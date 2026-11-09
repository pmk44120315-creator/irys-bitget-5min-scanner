import unittest
from pathlib import Path
import yaml
class WorkflowTests(unittest.TestCase):
 def load(self):
  return yaml.load(Path('.github/workflows/v39-direction-causal-audit.yml').read_text(),Loader=yaml.BaseLoader)
 def test_current_feedback_has_completed_source_trigger(self):
  w=self.load();self.assertIn('workflow_run',w['on'])
  self.assertEqual(w['on']['workflow_run']['types'],['completed'])
  self.assertIn('IRYS V30 official paired directional evidence (NO MESSAGES)',w['on']['workflow_run']['workflows'])
 def test_source_event_cannot_execute_untrusted_code(self):
  w=self.load();g=w['jobs']['audit'].get('if','')
  for x in ['head_branch','main','success','head_repository.full_name','github.repository']:self.assertIn(x,g)
  self.assertEqual(w['jobs']['audit']['steps'][0]['with']['ref'],'main')
 def test_original_cron_and_nonforce_writer_preserved(self):
  w=self.load();self.assertEqual(w['on']['schedule'][0]['cron'],'14,44 * * * *')
  self.assertEqual(w['concurrency']['group'],'irys-v39-public-ack-feedback-branch')
  text=Path('.github/workflows/v39-direction-causal-audit.yml').read_text()
  self.assertIn('cmp ',text);self.assertNotIn('push --force',text);self.assertNotIn('secrets.IRYS_',text)
if __name__=='__main__':unittest.main()
