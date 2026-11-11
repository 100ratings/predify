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

test('remote receipt has its own line and preserves the presentation status and errors',async()=>{
 const {readFileSync}=await import('node:fs'),vm=await import('node:vm');
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const elements={};
 const context={remoteKey:()=>true,remoteOwnsPlaylist:()=>false,sending:false,playlistBusy:false,playlistLoading:false,importingCatalog:false,auth:()=>true,data:{playlist:'selected'},validInjectId:()=>true,injectIdInput:{value:'5156'},remoteBusy:false,remoteUnknown:false,remoteConfigOpen:false,sendBlockReasons:()=>[],lastRemoteReadiness:'',recordDiagnostic:()=>{},remoteMessage:'',lastRemoteWord:'a very long received word',remoteState:{active:true,endsAt:Date.now()+60000,polls:402,lastValue:'a very long received word',lastError:'test error'},$:id=>elements[id] ||= {}};
 vm.createContext(context);
 const paint=vm.runInContext(source.slice(source.indexOf('function paintRemote() {'),source.indexOf('function applyRemoteStatus('))+'\npaintRemote',context);
 paint();
 assert.match(elements['remote-status'].textContent,/Apresentação ativa até .*402 leituras.*test error/);
 assert.equal(elements['remote-status'].textContent.includes('received word'),false);
 assert.equal(elements['remote-last-word'].textContent,'Última: A VERY LONG RECEIVED WORD');
 assert.equal(elements['remote-last-word'].hidden,false);
 context.remoteState={active:false,mode:'test',phase:'stopped'};paint();
 assert.equal(elements['remote-last-word'].hidden,false);
 assert.equal(elements['remote-last-word'].textContent,'Última: A VERY LONG RECEIVED WORD');
 assert.match(elements['remote-status'].textContent,/Nenhuma palavra nova recebida neste teste/);
});


test('last remote word survives start, stop, expiry and reopening until another nonempty receipt',async()=>{
 const {readFileSync}=await import('node:fs'),vm=await import('node:vm');
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const stored=new Map();let writes=0;
 const context={LAST_REMOTE_WORD_KEY:'test.remote-word',lastRemoteWord:'',localStorage:{getItem:key=>stored.get(key)??null,setItem:(key,value)=>{writes++;stored.set(key,value);}}};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('function loadLastRemoteWord('),source.indexOf('function loadData(')),context);
 context.rememberLastRemoteWord('rihanna');
 for(const value of ['',undefined,null,'   '])context.rememberLastRemoteWord(value);
 assert.equal(context.lastRemoteWord,'rihanna');
 assert.equal(context.loadLastRemoteWord(),'rihanna');
 context.lastRemoteWord=context.loadLastRemoteWord();
 context.rememberLastRemoteWord('rihanna');assert.equal(writes,1);
 context.rememberLastRemoteWord('neide');
 assert.equal(context.lastRemoteWord,'neide');assert.equal(context.loadLastRemoteWord(),'neide');
 stored.set('test.remote-word','invalid json');assert.equal(context.loadLastRemoteWord(),'');
 context.localStorage.setItem=()=>{throw new Error('full');};
 context.rememberLastRemoteWord('new');assert.equal(context.lastRemoteWord,'new');
});
