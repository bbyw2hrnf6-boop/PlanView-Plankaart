const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fit,preferences}=require('../workspace-resize.js');

test('saved widths discard corrupt storage and keep independent bounded preferences',()=>{
  assert.deepEqual(preferences(null),{});
  assert.deepEqual(preferences({layers:315,search:580,inspector:720,unrelated:'secret'}),{layers:315,search:580,inspector:720});
  assert.deepEqual(preferences({layers:'315',search:NaN,inspector:Infinity}),{});
  assert.deepEqual(preferences({layers:-1,search:100,inspector:90000}),{search:340,inspector:1000});
});
test('closed panes reserve no space and a single pane can use its allowed range',()=>{
  assert.deepEqual([fit(1440,null,false,{}).left,fit(1440,null,false,{}).right],[0,0]);
  assert.equal(fit(1440,'search',false,{search:740}).left,740);
  assert.equal(fit(1440,null,true,{inspector:900}).right,900);
});
test('two wide panes share limited space while preserving readable panes and the map',()=>{
  const original={search:740,inspector:950};
  const small=fit(1366,'search',true,original),large=fit(1920,'search',true,original);
  assert.ok(small.left>=340&&small.right>=360);
  assert.ok(Math.abs(small.map-320)<0.0001);
  assert.ok(large.left>small.left&&large.right>small.right);
  assert.deepEqual(original,{search:740,inspector:950});
});
test('all desktop combinations keep panels, limits and map inside the viewport',()=>{
  for(const width of [901,1024,1200,1366,1440,1920,2560])for(const left of [null,'layers','search'])for(const right of [false,true])for(const size of [0,240,400,760,1000,9000]){
    const layout=fit(width,left,right,{layers:size,search:size,inspector:size});
    assert.ok(layout.map>=Math.min(320,width-(left==='layers'?240:left==='search'?340:0)-(right?360:0))-0.001);
    assert.ok(Math.abs(layout.left+layout.right+layout.map-width)<0.001);
    assert.ok(layout.left>=layout.leftMin-0.001&&layout.left<=layout.leftMax+0.001);
    assert.ok(layout.right>=layout.rightMin-0.001&&layout.right<=layout.rightMax+0.001);
  }
});
