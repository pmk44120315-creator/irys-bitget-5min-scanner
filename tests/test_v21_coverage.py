import inspect
import unittest
import v21_runtime as v

class ForwardCoverage(unittest.TestCase):
    def rows(self):
        return [{'symbol':str(i),'issued_ms':i*3600000,'side':1,'ret':.7 if i%4 else -.1} for i in range(60)]

    def test_unmeasured_outcomes_are_part_of_evidence_contract(self):
        self.assertIn('unmeasured',inspect.signature(v.certificate).parameters)
        c=v.certificate(self.rows(),'bitget',5,1,unmeasured=20)
        self.assertFalse(c['ready'])
        self.assertEqual(c['reason'],'FORWARD_OUTCOME_COVERAGE_INSUFFICIENT')
        self.assertAlmostEqual(c['coverage_ratio'],.75)
        self.assertEqual(c['unmeasured_outcomes'],20)

    def test_complete_positive_evidence_can_still_qualify(self):
        self.assertIn('unmeasured',inspect.signature(v.certificate).parameters)
        c=v.certificate(self.rows(),'bitget',5,1,unmeasured=0)
        self.assertTrue(c['ready'])
        self.assertEqual(c['coverage_ratio'],1)

if __name__=='__main__':unittest.main()
