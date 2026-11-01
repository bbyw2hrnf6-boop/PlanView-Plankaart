"""Key-free permit history: bounded local bridge to the shared cloud engine."""
import copy
import json
import math
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
_LOCK = threading.Lock()
_CACHE = {}
_REQUESTS = []
CACHE_SECONDS = 300
MAX_REQUESTS = 40  # PlanView's own budget, not a published KOOP quota.


class PermitError(Exception):
    def __init__(self, status, code):
        super().__init__(code)
        self.status, self.code = status, code


def clean_permit_input(value):
    if not isinstance(value, dict) or set(value) - {'point', 'parcelId', 'cursor'}:
        raise PermitError(400, 'invalid_permit_request')
    point = value.get('point')
    if (not isinstance(point, dict) or set(point) != {'lat', 'lng'}
            or any(type(point.get(k)) not in (float, int) or not math.isfinite(point[k]) for k in ('lat', 'lng'))
            or not 50 <= point['lat'] <= 54 or not 3 <= point['lng'] <= 8):
        raise PermitError(400, 'invalid_permit_request')
    result = {'point': {k: point[k] for k in ('lat', 'lng')}}
    if 'parcelId' in value:
        if not isinstance(value['parcelId'], str) or not re.fullmatch(r'[A-Za-z0-9_.:/-]{1,160}', value['parcelId']):
            raise PermitError(400, 'invalid_permit_request')
        result['parcelId'] = value['parcelId']
    if 'cursor' in value:
        if not isinstance(value['cursor'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,600}', value['cursor']):
            raise PermitError(400, 'invalid_permit_cursor')
        result['cursor'] = value['cursor']
    return result


def clean_permit_question_input(value):
    if not isinstance(value, dict) or set(value) - {'point', 'parcelId', 'query', 'language'}:
        raise PermitError(400, 'invalid_permit_question')
    if not isinstance(value.get('query'), str) or not 1 <= len(value['query'].strip()) <= 1000:
        raise PermitError(400, 'invalid_permit_question')
    if 'language' in value and value['language'] not in ('en', 'nl', 'de'):
        raise PermitError(400, 'invalid_permit_question')
    location = clean_permit_input({k: value[k] for k in ('point', 'parcelId') if k in value})
    return {**location, 'query': value['query'].strip(), 'language': value.get('language', 'en')}


def permit_questions_node(payload):
    candidates = [shutil.which('node'), '/opt/homebrew/bin/node', '/usr/local/bin/node',
                  '/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node']
    node = next((str(p) for p in candidates if p and Path(p).is_file()), None)
    if not node:
        raise PermitError(503, 'permit_engine_unavailable')
    try:
        result = subprocess.run([node, str(ROOT / 'cloud/lib/permit-questions-cli.mjs')],
                                input=json.dumps(payload), capture_output=True,
                                text=True, timeout=60, cwd=ROOT)
        if len(result.stdout) > 4_000_000:
            raise ValueError()
        data = json.loads(result.stdout)
        if not isinstance(data, dict):
            raise ValueError()
    except (OSError, ValueError, subprocess.TimeoutExpired):
        raise PermitError(502, 'permit_question_sources_unavailable') from None
    if data.get('error'):
        status, code = data.get('status', 502), data['error']
        if status not in (400, 429, 502, 503) or not isinstance(code, str) or not re.fullmatch(r'[a-z_]{1,80}', code):
            raise PermitError(502, 'permit_question_sources_unavailable')
        raise PermitError(status, code)
    if result.returncode:
        raise PermitError(502, 'permit_question_sources_unavailable')
    return data


def permits_node(value):
    candidates = [shutil.which('node'), '/opt/homebrew/bin/node', '/usr/local/bin/node',
                  '/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node']
    node = next((str(p) for p in candidates if p and Path(p).is_file()), None)
    if not node:
        raise PermitError(503, 'permit_engine_unavailable')
    try:
        result = subprocess.run([node, str(ROOT / 'cloud/lib/permits-cli.mjs')],
                                input=json.dumps({'input': value}), capture_output=True,
                                text=True, timeout=60, cwd=ROOT)
        if len(result.stdout) > 4_000_000:
            raise ValueError()
        data = json.loads(result.stdout)
        if not isinstance(data, dict):
            raise ValueError()
    except (OSError, ValueError, subprocess.TimeoutExpired):
        raise PermitError(502, 'permit_sources_unavailable') from None
    if data.get('error'):
        status = data.get('status', 502)
        code = data['error']
        if status not in (400, 429, 502, 503) or not isinstance(code, str) or not re.fullmatch(r'[a-z_]{1,80}', code):
            raise PermitError(502, 'permit_sources_unavailable')
        raise PermitError(status, code)
    if result.returncode or data.get('version') != 1 or not isinstance(data.get('cases'), list):
        raise PermitError(502, 'permit_sources_unavailable')
    return data


def permit_history(payload):
    value = clean_permit_input(payload)
    key = json.dumps(value, sort_keys=True, separators=(',', ':'))
    if not _LOCK.acquire(blocking=False):
        raise PermitError(429, 'permit_request_limit')
    try:
        now = time.monotonic()
        for old in [k for k, (at, _) in _CACHE.items() if now - at >= CACHE_SECONDS]:
            del _CACHE[old]
        if key in _CACHE:
            return copy.deepcopy(_CACHE[key][1])
        _REQUESTS[:] = [at for at in _REQUESTS if now - at < 300]
        if len(_REQUESTS) >= MAX_REQUESTS:
            raise PermitError(429, 'permit_request_limit')
        _REQUESTS.append(now)
        response = permits_node(value)
        if len(_CACHE) >= 60:
            del _CACHE[next(iter(_CACHE))]
        _CACHE[key] = (time.monotonic(), copy.deepcopy(response))
        return response
    finally:
        _LOCK.release()
