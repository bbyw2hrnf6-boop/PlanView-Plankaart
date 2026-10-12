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
INTERPRETER_VERSION = 2


def status(port):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/status', timeout=6) as response:
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


def current_server(info):
    return (info.get('instance') == INSTANCE_ID and info.get('settingsVersion') == 1
            and info.get('interpreterVersion') == INTERPRETER_VERSION
            and info.get('model') == 'gpt-6-luna' and info.get('reasoning') == 'high')


def main():
    # A previously launched server can keep running after code updates. Only reuse
    # one that exposes the current settings and interpreter configuration.
    running = [(p, status(p) or {}) for p in PORTS]
    port = next((p for p, info in running if current_server(info)), None)
    if port is None:
        stale = next((p for p, info in running if info.get('instance') == INSTANCE_ID), None)
        if stale is not None:
            raise SystemExit(f'PlanView is still running with older AI settings on port {stale}. '
                             'Restart that PlanView server to apply this update. '
                             'Keeping the same port preserves access to your local cases and history.')
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
            if current_server(status(port) or {}):
                break
            if process.poll() is not None:
                raise SystemExit(f'PlanView could not start. See {log_path}')
            time.sleep(0.1)
        else:
            raise SystemExit(f'PlanView did not become ready. See {log_path}')
    url = f'http://127.0.0.1:{port}/'
    print(f'PlanView ready: {url}')
    info = status(port) or {}
    print('AI: GPT-6 Luna · High reasoning via Codex CLI' if info.get('backend') == 'codex-cli'
          else 'AI: GPT-6 Luna · High reasoning via API' if info.get('backend') == 'openai-api'
          else 'AI: local text interpreter (Codex sign-in not found)')
    if '--no-browser' not in sys.argv:
        if sys.platform == 'darwin':
            subprocess.run(['/usr/bin/open', url], check=True)
        else:
            webbrowser.open(url, new=2)


if __name__ == '__main__':
    main()
