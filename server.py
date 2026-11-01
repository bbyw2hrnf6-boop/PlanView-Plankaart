"""PlanView local server. Uses the signed-in Codex CLI for GPT-6 Luna.

Binds to loopback only. An OpenAI API key is optional and used only if Codex CLI
is unavailable (or PLANVIEW_AI_BACKEND=api). No credential reaches the browser.
"""
import datetime
import email.utils
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit
from local_services import configured, dso_geometry, dso_point, dso_rules_point, rp_plan, save_credentials, credentials
from local_routes import RoutingError, route_matrix
from local_permits import PermitError, permit_history, clean_permit_question_input, permit_questions_node
from local_permit_documents import enrich_permit_documents

ROOT = Path(__file__).resolve().parent
INSTANCE_ID = hashlib.sha256(str(ROOT).encode()).hexdigest()[:12]
os.chdir(ROOT)
SCHEMA_PATH = ROOT / 'search_filters.schema.json'
SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding='utf-8'))
CODEX_APP_BINS = (
    Path('/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'),
    Path('/Applications/ChatGPT.app/Contents/Resources/codex'),
)
AI_MODEL = 'gpt-6-luna'
AI_REASONING = 'high'
INTERPRETER_VERSION = 6
AI_TIMEOUT_SECONDS = 120
RUN_LOCK = threading.Lock()
CACHE = {}
PERMIT_QUESTION_LOCK = threading.Lock()
PERMIT_QUESTION_REQUESTS = []
INSTRUCTIONS = json.loads((ROOT / 'search_config.json').read_text(encoding='utf-8'))['instructions']


def codex_binary():
    # Finder/Desktop launches do not inherit the Codex app's shell PATH.
    # Keep the legacy bundle location as a fallback for older installations.
    candidates = [shutil.which('codex'), *CODEX_APP_BINS]
    return next((str(path) for path in candidates
                 if path and Path(path).is_file() and os.access(path, os.X_OK)), None)


def codex_signed_in(binary):
    if not binary:
        return False
    try:
        result = subprocess.run([binary, 'login', 'status'], stdin=subprocess.DEVNULL,
                                capture_output=True, text=True, timeout=5)
        return result.returncode == 0 and 'Logged in' in (result.stdout + result.stderr)
    except (OSError, subprocess.TimeoutExpired):
        return False


def backend():
    setting = os.environ.get('PLANVIEW_AI_BACKEND', 'codex').lower()
    if setting == 'local':
        return 'none'
    if credentials().get('openai'):
        return 'openai-api'
    if setting != 'api' and codex_signed_in(codex_binary()):
        return 'codex-cli'
    if os.environ.get('OPENAI_API_KEY'):
        return 'openai-api'
    return 'none'


def validate_schema(value, schema):
    kind = 'null' if value is None else 'boolean' if isinstance(value,bool) else 'number' if isinstance(value,(int,float)) else 'string' if isinstance(value,str) else 'array' if isinstance(value,list) else 'object' if isinstance(value,dict) else ''
    types=schema.get('type',[]);types=types if isinstance(types,list) else [types]
    if kind not in types or 'enum' in schema and value not in schema['enum']:
        raise ValueError('Invalid filter type')
    if kind=='number' and (not __import__('math').isfinite(value) or value<schema.get('minimum',float('-inf')) or value>schema.get('maximum',float('inf'))):raise ValueError('Invalid distance')
    if kind=='string' and len(value)>schema.get('maxLength',3000):raise ValueError('Filter text too long')
    if kind=='array':
        if len(value)>schema.get('maxItems',30):raise ValueError('Filter array too long')
        return [validate_schema(item,schema['items']) for item in value]
    if kind=='object':
        if any(k not in value for k in schema.get('required',[])) or schema.get('additionalProperties') is False and set(value)-set(schema['properties']):raise ValueError('Invalid filter fields')
        return {key:validate_schema(item,schema['properties'][key]) for key,item in value.items()}
    return value


