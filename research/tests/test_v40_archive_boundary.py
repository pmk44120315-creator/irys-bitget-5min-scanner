import unittest,sys,datetime as dt
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from research.v40_history_corpus import older_commit_bound
class BoundaryTests(unittest.TestCase):
 def test_earliest_event_millisecond_can_share_commit_second(self):
  stamp='2026-11-01T04:54:59Z';published=int(dt.datetime.fromisoformat(stamp.replace('Z','+00:00')).timestamp()*1000)
  self.assertEqual(older_commit_bound(stamp,published+485),published-1000)
 def test_no_progress_or_future_response_is_not_accepted(self):
  self.assertRaises(ValueError,older_commit_bound,'2026-11-01T04:54:59Z',1793508800000)
if __name__=='__main__':unittest.main()
