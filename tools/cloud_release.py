"""Validate and mirror PlanView assets; native Sites tools own authentication/deploys."""
import argparse,hashlib,json,re,shutil,subprocess,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
PROJECT='appgprj_6ab985de2e6481918b9e1e3ccccdfcd8'
URL='https://planview-maastricht-spatial.dannhir.chatgpt.site'
STATE=ROOT/'.planview-cloud/state.json'

def write_json(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix(path.suffix+'.tmp');temp.write_text(json.dumps(value,indent=2)+'\n');temp.replace(path)

def assets():
    root_files=[p for p in ROOT.iterdir() if p.suffix in {'.js','.css','.html'} or p.name in {'limburg.json','search_filters.schema.json','search_config.json','.nojekyll'}]
    files=root_files+[p for folder in ['data','legend','vendor'] for p in (ROOT/folder).rglob('*') if p.is_file() and not any(part.startswith('.') for part in p.relative_to(ROOT).parts)]
    files += [p for p in (ROOT/'cloud').rglob('*') if p.is_file() and not any(part.startswith('.') for part in p.relative_to(ROOT/'cloud').parts)]
    for p in files:
        if p.is_symlink():raise ValueError('Refusing symlink: '+str(p))
        if p.suffix not in {'.js','.mjs','.css','.html','.json','.geojson','.png','.jpg','.jpeg','.webp','.svg','.woff','.woff2','.ttf','.txt','.ts','.tsx','.sql'} and p.name!='.nojekyll':raise ValueError('Unexpected asset type: '+str(p))
    return sorted(files,key=lambda p:p.relative_to(ROOT).as_posix())

def fingerprint(files):
    digest=hashlib.sha256()
    for p in files:
        digest.update(p.relative_to(ROOT).as_posix().encode()+b'\0')
        digest.update(hashlib.sha256(p.read_bytes()).digest())
    return digest.hexdigest()

def info():
    files=assets();digest=fingerprint(files)
    old=json.loads(STATE.read_text()) if STATE.exists() else {}
    return files,{'project_id':PROJECT,'url':URL,'fingerprint':digest,'version':digest[:12],'file_count':len(files),'bytes':sum(p.stat().st_size for p in files),'settled':time.time()-max(p.stat().st_mtime for p in files)>30,'changed':old.get('fingerprint')!=digest,'published':old}

def validate(files):
    for p in files:
        if p.parent==ROOT and p.suffix=='.js':subprocess.run(['node','--check',str(p)],check=True,capture_output=True)
        if p.suffix in {'.json','.geojson'}:json.loads(p.read_text())
    for ref in re.findall(r'(?:src|href)=["\'](\./[^"\']+)["\']',(ROOT/'index.html').read_text()):
        target=ROOT/ref.split('?',1)[0]
        if not target.is_file():raise ValueError('Missing page asset: '+ref)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=['status','stage','record']);parser.add_argument('--checkout',type=Path);parser.add_argument('--commit');parser.add_argument('--deployment');parser.add_argument('--fingerprint');parser.add_argument('--force-initial',action='store_true');args=parser.parse_args()
    files,current=info()
    if args.command=='status':print(json.dumps(current));return
    if args.command=='record':
        if not args.commit or not args.deployment or not args.fingerprint:raise ValueError('Record requires successful deployment identifiers and fingerprint')
        if args.fingerprint!=current['fingerprint']:raise ValueError('Source changed during deployment; do not mark new content published')
        write_json(STATE,{'fingerprint':args.fingerprint,'version':current['version'],'site_commit':args.commit,'deployment_id':args.deployment,'url':URL,'published_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())});print(json.dumps({'recorded':True,'version':current['version']}));return
    checkout=args.checkout.resolve() if args.checkout else None
    if not checkout or checkout==ROOT or ROOT in checkout.parents:raise ValueError('Use a separate Site checkout outside the app folder')
    manifest=json.loads((checkout/'.openai/hosting.json').read_text())
    if manifest.get('project_id')!=PROJECT or manifest.get('d1')!='DB' or 'static' in manifest:raise ValueError('Wrong Site or unsupported build configuration')
    head=subprocess.check_output(['git','-C',str(checkout),'rev-parse','HEAD'],text=True).strip()
    old=current['published']
    if old.get('site_commit') and head!=old['site_commit']:raise ValueError('Cloud source advanced independently. Reconcile changes before mirroring.')
    if not old and not args.force_initial:raise ValueError('First publication requires --force-initial')
    validate(files)
    stage=checkout/'.planview-stage'
    if stage.exists():shutil.rmtree(stage)
    stage.mkdir()
    try:
        for p in files:
            relative=p.relative_to(ROOT)
            target=(checkout/Path(*relative.parts[1:])) if relative.parts[0]=='cloud' else (stage/relative)
            target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
        if fingerprint(assets())!=current['fingerprint']:raise ValueError('Source changed during staging; retry once it is stable')
        release={k:current[k] for k in ['version','fingerprint','file_count']};release.update({'cloud_url':URL,'cloud_ai':True,'cloud_ai_requires_key':True,'cloud_dso':False})
        write_json(stage/'release.json',release)
        (checkout/'planview.html').write_text((ROOT/'index.html').read_text())
        dist=checkout/'public'
        if dist.exists():shutil.rmtree(dist)
        stage.replace(dist)
        write_json(ROOT/'release.json',release)
        (checkout/'README.md').write_text('# PlanView web publication\n\nGenerated from the canonical PlanView application folder. Browser assets are in public/. The authenticated AI server is maintained in the canonical cloud/ folder.\n\n'+(ROOT/'CLOUD_SYNC.md').read_text())
        print(json.dumps({**current,'checkout':str(checkout),'validated':True,'staged':True}))
    finally:
        if stage.exists():shutil.rmtree(stage)

if __name__=='__main__':main()