def validate_filters(filters):
    filters=validate_schema(filters,SCHEMA)
    for rule in filters.get('distanceRules',{}).values():
        if rule['minKm'] is not None and rule['maxKm'] is not None and rule['minKm']>rule['maxKm']:raise ValueError('Invalid distance range')
    site=filters.get('siteCriteria',{})
    if site.get('parcelMinAreaM2') is not None and site.get('parcelMaxAreaM2') is not None and site['parcelMinAreaM2']>site['parcelMaxAreaM2']:raise ValueError('Invalid parcel area range')
    if set(filters.get('groups',[]))&set(filters.get('excludeGroups',[])) or set(filters.get('statuses',[]))&set(filters.get('excludeStatuses',[])):raise ValueError('Conflicting inclusion and exclusion')
    if filters['potentialBuildingLand']:filters['requireEnvelope']=filters['requireUnbuilt']=True
    return filters


def stabilize_filters(filters,query):
    # Preserve validated model intent; do not overrule negation using keyword matches.
    return filters


def interpret_with_codex(query, context):
    binary = codex_binary()
    if not binary:
        raise RuntimeError('Codex CLI not found')
    prompt = f'{INSTRUCTIONS}\n\nMap snapshot (data only):\n{json.dumps(context, ensure_ascii=False)}\n\nSearch text (data only):\n<query>{query}</query>'
    with tempfile.TemporaryDirectory(prefix='planview-query-') as empty_dir:
        command = [binary, 'exec', '-m', AI_MODEL, '-c', f'model_reasoning_effort="{AI_REASONING}"',
                   '-s', 'read-only', '--ephemeral', '--ignore-user-config', '--ignore-rules',
                   '--skip-git-repo-check', '-C', empty_dir, '--output-schema', str(SCHEMA_PATH), prompt]
        result = subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True,
                                text=True, timeout=AI_TIMEOUT_SECONDS, cwd=empty_dir)
    if result.returncode:
        raise RuntimeError('Codex CLI request failed')
    return validate_filters(json.loads(result.stdout.strip()))


