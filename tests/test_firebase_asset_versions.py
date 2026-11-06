import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

TOOLS=Path(__file__).resolve().parents[1]/'tools'
sys.path.insert(0,str(TOOLS))
try:
    spec=importlib.util.spec_from_file_location('firebase_release_assets',TOOLS/'firebase_release.py')
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
finally:
    sys.path.remove(str(TOOLS))

class FirebaseAssetVersions(unittest.TestCase):
    def test_changed_bytes_get_new_urls_and_existing_options_remain(self):
        with tempfile.TemporaryDirectory() as temp:
            public=Path(temp);file=public/'app.js';file.write_text('first')
            markup='<script src="./app.js?v=old&amp;feature=1"></script>'
            first=module.version_browser_assets(markup,public)
            self.assertIn('feature=1&amp;pv=',first)
            self.assertNotIn('v=old',first)
            self.assertEqual(first,module.version_browser_assets(first,public))
            file.write_text('second')
            self.assertNotEqual(first,module.version_browser_assets(markup,public))

    def test_styles_auth_and_external_or_non_asset_urls(self):
        with tempfile.TemporaryDirectory() as temp:
            public=Path(temp)
            for name in ['styles.css','firebase-auth.js']:(public/name).write_text(name)
            external='<script src="https://cdn.example/x.js?v=1"></script><a href="guide.html">Guide</a>'
            result=module.version_browser_assets('<link href="/styles.css"><script src="/firebase-auth.js"></script>'+external,public)
            self.assertIn('/styles.css?pv=',result);self.assertIn('/firebase-auth.js?pv=',result)
            self.assertTrue(result.endswith(external))
            for path in ['missing.js','../escape.js']:
                with self.assertRaises(ValueError):module.version_browser_assets(f'<script src="{path}"></script>',public)
