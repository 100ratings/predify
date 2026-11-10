import test from 'node:test';
import assert from 'node:assert/strict';
const saved = new Map();
global.localStorage = {getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)};
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
  assert.equal(report.events.length,400);
  assert.equal(report.events[0].ms,10);
  assert.equal(report.events.at(-1).ms,409);
});
