import test from 'node:test';
import assert from 'node:assert/strict';
import { isNewRemoteConfirmation } from '../remote.js';

test('a stopped remote session cannot replace a newer manual success, including after reopening',()=>{
  const manual = {playlist:'same-playlist',word:'marcos',at:2000};
  const oldRemote = {playlist:'same-playlist',word:'paula',at:1000};
  assert.equal(isNewRemoteConfirmation(oldRemote,manual),false);
  assert.equal(isNewRemoteConfirmation(oldRemote,JSON.parse(JSON.stringify(manual))),false);
  assert.equal(isNewRemoteConfirmation({...oldRemote,at:3000},manual),true);
  assert.equal(isNewRemoteConfirmation(manual,manual),false);
  assert.equal(isNewRemoteConfirmation(oldRemote,null),true);
  assert.equal(isNewRemoteConfirmation({word:'unknown date'},manual),false);
});

test('remote status checks slow only after a confirmed inactive state',async()=>{
 const {remoteStatusInterval}=await import('../remote.js');
 assert.equal(remoteStatusInterval({active:false}),60000);
 assert.equal(remoteStatusInterval({active:true}),2500);
 assert.equal(remoteStatusInterval({unknown:true}),2500);
 assert.equal(remoteStatusInterval({error:true}),2500);
});
