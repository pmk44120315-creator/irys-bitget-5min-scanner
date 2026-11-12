"""Rebuild expired test artifacts from their recorded release commits; never deploy."""
from pathlib import Path
import subprocess, json, hashlib, zipfile, os, tarfile, io, shutil
ROOT = Path.cwd()
OUT = ROOT / 'v48_verified'
OUT.mkdir(exist_ok=True)
receipts = []
def run(*args, capture=False):
    p = subprocess.run(args, check=True, stdout=subprocess.PIPE if capture else None)
    return p.stdout if capture else None

def source(ref, tag):
    dest = Path('/tmp') / ('v48-source-' + tag)
    dest.mkdir(exist_ok=True)
    run('git', 'fetch', '--quiet', '--depth=1', 'origin', ref)
    sha = run('git', 'rev-parse', 'FETCH_HEAD', capture=True).decode().strip()
    archive = run('git', 'archive', 'FETCH_HEAD', 'deployment', capture=True)
    with tarfile.open(fileobj=io.BytesIO(archive)) as t:
        t.extractall(dest, filter='data')
    receipts.append({'kind': 'source', 'ref': ref, 'commit': sha, 'purpose': tag})
    return dest

def released_source(run_id, tag):
    raw = run('gh', 'api', f'repos/{os.environ["GITHUB_REPOSITORY"]}/actions/runs/{run_id}', capture=True)
    d = json.loads(raw)
    assert d['conclusion'] == 'success', (run_id, d['conclusion'])
    return source(d['head_sha'], tag)

def verify(path, expected):
    path = Path(path)
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    assert actual == expected, (str(path), expected, actual)
    receipts.append({'kind': 'verified_build', 'path': str(path), 'sha256': actual})

def build(src, ver, inp, out):
    run('python', str(src / 'deployment' / f'build_v{ver}_worker.py'), str(inp), str(out))

def download(run_id, name, dest):
    print('READ_ONLY_ARTIFACT', run_id, name, flush=True)
    run('gh', 'run', 'download', str(run_id), '-n', name, '-D', dest)
    receipts.append({'kind': 'artifact', 'run_id': run_id, 'name': name})

