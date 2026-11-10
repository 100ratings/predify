import test from 'node:test';
import assert from 'node:assert/strict';
const saved = new Map();
global.localStorage = {getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key),get length(){return saved.size;},key:index=>[...saved.keys()][index]};
const {recordDiagnostic,diagnosticReport,spotifyOperation} = await import('../diagnostics.js');
test('diagnostics only retain allowed technical fields and redact IDs and query terms', () => {
  const secret='private-token-secret';
  recordDiagnostic('spotify-response',{operation:spotifyOperation('/search?q='+secret),status:429,method:'GET',token:secret,word:secret,url:secret,reason:secret});
  recordDiagnostic(secret,{operation:secret,message:secret});
  const report=diagnosticReport();
  assert.equal(report.events[0].operation,'search');
  assert.equal(spotifyOperation('/playlists/'+secret+'/items'),'playlist-items');
  assert.equal(JSON.stringify(report).includes(secret),false);
  assert.equal([...saved.values()].join('').includes(secret),false);
});
test('diagnostics retain a bounded recent history and survive reopening', async () => {
  for(let i=0;i<410;i++)recordDiagnostic('spotify-response',{status:200,ms:i});
  const reopened=await import('../diagnostics.js?reopened');
  const report=reopened.diagnosticReport();
  assert.ok(report.events.length>=400);
  assert.equal(report.events.filter(e=>e.ms!==undefined).at(-400).ms,10);
  assert.equal(report.events.at(-1).ms,409);
});

test('test records count every attempt once, preserve attribution across reopening and keep cache hits at zero', async()=>{
 const d=await import('../diagnostics.js');
 const test=d.beginDiagnosticTest();
 d.recordDiagnostic('playlist-switch',{operation:'playlist-switch'});
 d.recordDiagnostic('cache-hit',{operation:'playlist-switch',apiCalls:0});
 let report=d.diagnosticReport();
 assert.deepEqual(report.tests.find(t=>t.id===test.id).browser,{});
 const req=d.beginDiagnosticRequest('spotify','playlists','GET');
 d.finishDiagnosticRequest(req,429);
 const other=await import('../diagnostics.js?second-tab');
 const req2=other.beginDiagnosticRequest('spotify','playlist-items','PUT',20);
 other.finishDiagnosticRequest(req2,200);
 d.endDiagnosticTest();
 report=other.diagnosticReport();
 const metrics=report.tests.find(t=>t.id===test.id).browser;
 assert.equal(metrics['spotify|playlists|GET'].attempts,1);
 assert.equal(metrics['spotify|playlist-items|PUT'].attempts,1);
 assert.equal(metrics['spotify|playlist-items|PUT'].itemsSubmitted,20);
 assert.ok(report.tests.find(t=>t.id===test.id).endedAt);
 assert.ok(report.events.some(e=>e.event==='cache-hit'&&e.apiCalls===0));
});

test('server metrics snapshots replace prior snapshots without counting them repeatedly and sanitize data',async()=>{
 const d=await import('../diagnostics.js');
 const snapshot={schema:1,since:Date.now(),totals:{'spotify|playlist-items|PUT':{attempts:3}},days:{},runs:[],token:'secret'};
 d.updateRemoteDiagnostics(snapshot);d.updateRemoteDiagnostics(snapshot);
 const r=d.diagnosticReport();
 assert.equal(r.cloudflare.totals['spotify|playlist-items|PUT'].attempts,3);
 assert.equal(JSON.stringify(r.cloudflare).includes('secret'),false);
});

test('unavailable-send logging allows only fixed reason codes and does not increment HTTP counters',async()=>{
 const d=await import('../diagnostics.js');
 d.beginDiagnosticTest();
 d.recordDiagnostic('manual-blocked',{operation:'manual-send',reasonCodes:['sequence-empty','private-word','sequence-empty'],word:'private-word',stage:'write'});
 const r=d.diagnosticReport();const event=r.events.findLast(e=>e.event==='manual-blocked');
 assert.deepEqual(event.reasonCodes,['sequence-empty']);
 assert.equal(JSON.stringify(event).includes('private-word'),false);
 const t=r.tests.find(t=>!t.endedAt);assert.deepEqual(t.browser,{});
 assert.equal(r.reasonLegend['sequence-empty'],'A sequência não contém músicas para enviar');
 d.endDiagnosticTest();
});
