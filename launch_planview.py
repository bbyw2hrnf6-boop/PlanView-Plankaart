"""One-click launcher: reuse this project server or start it in the background."""
import hashlib
import json
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INSTANCE_ID = hashlib.sha256(str(ROOT).encode()).hexdigest()[:12]
PORTS = range(4174, 4185)


def status(port):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/status', timeout=0.7) as response:
            return json.load(response)
    except (OSError, ValueError, urllib.error.URLError):
        return None


def available(port):
    with socket.socket() as sock:
        try:
            sock.bind(('127.0.0.1', port))
            return True
        except OSError:
            return False


def main():
    port = next((p for p in PORTS if (status(p) or {}).get('instance') == INSTANCE_ID), None)
    if port is None:
        port = next((p for p in PORTS if available(p)), None)
        if port is None:
            raise SystemExit('No free PlanView port found (4174–4184).')
        log_path = ROOT / 'planview-server.log'
        with log_path.open('ab') as log:
            process = subprocess.Popen([sys.executable, '-u', str(ROOT / 'server.py'), str(port)],
                                       cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log,
                                       stderr=subprocess.STDOUT, start_new_session=True,
                                       close_fds=True)
        for _ in range(60):
            if (status(port) or {}).get('instance') == INSTANCE_ID:
                break
            if process.poll() is not None:
                raise SystemExit(f'PlanView could not start. See {log_path}')
            time.sleep(0.1)
        else:
            raise SystemExit(f'PlanView did not become ready. See {log_path}')
    url = f'http://127.0.0.1:{port}/'
    print(f'PlanView ready: {url}')
    info = status(port) or {}
    print('AI: GPT-6 Luna via Codex CLI' if info.get('backend') == 'codex-cli'
          else 'AI: GPT-6 Luna via API' if info.get('backend') == 'openai-api'
          else 'AI: local text interpreter (Codex sign-in not found)')
    if '--no-browser' not in sys.argv:
        if sys.platform == 'darwin':
            subprocess.run(['/usr/bin/open', url], check=True)
        else:
            webbrowser.open(url, new=2)


if __name__ == '__main__':
    main()
