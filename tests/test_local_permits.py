import io
import json
import subprocess
import sys
import unittest
from email.message import Message
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import local_permits as permits
import server

INPUT = {'point': {'lat': 50.85, 'lng': 5.69}}
RESULT = {'version': 1, 'cases': [], 'coverage': {'complete': False, 'partial': False}}


class LocalPermits(unittest.TestCase):
    def setUp(self):
        permits._CACHE.clear()
        permits._REQUESTS.clear()

    def test_invalid_inputs_never_start_shared_engine(self):
        for value in [None, [], dict(INPUT, url='https://evil.test'),
                      {'point': {'lat': True, 'lng': 5.69}},
                      {'point': {'lat': float('nan'), 'lng': 5.69}},
                      {'point': {'lat': 49, 'lng': 5.69}},
                      dict(INPUT, parcelId='hello" OR foo'), dict(INPUT, cursor='https://evil.test')]:
            with patch.object(permits, 'permits_node', side_effect=AssertionError('No engine call')):
                with self.assertRaises(permits.PermitError) as error:
                    permits.permit_history(value)
                self.assertEqual(error.exception.status, 400)

    def test_cached_results_are_separate_and_expire_without_background_calls(self):
        with patch.object(permits.time, 'monotonic', return_value=100), patch.object(permits, 'permits_node', return_value=RESULT) as engine:
            first = permits.permit_history(INPUT)
            first['cases'].append({'id': 'mutated'})
            again = permits.permit_history(INPUT)
            self.assertEqual(again['cases'], [])
            self.assertEqual(engine.call_count, 1)
            self.assertEqual(len(permits._REQUESTS), 1)
            permits.permit_history(dict(INPUT, cursor='eyJwYWdlIjoyfQ'))
            self.assertEqual(engine.call_count, 2)
        with patch.object(permits.time, 'monotonic', return_value=401), patch.object(permits, 'permits_node', return_value=RESULT) as engine:
            permits.permit_history(INPUT)
            self.assertEqual(engine.call_count, 1)

    def test_concurrent_and_excessive_uncached_requests_are_bounded(self):
        permits._LOCK.acquire()
        try:
            with self.assertRaises(permits.PermitError) as error:
                permits.permit_history(INPUT)
            self.assertEqual(error.exception.status, 429)
        finally:
            permits._LOCK.release()
        with patch.object(permits.time, 'monotonic', return_value=100), patch.object(permits, 'permits_node', return_value=RESULT) as engine:
            for index in range(40):
                permits.permit_history({'point': {'lat': 50.85, 'lng': 5.69 + index / 10000}})
            with self.assertRaises(permits.PermitError) as error:
                permits.permit_history({'point': {'lat': 50.9, 'lng': 5.7}})
            self.assertEqual((error.exception.status, error.exception.code), (429, 'permit_request_limit'))
            self.assertEqual(engine.call_count, 40)

    def test_cli_errors_preserve_status_without_echoing_provider_output(self):
        for data, status, code in [({'error': 'invalid_permit_cursor', 'status': 400}, 400, 'invalid_permit_cursor'),
                                   ({'error': 'permit_request_limit', 'status': 429}, 429, 'permit_request_limit'),
                                   ({'error': 'secret provider body', 'status': 502}, 502, 'permit_sources_unavailable')]:
            result = SimpleNamespace(stdout=json.dumps(data), returncode=1)
            with patch.object(permits.shutil, 'which', return_value=sys.executable), patch.object(permits.subprocess, 'run', return_value=result):
                with self.assertRaises(permits.PermitError) as error:
                    permits.permits_node(INPUT)
                self.assertEqual((error.exception.status, error.exception.code), (status, code))
        with patch.object(permits.shutil, 'which', return_value=sys.executable), patch.object(permits.subprocess, 'run', side_effect=subprocess.TimeoutExpired('node', 60)):
            with self.assertRaises(permits.PermitError) as error:
                permits.permits_node(INPUT)
            self.assertEqual(error.exception.code, 'permit_sources_unavailable')

    def handler(self, payload=INPUT, origin='http://127.0.0.1:4174'):
        handler = object.__new__(server.Handler)
        handler.path = '/api/permits/point'
        handler.server = SimpleNamespace(server_port=4174)
        handler.headers = Message()
        raw = json.dumps(payload).encode()
        for key, value in {'Host': '127.0.0.1:4174', 'Origin': origin, 'Content-Type': 'application/json', 'Content-Length': str(len(raw))}.items():
            handler.headers[key] = value
        handler.rfile = io.BytesIO(raw)
        captured = []
        handler.send_json = lambda status, data: captured.append((status, data))
        return handler, captured

    def test_endpoint_is_key_free_and_same_origin_only(self):
        handler, captured = self.handler()
        with patch.object(server, 'credentials', side_effect=AssertionError('No credentials needed')), patch.object(server, 'permit_history', return_value=RESULT):
            handler.do_POST()
        self.assertEqual(captured, [(200, RESULT)])
        handler, captured = self.handler(origin='https://evil.test')
        with patch.object(server, 'permit_history', side_effect=AssertionError('No cross-origin request')):
            handler.do_POST()
        self.assertEqual(captured[0][0], 403)
        handler, captured = self.handler()
        with patch.object(server, 'permit_history', side_effect=permits.PermitError(429, 'permit_request_limit')):
            handler.do_POST()
        self.assertEqual(captured, [(429, {'error': 'permit_request_limit'})])


if __name__ == '__main__':
    unittest.main()
