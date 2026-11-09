import unittest
from pathlib import Path
import yaml
class ObservationWorkflowTests(unittest.TestCase):
 def read(self):
  p=Path('.github/workflows/v43-observation.yml')
  self.assertTrue(p.is_file(),'event-driven public observation workflow must exist')
  return yaml.load(p.read_text(),Loader=yaml.BaseLoader),p.read_text()
 def test_completed_same_repo_main_trigger_only(self):
  w,s=self.read();self.assertEqual(w['on']['workflow_run']['types'],['completed']);g=w['jobs']['collect']['if']
  for key in ['head_branch','main','head_repository.full_name','github.repository','success']:self.assertIn(key,g)
  self.assertEqual(w['jobs']['collect']['steps'][0]['with']['ref'],'main')
 def test_observe_is_readonly_and_publication_isolated(self):
  w,s=self.read();self.assertEqual(w['permissions']['contents'],'read');self.assertEqual(w['jobs']['publish']['permissions']['contents'],'write')
  self.assertEqual(w['jobs']['publish']['concurrency']['group'],'irys-v43-evidence-writer')
  self.assertIn('data/irys-v43-stream-evidence',s);self.assertIn('cmp ',s);self.assertNotIn('push --force',s)
  self.assertNotIn('CF_TOKEN',s);self.assertNotIn('TELEGRAM',s);self.assertNotIn('wrangler',s)
 def test_all_original_frames_kept_for_stated_artifact_retention_without_daily_continuity_claim(self):
  w,s=self.read();self.assertIn('--duration-ms 300000',s)
  uploads=[x for x in w['jobs']['collect']['steps'] if x.get('uses')=='actions/upload-artifact@v4'];self.assertEqual(uploads[0]['with']['retention-days'],'1')
if __name__=='__main__':unittest.main()
