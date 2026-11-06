from pathlib import Path
s=Path('deployment/release_v35_guarded.mjs').read_text()
rep={"const OLD='728b2d14d3543b79040d810cbfe290dbb14c6edb3987ee5b2db4d96b0d9de881';":"const OLD='949cc9b7392e7f6bbf7ce710509b804ce734cf6b123294b1a2c530cfdc2669aa';","const NEW='949cc9b7392e7f6bbf7ce710509b804ce734cf6b123294b1a2c530cfdc2669aa';":"const NEW='6356cf5919e5dd05808d9b84bf92378393cc0b9a9da31e964d93566cc86c0d13';","IRYS-V35-SIGNAL-LIFECYCLE-20261106":"IRYS-V35.1-DELIVERY-FIRST-LIFECYCLE-20261106","fix/irys-v35-thesis-lifecycle-20261106":"fix/irys-v35-1-resume-20261106","IRYS_V35_LIFECYCLE_WORKER.mjs":"IRYS_V351_DELIVERY_FIRST_WORKER.mjs","v35_release":"v351_release","V35_EXACT_DEPLOYMENT":"V351_EXACT_DEPLOYMENT"}
for a,b in rep.items():assert a in s;s=s.replace(a,b)
Path('deployment/release_v351_guarded.mjs').write_text(s)
s=Path('tests/test_v35_release_guard.mjs').read_text().replace('release_v35_guarded.mjs','release_v351_guarded.mjs').replace('IRYS_V35_LIFECYCLE_WORKER.mjs','IRYS_V351_DELIVERY_FIRST_WORKER.mjs').replace('IRYS_V34_CRASH_WARNING_WORKER.mjs','IRYS_V35_LIFECYCLE_WORKER.mjs').replace('V35 ','V35.1 ')
Path('tests/test_v351_release_guard.mjs').write_text(s)