try:
    v24source = source('release/irys-v24-bitget-fallback-20261101', 'v24')
    v24 = Path('/tmp/v24.mjs')
    shutil.copyfile(v24source / 'deployment/IRYS_V24_BITGET_FALLBACK_WORKER.mjs', v24)
    verify(v24, 'd1a46e867b57d5bce542d46abbbc3b7c9ceeda762700e12dd18b56ee89ba02c7')
    dep = ROOT / 'deployment'
    p27=dep/'IRYS_V27_RESPONSE_WORKER.mjs';p28=dep/'IRYS_V28_BUILDUP_WORKER.mjs';p29=dep/'IRYS_V29_DIRECTION_REVIEW_WORKER.mjs'
    build(ROOT, '27', v24, p27)
    original28=source('91f47ac2bb3a72e90e4fc65c2e8925adbafc9a55','v28')
    Path('/tmp/v28').mkdir(exist_ok=True)
    p28original=Path('/tmp/v28/IRYS_V28_BUILDUP_WORKER.mjs')
    build(original28,'28',p27,p28original)
    verify(p28original,'e3fa2f1da6151ceb419fe5f21bf5fae8afd3db5a2d8068425f0986e64692c19d')
    build(ROOT,'28',p27,p28);build(ROOT,'29',p28,p29)
    verify(p29,'28dc5922e54f9e69d4a8150f03184417d0ea46409d82fe9130bbf648ac17309e')
    p30=dep/'IRYS_V30_SELECTIVE_DIRECTION_WORKER.mjs';p31=dep/'IRYS_V31_TIMELY_WORKER.mjs';p34=dep/'IRYS_V34_CRASH_WARNING_WORKER.mjs';p35=dep/'IRYS_V35_LIFECYCLE_WORKER.mjs'
    build(released_source(41693577194,'v30'),'30',p29,p30)
    verify(p30,'c1b8722e5231d85aacbda04497128926817dcc38508a1249b2d637e3f145c89a')
    build(released_source(41814867318,'v31'),'31',p29,p31)
    verify(p31,'20c730063705ffa9fdbafa000621bbd8db94a71e3e926fa915c88fa56db44a3a')
    build(ROOT,'34',p31,p34)
    verify(p34,'728b2d14d3543b79040d810cbfe290dbb14c6edb3987ee5b2db4d96b0d9de881')
    build(released_source(42083867409,'v35'),'35',p34,p35)
    verify(p35,'949cc9b7392e7f6bbf7ce710509b804ce734cf6b123294b1a2c530cfdc2669aa')
    for run_id,name,dest,filename in [
        (42156639897,'v351-delivery-first-production-proof','/tmp/v351','IRYS_V351_DELIVERY_FIRST_WORKER.mjs'),
        (42459877506,'v42-live-dispatch-upgrade-proof','/tmp/v42','IRYS_V42_DISPATCH_WORKER.mjs'),
        (42466573774,'v421-transport-verified-proof','/tmp/v421','IRYS_V421_DISPATCH_WORKER.mjs'),
        (42564939375,'v45-resumed-live-deployment-proof','/tmp/v45','IRYS_V45_RSI_WORKER.mjs')]:
        download(run_id,name,dest);shutil.copyfile(Path(dest)/filename,dep/filename)
    verify(dep/'IRYS_V351_DELIVERY_FIRST_WORKER.mjs','6356cf5919e5dd05808d9b84bf92378393cc0b9a9da31e964d93566cc86c0d13')
    shutil.copyfile('/tmp/v45/release_v45_guarded.mjs',dep/'release_v45_guarded.mjs')
    build(ROOT,'46',dep/'IRYS_V45_RSI_WORKER.mjs',dep/'IRYS_V46_CONTEXT_WORKER.mjs')
    run('python','deployment/build_v46_release_guard.py','deployment/release_v45_guarded.mjs','deployment/release_v46_guarded.mjs')
    verify(dep/'IRYS_V46_CONTEXT_WORKER.mjs','9979d4c357cbb520c4cc8f2c68b55adf93264b53d992c9c3562c82b2e1ca8bc4')
    verify(dep/'release_v46_guarded.mjs','e4c51066074898e8bd0eae5afec886fdb87f0ca72d501c2967a8cd72f0a2c6a9')
    download(42642722251,'v46-native-rsi-diagnosis','/tmp/native')
    fixtures=ROOT/'verification/v46/fixtures';fixtures.mkdir(parents=True,exist_ok=True)
    for f in Path('/tmp/native').glob('original_*.json'):
        d=json.loads(f.read_text());e=d['evaluation']
        if e['source_packet_at_ms']==e['batch_packet_at_ms'] and e['published_before_ack']:
            row={'ack':d['ack'],'batch':d['context_batch'],'publication_sha':e['publication_sha'],'published_at':e['commit_at']}
            (fixtures/(d['ack']['symbol']+'_original.json')).write_text(json.dumps(row,separators=(',',':')))
    assert (fixtures/'KRW-RSR_original.json').is_file() and (fixtures/'KRW-MERL_original.json').is_file()
    with zipfile.ZipFile(OUT/'compiled_dependencies.zip','w',zipfile.ZIP_DEFLATED) as z:
        for f in dep.glob('IRYS*.mjs'):z.write(f,str(f.relative_to(ROOT)))
        for f in [dep/'release_v45_guarded.mjs',dep/'release_v46_guarded.mjs',*fixtures.glob('*.json')]:z.write(f,str(f.relative_to(ROOT)))
        z.write(v24,'fixtures/v24.mjs');z.write(p28original,'fixtures/v28_release.mjs')
    download(42791465821,'v43-observation-42791465821-1','/tmp/v47-original')
finally:
    (OUT/'fixture_receipts.json').write_text(json.dumps(receipts,indent=2))
