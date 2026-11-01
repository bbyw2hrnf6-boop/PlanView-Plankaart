import io
import json
import sys
import tempfile
import unittest
import urllib.error
from email.message import Message
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import local_routes as routes
import local_services as services
import server

INPUT = {'origins': [{'lat': 50.86, 'lng': 5.69}], 'target': {'lat': 50.85, 'lng': 5.71, 'label': 'Station'}, 'mode': 'walking'}
KEY = 'eyJ-routing-fixture-not-a-real-secret.payload.signature'


class LocalRoutes(unittest.TestCase):
    def setUp(self):
        routes._REQUESTS.clear()
        routes._OSRM_LAST_START = None

    def test_strict_input_before_any_provider_request(self):
        for data in [dict(INPUT, mode='flight'), dict(INPUT, origins=INPUT['origins']*4), dict(INPUT, url='https://evil.test'), dict(INPUT, target={'lat': True, 'lng': 5.7})]:
            with self.assertRaises(routes.RoutingError):
                routes.clean_route_input(data)
        with self.assertRaises(routes.RoutingError) as error:
            routes.route_matrix(dict(INPUT, target={'lat': float('nan'), 'lng': 5.7}), None,
                                opener=lambda *a, **k: self.fail('Invalid coordinates cannot invoke a provider'))
        self.assertEqual(error.exception.code, 'invalid_route_point')

    def test_model_response_and_provider_errors_never_echo_secret(self):
        def opener(request, timeout):
            self.assertEqual(request.full_url, 'https://api.heigit.org/openrouteservice/v2/matrix/foot-walking')
            self.assertEqual(request.get_header('Authorization'), KEY)
            self.assertEqual(timeout, 12)
            self.assertEqual(json.loads(request.data)['locations'], [[5.69, 50.86], [5.71, 50.85]])
            return io.BytesIO(b'{"durations":[[111]],"distances":[[401]]}')
        data = routes.route_matrix(INPUT, KEY, opener=opener)
        self.assertEqual(data['routes'][0]['durationSeconds'], 111)
        self.assertFalse(data['liveTraffic'])
        self.assertNotIn(KEY, json.dumps(data))
        def denied(*args, **kwargs):
            raise urllib.error.HTTPError('https://api.heigit.org/', 401, KEY, {}, None)
        with self.assertRaises(routes.RoutingError) as error:
            routes.route_matrix(INPUT, KEY, opener=denied)
        self.assertEqual(str(error.exception), 'routing_key_rejected')

    def test_null_and_invalid_responses_never_become_zero_times(self):
        data = routes.route_matrix(INPUT, KEY, opener=lambda *a, **k: io.BytesIO(b'{"durations":[[null]],"distances":[[401]]}'))
        self.assertEqual(data['routes'][0]['status'], 'unavailable')
        self.assertIsNone(data['routes'][0]['durationSeconds'])
        for raw in [b'{"durations":[[true]],"distances":[[401]]}', b'{"durations":[],"distances":[]}', b'{}', b'[]', b'null']:
            with self.assertRaises(routes.RoutingError) as error:
                routes.route_matrix(INPUT, KEY, opener=lambda *a, **k: io.BytesIO(raw))
            self.assertEqual(error.exception.code, 'invalid_routing_response')

    def test_no_account_batch_profiles_order_headers_and_attribution(self):
        payload = dict(INPUT, origins=[{'lat': 50.86, 'lng': 5.69}, {'lat': 50.87, 'lng': 5.7}, {'lat': 50.88, 'lng': 5.72}])
        for index, (mode, profile) in enumerate([('walking', 'foot'), ('cycling', 'bike'), ('driving', 'car')]):
            def opener(request, timeout):
                self.assertEqual(request.get_method(), 'GET')
                self.assertEqual(request.full_url, 'https://routing.openstreetmap.de/routed-' + profile
                                 + '/table/v1/driving/5.69,50.86;5.7,50.87;5.72,50.88;5.71,50.85'
                                 + '?sources=0;1;2&destinations=3&annotations=duration,distance&generate_hints=false')
                self.assertIsNone(request.data)
                self.assertIsNone(request.get_header('Authorization'))
                self.assertEqual(request.get_header('User-agent'), 'PlanView/1.0 (' + routes.PLANVIEW_URL + ')')
                self.assertEqual(request.get_header('Referer'), routes.PLANVIEW_URL)
                self.assertNotIn('Station', request.full_url)
                self.assertNotIn('fallback_speed', request.full_url)
                self.assertEqual(timeout, 12)
                return io.BytesIO(b'{"code":"Ok","durations":[[111],[222],[null]],"distances":[[401],[802],[null]]}')
            with patch.object(routes.time, 'monotonic', return_value=100 + index * 2):
                result = routes.route_matrix(dict(payload, mode=mode), None, opener=opener)
            self.assertEqual(result['provider'], 'osrm')
            self.assertEqual(result['profile'], profile)
            self.assertEqual(result['mode'], mode)
            self.assertEqual(result['sourceUrl'], 'https://routing.openstreetmap.de/about.html')
            self.assertEqual(result['attributionUrl'], 'https://www.openstreetmap.org/copyright')
            self.assertEqual(result['editUrl'], 'https://www.openstreetmap.org/fixthemap')
            self.assertEqual([row['origin'] for row in result['routes']], payload['origins'])
            self.assertEqual([row['durationSeconds'] for row in result['routes']], [111, 222, None])
            self.assertEqual(result['routes'][2]['status'], 'unavailable')
            self.assertIsNone(result['routes'][2]['distanceMeters'])
            self.assertTrue(result['modeled'])
            self.assertFalse(result['liveTraffic'])

    def test_osrm_one_global_start_per_1_1_seconds_across_modes(self):
        opener = lambda *a, **k: io.BytesIO(b'{"code":"Ok","durations":[[100]],"distances":[[400]]}')
        with patch.object(routes.time, 'monotonic', return_value=100):
            routes.route_matrix(INPUT, None, opener=opener)
        for at in (100, 100.5, 101.09):
            with patch.object(routes.time, 'monotonic', return_value=at), self.assertRaises(routes.RoutingError) as error:
                routes.route_matrix(dict(INPUT, mode='cycling'), None, opener=lambda *a, **k: self.fail('Rate limit must precede provider'))
            self.assertEqual((error.exception.status, error.exception.code), (429, 'routing_limit'))
        self.assertEqual(len(routes._REQUESTS), 1)
        with patch.object(routes.time, 'monotonic', return_value=101.11):
            self.assertEqual(routes.route_matrix(dict(INPUT, mode='driving'), None, opener=opener)['provider'], 'osrm')

    def test_existing_twelve_per_five_minutes_limit_includes_account_free_requests(self):
        opener = lambda *a, **k: io.BytesIO(b'{"code":"Ok","durations":[[100]],"distances":[[400]]}')
        for index in range(12):
            with patch.object(routes.time, 'monotonic', return_value=100 + index * 2):
                routes.route_matrix(INPUT, None, opener=opener)
        with patch.object(routes.time, 'monotonic', return_value=130), self.assertRaises(routes.RoutingError) as error:
            routes.route_matrix(INPUT, None, opener=lambda *a, **k: self.fail('No thirteenth request'))
        self.assertEqual(error.exception.status, 429)
        with patch.object(routes.time, 'monotonic', return_value=422):
            self.assertEqual(routes.route_matrix(INPUT, None, opener=opener)['provider'], 'osrm')

    def test_osrm_invalid_fallback_or_incomplete_output_never_fabricates_routes(self):
        invalid = [b'{}', b'null', b'[]', b'{"code":"NoTable"}',
                   b'{"code":"Ok","durations":[[true]],"distances":[[400]]}',
                   b'{"code":"Ok","durations":[[NaN]],"distances":[[400]]}',
                   b'{"code":"Ok","durations":[[100]],"distances":[[-1]]}',
                   b'{"code":"Ok","durations":[[100],[200]],"distances":[[400]]}',
                   b'{"code":"Ok","durations":[[100]],"distances":[[400]],"fallback_speed_cells":[]}',
                   b'x' * 64001]
        for index, raw in enumerate(invalid):
            with patch.object(routes.time, 'monotonic', return_value=100 + index * 2), self.assertRaises(routes.RoutingError) as error:
                routes.route_matrix(INPUT, None, opener=lambda *a, **k: io.BytesIO(raw))
            self.assertEqual(error.exception.code, 'invalid_routing_response')
        with patch.object(routes.time, 'monotonic', return_value=130):
            result = routes.route_matrix(INPUT, None, opener=lambda *a, **k: io.BytesIO(b'{"code":"Ok","durations":[[null]],"distances":[[400]]}'))
        self.assertEqual(result['routes'][0]['status'], 'unavailable')
        self.assertIsNone(result['routes'][0]['durationSeconds'])
        self.assertIsNone(result['routes'][0]['distanceMeters'])

    def test_osrm_errors_redirects_and_concurrent_requests_are_bounded(self):
        for index, code in enumerate((302, 401, 429, 503)):
            def rejected(*args, **kwargs):
                raise urllib.error.HTTPError('https://routing.openstreetmap.de/', code, 'private provider detail', {}, None)
            with patch.object(routes.time, 'monotonic', return_value=100 + index * 2), self.assertRaises(routes.RoutingError) as error:
                routes.route_matrix(INPUT, None, opener=rejected)
            self.assertEqual(error.exception.code, 'routing_limit' if code == 429 else 'routing_unavailable')
            self.assertNotIn('private provider detail', str(error.exception))
        with self.assertRaises(routes.RoutingError) as error:
            routes._LOCK.acquire()
            try:
                routes.route_matrix(INPUT, None, opener=lambda *a, **k: self.fail('No concurrent request'))
            finally:
                routes._LOCK.release()
        self.assertEqual(error.exception.status, 429)
        self.assertIsNone(routes._NoRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.test'))

    def test_optional_ors_key_selects_ors_and_never_silently_falls_back_after_rejection(self):
        calls = []
        def rejected(request, timeout):
            calls.append(request.full_url)
            self.assertTrue(request.full_url.startswith('https://api.heigit.org/openrouteservice/'))
            self.assertEqual(request.get_header('Authorization'), KEY)
            raise urllib.error.HTTPError(request.full_url, 403, KEY, {}, None)
        with self.assertRaises(routes.RoutingError) as error:
            routes.route_matrix(INPUT, KEY, opener=rejected)
        self.assertEqual(error.exception.code, 'routing_key_rejected')
        self.assertEqual(len(calls), 1)
        self.assertIsNone(routes._OSRM_LAST_START)

    def test_local_status_exposes_account_free_availability_without_credentials(self):
        for has_key in (False, True):
            handler = object.__new__(server.Handler)
            handler.path = '/api/routes/status'
            handler.blocked_file = lambda: False
            handler.same_local_origin = lambda: True
            captured = []
            handler.send_json = lambda status, data: captured.append((status, data))
            with patch.object(server, 'credentials', return_value={'ors': KEY} if has_key else {}):
                handler.do_GET()
            status, data = captured[0]
            self.assertEqual(status, 200)
            self.assertEqual(data, {'configured': has_key, 'available': True, 'requiresKey': False,
                                    'provider': 'ors' if has_key else 'osrm', 'storage': 'local-device'})
            self.assertNotIn(KEY, json.dumps(data))

    def test_ors_key_storage_preserves_other_credentials_and_permissions(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp) / 'config'
            with patch.object(services, 'CONFIG_DIR', folder), patch.object(services, 'CONFIG_FILE', folder / 'credentials.json'):
                services.save_credentials({'dso': 'fixture-dso-secret'})
                self.assertTrue(services.save_credentials({'ors': KEY})['ors'])
                self.assertEqual(services.credentials()['dso'], 'fixture-dso-secret')
                self.assertEqual(services.CONFIG_FILE.stat().st_mode & 0o777, 0o600)
                services.save_credentials({'ors': ''})
                self.assertNotIn('ors', services.credentials())
                self.assertIn('dso', services.credentials())

    def test_local_route_endpoint_rejects_cross_origin_before_secret_or_provider_access(self):
        handler = object.__new__(server.Handler)
        handler.path = '/api/routes'
        handler.server = SimpleNamespace(server_port=4174)
        handler.headers = Message()
        for name, value in {'Host': '127.0.0.1:4174', 'Origin': 'https://evil.test', 'Content-Type': 'application/json'}.items():
            handler.headers[name] = value
        captured = []
        handler.send_json = lambda status, data: captured.append((status, data))
        with patch.object(server, 'credentials', side_effect=AssertionError('Do not access secret')), patch.object(server, 'route_matrix', side_effect=AssertionError('Do not invoke provider')):
            handler.do_POST()
        self.assertEqual(captured[0][0], 403)


if __name__ == '__main__':
    unittest.main()
