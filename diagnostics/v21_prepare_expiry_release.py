"""Only retarget reviewed release constants; all integrity checks remain intact.
Writes local runner files, not production. The guarded release performs all
actual source/Cron/binding verification and rollback separately.
"""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OLD='71212954bcfee2d52a568c0c5980ed34ab749fbf5e17c538c92dec4c484bdc93'
NEW='d05577405be21f4a2c72f076ac5dd3b334b62c4cc52886eb4d69fb7e01ef016d'
OLDV='IRYS-V21-LEARNED-FORECAST-FORWARD-EVIDENCE-20261031'
NEWV='IRYS-V21.1-LEARNED-FORECAST-EXPIRY-ALIGNED-20261031'
files=['deployment/release_v21_guarded.mjs','deployment/verify_v21_production.mjs']
text={f:(ROOT/f).read_text(encoding='utf8') for f in files}
def replace(path,a,b):
    assert text[path].count(a)==1, ('RELEASE_PATCH_ANCHOR',path,a)
    text[path]=text[path].replace(a,b)
replace(files[0],"const OLD_SHA='d7b9b3187fe338ec3ae2c422bedc1035bd1de5a543e74c00bbf4f8eaf141736a';",f"const OLD_SHA='{OLD}';")
replace(files[0],f"const NEW_SHA='{OLD}';",f"const NEW_SHA='{NEW}';")
replace(files[0],"const OLD_VERSION='IRYS-V20-ACCURACY-FIRST-NO-UNVALIDATED-DIRECTION-20261031';",f"const OLD_VERSION='{OLDV}';")
replace(files[0],f"const NEW_VERSION='{OLDV}';",f"const NEW_VERSION='{NEWV}';")
replace(files[1],f"const expectedSha='{OLD}';",f"const expectedSha='{NEW}';")
replace(files[1],f"const expectedVersion='{OLDV}';",f"const expectedVersion='{NEWV}';")
for f,s in text.items():(ROOT/f).write_text(s,encoding='utf8')
print('V21_1_EXACT_RELEASE_TARGET',NEW,NEWV)
