import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECK_INTERVAL, validRelease, newerRelease, canApplyUpdate, fetchRelease, pollPeriodically } from '../updates.js';
test('release descriptor detects a different published build and rejects invalid data', () => {
  const release = validRelease({version:'1.2.0',build:'1.2.0-123'});
  assert.equal(newerRelease(release,'1.2.0-123'),false);
  assert.equal(newerRelease(release,'1.1.0-111'),true);
  assert.throws(()=>validRelease({version:'1.2',build:'123'}));
  assert.throws(()=>validRelease({version:'1.2.0',build:'https://example.org'}));
});
test('version fetch bypasses caches and stays inside the project directory', async () => {
  let request;
  const release = await fetchRelease({base:'https://100ratings.github.io/predify/?test=1#settings',time:123,fetcher:async(url,options)=>{
    request={url,options};
    return {ok:true,json:async()=>({version:'1.2.0',build:'test-build'})};
  }});
  assert.equal(request.url,'https://100ratings.github.io/predify/version.json?_=123');
  assert.equal(request.options.cache,'no-store');
  assert.equal(request.options.credentials,'omit');
  assert.equal(release.build,'test-build');
});
test('sixty-second polling pauses when inactive and never overlaps pending checks', async () => {
  let handler, interval, calls=0, active=true, unblock;
  const pending=new Promise(resolve=>{unblock=resolve});
  const poller=pollPeriodically(async()=>{calls++;await pending},{active:()=>active,schedule:(fn,delay)=>{handler=fn;interval=delay;return 42},cancel:id=>assert.equal(id,42)});
  assert.equal(interval,60000);assert.equal(CHECK_INTERVAL,60000);assert.equal(calls,1);
  await handler();assert.equal(calls,1);
  unblock();await pending;await Promise.resolve();
  active=false;await handler();assert.equal(calls,1);
  active=true;await handler();assert.equal(calls,2);
  poller.stop();await handler();assert.equal(calls,2);
});

test('update button is enabled only for a new known version with a usable connection', () => {
  const latest={version:'1.2.1',build:'new'};
  assert.equal(canApplyUpdate({latest:null,currentBuild:'old'}),false);
  assert.equal(canApplyUpdate({latest,currentBuild:'new'}),false);
  assert.equal(canApplyUpdate({latest,currentBuild:'old'}),true);
  assert.equal(canApplyUpdate({latest,currentBuild:'old',online:false}),false);
  assert.equal(canApplyUpdate({latest,currentBuild:'old',busy:true}),false);
  assert.equal(canApplyUpdate({latest,currentBuild:'old',safe:false}),false);
});