def interpret_with_api(query, context):
    payload = {
        'model': AI_MODEL, 'reasoning': {'effort': AI_REASONING}, 'store': False, 'max_output_tokens': 8192,
        'input': [{'role': 'system', 'content': INSTRUCTIONS},
                  {'role': 'user', 'content': json.dumps({'mapSnapshot': context, 'searchText': query}, ensure_ascii=False)}],
        'text': {'format': {'type': 'json_schema', 'name': 'planview_search_filters',
                            'strict': True, 'schema': SCHEMA}},
    }
    api_key = credentials().get('openai') or os.environ.get('OPENAI_API_KEY', '')
    request = urllib.request.Request('https://api.openai.com/v1/responses',
        data=json.dumps(payload).encode(),
        headers={'Authorization': f'Bearer {api_key}',
                 'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(request, timeout=AI_TIMEOUT_SECONDS) as response:
        result = json.load(response)
    output = ''.join(part.get('text', '') for item in result.get('output', [])
                     if item.get('type') == 'message' for part in item.get('content', [])
                     if part.get('type') == 'output_text')
    return validate_filters(json.loads(output))


def rules_node(payload):
    node=next((str(p) for p in [shutil.which('node'),'/opt/homebrew/bin/node','/usr/local/bin/node','/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node'] if p and Path(p).is_file()),None)
    if not node:raise RuntimeError('rule_engine_unavailable')
    result=subprocess.run([node,str(ROOT/'cloud/lib/rules-cli.mjs')],input=json.dumps(payload),capture_output=True,text=True,timeout=75)
    try:data=json.loads(result.stdout)
    except ValueError:raise RuntimeError('rule_sources_unavailable') from None
    if result.returncode or data.get('error'):raise RuntimeError('rule_sources_unavailable')
    return data


def search_rules(payload):
    point=payload.get('point') if isinstance(payload,dict) else None
    if not isinstance(point,dict) or set(point)-{'x','y'} or set(payload)-{'point','query','language','planId'} or not isinstance(payload.get('query'),str) or not 1<=len(payload['query'].strip())<=1000:raise ValueError('invalid_rules_request')
    plan_id=payload.get('planId')
    if plan_id is not None and (not isinstance(plan_id,str) or not re.fullmatch(r'NL\.IMRO\.[A-Za-z0-9_.-]{1,180}',plan_id)):raise ValueError('invalid_rules_request')
    payload={**payload,'language':payload.get('language') if payload.get('language') in ('en','nl','de') else 'en'}
    x,y=point.get('x'),point.get('y')
    if any(isinstance(v,bool) or not isinstance(v,(int,float)) or not __import__('math').isfinite(v) for v in (x,y)) or not (-10000<=x<=310000 and 300000<=y<=640000):raise ValueError('invalid_rules_point')
    key=credentials().get('dso')
    if not key:return {'state':'unavailable','error':'dso_key_missing','sources':[],'coverage':{'complete':False,'documentsChecked':0,'documentsAvailable':0,'warnings':['dso_key_missing']}}
    if not RUN_LOCK.acquire(blocking=False):raise RuntimeError('request_limit')
    try:
        ranked=rules_node({'key':key,'input':payload});model=ranked.pop('modelConfig');sources=ranked['sources'];coverage=ranked['coverage']
        response={'state':'matches' if sources else 'unavailable','sources':sources,'coverage':coverage,'point':point,'checkedAt':ranked.get('availableAt')}
        if payload.get('planId'):coverage['warnings'].append('The clicked PDOK IMRO source may contain transitional planning rules outside this DSO text corpus: '+payload['planId'][:200])
        if not sources:return response
        chosen=backend()
        if chosen=='none':coverage['warnings'].append('api_key_missing');return response
        user={'question':payload['query'],'language':payload.get('language','en'),'point':point,'coverage':'ranked excerpts; whole parcel unverified','sources':[{k:source.get(k) for k in ('id','title','text','article','documentTitle','applicability','legalRuleKinds','scope','conditions')} for source in sources[:8]]}
        try:
            if chosen=='codex-cli':
                with tempfile.TemporaryDirectory(prefix='planview-rules-') as folder:
                    schema_path=Path(folder)/'answer.schema.json';schema_path.write_text(json.dumps(model['schema']))
                    command=[codex_binary(),'exec','-m',AI_MODEL,'-c',f'model_reasoning_effort="{AI_REASONING}"','-s','read-only','--ephemeral','--ignore-user-config','--ignore-rules','--skip-git-repo-check','-C',folder,'--output-schema',str(schema_path),'-']
                    result=subprocess.run(command,input=model['instructions']+'\n\n'+json.dumps(user,ensure_ascii=False),capture_output=True,text=True,timeout=100,cwd=folder)
                if result.returncode:raise RuntimeError('rule_ai_unavailable')
                answer=json.loads(result.stdout.strip())
            else:
                body={'model':AI_MODEL,'reasoning':{'effort':AI_REASONING},'store':False,'max_output_tokens':8192,'input':[{'role':'system','content':model['instructions']},{'role':'user','content':json.dumps(user,ensure_ascii=False)}],'text':{'format':{'type':'json_schema','name':'planview_rule_answer','strict':True,'schema':model['schema']}}}
                api_key=credentials().get('openai') or os.environ.get('OPENAI_API_KEY','')
                request=urllib.request.Request('https://api.openai.com/v1/responses',data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+api_key,'Content-Type':'application/json'},method='POST')
                with urllib.request.urlopen(request,timeout=95) as provider:result=json.load(provider)
                if result.get('status')!='completed':raise RuntimeError('rule_ai_unavailable')
                answer=json.loads(''.join(part.get('text','') for item in result.get('output',[]) if item.get('type')=='message' for part in item.get('content',[]) if part.get('type')=='output_text'))
            response['answer']=rules_node({'mode':'validate','answer':answer,'sources':[{'id':source['id'],'text':source['text']} for source in sources]});response['state']='answered' if response['answer']['citations'] else 'matches'
        except (ValueError,RuntimeError,OSError,subprocess.TimeoutExpired):coverage['warnings'].append('ai_unavailable')
        return response
    finally:RUN_LOCK.release()


def generate_permit_answer(model, user, chosen, timeout=100):
    """Use the existing local AI connection; public-data retrieval needs no key."""
    if chosen == 'codex-cli':
        staging = ROOT / 'maintenance' / 'permit-questions-20261018'
        staging.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='answer-', dir=staging) as folder:
            schema_path = Path(folder) / 'answer.schema.json'
            schema_path.write_text(json.dumps(model['schema']))
            command = [codex_binary(), 'exec', '-m', AI_MODEL, '-c', f'model_reasoning_effort="{AI_REASONING}"',
                       '-s', 'read-only', '--ephemeral', '--ignore-user-config', '--ignore-rules',
                       '--skip-git-repo-check', '-C', folder, '--output-schema', str(schema_path), '-']
            result = subprocess.run(command, input=model['instructions']+'\n\n'+json.dumps(user, ensure_ascii=False),
                                    capture_output=True, text=True, timeout=timeout, cwd=folder)
        if result.returncode or len(result.stdout) > 150000:
            raise RuntimeError('permit_ai_unavailable')
        return json.loads(result.stdout.strip())
    body = {'model': AI_MODEL, 'reasoning': {'effort': AI_REASONING}, 'store': False,
            'max_output_tokens': 8192,
            'input': [{'role': 'system', 'content': model['instructions']},
                      {'role': 'user', 'content': json.dumps(user, ensure_ascii=False)}],
            'text': {'format': {'type': 'json_schema', 'name': 'planview_permit_answer',
                                'strict': True, 'schema': model['schema']}}}
    api_key = credentials().get('openai') or os.environ.get('OPENAI_API_KEY', '')
    request = urllib.request.Request('https://api.openai.com/v1/responses', data=json.dumps(body).encode(),
                                     headers={'Authorization': 'Bearer '+api_key, 'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(request, timeout=min(timeout, 95)) as provider:
        raw = provider.read(150001)
    if len(raw) > 150000:
        raise RuntimeError('permit_ai_unavailable')
    result = json.loads(raw)
    if result.get('status') != 'completed':
        raise RuntimeError('permit_ai_unavailable')
    return json.loads(''.join(part.get('text', '') for item in result.get('output', [])
                             if item.get('type') == 'message' for part in item.get('content', [])
                             if part.get('type') == 'output_text'))


def generate_permit_intent(value, chosen):
    model = permit_questions_node({'mode': 'intent-config', 'input': value})['modelConfig']
    raw = generate_permit_answer(model, {'question': value['query'], 'language': value['language']}, chosen, timeout=30)
    return permit_questions_node({'mode': 'intent-validate', 'input': value, 'intent': raw})


def search_permits(payload):
    value = clean_permit_question_input(payload)
    if not PERMIT_QUESTION_LOCK.acquire(blocking=False):
        raise PermitError(429, 'permit_question_limit')
    try:
        now = time.monotonic()
        PERMIT_QUESTION_REQUESTS[:] = [at for at in PERMIT_QUESTION_REQUESTS if now - at < 300]
        if len(PERMIT_QUESTION_REQUESTS) >= 12:
            raise PermitError(429, 'permit_question_limit')
        PERMIT_QUESTION_REQUESTS.append(now)
        chosen, intent, intent_warning = backend(), None, None
        if chosen != 'none':
            if RUN_LOCK.acquire(blocking=False):
                try:
                    intent = generate_permit_intent(value, chosen)
                except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired, PermitError, KeyError):
                    intent_warning = 'permit_intent_unavailable'
                finally:
                    RUN_LOCK.release()
            else:
                intent_warning = 'permit_intent_busy'
        else:
            intent_warning = 'permit_intent_unavailable'
        retrieval = {'mode': 'retrieve', 'input': value}
        if intent is not None:
            retrieval['intent'] = intent
        ranked = permit_questions_node(retrieval)
        model = ranked.pop('modelConfig', None)
        response = {**ranked, 'answer': None}
        coverage = response.setdefault('coverage', {'complete': False, 'warnings': []})
        warnings = coverage.setdefault('warnings', [])
        if intent_warning:
            warnings.append(intent_warning)
        # Only server-retrieved official links are candidates. Failure retains notices.
        try:
            response = enrich_permit_documents(response, value, deadline_seconds=45)
        except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired):
            warnings.append('permit_documents_unavailable')
        coverage = response.setdefault('coverage', {'complete': False, 'warnings': []})
        warnings = coverage.setdefault('warnings', [])
        sources = response.get('sources', [])
        evidence = [s for s in sources if s.get('sourceAvailable') is not False and isinstance(s.get('text'), str) and len(s['text'].strip()) >= 12][:8]
        if not evidence:
            return response
        if chosen == 'none' or not model:
            warnings.append('api_key_missing' if chosen == 'none' else 'ai_unavailable')
            return response
        if not RUN_LOCK.acquire(blocking=False):
            warnings.append('ai_busy')
            return response
        try:
            user = {'question': value['query'], 'language': value['language'], 'point': value['point'],
                    'coverage': coverage, 'sources': evidence}
            answer = generate_permit_answer(model, user, chosen)
            response['answer'] = permit_questions_node({'mode': 'validate', 'answer': answer, 'sources': evidence})
            response['state'] = 'answered' if response['answer'].get('citations') else 'matches'
        except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired, PermitError):
            warnings.append('ai_unavailable')
        finally:
            RUN_LOCK.release()
        return response
    finally:
        PERMIT_QUESTION_LOCK.release()


