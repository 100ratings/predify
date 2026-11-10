import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const values=new Map();
global.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k),get length(){return values.size;},key:i=>[...values.keys()][i]};
const {playlistTracks,replacePlaylist}=await import('../spotify.js');
const page=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const source=page.slice(page.indexOf('async function sendSequenceToSpotify('),page.indexOf("$('update').onclick ="));
const id='p'.repeat(22),before={id:'b'.repeat(22),uri:'spotify:track:'+'b'.repeat(22)},after={id:'a'.repeat(22),uri:'spotify:track:'+'a'.repeat(22)};
function fixture(snapshot) {
 values.clear();values.set('predify.auth.v1',JSON.stringify({access_token:'test',refresh_token:'test',expires_at:Date.now()+3600000}));
 const methods=[],notices=[];
 global.fetch=async(url,opts)=>{methods.push(opts.method||'GET');return Response.json(opts.method==='PUT'?snapshot:{items:[{item:before}],next:null});};
 const elements={};
 const context={remoteOwnsPlaylist:()=>false,sending:false,playlistBusy:false,playlistLoading:false,importingCatalog:false,auth:()=>true,data:{playlist:id},playlists:[{id,name:'Test'}],recordDiagnostic:()=>{},updateButton:()=>{},playlistTracks,replacePlaylist,localStorage,
  lastSuccessfulSend:null,LAST_SUCCESS_KEY:'test.last-success',paintLastSuccessfulWord:()=>{},playlistItems:[],playlistLoadedFor:'',
  $:id=>elements[id] ||= {append:()=>{}},node:()=>({}),toast:message=>notices.push(message),saveCurrentPlaylistCache:()=>{},paintPlaylist:()=>{}};
 vm.createContext(context);const send=vm.runInContext(source+'\nsendSequenceToSpotify',context);
 return {context,methods,notices,send};
}
test('manual send performs only fresh backup GET and acknowledged PUT, without post-send GET',async()=>{
 const f=fixture({snapshot_id:'confirmed'});
 assert.equal(await f.send('TEST',[after]),true);
 assert.deepEqual(f.methods,['GET','PUT']);
 assert.equal(JSON.parse(values.get('predify.last-backup')).uris[0],before.uri);
 assert.equal(f.context.lastSuccessfulSend.word,'TEST');
 assert.equal(f.context.playlistItems[0].uri,after.uri);
});
test('a PUT without a valid Spotify snapshot cannot mark the manual word as successful or retry the write',async()=>{
 const f=fixture({});
 assert.equal(await f.send('TEST',[after]),false);
 assert.deepEqual(f.methods,['GET','PUT']);
 assert.equal(f.context.lastSuccessfulSend,null);
 assert.ok(f.notices.some(text=>text.includes('sem confirmação')));
});
