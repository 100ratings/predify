import test from 'node:test';
import assert from 'node:assert/strict';
import {createUpdateAttempt,finishUpdateAttempt,createUpdateAttemptStore,updateAttemptError,cleanUpdateAttempt,ATTEMPT_RESULTS} from '../update-attempt.js';
function fixture(){const saved=new Map();let writes=0;return {saved,get writes(){return writes;},storage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>{writes++;saved.set(key,value);}}};}
test('last attempt survives reopening, prefers newer attempts and does not double-write remote snapshots',()=>{
 const f=fixture(),store=createUpdateAttemptStore(f.storage);
 const manual=createUpdateAttempt('Rihanna','manual',2000);
 store.save(manual);const success=finishUpdateAttempt(manual,'confirmed');success.updatedAt=manual.at;
 store.save(success);assert.equal(store.get().result,'confirmed');
 const old=createUpdateAttempt('Old','remote',1000);old.updatedAt=9000;
 store.save(old);assert.equal(store.get().word,'Rihanna');
 const remote=createUpdateAttempt('New','remote',3000);store.save(finishUpdateAttempt(remote,'rate-limit',429));
 const writes=f.writes;store.save(store.get());store.get();assert.equal(f.writes,writes);
 const reopened=createUpdateAttemptStore(f.storage);assert.equal(reopened.get().result,'rate-limit');assert.equal(reopened.get().origin,'remote');
});
test('attempt results distinguish HTTP refusals, auth expiry, pre-send backup and ambiguous writes',()=>{
 assert.equal(updateAttemptError({status:429}),'rate-limit');
 assert.equal(updateAttemptError({code:'spotify-auth'},'backup'),'auth');
 assert.equal(updateAttemptError({status:401}),'auth');assert.equal(updateAttemptError({status:403}),'access');
 assert.equal(updateAttemptError({status:404}),'not-found');assert.equal(updateAttemptError({status:400}),'spotify-error');
 assert.equal(updateAttemptError(new TypeError('network'),'backup'),'backup-failed');
 assert.equal(updateAttemptError(new TypeError('network'),'write'),'unknown-write');
 assert.equal(updateAttemptError({status:503}),'unknown-write');
 assert.equal(updateAttemptError({code:'missing-confirmation'}),'unknown-write');
 assert.match(ATTEMPT_RESULTS.pending,/Aguardando confirmação/);
});
test('attempt records retain only explicit user fields, errors never retain tokens or raw messages',()=>{
 const value=createUpdateAttempt('Name','manual');
 const safe=cleanUpdateAttempt({...value,token:'private',message:'private',url:'private',headers:{Authorization:'private'}});
 assert.equal(JSON.stringify(safe).includes('private'),false);assert.equal(cleanUpdateAttempt({...value,result:'private'}),null);
 assert.equal(cleanUpdateAttempt({...value,origin:'private'}),null);
 assert.equal(cleanUpdateAttempt(null),null);
 const f=fixture();f.storage.setItem=()=>{throw Error('full');};
 const store=createUpdateAttemptStore(f.storage);store.save(value);assert.equal(store.get().word,'Name');assert.equal(store.storageLimited,true);
});
