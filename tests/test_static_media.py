import io
import sys
import tempfile
import unittest
from email.message import Message
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class StaticMedia(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.media = bytes(range(256)) * 5
        (self.root / 'demo.mp4').write_bytes(self.media)
        (self.root / 'empty.mp4').write_bytes(b'')

    def request(self, headers=None, method='GET', name='demo.mp4'):
        handler = object.__new__(server.Handler)
        handler.path = '/' + name
        handler.command = method
        handler.headers = Message()
        for key, value in (headers or {}).items():
            handler.headers[key] = value
        handler.translate_path = lambda path: str(self.root / name)
        handler.wfile = io.BytesIO()
        result = {'headers': {}}
        handler.send_response = lambda code: result.update(status=code)
        handler.send_header = lambda key, value: result['headers'].update({key: value})
        handler.end_headers = lambda: None
        handler.send_error = lambda code, *args: result.update(status=code)
        with patch.object(server, 'credentials', side_effect=AssertionError('Static media cannot read credentials')):
            (handler.do_HEAD if method == 'HEAD' else handler.do_GET)()
        result['body'] = handler.wfile.getvalue()
        return result

    def test_full_response_advertises_seek_support(self):
        response = self.request()
        self.assertEqual(response['status'], 200)
        self.assertEqual(response['body'], self.media)
        self.assertEqual(response['headers']['Accept-Ranges'], 'bytes')
        self.assertEqual(response['headers']['Content-Length'], str(len(self.media)))
        self.assertEqual(response['headers']['Content-Type'], 'video/mp4')
        self.assertNotIn('Content-Range', response['headers'])

    def test_closed_open_and_suffix_ranges_match_exact_bytes(self):
        for requested, start, end in [('bytes=12-31', 12, 31), ('bytes=1270-', 1270, 1279),
                                      ('bytes=-23', 1257, 1279), ('bytes=1200-9999', 1200, 1279),
                                      ('bytes=-9999', 0, 1279), ('bytes=0-0', 0, 0)]:
            with self.subTest(requested=requested):
                response = self.request({'Range': requested})
                self.assertEqual(response['status'], 206)
                self.assertEqual(response['body'], self.media[start:end + 1])
                self.assertEqual(response['headers']['Content-Range'], f'bytes {start}-{end}/1280')
                self.assertEqual(response['headers']['Content-Length'], str(end - start + 1))

    def test_unsatisfiable_and_malformed_single_ranges_are_416(self):
        for requested in ['bytes=1280-', 'bytes=42-10', 'bytes=-0', 'bytes=-', 'bytes=abc-def']:
            with self.subTest(requested=requested):
                response = self.request({'Range': requested})
                self.assertEqual(response['status'], 416)
                self.assertEqual(response['headers']['Content-Range'], 'bytes */1280')
                self.assertEqual(response['headers']['Content-Length'], '0')
                self.assertEqual(response['body'], b'')
        response = self.request({'Range': 'bytes=0-'}, name='empty.mp4')
        self.assertEqual(response['status'], 416)
        self.assertEqual(response['headers']['Content-Range'], 'bytes */0')

    def test_head_has_full_headers_and_no_body_even_with_range(self):
        for headers in [{}, {'Range': 'bytes=10-19'}]:
            response = self.request(headers, method='HEAD')
            self.assertEqual(response['status'], 200)
            self.assertEqual(response['body'], b'')
            self.assertEqual(response['headers']['Content-Length'], '1280')
            self.assertEqual(response['headers']['Accept-Ranges'], 'bytes')
            self.assertNotIn('Content-Range', response['headers'])

    def test_unsupported_multi_ranges_and_units_fall_back_to_full_response(self):
        for requested in ['bytes=0-9,20-29', 'items=0-2']:
            response = self.request({'Range': requested})
            self.assertEqual(response['status'], 200)
            self.assertEqual(response['body'], self.media)
            self.assertNotIn('Content-Range', response['headers'])

    def test_conditionals_and_if_range_never_splice_stale_representations(self):
        initial = self.request()['headers']
        for validator in [initial['ETag'], initial['Last-Modified']]:
            response = self.request({'Range': 'bytes=20-29', 'If-Range': validator})
            self.assertEqual(response['status'], 206)
            self.assertEqual(response['body'], self.media[20:30])
        for stale in ['"old-revision"', 'W/' + initial['ETag'], 'Sat, 01 Jan 2000 00:00:00 GMT', 'not a date']:
            response = self.request({'Range': 'bytes=20-29', 'If-Range': stale})
            self.assertEqual(response['status'], 200)
            self.assertEqual(response['body'], self.media)
        for headers in [{'If-Modified-Since': initial['Last-Modified']},
                        {'If-None-Match': initial['ETag']}, {'If-None-Match': 'W/' + initial['ETag']}]:
            response = self.request(headers)
            self.assertEqual(response['status'], 304)
            self.assertEqual(response['body'], b'')
        response = self.request({'If-None-Match': '"other"', 'If-Modified-Since': initial['Last-Modified']})
        self.assertEqual(response['status'], 200, 'ETag condition takes precedence over modification date')

    def test_partial_copy_never_reads_beyond_selected_bytes(self):
        class TrackingSource(io.BytesIO):
            def __init__(self, data):
                super().__init__(data)
                self.read_sizes = []

            def read(self, size=-1):
                self.read_sizes.append(size)
                return super().read(size)

        source = TrackingSource(b'x' * 200000)
        source.seek(31)
        handler = object.__new__(server.Handler)
        handler._media_remaining = 65536 + 17
        output = io.BytesIO()
        handler.copyfile(source, output)
        self.assertEqual(source.read_sizes, [65536, 17])
        self.assertEqual(source.tell(), 31 + 65536 + 17)
        self.assertEqual(len(output.getvalue()), 65536 + 17)
        self.assertIsNone(handler._media_remaining)

    def test_static_security_blocks_hidden_and_private_paths_before_reading(self):
        for name in ['.private/demo.mp4', 'cloud/demo.mp4', 'tools/demo.mp4', 'server.py', '%2Eprivate/demo.mp4']:
            for method in ['GET', 'HEAD']:
                response = self.request({'Range': 'bytes=0-9'}, method=method, name=name)
                self.assertEqual(response['status'], 404)
                self.assertEqual(response['body'], b'')


if __name__ == '__main__':
    unittest.main()
