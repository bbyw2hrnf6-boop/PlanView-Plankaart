"""Maintenance writers and release validation must keep exact source bytes."""
import ast
import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def load_module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class LosslessContextPackaging(unittest.TestCase):
    def test_context_updater_regenerates_both_camping_copies(self):
        module = load_module('packaging_context', 'update_context.py')
        with tempfile.TemporaryDirectory() as folder:
            module.OUT = Path(folder) / 'netherlands_context.json'
            point = {'id': 'source-1', 'geometry': {'type': 'Point', 'coordinates': [5.7, 50.9]}}
            module.write_context({'camping': [point], 'towns': [], 'industry': [], 'features': {}},
                                 {'source': 'PDOK', 'note': 'Fryslân'}, [point])
            for name in ['camping_sites.geojson', 'netherlands_context.json']:
                plain = Path(folder) / name
                self.assertEqual(gzip.decompress(Path(str(plain) + '.gz').read_bytes()), plain.read_bytes())
            self.assertEqual(json.loads((Path(folder) / 'camping_sites.geojson').read_bytes())['features'], [point])

    def test_project_writer_keeps_all_bytes_and_deterministic_gzip(self):
        # Load the actual pure writer without running the updater's network job.
        tree = ast.parse((ROOT / 'update_development_projects.py').read_text())
        writer = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'write_project_snapshot')
        namespace = {'gzip': gzip, 'json': json}
        exec(compile(ast.Module(body=[writer], type_ignores=[]), 'update_development_projects.py', 'exec'), namespace)
        payload = {'type': 'FeatureCollection', 'metadata': {'title': 'Fryslân'}, 'features': [{'id': 'retained'}]}
        with tempfile.TemporaryDirectory() as folder:
            plain = Path(folder) / 'development_projects.geojson'
            namespace['write_project_snapshot'](plain, payload)
            compressed = Path(str(plain) + '.gz').read_bytes()
            self.assertEqual(gzip.decompress(compressed), plain.read_bytes())
            self.assertEqual(json.loads(plain.read_bytes()), payload)
            namespace['write_project_snapshot'](plain, payload)
            self.assertEqual(Path(str(plain) + '.gz').read_bytes(), compressed)

    def test_release_omits_plain_duplicates_and_rejects_even_valid_json_mismatch(self):
        module = load_module('packaging_release', 'tools/cloud_release.py')
        with tempfile.TemporaryDirectory() as folder:
            module.ROOT = Path(folder)
            (module.ROOT / 'data').mkdir()
            (module.ROOT / 'index.html').write_text('<!doctype html>')
            for name in module.MAINTENANCE_ASSETS:
                plain = module.ROOT / name
                plain.write_bytes(b'{"source":"unchanged"}')
                Path(str(plain) + '.gz').write_bytes(gzip.compress(plain.read_bytes(), mtime=0))
            files = module.assets()
            for name in module.MAINTENANCE_ASSETS:
                self.assertNotIn(module.ROOT / name, files)
                self.assertIn(module.ROOT / (name + '.gz'), files)
            module.validate(files)
            different = module.ROOT / 'data/camping_sites.geojson.gz'
            different.write_bytes(gzip.compress(b'{"source":"changed"}', mtime=0))
            with self.assertRaisesRegex(ValueError, 'differs.*camping_sites'):
                module.validate(module.assets())

    def test_hosted_briefing_keeps_its_exact_video_and_rejects_missing_media(self):
        module = load_module('packaging_briefing', 'tools/cloud_release.py')
        with tempfile.TemporaryDirectory() as folder:
            module.ROOT = Path(folder)
            module.MAINTENANCE_ASSETS = ()
            (module.ROOT / 'index.html').write_text('<!doctype html>')
            (module.ROOT / 'briefing.html').write_text('<video src="./planview-demo.mp4"></video>')
            video = module.ROOT / 'planview-demo.mp4'
            video.write_bytes(b'original validated video bytes')
            files = module.assets()
            self.assertIn(video, files)
            module.validate(files)
            before = module.fingerprint(files)
            video.write_bytes(b'changed video bytes')
            self.assertNotEqual(before, module.fingerprint(files))
            with self.assertRaisesRegex(ValueError, 'omitted from publication'):
                module.validate([p for p in files if p != video])
            video.unlink()
            with self.assertRaisesRegex(ValueError, 'Missing briefing asset'):
                module.validate(module.assets())


if __name__ == '__main__':
    unittest.main()
