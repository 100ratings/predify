import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../cloudflare/presentation.js',import.meta.url),'utf8')
  .replace("import { DurableObject } from 'cloudflare:workers';",'class DurableObject { constructor(ctx,env) { this.ctx=ctx; this.env=env; } }')
  .replace("'../update-attempt.js'",JSON.stringify(new URL('../update-attempt.js',import.meta.url).href))
  .replace("'../request-metrics.js'",JSON.stringify(new URL('../request-metrics.js',import.meta.url).href))
  .replace("'../engine.js'",JSON.stringify(new URL('../engine.js',import.meta.url).href))
  .replace("'../inject.js'",JSON.stringify(new URL('../inject.js',import.meta.url).href));
const {PresentationMonitor,validateStart,seal,unseal} = await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const {default:worker} = await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(new URL('../cloudflare/worker.js',import.meta.url),'utf8').replace(/^export .*from .*;\n/gm,'')).toString('base64'));
const key = Buffer.alloc(32,7).toString('base64');
function fixture(saved = {}) {
  const state = structuredClone(saved);
  const ctx = {storage:{
    get:async k=>structuredClone(state[k]),
    put:async(k,v)=>{if (typeof k === 'object') Object.assign(state,structuredClone(k)); else state[k]=structuredClone(v);},
    setAlarm:async n=>{state.alarm=n;},deleteAlarm:async()=>{delete state.alarm;}
  },blockConcurrencyWhile(fn){this.ready=fn();},waitUntil(p){this.work=p;}};
  const monitor = new PresentationMonitor(ctx,{TOKEN_ENCRYPTION_KEY:key});
  return {monitor,ctx,state};
}
const request = (action,body)=>new Request('https://monitor.test/api/'+action,{method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})});

test('remote start validates duration and credentials and encrypts tokens',async()=>{
  assert.throws(()=>validateStart({injectId:'5156',mode:'test',minutes:241}));
  assert.throws(()=>validateStart({injectId:'5156',mode:'live',minutes:1}));
  const sealed = await seal({refresh_token:'private'},key);
  assert.equal(JSON.stringify(sealed).includes('private'),false);
  assert.deepEqual(await unseal(sealed,key),{refresh_token:'private'});
  await assert.rejects(()=>unseal(sealed,Buffer.alloc(32,8).toString('base64')));
});

test('worker requires private key and rejects a foreign origin before touching a Durable Object',async()=>{
  const env = {REMOTE_KEY:'private'};
  assert.equal((await worker.fetch(request('status'),env)).status,401);
  assert.equal((await worker.fetch(new Request('https://m.test/api/status',{headers:{Authorization:'Bearer private',Origin:'https://evil.test'}}),env)).status,403);
  assert.equal((await worker.fetch(new Request('https://m.test/api/status',{method:'OPTIONS'}),env)).headers.get('Access-Control-Allow-Origin'),'https://100ratings.github.io');
});

