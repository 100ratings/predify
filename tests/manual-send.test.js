import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const values=new Map();
global.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k),get length(){return values.size;},key:i=>[...values.keys()][i]};
const {playlistTracks,replacePlaylist}=await import('../spotify.js');
const {createUpdateAttempt,finishUpdateAttempt,updateAttemptError,createUpdateAttemptStore}=await import('../update-attempt.js');
const {sendBlockReasons}=await import('../send-diagnostics.js');
const page=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const helpers=page.slice(page.indexOf('function currentSendReasons('),page.indexOf('function updateButton() {'));
const source=helpers+page.slice(page.indexOf('async function sendSequenceToSpotify('),page.indexOf("$('update').onclick ="));
const id='p'.repeat(22),before={id:'b'.repeat(22),uri:'spotify:track:'+'b'.repeat(22)},after={id:'a'.repeat(22),uri:'spotify:track:'+'a'.repeat(22)};
function fixture(snapshot) {
 values.clear();values.set('predify.auth.v1',JSON.stringify({access_token:'test',refresh_token:'test',expires_at:Date.now()+3600000}));
 const methods=[],notices=[],events=[];
 global.fetch=async(url,opts)=>{methods.push(opts.method||'GET');return Response.json(opts.method==='PUT'?snapshot:{items:[{item:before}],next:null});};
 const elements={};
 const context={createUpdateAttempt,finishUpdateAttempt,updateAttemptError,updateAttemptStore:createUpdateAttemptStore(localStorage),sendBlockReasons,remoteBusy:false,remoteUnknown:false,remoteState:{active:false},sequence:{tracks:[after],error:''},lastManualReadiness:'',remoteOwnsPlaylist:()=>false,sending:false,playlistBusy:false,playlistLoading:false,importingCatalog:false,auth:()=>true,data:{playlist:id},playlists:[{id,name:'Test'}],recordDiagnostic:(name,details)=>events.push({name,...details}),updateButton:()=>{},playlistTracks,replacePlaylist,localStorage,
  lastSuccessfulSend:null,LAST_SUCCESS_KEY:'test.last-success',lastManualSuccessfulSend:null,LAST_MANUAL_SUCCESS_KEY:'test.last-manual-success',paintLastSuccessfulWord:()=>{},playlistItems:[],playlistLoadedFor:'',
  $:id=>elements[id] ||= {append:()=>{}},node:()=>({}),toast:message=>notices.push(message),saveCurrentPlaylistCache:()=>{},paintPlaylist:()=>{}};
 vm.createContext(context);const send=vm.runInContext(source+'\nsendSequenceToSpotify',context);
 return {context,methods,notices,events,send};
}
test('manual send performs only fresh backup GET and acknowledged PUT, without post-send GET',async()=>{
 const f=fixture({snapshot_id:'confirmed'});
 assert.equal(await f.send('TEST',[after]),true);
 assert.deepEqual(f.methods,['GET','PUT']);
 assert.equal(JSON.parse(values.get('predify.last-backup')).uris[0],before.uri);
 assert.equal(f.context.lastSuccessfulSend.word,'TEST');
 assert.equal(f.context.lastManualSuccessfulSend.word,'TEST');
 assert.equal(f.context.updateAttemptStore.get().result,'confirmed');
 assert.equal(JSON.parse(values.get('test.last-manual-success')).word,'TEST');
 assert.equal(f.context.playlistItems[0].uri,after.uri);
});
test('a PUT without a valid Spotify snapshot cannot mark the manual word as successful or retry the write',async()=>{
 const f=fixture({});
 assert.equal(await f.send('TEST',[after]),false);
 assert.deepEqual(f.methods,['GET','PUT']);
 assert.equal(f.context.lastSuccessfulSend,null);
 assert.equal(f.context.lastManualSuccessfulSend,null);
 assert.equal(f.context.updateAttemptStore.get().result,'unknown-write');
 assert.ok(f.notices.some(text=>text.includes('sem confirmação')));
});

test('a blocked send records the actual reason and makes no HTTP request',async()=>{
 const f=fixture({snapshot_id:'unused'});f.context.auth=()=>false;
 assert.equal(await f.send('private word',[after]),false);
 assert.deepEqual(f.methods,[]);
 assert.deepEqual(Array.from(f.events[0].reasonCodes),['spotify-disconnected']);
 assert.equal(JSON.stringify(f.events).includes('private word'),false);
});

test('manual readiness logs transitions, not repeated paints, and never the word or playlist identity',()=>{
 const f=fixture({snapshot_id:'unused'});
 vm.runInContext('recordManualReadiness();recordManualReadiness();',f.context);
 assert.equal(f.events.length,1);
 assert.equal(f.events[0].ready,true);
 f.context.sequence.tracks=[];
 vm.runInContext('recordManualReadiness();',f.context);
 assert.equal(f.events.length,2);
 assert.deepEqual(Array.from(f.events[1].reasonCodes),['sequence-empty']);
 assert.equal(JSON.stringify(f.events).includes(id),false);
 assert.deepEqual(f.methods,[]);
});

test('local Inject updates overall success without replacing the saved manual success',async()=>{
 const f=fixture({snapshot_id:'confirmed'});
 await f.send('MANUAL',[after]);
 const savedManual=values.get('test.last-manual-success');
 assert.equal(await f.send('INJECT',[after],{inject:true}),true);
 assert.equal(f.context.lastSuccessfulSend.word,'INJECT');
 assert.equal(f.context.lastManualSuccessfulSend.word,'MANUAL');
 assert.equal(values.get('test.last-manual-success'),savedManual);
 assert.deepEqual(f.methods,['GET','PUT','PUT']);
});

