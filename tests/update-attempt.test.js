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

test('history migrates the old record, merges remote failures with manual successes and keeps only the three newest',()=>{
 const f=fixture();
 const old=finishUpdateAttempt(createUpdateAttempt('Previous','manual',1000),'confirmed');
 f.saved.set('predify.last-update-attempt.v1',JSON.stringify(old));
 const store=createUpdateAttemptStore(f.storage);
 assert.equal(store.list()[0].id,old.id);
 const remote=Array.from({length:6},(_,i)=>finishUpdateAttempt(createUpdateAttempt('Remote '+i,'remote',2000+i*1000),i===5?'rate-limit':'confirmed'));
 store.save(remote.slice(0,3));
 const manual=finishUpdateAttempt(createUpdateAttempt('Manual','manual',6500),'confirmed');store.save(manual);
 store.save(remote);
 assert.deepEqual(store.list().map(a=>a.word),['Remote 5','Manual','Remote 4']);
 const writes=f.writes;store.save(remote);store.list();assert.equal(f.writes,writes);
 assert.deepEqual(createUpdateAttemptStore(f.storage).list(),store.list());
 // Delayed old snapshots cannot evict a later attempt or restore an old pending result
 const pending={...remote[5],result:'pending',updatedAt:remote[5].updatedAt+1000};store.save(pending);
 assert.equal(store.get().result,'rate-limit');assert.equal(f.writes,writes);
});

test('history ignores malformed stored data and merges simultaneous browser stores without losing attempts',()=>{
 const f=fixture(),first=createUpdateAttemptStore(f.storage),second=createUpdateAttemptStore(f.storage);
 const a=createUpdateAttempt('A','manual',1000),b=createUpdateAttempt('B','remote',2000);
 first.save(a);second.save(b);first.save(finishUpdateAttempt(a,'confirmed'));
 assert.deepEqual(first.list().map(x=>x.word),['B','A']);
 assert.equal(createUpdateAttemptStore(f.storage).list()[1].result,'confirmed');
 f.saved.set('predify.update-attempt-history.v1','{"unexpected":true}');
 assert.equal(createUpdateAttemptStore(f.storage).list().length,0);
 assert.equal(first.list().length,2);
});

test('history renders all four fields in order as literal text, with no action or network callback',async()=>{
 const {readFileSync}=await import('node:fs'),vm=await import('node:vm');
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const attempts=[finishUpdateAttempt(createUpdateAttempt('<img onerror=bad>','manual',2000),'confirmed'),finishUpdateAttempt(createUpdateAttempt('Old','remote',1000),'rate-limit')];
 const node=()=>({children:[],append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;}});
 const elements={'update-attempt-empty':node(),'update-attempt-list':node()};
 const context={updateAttemptStore:{list:()=>attempts},ATTEMPT_RESULTS,ATTEMPT_ORIGINS:{manual:'Manual',remote:'Apresentação remota'},$:id=>elements[id],document:{createElement:()=>node()}};
 vm.createContext(context);
 const start=source.indexOf('function paintUpdateAttempts() {');
 const end=source.indexOf('\n}',start)+2;
 vm.runInContext(source.slice(start,end)+'\npaintUpdateAttempts();',context);
 assert.equal(elements['update-attempt-list'].children.length,2);
 const rows=elements['update-attempt-list'].children[0].children[0].children;
 assert.deepEqual(rows.map(r=>r.children[0].textContent),['Palavra','Origem','Horário','Resultado']);
 assert.equal(rows[0].children[1].textContent,'<img onerror=bad>');
 assert.equal(elements['update-attempt-empty'].hidden,true);
});
