const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const climate=require('../compare-climate.js');

function harness(language){
  const context=vm.createContext({
    document:{documentElement:{lang:language}},
    window:{addEventListener(){},PlanViewCompareCore:{key:item=>item.id},PlanViewCriteriaUI:{text:key=>({group:{en:'Zoning group',nl:'Bestemmingsgroep'},status:{en:'Plan status',nl:'Planstatus'}}[key]?.[language]||key)}},
    matchMedia:()=>({matches:true,addEventListener(){}}),localStorage:{getItem:()=>null},
    esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),URL
  });
  const source=fs.readFileSync(require.resolve('../comparison-ui.js'),'utf8');
  vm.runInContext(source.replace('window.PlanViewComparison={','globalThis.fixture={climateDisplay,label,sourceHtml};window.PlanViewComparison={'),context);
  return context.fixture;
}
const pixel=value=>({type:'FeatureCollection',features:[{properties:{GRAY_INDEX:value}}]});
function storedRecord(kind,value){
 const point={lat:50.846383,lng:5.709461};
 const source=climate._test.provenance(kind,point,climate.queryUrl(kind,point),Date.UTC(2026,9,18));
 return climate.parseDepth(kind,pixel(value),source);
}

for(const language of ['en','nl']){
 test(`cached climate facts render in ${language} without rewriting evidence`,()=>{
  const ui=harness(language),flood=storedRecord('flood',.758),rain=storedRecord('rain',.049),before=JSON.stringify({flood,rain});
  for(const [kind,record] of [['flood',flood],['rain',rain]]){
   const shown=ui.climateDisplay(record,kind),html=ui.sourceHtml({source:shown.source,scope:shown.scope},{id:'demo'});
   assert.equal(shown.value,record.value);assert.equal(shown.nativeValue,record.nativeValue);
   assert.equal(shown.source.url,record.source.url);assert.equal(shown.source.modelVersion,record.source.modelVersion);
   assert.equal(shown.source.queryUrls,record.source.queryUrls);assert.equal(shown.source.sampledCell,record.source.sampledCell);
   assert.doesNotMatch(shown.scenario,/Fluss und Meer|Starkregen/);
   assert.doesNotMatch(html,/Heutige Situation|Modellfassung|Eine native Rasterzelle/);
   assert.match(html,language==='en'?/not a parcel maximum/:/geen perceelmaximum/);
  }
  assert.equal(JSON.stringify({flood,rain}),before,'render translation never changes cached evidence');
  assert.equal(ui.label('groups'),language==='en'?'Zoning group':'Bestemmingsgroep');
  assert.equal(ui.label('statuses'),language==='en'?'Plan status':'Planstatus');
 });
 test(`NoData and source failures remain explicit open checks in ${language}`,()=>{
  const ui=harness(language);
  for(const kind of ['rain','flood']){
   const record=storedRecord(kind,-9999),shown=ui.climateDisplay(record,kind);
   assert.equal(shown.state,'unknown');assert.equal(shown.value,null);assert.equal(shown.reasonCode,'nodata');
   assert.match(shown.reason,/NoData/);assert.doesNotMatch(shown.reason,/Die Quelle|keine Entwarnung/);
  }
  const unavailable=ui.climateDisplay({...storedRecord('rain',-9999),reasonCode:'unavailable',reason:'Die Quelle hat nicht rechtzeitig geantwortet'},'rain');
  assert.match(unavailable.reason,language==='en'?/unavailable/:/niet bereikbaar/);
 });
}

test('German descriptions and unknown future source wording are retained',()=>{
 const original=storedRecord('flood',.758),de=harness('de').climateDisplay(original,'flood');
 assert.equal(de.scenario,original.scenario);assert.equal(de.source.dataPeriod,original.source.dataPeriod);assert.equal(de.source.method,original.source.method);
 const future={...original,scenario:'Different verified scenario',source:{...original.source,dataPeriod:'Future source edition',method:'Different source method'}};
 const shown=harness('en').climateDisplay(future,'flood');
 assert.equal(shown.scenario,future.scenario);assert.equal(shown.source.dataPeriod,future.source.dataPeriod);assert.equal(shown.source.method,future.source.method);
});
