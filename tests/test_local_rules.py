import unittest,sys,math,json
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server

class LocalRules(unittest.TestCase):
 def test_nested_distance_validation_and_no_keyword_override(self):
  def fixture(s):
   kind=s['type'];kind='null' if isinstance(kind,list) else kind
   return None if kind=='null' else {k:fixture(v) for k,v in s['properties'].items()} if kind=='object' else [] if kind=='array' else False if kind=='boolean' else s.get('enum',['text'])[0]
  data=fixture(server.SCHEMA);data['distanceRules']['station']={'minKm':.2,'maxKm':2}
  self.assertEqual(server.validate_filters(data)['distanceRules']['station']['maxKm'],2)
  self.assertFalse(server.stabilize_filters(data,'not quiet; near industry within 1.2 km')['avoidIndustry'])
  data['distanceRules']['station']['maxKm']='2'
  with self.assertRaises(ValueError):server.validate_filters(data)
 def test_rejects_client_evidence_and_nonfinite_points(self):
  for payload in [{'query':'Pool?','point':{'x':180000,'y':330000},'sources':[]},{'query':'Pool?','point':{'x':math.nan,'y':330000}},{'query':'Pool?','point':{'x':1,'y':2}}]:
   with self.assertRaises(ValueError):server.search_rules(payload)
 def test_missing_key_does_not_call_source_or_ai(self):
  with patch.object(server,'credentials',return_value={}),patch.object(server,'rules_node',side_effect=AssertionError('Unexpected call')):
   self.assertEqual(server.search_rules({'query':'Pool?','point':{'x':180000,'y':330000}})['error'],'dso_key_missing')
 def test_source_matches_stay_readable_without_ai_and_no_key_echo(self):
  corpus={'sources':[{'id':'official','text':'Zwembad'}],'coverage':{'complete':False,'warnings':[]},'modelConfig':{'instructions':'fixture','schema':{}}}
  with patch.object(server,'credentials',return_value={'dso':'fixture-only-secret'}),patch.object(server,'backend',return_value='none'),patch.object(server,'rules_node',return_value=corpus):
   response=server.search_rules({'query':'Pool?','point':{'x':180000,'y':330000}})
   self.assertEqual(response['state'],'matches');self.assertNotIn('fixture-only-secret',json.dumps(response));self.assertNotIn('modelConfig',response)
if __name__=='__main__':unittest.main()
