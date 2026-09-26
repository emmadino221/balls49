import json
import importlib.util
import os
import unittest

spec = importlib.util.spec_from_file_location('ml_retrainer', os.path.join(os.getcwd(), 'ml_retrainer.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class MlRetrainerFeatureVectorTests(unittest.TestCase):
    def test_extract_feature_vector_has_market_feature_fields(self):
        entry = {
            'predicted': {
                'betzero': [1, 2, 3, 4],
                'rainbow': 'red',
                'totalColor': {'topColors': ['red', 'green'], 'status': 'ACTIVE'},
                'hilo': 'LOW',
            },
            'result': {
                'betzero': 'WIN',
                'rainbow': 'LOSS',
                'hilo': 'WIN',
                'totalColor': 'LOSS'
            }
        }
        vector = module.extract_feature_vector(entry, 'u4')
        self.assertIn('u4_bet_count', vector)
        self.assertIn('u4_pick_count', vector)
        self.assertIn('signal_alignment', vector)
        self.assertEqual(vector['u4_bet_count'], 4)
        self.assertEqual(vector['u4_pick_count'], 4)
        self.assertGreaterEqual(vector['signal_alignment'], -1.0)

if __name__ == '__main__':
    unittest.main()
