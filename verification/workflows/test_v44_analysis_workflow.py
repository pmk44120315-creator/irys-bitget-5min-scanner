import unittest
from pathlib import Path
import yaml
class AnalysisWorkflowTests(unittest.TestCase):
 def load(self):return yaml.load(Path('.github/workflows/v43-observation.yml').read_text(),Loader=yaml.BaseLoader)
 def test_analysis_has_read_only_permissions(self):
  w=self.load();self.assertIn('analyze',w['jobs']);self.assertEqual(w['jobs']['analyze']['permissions']['contents'],'read');self.assertEqual(w['jobs']['analyze']['permissions']['actions'],'read')
 def test_analytics_cannot_block_evidence_publication(self):
  w=self.load();self.assertEqual(w['jobs']['publish']['needs'],'collect');self.assertEqual(w['jobs']['analyze']['needs'],'collect');self.assertEqual(w['jobs']['analyze']['steps'][0]['with']['ref'],'main')
 def test_no_live_orders_or_secret_credentials_or_extra_schedule(self):
  w=self.load();self.assertNotIn('schedule',w['on']);text=str(w['jobs']['analyze']);self.assertNotIn('CF_TOKEN',text);self.assertNotIn('TELEGRAM_BOT_TOKEN',text);self.assertIn('from research.v44_collect_history import collect',text)
if __name__=='__main__':unittest.main()
