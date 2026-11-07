import unittest,copy,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from research.v40_history_corpus import merge_snapshots
class HistoryTests(unittest.TestCase):
 def event(self):return {'venue':'bitget','symbol':'AAAUSDT','issued_ms':1000000,'shadow_only':True,'entry_quote':{'bid':1,'ask':1.1,'at_ms':999999},'features':{'p5':1},'decisions':{'5':{'direction':1}},'outcomes':{}}
 def test_mature_label_adds_without_recount(self):
  a=self.event();b=copy.deepcopy(a);b['outcomes']['5']={'both_sides_measured':True,'exit_quote':{'bid':2}}
  r,d=merge_snapshots([{'completed':[a]},{'completed':[b]}]);self.assertEqual(len(r['completed']),1);self.assertTrue(r['completed'][0]['outcomes']['5']['both_sides_measured'])
 def test_changed_frozen_features_remove_all_duplicates(self):
  a=self.event();b=copy.deepcopy(a);b['features']['p5']=3
  r,d=merge_snapshots([{'completed':[a]},{'completed':[b]}]);self.assertEqual(len(r['completed']),0);self.assertEqual(d['conflicting_frozen_events'],1)
 def test_conflicting_measured_labels_not_cherry_picked(self):
  a=self.event();a['outcomes']['5']={'both_sides_measured':True,'exit_quote':{'bid':2}};b=copy.deepcopy(a);b['outcomes']['5']['exit_quote']['bid']=3
  r,d=merge_snapshots([{'completed':[a]},{'completed':[b]}]);self.assertEqual(len(r['completed']),0);self.assertEqual(d['conflicting_measured_events'],1)
if __name__=='__main__':unittest.main()
