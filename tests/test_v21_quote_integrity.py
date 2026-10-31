import unittest
from unittest.mock import patch
import v21_runtime as v

class RuntimeIntegrity(unittest.TestCase):
    def test_quote_created_during_network_read_is_fresh_at_receive(self):
        def api(venue,path,args):
            return [{'symbol':'BTCUSDT','bidPr':'99','askPr':'101','ts':'1001000'}]
        with patch('v21_runtime.time.time',return_value=1002):
            quotes,errors=v.fetch_quotes({('bitget','BTCUSDT')},api,1000000)
        self.assertEqual(errors,[])
        self.assertIn(('bitget','BTCUSDT'),quotes)

    def test_empty_models_cannot_report_active(self):
        result,_=v.run({}, {}, {}, {}, {}, 1000000,lambda *a:[])
        self.assertEqual(result['status'],'MODEL_INTEGRITY_FAILURE')
        self.assertIn('models',result['model_integrity_errors'])

    def test_future_timestamp_quote_is_rejected(self):
        def api(venue,path,args):
            return [{'symbol':'BTCUSDT','bidPr':'99','askPr':'101','ts':'1100000'}]
        with patch('v21_runtime.time.time',return_value=1002):
            quotes,_=v.fetch_quotes({('bitget','BTCUSDT')},api,1000000)
        self.assertEqual(quotes,{})

    def test_no_crossed_market_is_accepted(self):
        def api(venue,path,args):
            return [{'symbol':'BTCUSDT','bidPr':'101','askPr':'99','ts':'1000000'}]
        with patch('v21_runtime.time.time',return_value=1002):
            quotes,_=v.fetch_quotes({('bitget','BTCUSDT')},api,1000000)
        self.assertEqual(quotes,{})

if __name__=='__main__':unittest.main()
