import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {viewportLayout} from '../viewport.js';
const boot=readFileSync(new URL('../startup.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function fixture({ios=true,standalone=true,innerHeight=800,innerWidth=390,screenHeight=844,screenWidth=390}={}) {
 const classes=new Set(),styles={},events=new Map(),timers=new Map();let id=0;
 const root={classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},style:{setProperty:(k,v)=>{styles[k]=v;}}};
 const context={navigator:{userAgent:ios?'iPhone':'Desktop',standalone},matchMedia:()=>({matches:standalone}),screen:{height:screenHeight,width:screenWidth},innerHeight,innerWidth,
 document:{documentElement:root,addEventListener:(name,fn)=>events.set(name,fn)},setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(boot,context);
 return {classes,styles,events,timers};
}
test('pre-paint viewport matches idle layout on standalone iPhone, browser, desktop and landscape',()=>{
 for(const options of [{},{ios:false,standalone:false},{standalone:false},{innerWidth:844,innerHeight:390,screenWidth:844,screenHeight:390}]){
  const base={ios:true,standalone:true,innerHeight:800,innerWidth:390,screenHeight:844,screenWidth:390,...options};
  const f=fixture(base);
  assert.equal(f.styles['--app-h'],viewportLayout({...base,editing:false}).height+'px');
  assert.equal(f.styles['--app-top'],'0px');assert.equal(f.classes.has('app-starting'),true);
 }
});
test('ready reveals immediately, module failure cannot leave the interface hidden indefinitely',()=>{
 const f=fixture();f.events.get('predify:ready')();
 assert.equal(f.classes.has('app-starting'),false);assert.equal(f.timers.size,0);
 const failed=fixture();const fallback=[...failed.timers.values()][0];
 assert.equal(fallback.ms,3000);fallback.fn();assert.equal(failed.classes.has('app-starting'),false);
});
test('cached state is visible before a stalled OAuth response, normal startup makes no Spotify list read',async()=>{
 const order=[];let resolveLogin;
 const context={recordDiagnostic:()=>{},watchAppUpdates:()=>{},$:()=>({}),sending:false,playlistBusy:false,importingCatalog:false,navigator:{},
 paintCatalog:()=>order.push('catalog'),paintOpeningSummary:()=>{},renderPreview:()=>{},paintAccount:()=>{},setView:()=>order.push('view'),restoreSavedPlaylists:()=>order.push('cache'),applyViewport:()=>order.push('viewport'),
 document:{dispatchEvent:()=>order.push('ready')},Event,finishLogin:()=>{order.push('oauth');return new Promise(resolve=>{resolveLogin=resolve;});},auth:()=>true,playlistCache:{profile:()=>null,clear:()=>order.push('clear')},
 loadPlaylists:()=>order.push('spotify-read'),spotifyConnectionError:'',toast:()=>{},injectMonitor:{setId:()=>{}},validInjectId:()=>true,injectIdInput:{value:'5156'},location:{hash:'',href:'https://100ratings.github.io/predify/'},URL,history:{replaceState:()=>{}}};
 vm.createContext(context);
 const start=vm.runInContext(app.slice(app.indexOf('async function start() {'),app.indexOf('start().catch('))+'\nstart',context);
 const pending=start();
 assert.deepEqual(order,['catalog','view','cache','viewport','ready','oauth']);
 resolveLogin(false);await pending;assert.equal(order.includes('spotify-read'),false);
 assert.equal(order.filter(x=>x==='cache').length,1);
 const login=start();resolveLogin(true);await login;
 assert.ok(order.indexOf('ready')<order.indexOf('spotify-read'));
 assert.equal(order.filter(x=>x==='spotify-read').length,1);
});