class Handler(SimpleHTTPRequestHandler):
    def same_local_origin(self):
        host = self.headers.get('Host', '')
        origin = self.headers.get('Origin')
        allowed = {f'127.0.0.1:{self.server.server_port}',
                   f'localhost:{self.server.server_port}'}
        return (host in allowed and (not origin or origin in {f'http://{value}' for value in allowed})
                and self.headers.get('Sec-Fetch-Site', 'same-origin') not in ('cross-site', 'same-site'))

    def send_json(self, code, data):
        raw = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def blocked_file(self):
        parts = [unquote(part) for part in urlsplit(self.path).path.split('/') if part]
        return any(part.startswith('.') or part in ('cloud', 'tools') or part.endswith(('.py', '.pyc')) for part in parts)

    def send_head(self):
        # Native video chapter seeking needs byte ranges. Other assets retain
        # SimpleHTTPRequestHandler semantics; API requests never enter this path.
        self._media_remaining = None
        path = self.translate_path(self.path)
        if Path(path).suffix.lower() != '.mp4' or not os.path.isfile(path):
            return super().send_head()
        try:
            source = open(path, 'rb')
        except OSError:
            self.send_error(404, 'File not found')
            return None
        try:
            info = os.fstat(source.fileno())
            size = info.st_size
            modified = self.date_time_string(info.st_mtime)
            etag = f'"{info.st_mtime_ns:x}-{size:x}"'

            def date_matches(value):
                try:
                    date = email.utils.parsedate_to_datetime(value)
                    if date.tzinfo is None:
                        date = date.replace(tzinfo=datetime.timezone.utc)
                    return int(info.st_mtime) <= date.timestamp()
                except (TypeError, ValueError, OverflowError):
                    return False

            none_match = self.headers.get('If-None-Match')
            unchanged = (any(tag.strip().removeprefix('W/') in ('*', etag)
                             for tag in none_match.split(',')) if none_match else
                         date_matches(self.headers.get('If-Modified-Since')))
            if unchanged:
                self.send_response(304)
                self.send_header('ETag', etag)
                self.send_header('Last-Modified', modified)
                self.send_header('Accept-Ranges', 'bytes')
                self.end_headers()
                source.close()
                return None

            # RFC Range applies to GET, not HEAD. Unsupported multi-ranges
            # deliberately fall back to the complete representation.
            requested = self.headers.get('Range') if self.command == 'GET' else None
            if_range = self.headers.get('If-Range')
            if if_range and if_range != etag and not date_matches(if_range):
                requested = None
            start, end, partial = 0, size - 1, False
            if requested and requested.startswith('bytes=') and ',' not in requested:
                match = re.fullmatch(r'bytes=(\d*)-(\d*)', requested.strip())
                try:
                    if not match or not any(match.groups()) or not size:
                        raise ValueError('Invalid or unsatisfiable range')
                    first, last = match.groups()
                    if first:
                        start = int(first)
                        end = min(int(last), size - 1) if last else size - 1
                    else:
                        suffix = int(last)
                        if suffix <= 0:
                            raise ValueError('Empty suffix range')
                        start, end = max(0, size - suffix), size - 1
                    if start >= size or end < start:
                        raise ValueError('Unsatisfiable range')
                except ValueError:
                    self.send_response(416)
                    self.send_header('Content-Range', f'bytes */{size}')
                    self.send_header('Content-Length', '0')
                    self.send_header('Accept-Ranges', 'bytes')
                    self.end_headers()
                    source.close()
                    return None
                partial = True
                source.seek(start)
                self._media_remaining = end - start + 1
            self.send_response(206 if partial else 200)
            self.send_header('Content-Type', self.guess_type(path))
            self.send_header('Content-Length', str(end - start + 1 if partial else size))
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Last-Modified', modified)
            self.send_header('ETag', etag)
            if partial:
                self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.end_headers()
            return source
        except BaseException:
            source.close()
            raise

    def copyfile(self, source, outputfile):
        remaining = getattr(self, '_media_remaining', None)
        if remaining is None:
            return super().copyfile(source, outputfile)
        try:
            while remaining > 0:
                block = source.read(min(64 * 1024, remaining))
                if not block:
                    break
                outputfile.write(block)
                remaining -= len(block)
        finally:
            self._media_remaining = None

    def do_HEAD(self):
        if self.blocked_file():
            self.send_error(404)
            return
        super().do_HEAD()

    def do_GET(self):
        if self.blocked_file():
            self.send_error(404)
            return
        parsed = urlsplit(self.path)
        if parsed.path.startswith('/api/') and not self.same_local_origin():
            self.send_json(403, {'error': 'Local PlanView origin only'})
            return
        if parsed.path == '/api/status':
            chosen = backend()
            self.send_json(200, {'app': 'planview', 'instance': INSTANCE_ID, 'available': chosen != 'none',
                                 'backend': chosen, 'model': AI_MODEL, 'reasoning': AI_REASONING,
                                 'interpreterVersion': INTERPRETER_VERSION, 'settingsVersion': 2})
            return
        if parsed.path == '/api/ai/settings':
            self.send_json(200, {'configured': bool(credentials().get('openai')), 'available': backend() != 'none', 'storage': 'local-device'})
            return
        if parsed.path == '/api/settings':
            self.send_json(200, {'configured': configured(), 'storage': 'local-device'})
            return
        if parsed.path == '/api/routes/status':
            has_ors = bool(credentials().get('ors'))
            self.send_json(200, {'configured': has_ors, 'available': True, 'requiresKey': False,
                                 'provider': 'ors' if has_ors else 'osrm', 'storage': 'local-device'})
            return
        if parsed.path in ('/api/dso/point', '/api/dso/rules', '/api/dso/geometry', '/api/rp/plan'):
            try:
                params = parse_qs(parsed.query)
                if parsed.path == '/api/dso/point':
                    x, y = float(params['x'][0]), float(params['y'][0])
                    self.send_json(200, dso_point(x, y))
                elif parsed.path == '/api/dso/rules':
                    x, y = float(params['x'][0]), float(params['y'][0])
                    self.send_json(200, dso_rules_point(x, y))
                elif parsed.path == '/api/dso/geometry':
                    self.send_json(200, dso_geometry(params['id'][0]))
                else:
                    self.send_json(200, rp_plan(params['id'][0]))
            except (KeyError, IndexError, ValueError) as error:
                self.send_json(400, {'error': str(error)})
            except PermissionError as error:
                self.send_json(409, {'error': str(error)})
            except urllib.error.HTTPError as error:
                self.send_json(502, {'error': f'Official service returned HTTP {error.code}'})
            except (urllib.error.URLError, OSError):
                self.send_json(502, {'error': 'Official service unavailable'})
            return
        super().do_GET()

    def do_POST(self):
        if self.path not in ('/api/interpret', '/api/settings', '/api/ai/settings', '/api/ai/test', '/api/rules/search', '/api/routes', '/api/permits/point', '/api/permits/search'):
            self.send_json(404, {'error': 'Unknown endpoint'})
            return
        if (not self.same_local_origin()
                or self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json'):
            self.send_json(403, {'error': 'Same-origin JSON requests only'})
            return
        if self.path == '/api/permits/search':
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 2 <= size <= 8192:
                    raise PermitError(400, 'invalid_permit_question')
                self.send_json(200, search_permits(json.loads(self.rfile.read(size))))
            except PermitError as error:
                self.send_json(error.status, {'error': error.code})
            except (ValueError, OSError):
                self.send_json(400, {'error': 'invalid_permit_question'})
            return
        if self.path == '/api/permits/point':
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 2 <= size <= 4096:
                    raise PermitError(400, 'invalid_permit_request')
                self.send_json(200, permit_history(json.loads(self.rfile.read(size))))
            except PermitError as error:
                self.send_json(error.status, {'error': error.code})
            except (ValueError, OSError):
                self.send_json(400, {'error': 'invalid_permit_request'})
            return
        if self.path == '/api/routes':
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 2 <= size <= 4096:
                    raise RoutingError(400, 'invalid_route_request')
                self.send_json(200, route_matrix(json.loads(self.rfile.read(size)), credentials().get('ors')))
            except RoutingError as error:
                self.send_json(error.status, {'error': error.code})
            except (ValueError, OSError):
                self.send_json(400, {'error': 'invalid_route_request'})
            return
        if self.path == '/api/rules/search':
            try:
                size=int(self.headers.get('Content-Length','0'))
                if not 2<=size<=8192:raise ValueError('invalid_rules_request')
                self.send_json(200,search_rules(json.loads(self.rfile.read(size))))
            except ValueError:self.send_json(400,{'error':'invalid_rules_request'})
            except (RuntimeError,OSError,subprocess.TimeoutExpired):self.send_json(502,{'error':'rule_sources_unavailable'})
            return
        if self.path in ('/api/ai/settings', '/api/ai/test'):
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if size < 2 or size > 2048:
                    raise ValueError('invalid_request')
                payload = json.loads(self.rfile.read(size))
                if self.path == '/api/ai/settings':
                    if not isinstance(payload, dict) or set(payload) != {'key'} or not isinstance(payload['key'], str):
                        raise ValueError('invalid_api_key_format')
                    value = payload['key'].strip()
                    if value and not re.fullmatch(r'sk-[A-Za-z0-9_-]{16,508}', value):
                        raise ValueError('invalid_api_key_format')
                    save_credentials({'openai': value})
                    CACHE.clear()
                    self.send_json(200, {'configured': bool(credentials().get('openai')), 'storage': 'local-device'})
                    return
                chosen = backend()
                if chosen == 'none':
                    self.send_json(409, {'error': 'api_key_missing'})
                    return
                if not RUN_LOCK.acquire(blocking=False):
                    self.send_json(429, {'error': 'request_limit'})
                    return
                try:
                    test = ('Find residential zoning.', {'interfaceLanguage': 'en'})
                    interpret_with_codex(*test) if chosen == 'codex-cli' else interpret_with_api(*test)
                    self.send_json(200, {'ok': True, 'model': AI_MODEL, 'reasoning': AI_REASONING, 'backend': chosen})
                finally:
                    RUN_LOCK.release()
            except urllib.error.HTTPError as error:
                self.send_json(502, {'error': 'invalid_api_key' if error.code == 401 else 'provider_limit' if error.code == 429 else 'model_access_denied' if error.code in (403, 404) else 'provider_unavailable'})
            except (ValueError, OSError, KeyError, RuntimeError, subprocess.TimeoutExpired):
                self.send_json(400, {'error': 'service_unavailable'})
            return
        if self.path == '/api/settings':
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if size < 2 or size > 4096:
                    raise ValueError('Invalid settings request')
                payload = json.loads(self.rfile.read(size))
                if not isinstance(payload, dict) or set(payload) - {'dso', 'rp', 'ors'}:
                    raise ValueError('Invalid settings fields')
                self.send_json(200, {'configured': save_credentials(payload), 'storage': 'local-device'})
            except (ValueError, OSError) as error:
                self.send_json(400, {'error': str(error)})
            return
        chosen = backend()
        if chosen == 'none':
            self.send_json(503, {'error': 'Codex CLI or API interpreter not configured'})
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size < 1 or size > 8192:
                self.send_json(400, {'error': 'Request too large or empty'})
                return
            payload = json.loads(self.rfile.read(size))
            query = payload.get('query', '')
            if not isinstance(query, str) or not query.strip() or len(query) > 1200:
                self.send_json(400, {'error': 'Invalid query'})
                return
            context = payload.get('context', {})
            if not isinstance(context, dict) or len(json.dumps(context)) > 3200:
                self.send_json(400, {'error': 'Invalid map context'})
                return
            # Only pass a bounded, public-data snapshot to the interpreter.
            samples = context.get('sampledPlanFeatures', [])
            counts = context.get('nearbyFeatureCounts', {})
            examples = context.get('nearbyExamples', [])
            samples = samples if isinstance(samples, list) else []
            counts = counts if isinstance(counts, dict) else {}
            examples = examples if isinstance(examples, list) else []
            context = {
                'scope': str(context.get('scope', 'Nederland'))[:100],
                'interfaceLanguage': context.get('interfaceLanguage') if context.get('interfaceLanguage') in ('en', 'nl', 'de') else 'en',
                'sampledPlanFeatures': [
                    {'designation': str(item.get('designation', ''))[:100],
                     'group': str(item.get('group', ''))[:40]}
                    for item in samples[:8] if isinstance(item, dict)
                ],
                'nearbyFeatureCounts': {
                    key: max(0, min(3000, int(value))) for key, value in
                    counts.items()
                    if key in ('camping', 'towns', 'industry', 'roads', 'station', 'park', 'sports', 'cemetery', 'swimming_pool', 'marina', 'hospital', 'allotments', 'recreation_area') and isinstance(value, (int, float))
                },
                'nearbyExamples': [str(value)[:80] for value in examples[:6]
                                   if isinstance(value, str)],
            }
            cache_key = (chosen, AI_MODEL, AI_REASONING, query.strip().casefold(), json.dumps(context, sort_keys=True))
            if cache_key in CACHE:
                self.send_json(200, CACHE[cache_key])
                return
            if not RUN_LOCK.acquire(blocking=False):
                self.send_json(429, {'error': 'Interpreter busy; retry shortly'})
                return
            try:
                filters = interpret_with_codex(query, context) if chosen == 'codex-cli' else interpret_with_api(query, context)
                filters = stabilize_filters(filters, query)
                filters.update(engine=AI_MODEL, backend=chosen, reasoning=AI_REASONING)
                if len(CACHE) >= 100:
                    CACHE.clear()
                CACHE[cache_key] = filters
                self.send_json(200, filters)
            finally:
                RUN_LOCK.release()
        except (urllib.error.URLError, OSError, ValueError, KeyError, RuntimeError,
                subprocess.TimeoutExpired) as error:
            print(f'Interpreter failed: {type(error).__name__}', file=sys.stderr)
            self.send_json(502, {'error': 'AI interpreter unavailable'})


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4174
    print(f'PlanView: http://127.0.0.1:{port}/ · AI backend: {backend()}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