test('remote confirmation preserves manual history, ignores stale success and never treats receipt as success',async()=>{
 const {isNewRemoteConfirmation}=await import('../remote.js');
 const f=fixture({snapshot_id:'confirmed'});
 await f.send('MANUAL',[after]);
 Object.assign(f.context,{rememberLastRemoteWord:()=>{},isNewRemoteConfirmation,remoteKey:()=>false,injectStatus:()=>{},lastRemoteStatusAt:0,remoteStatusFailed:false});
 const apply=vm.runInContext(page.slice(page.indexOf('function applyRemoteStatus('),page.indexOf('async function readRemoteStatus('))+'\napplyRemoteStatus',f.context);
 const at=f.context.lastSuccessfulSend.at;
 apply({active:true,lastValue:'RECEIVED'});
 assert.equal(f.context.lastSuccessfulSend.word,'MANUAL');
 apply({active:true,lastValue:'REMOTE',lastSuccess:{snapshotId:'confirmed',playlist:id,word:'REMOTE',at:at+1000}});
 assert.equal(f.context.lastSuccessfulSend.word,'REMOTE');
 assert.equal(f.context.lastManualSuccessfulSend.word,'MANUAL');
 apply({active:false,lastSuccess:{snapshotId:'old',playlist:id,word:'OLD',at:at-1000}});
 assert.equal(f.context.lastSuccessfulSend.word,'REMOTE');
 assert.equal(JSON.parse(values.get('test.last-manual-success')).word,'MANUAL');
});

test('independent confirmations restore and render separately for the selected playlist',()=>{
 const f=fixture({snapshot_id:'unused'});
 const manual={playlist:id,word:'neide',at:1000},overall={playlist:id,word:'busca',at:2000};
 values.set('test.last-success',JSON.stringify(overall));values.set('test.last-manual-success',JSON.stringify(manual));
 Object.assign(f.context,{spotifyId:(value)=>value?.length===22?value:null});
 const load=vm.runInContext(page.slice(page.indexOf('function loadLastSuccess('),page.indexOf('function loadData('))+'\nloadLastSuccess',f.context);
 f.context.lastSuccessfulSend=load();f.context.lastManualSuccessfulSend=load('test.last-manual-success');
 const paint=vm.runInContext(page.slice(page.indexOf('function paintLastSuccessfulWord('),page.indexOf('function node('))+'\npaintLastSuccessfulWord',f.context);
 paint();
 assert.equal(f.context.$('last-success-word').textContent,'✓ Última: BUSCA');
 assert.equal(f.context.$('last-manual-success-word').textContent,'Última: NEIDE');
 f.context.data.playlist='q'.repeat(22);paint();
 assert.equal(f.context.$('last-success-word').hidden,true);
 assert.equal(f.context.$('last-manual-success-word').hidden,true);
});

test('manual composer clears only after acknowledgment and refreshes the empty preview',async()=>{
 const f=fixture({snapshot_id:'confirmed'});
 const input=f.context.$('person-name');input.value=' TEST ';
 f.context.$('update').disabled=false;
 let renders=0;f.context.renderPreview=()=>{renders++;f.context.sequence={tracks:[],error:'empty'};};
 vm.runInContext(page.slice(page.indexOf("$('update').onclick ="),page.indexOf("$('connect').onclick =")),f.context);
 assert.equal(await f.context.$('update').onclick(),true);
 assert.equal(input.value,'');assert.equal(renders,1);
 assert.equal(f.context.sequence.tracks.length,0);
 assert.equal(f.context.lastManualSuccessfulSend.word,'TEST');
 assert.deepEqual(f.methods,['GET','PUT']);
});

test('failed manual send preserves the word and preview for another attempt',async()=>{
 const f=fixture({});f.context.$('person-name').value='TEST';f.context.$('update').disabled=false;
 let renders=0;f.context.renderPreview=()=>{renders++;};
 vm.runInContext(page.slice(page.indexOf("$('update').onclick ="),page.indexOf("$('connect').onclick =")),f.context);
 assert.equal(await f.context.$('update').onclick(),false);
 assert.equal(f.context.$('person-name').value,'TEST');assert.equal(renders,0);
 assert.equal(f.context.sequence.tracks.length,1);
});

test('manual success never erases a newer draft typed while waiting for Spotify',async()=>{
 const f=fixture({snapshot_id:'confirmed'});f.context.$('person-name').value='TEST';f.context.$('update').disabled=false;
 const fetcher=global.fetch;
 let release;const gate=new Promise(resolve=>{release=resolve;});
 global.fetch=async(url,opts)=>{if(opts.method==='PUT')await gate;return fetcher(url,opts);};
 let renders=0;f.context.renderPreview=()=>{renders++;};
 vm.runInContext(page.slice(page.indexOf("$('update').onclick ="),page.indexOf("$('connect').onclick =")),f.context);
 const pending=f.context.$('update').onclick();
 f.context.$('person-name').value='NEXT';release();
 assert.equal(await pending,true);
 assert.equal(f.context.$('person-name').value,'NEXT');assert.equal(renders,0);
 assert.equal(f.context.lastManualSuccessfulSend.word,'TEST');
});
