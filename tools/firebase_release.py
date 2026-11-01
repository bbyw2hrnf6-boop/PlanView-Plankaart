"""Build Firebase publication from canonical app/ only; never collect local settings."""
import argparse,hashlib,json,re,shutil,subprocess
from pathlib import Path
from cloud_release import ROOT,assets,validate
BUILD=ROOT/'.firebase-build'
GENERATED=ROOT/'firebase/functions/generated'

def prepare():
    project=json.loads((ROOT/'.firebaserc').read_text())['projects']['default']
    if not re.fullmatch(r'[a-z][a-z0-9-]{4,28}[a-z0-9]',project):raise ValueError('Invalid Firebase project ID')
    settings=json.loads((ROOT/'firebase/deployment-settings.json').read_text())
    if set(settings)!={'PLANVIEW_ALLOWED_EMAILS','PLANVIEW_EXTRA_ORIGINS','PLANVIEW_TEST_USER_UID'} or not all(isinstance(v,str) for v in settings.values()):raise ValueError('Invalid public deployment settings')
    if not settings['PLANVIEW_ALLOWED_EMAILS'].strip():raise ValueError('An explicit account allowlist is required')
    if settings['PLANVIEW_TEST_USER_UID'] and not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',settings['PLANVIEW_TEST_USER_UID']):raise ValueError('Invalid test-user UID')
    # Non-secret deployment parameters. Never generate or read provider keys here.
    env_file=ROOT/f'firebase/functions/.env.{project}'
    env_file.write_text(''.join(f'{key}={json.dumps(value)}\n' for key,value in settings.items()))
    files=assets();validate(files)
    public=BUILD/'public'
    if public.exists():shutil.rmtree(public)
    public.mkdir(parents=True)
    for source in files:
        relative=source.relative_to(ROOT)
        if relative.parts[0]=='cloud':continue
        target=public/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
    # Firebase-only login bootstrap. Canonical localhost/Sites HTML is unchanged.
    html=(public/'index.html').read_text()
    html=html.replace('<head>','<head>\n  <script src="/firebase-auth.js"></script>',1)
    (public/'index.html').write_text(html)
    esbuild=ROOT/'firebase/node_modules/.bin/esbuild'
    if not esbuild.exists():raise ValueError('First run: npm ci --prefix firebase')
    subprocess.run([str(esbuild),str(ROOT/'firebase/browser/auth.mjs'),'--bundle','--minify','--format=iife','--target=es2022','--outfile='+str(public/'firebase-auth.js')],check=True)
    (public/'firebase-runtime.json').write_text(json.dumps({'projectId':project,'apiBase':f'https://europe-west1-{project}.cloudfunctions.net/planviewApi'})+'\n')
    if GENERATED.exists():shutil.rmtree(GENERATED)
    (GENERATED/'lib').mkdir(parents=True)
    for source in (ROOT/'cloud/lib').glob('*.mjs'):
        if source.name.endswith('-cli.mjs'):continue
        shutil.copy2(source,GENERATED/'lib'/source.name)
    for name in ['search_config.json','search_filters.schema.json']:shutil.copy2(ROOT/name,GENERATED/name)
    digest=hashlib.sha256()
    for file in sorted(public.rglob('*')):
        if file.is_file():digest.update(file.relative_to(public).as_posix().encode());digest.update(hashlib.sha256(file.read_bytes()).digest())
    backend_files=list(GENERATED.rglob('*.mjs'))+list(GENERATED.glob('*.json'))+list((ROOT/'firebase/functions').glob('*.mjs'))+[ROOT/name for name in ['firebase/functions/package.json','firebase/functions/package-lock.json','firebase/deployment-settings.json','firebase/firestore.rules','firebase/firestore.indexes.json','firebase.json','.firebaserc']]
    for file in sorted(backend_files):
        digest.update(file.relative_to(ROOT).as_posix().encode());digest.update(hashlib.sha256(file.read_bytes()).digest())
    (public/'firebase-release.json').write_text(json.dumps({'projectId':project,'fingerprint':digest.hexdigest(),'source':'canonical app; browser and backend','authentication':'Firebase Google sign-in and pinned test-user password login','credentialStorage':'per-user encrypted Firestore'})+'\n')
    print(json.dumps({'prepared':True,'project':project,'public':str(public),'files':sum(p.is_file() for p in public.rglob('*')),'bytes':sum(p.stat().st_size for p in public.rglob('*') if p.is_file()),'fingerprint':digest.hexdigest()}))

def audit():
    candidates=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=ROOT).split(b'\0')
    problems=[]
    for raw in set(candidates):
        if not raw:continue
        path=ROOT/raw.decode()
        if not path.is_file() or path.is_symlink():continue
        if path.stat().st_size>100_000_000:problems.append({'path':str(path.relative_to(ROOT)),'problem':'GitHub file over 100 MB; do not push before resolving'})
        if path.suffix not in {'.js','.mjs','.ts','.tsx','.py','.json','.html','.yml','.yaml','.md','.txt'}:continue
        if path.stat().st_size>10_000_000:continue
        text=path.read_text(errors='replace')
        if re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{35,}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b',text):problems.append({'path':str(path.relative_to(ROOT)),'problem':'Possible credential/private key. Review locally; value not printed.'})
    print(json.dumps({'ok':not problems,'problems':problems},indent=2))
    if problems:raise SystemExit(1)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=['prepare','audit']);args=parser.parse_args()
    prepare() if args.command=='prepare' else audit()
