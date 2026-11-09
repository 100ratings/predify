import test from 'node:test';
import assert from 'node:assert/strict';
import { INJECT_INTERVAL, validInjectId, parseInjectSelection, fetchInjectSelection, createInjectMonitor, INJECT_COUNT_PREFIX } from '../inject.js';
const flush = () => new Promise(resolve => setImmediate(resolve));
const store = () => {
  const map = new Map();
  return {
    getItem: k => map.get(k) ?? null,
    setItem: (k,v) => map.set(k,String(v)),
    removeItem: k => map.delete(k)
  };
};
test('Inject ID is exactly four digits, including leading zero', () => {
  assert.equal(validInjectId('5156'), true);
  assert.equal(validInjectId('0001'), true);
  for (const invalid of ['156','12345','1a56',' 5156',5156]) assert.equal(validInjectId(invalid),false);
});
test('Inject count and value are validated without executing arbitrary input', () => {
  assert.deepEqual(parseInjectSelection({count:34682,value:'  rodrigo   cantor  '}),{count:'34682',value:'rodrigo cantor'});
  assert.deepEqual(parseInjectSelection({selection:{count:'034682',value:'Maria'}}),{count:'034682',value:'Maria'});
  assert.throws(()=>parseInjectSelection({count:'x',value:'oi'}),/count/);
  assert.throws(()=>parseInjectSelection({count:3,value:{html:'hello'}}),/value/);
});
test('GET uses exact Inject endpoint and cache bypass but never sends to Spotify', async () => {
  let request;
  const result = await fetchInjectSelection('5156',{fetcher:async (url,options)=>{
    request={url,options};
    return {ok:true,json:async()=>({count:34682,value:'rodrigo cantor'})};
  }});
  assert.deepEqual(result,{count:'34682',value:'rodrigo cantor'});
  assert.equal(request.url,'https://11z.co/_w/5156/selection');
  assert.equal(request.options.method,'GET');
  assert.equal(request.options.cache,'no-store');
  assert.equal(request.options.credentials,'omit');
});
test('first reading is only a baseline; a changed count triggers once and persists', async () => {
  const storage=store(), statuses=[],sent=[], readings=[{count:34682,value:'rodrigo cantor'},{count:34683,value:'CAMILA'},{count:34683,value:'CAMILA'}];
  let scheduled,delay;
  const monitor=createInjectMonitor({
    storage, read:async()=>readings.shift() ?? {count:34683,value:'CAMILA'},
    onSelection:async event=>{sent.push(event.value);return true;},
    onStatus:e=>statuses.push(e), schedule:(callback,ms)=>{scheduled=callback;delay=ms;return 1},cancel:()=>{}
  });
  monitor.setId('5156');
  await flush();
  assert.equal(delay,500); assert.equal(INJECT_INTERVAL,500);
  assert.deepEqual(sent,[]);
  assert.equal(storage.getItem(INJECT_COUNT_PREFIX+'5156'),'34682');
  await monitor.tick();await flush();
  assert.deepEqual(sent,['CAMILA']);
  await monitor.tick();await flush();
  assert.deepEqual(sent,['CAMILA']);
  assert.equal(storage.getItem(INJECT_COUNT_PREFIX+'5156'),'34683');
  assert.ok(statuses.some(s=>s.kind==='sent'));
  monitor.stop();
});
test('a saved counter triggers on restart only if the count changed', async () => {
  const storage=store(),sent=[];
  storage.setItem(INJECT_COUNT_PREFIX+'5156','100');
  const monitor=createInjectMonitor({
    storage,read:async()=>({count:101,value:'nova palavra'}),
    onSelection:async e=>{sent.push(e.value);return true;},schedule:()=>1,cancel:()=>{}
  });
  monitor.setId('5156');await flush();
  assert.deepEqual(sent,['nova palavra']);
  monitor.stop();
});
test('duplicate or empty values do not send, hidden pauses reads', async () => {
  const storage=store(),sent=[];let visible=true,reads=0;
  const monitor=createInjectMonitor({storage,active:()=>visible,
    read:async()=>{reads++;return {count:reads===1?5:6,value:reads===1?'x':''};},
    onSelection:async e=>{sent.push(e.value);return true;},schedule:()=>1,cancel:()=>{}
  });
  monitor.setId('5156');await flush();
  visible=false;await monitor.tick();assert.equal(reads,1);
  visible=true;await monitor.tick();await flush();
  assert.equal(reads,2);assert.deepEqual(sent,[]);
  monitor.stop();
});
test('busy Spotify defers without losing the count and sends after it becomes ready',async()=>{
  const storage=store();storage.setItem(INJECT_COUNT_PREFIX+'5156','20');
  let busy=true,attempts=0,sent=0;
  const monitor=createInjectMonitor({storage,
    read:async()=>({count:21,value:'palavra'}),onSelection:async()=>{
      attempts++;if(busy)return 'defer';sent++;return true;
    },schedule:()=>1,cancel:()=>{}
  });
  monitor.setId('5156');await flush();
  assert.equal(attempts,1);assert.equal(sent,0);
  busy=false;await monitor.tick();await flush();
  assert.equal(sent,1);assert.equal(storage.getItem(INJECT_COUNT_PREFIX+'5156'),'21');
  await monitor.tick();await flush();assert.equal(sent,1);
  monitor.stop();
});
test('only latest new selection is queued while previous write is in flight',async()=>{
  const storage=store();storage.setItem(INJECT_COUNT_PREFIX+'5156','40');
  let release; const blocked=new Promise(r=>release=r),sent=[];
  let current={count:41,value:'primeiro'};
  const monitor=createInjectMonitor({
    storage,read:async()=>current,onSelection:async e=>{sent.push(e.value);if(e.value==='primeiro')await blocked;return true;},
    schedule:()=>1,cancel:()=>{}
  });
  monitor.setId('5156');await flush();
  current={count:42,value:'segundo'};
  await monitor.tick();await flush();
  current={count:43,value:'terceiro'};
  await monitor.tick();await flush();
  release();await flush();
  assert.deepEqual(sent,['primeiro','terceiro']);
  monitor.stop();
});
test('429 enforces Retry-After and backs off, without request storms',async()=>{
  const storage=store();let time=0,calls=0;
  const monitor=createInjectMonitor({storage,now:()=>time,
    read:async()=>{calls++;if(calls===1)throw Object.assign(new Error('429'),{status:429,retryAfterMs:5000});return {count:1,value:'teste'};},
    onSelection:async()=>true,schedule:()=>1,cancel:()=>{}
  });
  monitor.setId('5156');await flush();
  time=4000;await monitor.tick();assert.equal(calls,1);
  time=5000;await monitor.tick();assert.equal(calls,2);
  monitor.stop();
});
