const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','parcel-address.js'),'utf8');
function harness(){
 const calls=[],nodes=[];
 const make=tag=>({tag,children:[],textContent:'',className:'',append(...items){this.children.push(...items);},remove(){},querySelector(){return null;}});
 const top=make('div');top.querySelector=selector=>selector==='.detail-title-row'?{insertAdjacentElement:(_,node)=>nodes.push(node)}:null;
 const selected={point:{lat:52.5,lng:5.5},parcel:{geometry:{type:'Polygon'}},signal:new AbortController().signal};
 const context=vm.createContext({state:{selected},renderDetails(){},document:{documentElement:{lang:'de'},createElement:make,querySelector:()=>top},URLSearchParams,AbortController,setTimeout,clearTimeout,
  geoToLatLng:f=>f,parseWkt:s=>{const m=/POINT\(([^ ]+) ([^)]+)\)/.exec(s||'');return m?{lng:+m[1],lat:+m[2]}:null;},
  geometryContains:(_,p)=>p.lng>=5&&p.lng<=6&&p.lat>=52&&p.lat<=53,
  fetch:(url,opts)=>new Promise(resolve=>calls.push({url,opts,resolve}))});
 vm.runInContext(source.replace(/\}\)\(\);\s*$/,'globalThis.api={addressesInParcel,load,show};})();'),context);
 return {context,selected,calls,nodes};
}
const address=(overrides={})=>({type:'adres',straatnaam:'Teststraat',huisnummer:3,huisletter:'A',huisnummertoevoeging:'101',woonplaatsnaam:'Teststad',geometrie_ll:'POINT(5.5 52.5)',...overrides});
const plain=v=>JSON.parse(JSON.stringify(v));
test('header addresses require parcel containment and keep exact number suffixes',()=>{
 const h=harness(),docs=[address(),address(),address({huisnummer:30}),address({geometrie_ll:'POINT(6.01 52.5)'}),address({type:'weg'}),address({geometrie_ll:''}),address({huisnummer:null})];
 assert.deepEqual(plain(h.context.api.addressesInParcel(docs,{})),[{street:'Teststraat 3A-101',place:'Teststad'},{street:'Teststraat 30A-101',place:'Teststad'}]);
});
test('map clicks resolve addresses without changing point, source context or map state',async()=>{
 const h=harness(),point=JSON.stringify(h.selected.point);const pending=h.context.api.load(h.selected);
 assert.equal(h.calls.length,1);assert.equal(new URL(h.calls[0].url).searchParams.get('rows'),'30');
 h.calls[0].resolve({ok:true,json:async()=>({response:{docs:[address()]}})});await pending;
 assert.equal(h.selected.parcelAddresses.addresses[0].street,'Teststraat 3A-101');assert.equal(JSON.stringify(h.selected.point),point);
 assert.equal(h.nodes[0].children[1].textContent,'Teststraat 3A-101, Teststad');
});
test('multiple addresses are explicit and not reduced to a guessed single household',()=>{
 const h=harness();h.selected.parcelAddresses={addresses:[{street:'A 1',place:'Town'},{street:'A 2',place:'Town'},{street:'B 3',place:'Town'}],limited:true};h.context.api.show(h.selected);
 const block=h.nodes[0];assert.equal(block.children[0].textContent,'Adressen im Grundstück');assert.match(block.children[1].children[0].textContent,/A 1.*A 2.*1 weitere/);assert.equal(block.children[1].children[1].children.length,3);assert.match(block.children[2].textContent,/unvollständig/);
});
test('late address responses cannot overwrite another selected parcel',async()=>{
 const h=harness(),pending=h.context.api.load(h.selected);h.context.state.selected={point:{lat:51,lng:4}};
 h.calls[0].resolve({ok:true,json:async()=>({response:{docs:[address()]}})});await pending;assert.equal(h.nodes.length,0);assert.equal(h.selected.parcelAddresses,undefined);
});
test('unresolved parcels, source failures and existing searched addresses keep existing header labels',async()=>{
 const h=harness();h.selected.parcel=null;await h.context.api.load(h.selected);assert.equal(h.calls.length,0);
 h.selected.parcel={geometry:{type:'Polygon'}};h.selected.point.address='Chosen address';await h.context.api.load(h.selected);assert.equal(h.calls.length,0);
 delete h.selected.point.address;const pending=h.context.api.load(h.selected);h.calls[0].resolve({ok:false});await pending;assert.equal(h.nodes.length,0);
});
