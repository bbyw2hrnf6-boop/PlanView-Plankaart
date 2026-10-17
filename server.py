"""PlanView local server. Uses the signed-in Codex CLI for GPT-6 Luna.

Binds to loopback only. An OpenAI API key is optional and used only if Codex CLI
is unavailable (or PLANVIEW_AI_BACKEND=api). No credential reaches the browser.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit
from local_services import configured, dso_geometry, dso_point, dso_rules_point, rp_plan, save_credentials, credentials

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
INTERPRETER_VERSION = 3
AI_TIMEOUT_SECONDS = 120
RUN_LOCK = threading.Lock()
CACHE = {}
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
        if self.path not in ('/api/interpret', '/api/settings', '/api/ai/settings', '/api/ai/test', '/api/rules/search'):
            self.send_json(404, {'error': 'Unknown endpoint'})
            return
        if (not self.same_local_origin()
                or self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json'):
            self.send_json(403, {'error': 'Same-origin JSON requests only'})
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
                if size < 2 or size > 1024:
                    raise ValueError('Invalid settings request')
                payload = json.loads(self.rfile.read(size))
                if not isinstance(payload, dict) or set(payload) - {'dso', 'rp'}:
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
                    if key in ('camping', 'towns', 'industry', 'roads', 'station', 'park', 'sports', 'cemetery', 'swimming_pool', 'marina') and isinstance(value, (int, float))
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