test('test mode polls and detects counts without Spotify, survives restarts and expires',async()=>{
  const f=fixture(); await f.ctx.ready;
  const realFetch=globalThis.fetch, realNow=Date.now, realTimer=globalThis.setTimeout;
  let time=realNow(), reads=0, changes=0;
  Date.now=()=>time;
  globalThis.setTimeout=(fn,ms)=>{time+=ms;queueMicrotask(fn);return 1;};
  globalThis.fetch=async url=>{
    assert.match(String(url),/^https:\/\/11z.co\//);
    time+=60;reads++;
    return Response.json({count:reads<4?1:2,value:'macarrao'});
  };
  try {
    assert.equal((await f.monitor.fetch(request('start',{mode:'test',injectId:'5156',minutes:1}))).status,200);
    assert.equal((await f.monitor.fetch(request('start',{mode:'test',injectId:'5156',minutes:1}))).status,409);
    await f.monitor.alarm();
    assert.equal(f.monitor.s.changes,1); assert.equal(f.monitor.s.lastSuccess,null);
    const restarted=fixture(f.state); await restarted.ctx.ready;
    changes=restarted.monitor.s.changes;
    while(restarted.monitor.s.active) await restarted.monitor.alarm();
    assert.equal(restarted.monitor.s.phase,'expired');
    assert.equal(restarted.monitor.s.changes,changes);
    assert.equal(restarted.state.alarm,undefined);
    const before=reads; await restarted.monitor.alarm(); assert.equal(reads,before);
    assert.equal(restarted.monitor.status().diagnostics.totals['inject|selection|GET'].attempts,reads);
    assert.ok(reads>=100); assert.equal(restarted.monitor.status().intervalMs.p50,500);
    assert.equal(JSON.stringify(restarted.monitor.status()).includes('sealedAuth'),false);
  } finally {globalThis.fetch=realFetch;Date.now=realNow;globalThis.setTimeout=realTimer;}
});

test('ambiguous Spotify PUT after restart is not retried, new count is sent only once after acknowledgment',async()=>{
  const {emptyCatalog}=await import('../engine.js');
  const catalog=emptyCatalog();catalog.A[0]={id:'A'.repeat(22),uri:'spotify:track:'+'A'.repeat(22),name:'Anna Julia',artist:'Los Hermanos',image:''};
  const f=fixture();await f.ctx.ready;
  const realFetch=globalThis.fetch,realNow=Date.now,realTimer=globalThis.setTimeout;
  let time=realNow(),reads=0,puts=0;
  Date.now=()=>time;globalThis.setTimeout=(fn,ms)=>{time+=ms;queueMicrotask(fn);return 1;};
  globalThis.fetch=async(url,opts)=>{
    if(String(url).startsWith('https://11z.co')) {reads++;time+=60;return Response.json({count:reads<3?1:2,value:'a'});}
    assert.match(String(url),/api.spotify.com\/v1\/playlists\/.+\/items/);assert.equal(opts.method,'PUT');
    puts++;return Response.json({snapshot_id:'accepted'});
  };
  try {
    const start={mode:'live',injectId:'5156',minutes:1,playlist:'P'.repeat(22),catalog,opening:null,auth:{access_token:'private-access',refresh_token:'private-refresh',expires_at:time+3600000}};
    assert.equal((await f.monitor.fetch(request('start',start))).status,200);
    assert.equal(JSON.stringify(f.state.presentation).includes('private-refresh'),false);
    await f.monitor.alarm();if(f.monitor.delivery)await f.monitor.delivery;
    assert.equal(puts,1);assert.equal(f.monitor.s.lastSuccess.snapshotId,'accepted');
    assert.equal(f.monitor.status().lastAttempt.result,'confirmed');
    assert.equal(f.monitor.status().lastAttempt.origin,'remote');
    await f.monitor.alarm();assert.equal(puts,1);
    f.state.presentation.pending={count:'2',value:'a',phase:'sending'};
    f.state['last-update-attempt']={...f.monitor.lastAttempt,result:'pending'};
    const restarted=fixture(f.state);await restarted.ctx.ready;await restarted.monitor.alarm();
    assert.equal(puts,1);assert.match(restarted.monitor.s.lastError,/interrompido/);
    assert.equal(restarted.monitor.status().lastAttempt.result,'interrupted');
    await restarted.monitor.fetch(request('stop',{}));
    const before=reads;await restarted.monitor.alarm();assert.equal(reads,before);
    assert.equal(restarted.monitor.s.sealedAuth,null);
    assert.ok(restarted.monitor.s.syncAuth);
    const sync=await (await restarted.monitor.fetch(request('sync',{}))).json();
    assert.equal(sync.auth.refresh_token,'private-refresh');
    assert.equal(restarted.monitor.s.syncAuth,null);
    assert.equal(restarted.state.alarm,undefined);
  } finally {globalThis.fetch=realFetch;Date.now=realNow;globalThis.setTimeout=realTimer;}
});

test('encrypted return credentials expire without further Inject requests',async()=>{
  const sealed=await seal({access_token:'private-access',refresh_token:'private-refresh'},key);
  const f=fixture({presentation:{active:false,phase:'expired',syncAuth:sealed,syncUntil:Date.now()-1}});
  await f.ctx.ready;await f.monitor.alarm();assert.equal(f.monitor.s.syncAuth,null);
  const sync=await (await f.monitor.fetch(request('sync',{}))).json();assert.equal(sync.auth,null);
});

test('Inject errors back off and stop never starts another poll',async()=>{
  const f=fixture();await f.ctx.ready;
  const realFetch=globalThis.fetch,realNow=Date.now,realTimer=globalThis.setTimeout;
  let time=realNow(),reads=0;
  Date.now=()=>time;globalThis.setTimeout=(fn,ms)=>{time+=ms;queueMicrotask(fn);return 1;};
  globalThis.fetch=async()=>{reads++;return new Response('',{status:429,headers:{'Retry-After':'15'}});};
  try {
    await f.monitor.fetch(request('start',{mode:'test',injectId:'5156',minutes:1}));
    await f.monitor.alarm();assert.equal(reads,1);assert.equal(f.monitor.s.errors,1);
    await f.monitor.fetch(request('stop',{}));await f.monitor.alarm();assert.equal(reads,1);
  } finally {globalThis.fetch=realFetch;Date.now=realNow;globalThis.setTimeout=realTimer;}
});

test('stop cancels a start still reading its configuration and concurrent starts are refused',async()=>{
  const f=fixture();await f.ctx.ready;
  let release;
  const body=new Promise(resolve=>{release=resolve;});
  const starting=f.monitor.fetch({url:'https://m.test/api/start',method:'POST',json:()=>body});
  assert.equal((await f.monitor.fetch(request('start',{mode:'test',injectId:'5156',minutes:1}))).status,409);
  await f.monitor.fetch(request('stop',{}));
  release({mode:'test',injectId:'5156',minutes:1});
  assert.equal((await starting).status,400);
  assert.equal(f.monitor.s.active,false);
  assert.equal(f.state.alarm,undefined);
});

test('Spotify Retry-After applies to newer Inject counts too',async()=>{
  const {emptyCatalog}=await import('../engine.js');
  const catalog=emptyCatalog();catalog.A[0]={id:'A'.repeat(22),uri:'spotify:track:'+'A'.repeat(22),name:'Anna Julia',artist:'Los Hermanos',image:''};
  const f=fixture();await f.ctx.ready;
  const realFetch=globalThis.fetch,realNow=Date.now,realTimer=globalThis.setTimeout;
  let time=realNow(),reads=0,puts=0;
  Date.now=()=>time;globalThis.setTimeout=(fn,ms)=>{time+=ms;queueMicrotask(fn);return 1;};
  globalThis.fetch=async url=>{
    if(String(url).startsWith('https://11z.co')) {time+=60;return Response.json({count:++reads,value:'a'});}
    puts++;return Response.json({error:'rate limit'},{status:429,headers:{'Retry-After':'15'}});
  };
  try {
    await f.monitor.fetch(request('start',{mode:'live',injectId:'5156',minutes:1,playlist:'P'.repeat(22),catalog,auth:{access_token:'private',refresh_token:'private',expires_at:time+3600000}}));
    await f.monitor.alarm();if(f.monitor.delivery)await f.monitor.delivery;
    assert.ok(reads>10);assert.equal(puts,1);assert.equal(f.monitor.s.lastSuccess,null);
    assert.ok(f.monitor.s.spotifyRetryAt>time);
    assert.equal(f.monitor.status().lastAttempt.result,'rate-limit');
    const lastAttempt=f.monitor.status().lastAttempt;
    await f.monitor.fetch(request('stop',{}));
    assert.deepEqual(f.monitor.status().lastAttempt,lastAttempt);
    await f.monitor.fetch(request('stop',{}));
  } finally {globalThis.fetch=realFetch;Date.now=realNow;globalThis.setTimeout=realTimer;}
});

test('remote accounting counts retries and token calls separately, persists without exposing tokens or words',async()=>{
 const f=fixture();await f.ctx.ready;
 f.monitor.s={active:true,runId:crypto.randomUUID(),startedAt:Date.now(),mode:'live',config:{diagnosticTestId:crypto.randomUUID()}};
 const original=globalThis.fetch;
 let n=0;
 globalThis.fetch=async()=>Response.json({}, {status:++n===1?401:200});
 try{
  await f.monitor.trackedFetch('spotify','playlist-items','https://example.test',{method:'PUT'},20);
  await f.monitor.trackedFetch('spotify-auth','token','https://example.test',{method:'POST'});
  await f.monitor.trackedFetch('spotify','playlist-items','https://example.test',{method:'PUT'},20);
  const restarted=fixture(f.state);await restarted.ctx.ready;
  const diag=restarted.monitor.status().diagnostics;
  assert.equal(diag.totals['spotify|playlist-items|PUT'].attempts,2);
  assert.equal(diag.totals['spotify-auth|token|POST'].attempts,1);
  assert.equal(diag.totals['spotify|playlist-items|PUT'].statuses[401],1);
  assert.equal(diag.runs[0].testId,f.monitor.s.config.diagnosticTestId);
  assert.equal(JSON.stringify(diag).includes('access_token'),false);
 }finally{globalThis.fetch=original;}
});

test('remote attempt persists refusals and ambiguous writes without extra Spotify requests and survives a new test session',async()=>{
 const {emptyCatalog}=await import('../engine.js');
 const catalog=emptyCatalog();catalog.A[0]={id:'A'.repeat(22),uri:'spotify:track:'+'A'.repeat(22),name:'Anna Julia',artist:'Los Hermanos',image:''};
 const original=globalThis.fetch;
 try{
  for(const scenario of [{status:403,result:'access'},{status:404,result:'not-found'},{status:500,result:'unknown-write'},{status:200,body:{},result:'unknown-write'},{network:true,result:'unknown-write'}]){
   const f=fixture();await f.ctx.ready;const runId=crypto.randomUUID();
   f.monitor.s={active:true,runId,mode:'live',startedAt:Date.now(),endsAt:Date.now()+60000,config:{catalog,playlist:'P'.repeat(22),opening:null},pending:{count:1,value:'a',phase:'queued'}};
   f.monitor.token={access_token:'private',expires_at:Date.now()+3600000};
   let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.equal(options.method,'PUT');if(scenario.network)throw new TypeError('private network error');return Response.json(scenario.body||{error:'private'}, {status:scenario.status});};
   await f.monitor.send(runId);
   assert.equal(calls,1);assert.equal(f.monitor.status().lastAttempt.result,scenario.result);
   assert.equal(JSON.stringify(f.monitor.status().lastAttempt).includes('private'),false);
   const restarted=fixture(f.state);await restarted.ctx.ready;
   assert.equal(restarted.monitor.status().lastAttempt.result,scenario.result);
   await restarted.monitor.fetch(request('stop',{}));
   await restarted.monitor.fetch(request('start',{mode:'test',injectId:'5156',minutes:1}));
   assert.equal(restarted.monitor.status().lastAttempt.result,scenario.result);
   assert.equal(calls,1);
  }
 }finally{globalThis.fetch=original;}
});
