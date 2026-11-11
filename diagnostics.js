import { SEND_REASON_LABELS } from './send-diagnostics.js?v=1.3.23';
import { APP_VERSION, BUILD_ID } from './version.js?v=1.3.23';
import { metricKey,metricDay,countAttempt,countResult,mergeMetrics,metricCount } from './request-metrics.js?v=1.3.23';
const LEGACY_KEY='predify.diagnostics.v1', PREFIX='predify.diagnostics.v2.',TESTS_KEY='predify.diagnostic-tests.v2',REMOTE_KEY='predify.remote-metrics.v2';
const LIMIT=2000, RETENTION_MS=14*86400000;
const uuid=()=>globalThis.crypto?.randomUUID?.() || Date.now().toString(16)+'-'+Math.random().toString(16).slice(2);
const validId=value=>typeof value==='string'&&/^[a-f0-9-]{8,64}$/.test(value);
const tabId=uuid(), key=PREFIX+tabId;
const ledger={tabId,since:Date.now(),updatedAt:Date.now(),totals:{},days:{},tests:{},actions:{},testActions:{},events:[]};
let storageLimited=false;
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const write=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{storageLimited=true;}};
function prune() {
  try { for(let i=localStorage.length-1;i>=0;i--){const k=localStorage.key(i);if(k?.startsWith(PREFIX)&&read(k,{}).updatedAt<Date.now()-RETENTION_MS)localStorage.removeItem(k);} }catch{storageLimited=true;}
}
prune();
const persist=()=>{ledger.updatedAt=Date.now();write(key,ledger);};
const allowedEvents=new Set(['app-start','spotify-response','spotify-network-error','spotify-wait','remote-response','remote-network-error','remote-state','request-start','request-result','cache-hit','cache-miss','playlist-switch','playlist-reload','manual-send','test-start','test-end','cooldown-blocked','manual-readiness','manual-blocked','inject-blocked','inject-observation','remote-readiness','remote-start-blocked','remote-start-attempt','send-accepted','send-failed']);
const allowedOperations=new Set(['profile','playlists','playlist-items','playlist-images','track','search','token','selection','other','status','start','stop','sync','startup','playlist-switch','playlist-reload','manual-send']);
function cleanEvent(name,details={},at=Date.now()) {
  const event={at,event:allowedEvents.has(name)?name:'other',version:typeof details.version==='string'&&/^\d+\.\d+\.\d+$/.test(details.version)?details.version:APP_VERSION};
  if(allowedOperations.has(details.operation))event.operation=details.operation;
  if(['spotify','spotify-auth','inject','cloudflare-control'].includes(details.service))event.service=details.service;
  if(['GET','POST','PUT','DELETE'].includes(details.method))event.method=details.method;
  for(const k of ['status','ms','retryAfter','polls','errors','changes','items','apiCalls'])if(Number.isFinite(details[k]))event[k]=Math.max(0,Math.round(details[k]));
  for(const k of ['testId','requestId'])if(validId(details[k]))event[k]=details[k];
  if(Array.isArray(details.reasonCodes))event.reasonCodes=[...new Set(details.reasonCodes.filter(reason=>Object.hasOwn(SEND_REASON_LABELS,reason)))].slice(0,20);
  if(['baseline','detected','sent','send-failed','empty'].includes(details.outcome))event.outcome=details.outcome;
  if(['backup','write'].includes(details.stage))event.stage=details.stage;
  if(typeof details.ready==='boolean')event.ready=details.ready;
  if(details.reason==='QUOTA_EXCEEDED')event.reason=details.reason;
  for(const k of ['active','hasError','reported'])if(typeof details[k]==='boolean')event[k]=details[k];
  return event;
}
export function currentDiagnosticTest() {
  const tests=read(TESTS_KEY,[]);
  return Array.isArray(tests)?tests.find(t=>validId(t?.id)&&!t.endedAt)||null:null;
}
export function recordDiagnostic(name,details={}) {
  const test=currentDiagnosticTest();
  const event=cleanEvent(name,{testId:test?.id,...details});
  const actionKey=event.event+'|'+(event.operation||'other');
  ledger.actions[actionKey]=(ledger.actions[actionKey]||0)+1;
  if(event.testId){const counts=ledger.testActions[event.testId] ||= {};counts[actionKey]=(counts[actionKey]||0)+1;}
  ledger.events.push(event);
  ledger.events=ledger.events.slice(-400);persist();
}
function metricGroups(ctx) {
  const groups=[ledger.totals,ledger.days[ctx.day] ||= {}];
  if(ctx.testId)groups.push(ledger.tests[ctx.testId] ||= {});
  return groups;
}
export function beginDiagnosticRequest(service,operation,method='GET',items=0) {
  const ctx={service,operation,method,items,requestId:uuid(),testId:currentDiagnosticTest()?.id,at:Date.now(),day:metricDay()};
  ctx.key=metricKey(service,operation,method);
  for(const m of metricGroups(ctx))countAttempt(m,ctx.key,items);
  if(service==='spotify'||service==='spotify-auth')ledger.events.push(cleanEvent('request-start',ctx,ctx.at));
  ledger.events=ledger.events.slice(-400);persist();return ctx;
}
export function finishDiagnosticRequest(ctx,status) {
  const ms=Date.now()-ctx.at;
  for(const m of metricGroups(ctx))countResult(m,ctx.key,status,ms);
  if(ctx.service==='spotify'||ctx.service==='spotify-auth'||!(status>=200&&status<300))ledger.events.push(cleanEvent('request-result',{...ctx,status,ms}));
  ledger.events=ledger.events.slice(-400);persist();
}
export async function diagnosticFetch(service,operation,url,options={},items=0,fetcher=fetch) {
  const ctx=beginDiagnosticRequest(service,operation,options.method||'GET',items);
  try{const res=await fetcher(url,options);finishDiagnosticRequest(ctx,res.status);return res;}
  catch(error){finishDiagnosticRequest(ctx,null);throw error;}
}
export function spotifyOperation(path) {
  if(path==='/me')return 'profile';
  if(path.startsWith('/me/playlists'))return 'playlists';
  if(/^\/playlists\/[^/]+\/items/.test(path))return 'playlist-items';
  if(/^\/playlists\/[^/]+\/images/.test(path))return 'playlist-images';
  if(path.startsWith('/tracks/'))return 'track';if(path.startsWith('/search'))return 'search';return 'other';
}
function safeRemote(value) {
  if(!value||value.schema!==1)return null;
  return {schema:1,since:Number(value.since)||0,observedAt:Date.now(),totals:mergeMetrics(value.totals),
    days:Object.fromEntries(Object.entries(value.days||{}).filter(([d])=>/^\d{4}-\d{2}-\d{2}$/.test(d)).slice(-14).map(([d,m])=>[d,mergeMetrics(m)])),
    runs:(value.runs||[]).slice(-20).map(r=>({id:validId(r.id)?r.id:'',startedAt:Number(r.startedAt)||0,endedAt:Number(r.endedAt)||0,testId:validId(r.testId)?r.testId:null,mode:r.mode==='live'?'live':'test',possibleGap:!!r.possibleGap,metrics:mergeMetrics(r.metrics)})),
    lastSpotifyLimit:value.lastSpotifyLimit?{at:Number(value.lastSpotifyLimit.at)||0,reason:value.lastSpotifyLimit.reason==='QUOTA_EXCEEDED'?'QUOTA_EXCEEDED':'',retryAfter:Number.isFinite(value.lastSpotifyLimit.retryAfter)?value.lastSpotifyLimit.retryAfter:null}:null};
}
export function updateRemoteDiagnostics(value){const safe=safeRemote(value);if(safe)write(REMOTE_KEY,safe);}
export function beginDiagnosticTest() {
  if(currentDiagnosticTest())return currentDiagnosticTest();
  const tests=read(TESTS_KEY,[]);const test={id:uuid(),startedAt:Date.now(),endedAt:null};
  write(TESTS_KEY,[...(Array.isArray(tests)?tests:[]),test].slice(-30));recordDiagnostic('test-start',{testId:test.id});return test;
}
export function endDiagnosticTest(){const tests=read(TESTS_KEY,[]);if(!Array.isArray(tests))return;const test=tests.find(t=>!t.endedAt);if(test){test.endedAt=Date.now();write(TESTS_KEY,tests);recordDiagnostic('test-end',{testId:test.id});}}
function mergeActions(sources) {
  const result={};for(const source of sources)for(const [key,n]of Object.entries(source||{}))if(/^[a-z-]+\|[a-z-]+$/.test(key)&&allowedEvents.has(key.split('|')[0])&&allowedOperations.has(key.split('|')[1])&&Number.isSafeInteger(n)&&n>=0)result[key]=(result[key]||0)+n;return result;
}
export function diagnosticReport() {
  const sources=[];
  try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(PREFIX)){const value=read(k,null);if(value&&value.updatedAt>=Date.now()-RETENTION_MS)sources.push(value);}}}catch{storageLimited=true;}
  const ownIndex=sources.findIndex(s=>s.tabId===tabId);
  if(ownIndex>=0)sources[ownIndex]=ledger;else sources.push(ledger);
  const totals=mergeMetrics(...sources.map(s=>s.totals));
  const dayKeys=[...new Set(sources.flatMap(s=>Object.keys(s.days||{})))].sort().slice(-14);
  const days=Object.fromEntries(dayKeys.map(d=>[d,mergeMetrics(...sources.map(s=>s.days?.[d]))]));
  const remote=safeRemote(read(REMOTE_KEY,null));
  // Keep the actual observation time instead of making an old server snapshot look current
  if(remote)remote.observedAt=read(REMOTE_KEY,{}).observedAt||0;
  const tests=read(TESTS_KEY,[]);
  const reports=(Array.isArray(tests)?tests:[]).filter(t=>validId(t?.id)).slice(-30).map(t=>({id:t.id,startedAt:t.startedAt,endedAt:t.endedAt,
    browser:mergeMetrics(...sources.map(s=>s.tests?.[t.id])),actions:mergeActions(sources.map(s=>s.testActions?.[t.id])),cloudflare:mergeMetrics(...(remote?.runs||[]).filter(r=>r.testId===t.id).map(r=>r.metrics))}));
  const legacy=read(LEGACY_KEY,[]);
  const events=[...(Array.isArray(legacy)?legacy:[]),...sources.flatMap(s=>s.events||[])].filter(e=>e&&Number.isFinite(e.at)).sort((a,b)=>a.at-b.at).slice(-LIMIT).map(e=>cleanEvent(e.event,e,e.at));
  const report={schema:2,app:'Predify',version:APP_VERSION,build:BUILD_ID,exportedAt:new Date().toISOString(),timezone:'America/Sao_Paulo',retentionDays:14,limit:LIMIT,
    coverage:{since:Math.min(ledger.since,...sources.map(s=>s.since||ledger.since)),storageLimited,meaning:'HTTP attempts initiated by Predify, not quota units or proof of receipt by Spotify',remoteSnapshotAvailable:!!remote,remotePossibleGap:!!remote?.runs.some(r=>r.possibleGap),legacyEventsNotCounted:true,blockedTouchCoverage:'Disabled buttons may suppress pointer events, readiness transitions are recorded independently',browserScope:'Only this browser profile on this device; other devices require their own export',cloudflareScope:'Remote presentation calls from all paired devices, grouped by presentation and diagnostic test ID'},
    reasonLegend:SEND_REASON_LABELS,browser:{totals,days,actions:mergeActions(sources.map(s=>s.actions))},cloudflare:remote,tests:reports,events};
  report.spotifyDaily=spotifyDailyHistory(report);
  return report;
}
export function diagnosticSummary() {
  const report=diagnosticReport(), test=currentDiagnosticTest(), latest=test?report.tests.find(t=>t.id===test.id):report.tests.at(-1);
  const scope=latest?.browser||report.browser.days[metricDay()]||{};
  const remote=latest?.cloudflare||report.cloudflare?.days?.[metricDay()]||{};
  return {active:!!test,report,local:scope,remote,text:(test?'Registro em andamento':latest?'Último registro':'Hoje neste aparelho')+'\nSpotify no aparelho: '+metricCount(scope,'spotify')+' chamadas\nAutorização Spotify no aparelho: '+metricCount(scope,'spotify-auth')+' chamadas\nInject no aparelho: '+metricCount(scope,'inject')+' chamadas\nControle Cloudflare: '+metricCount(scope,'cloudflare-control')+' chamadas\nSpotify na Cloudflare: '+(report.cloudflare?metricCount(remote,'spotify'):'sem medição')+'\nInject na Cloudflare: '+(report.cloudflare?metricCount(remote,'inject'):'sem medição')+'\nHoje, Spotify neste aparelho: '+metricCount(report.browser.days[metricDay()]||{},'spotify')+' chamadas'+'\nHoje, Spotify na Cloudflare: '+(report.cloudflare?metricCount(report.cloudflare.days[metricDay()]||{},'spotify'):'sem medição')+'\nLeituras da cópia salva neste registro: '+Object.entries(latest?.actions||{}).filter(([k])=>k.startsWith('cache-hit|')).reduce((n,[,v])=>n+v,0)+'\nPausas locais neste registro: '+Object.entries(latest?.actions||{}).filter(([k])=>k.startsWith('cooldown-blocked|')).reduce((n,[,v])=>n+v,0)};
}

// Calendar-day totals are independent of diagnostic test sessions and server snapshots
// are already replaced, not accumulated, by updateRemoteDiagnostics
export function spotifyDailyHistory(report, at=Date.now()) {
  const today=metricDay(at), cutoff=metricDay(at-13*86400000);
  const keys=[...new Set([today,...Object.keys(report.browser?.days||{}),...Object.keys(report.cloudflare?.days||{})])]
    .filter(day=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&day>=cutoff&&day<=today).sort().reverse();
  return {today,observedAt:report.cloudflare?.observedAt||null,
    rows:keys.map(day=>{
      const browser=metricCount(report.browser?.days?.[day],'spotify');
      const remote=report.cloudflare?metricCount(report.cloudflare.days?.[day],'spotify'):null;
      return {day,browser,remote,total:browser+(remote??0)};
    })};
}
