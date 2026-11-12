import { cleanDeliveryTiming } from '../delivery-timing.js';
import { createUpdateAttempt, finishUpdateAttempt, cleanUpdateAttempt, updateAttemptError } from '../update-attempt.js';
import { metricKey,metricDay,countAttempt,countResult } from '../request-metrics.js';
import { DurableObject } from 'cloudflare:workers';
import { buildSequence, validateCatalog, validateOpening, openingConflicts } from '../engine.js';
import { fetchInjectSelection } from '../inject.js';

const CLIENT_ID = 'ea812e9b0ada47778150c48b62bf02ee';
const MAX_MS = 4 * 60 * 60 * 1000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function stats(values) {
  const v = [...values].sort((a,b) => a-b);
  return v.length ? {samples:v.length,min:v[0],p50:v[Math.floor(v.length*.5)],p95:v[Math.floor(v.length*.95)],max:v.at(-1)} : null;
}
function sample(a, n) { a.push(n); if (a.length > 2000) a.shift(); }
async function encryptionKey(secret) {
  return crypto.subtle.importKey('raw', Uint8Array.from(atob(secret), c=>c.charCodeAt(0)), 'AES-GCM', false, ['encrypt','decrypt']);
}
export async function seal(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(secret),new TextEncoder().encode(JSON.stringify(value)));
  return {iv:Array.from(iv), data:Array.from(new Uint8Array(cipher))};
}
export async function unseal(value, secret) {
  const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(value.iv)},await encryptionKey(secret),new Uint8Array(value.data));
  return JSON.parse(new TextDecoder().decode(plain));
}
export function validateStart(input) {
  if (!input || !/^[0-9]{4}$/.test(input.injectId)) throw new Error('Informe o ID de 4 dígitos do Inject');
  if (!['test','live'].includes(input.mode)) throw new Error('Modo inválido');
  const minutes = Number(input.minutes ?? 120);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240) throw new Error('Use entre 1 e 240 minutos');
  const out = {injectId:input.injectId,mode:input.mode,durationMs:Math.min(MAX_MS,minutes*60000),diagnosticTestId:typeof input.diagnosticTestId==='string'&&/^[a-f0-9-]{8,64}$/.test(input.diagnosticTestId)?input.diagnosticTestId:null};
  if (input.mode === 'live') {
    if (!/^[A-Za-z0-9]{22}$/.test(input.playlist || '')) throw new Error('Selecione uma playlist');
    if (!input.auth?.refresh_token || !input.auth?.access_token || !Number.isFinite(input.auth.expires_at)) throw new Error('Conecte novamente o Spotify');
    out.playlist = input.playlist;
    out.catalog = validateCatalog(input.catalog);
    out.opening = input.opening ? {phrase:input.opening.phrase, tracks:validateOpening(input.opening.phrase,input.opening.tracks)} : null;
    if (openingConflicts(out.opening, out.catalog).length) throw new Error('Corrija as músicas repetidas da abertura');
    out.auth = {access_token:input.auth.access_token,refresh_token:input.auth.refresh_token,expires_at:input.auth.expires_at};
  }
  return out;
}

export class PresentationMonitor extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.running = false;
    this.starting = false;
    this.stopVersion = 0;
    this.delivery = null;
    this.abort = null;
    this.spotifyAbort = null;
    this.token = null;
    ctx.blockConcurrencyWhile(async () => {
      this.s = await ctx.storage.get('presentation') || {active:false,phase:'idle'};
      this.lastAttempt = cleanUpdateAttempt(await ctx.storage.get('last-update-attempt'));
      this.budget = await ctx.storage.get('budget') || {day:'',attempts:0,activeMs:0};
      this.diag = await ctx.storage.get('diagnostics') || {schema:1,since:Date.now(),totals:{},days:{},runs:[]};
      this.diag.deliveryTimings=(this.diag.deliveryTimings||[]).map(cleanDeliveryTiming).filter(Boolean).slice(-50);
      for(const timing of this.diag.deliveryTimings)if(timing.result==='pending'){timing.result='interrupted';timing.finishedAt=Date.now();}
      if ((this.diag.pollCheckpointOpen || this.diag.spotifyCheckpointOpen) && this.s.runId) this.metricRun().possibleGap=true;
      this.diag.pollCheckpointOpen=false; this.diag.spotifyCheckpointOpen=false;
      // A PUT interrupted by a restart has an unknown outcome, never repeat it automatically
      if (this.s.pending?.phase === 'sending') {
        this.s.lastError = 'Envio interrompido, confira a playlist antes de repetir';
        if(this.lastAttempt?.result==='pending')this.lastAttempt=finishUpdateAttempt(this.lastAttempt,'interrupted');
        this.s.pending = null;
        await this.save();
      } else if(this.lastAttempt?.result==='pending') {
        this.lastAttempt=finishUpdateAttempt(this.lastAttempt,'interrupted');
        await this.save();
      }
    });
  }
  save() { return this.ctx.storage.put({presentation:this.s,budget:this.budget,diagnostics:this.diag,'last-update-attempt':this.lastAttempt}); }
  metricRun() {
    let run=this.diag.runs.find(r=>r.id===this.s.runId);
    if(!run){run={id:this.s.runId,startedAt:this.s.startedAt||Date.now(),endedAt:0,testId:this.s.config?.diagnosticTestId||null,mode:this.s.mode||'test',possibleGap:false,metrics:{}};this.diag.runs.push(run);this.diag.runs=this.diag.runs.slice(-20);}
    return run;
  }
  async trackedFetch(service,operation,url,options,items=0,timing=null) {
    const start=Date.now(),day=metricDay(start),key=metricKey(service,operation,options.method||'GET');
    const requestTiming=timing?{service,checkpointStartedAt:start}:null;
    if(requestTiming)timing.requests.push(requestTiming);
    const run=this.metricRun();
    const groups=[this.diag.totals,this.diag.days[day] ||= {},run.metrics];
    for(const m of groups)countAttempt(m,key,items);
    for(const old of Object.keys(this.diag.days).sort().slice(0,-14))delete this.diag.days[old];
    // Spotify attempts are checkpointed before transmission, never store credentials in metrics
    if(service!=='inject'){this.diag.spotifyCheckpointOpen=true;await this.save();}
    if(requestTiming)requestTiming.startedAt=Date.now();
    try{const response=await fetch(url,options);if(requestTiming){requestTiming.responseAt=Date.now();requestTiming.status=response.status;}for(const m of groups)countResult(m,key,response.status,Date.now()-start);return response;}
    catch(error){if(requestTiming)requestTiming.failedAt=Date.now();for(const m of groups)countResult(m,key,null,Date.now()-start);throw error;}
    finally{if(service!=='inject'){this.diag.spotifyCheckpointOpen=false;await this.save();}}
  }
  budgetToday() {
    const day = new Date().toISOString().slice(0,10);
    if (this.budget.day !== day) this.budget = {day,attempts:0,activeMs:0};
    return this.budget;
  }
  status() {
    const s = this.s;
    return {updateAttemptSchema:1,lastAttempt:this.lastAttempt,diagnostics:this.diag,active:s.active,phase:s.phase,mode:s.mode,playlist:s.config?.playlist || '',runId:s.runId,startedAt:s.startedAt,endsAt:s.endsAt,
      polls:s.polls || 0,errors:s.errors || 0,changes:s.changes || 0,lastPollAt:s.lastPollAt,lastReadAt:s.lastReadAt,
      lastValue:s.lastValue || '',lastSuccess:s.lastSuccess || null,lastError:s.lastError || s.injectError || '',pending:!!s.pending,
      intervalMs:stats(s.intervals || []),fetchMs:stats(s.latencies || []),serverNow:Date.now(),dailyAttempts:this.budgetToday().attempts,authUpdatedAt:s.authUpdatedAt || 0,syncAvailable:!!s.syncAuth && s.syncUntil > Date.now()};
  }
  async finish(reason) {
    this.stopVersion++;
    this.s.active = false;
    this.s.phase = reason;
    if(this.s.runId)this.metricRun().endedAt=Date.now();
    const deliveryTiming=this.diag.deliveryTimings?.find(t=>t.id===this.lastAttempt?.id);
    if(deliveryTiming?.result==='pending'){deliveryTiming.result=this.s.pending?.phase==='sending'?'interrupted':'cancelled';deliveryTiming.finishedAt=Date.now();}
    if(this.lastAttempt?.result==='pending')this.lastAttempt=finishUpdateAttempt(this.lastAttempt,this.s.pending?.phase==='sending'?'interrupted':'cancelled');
    this.s.pending = null;
    if (this.s.sealedAuth) {
      this.s.syncAuth = this.s.sealedAuth;
      this.s.syncUntil = Date.now()+3600000;
    }
    this.s.sealedAuth = null;
    this.token = null;
    this.abort?.abort();
    this.spotifyAbort?.abort();
    if (this.s.syncAuth) await this.ctx.storage.setAlarm(this.s.syncUntil);
    else await this.ctx.storage.deleteAlarm();
    await this.save();
  }
  async fetch(req) {
    const path = new URL(req.url).pathname;
    let acquiredStart = false;
    try {
      if (path === '/api/start' && req.method === 'POST') {
        if (this.s.active || this.starting) return Response.json({error:'Já existe uma apresentação ativa',...this.status()},{status:409});
        if (this.running || this.delivery) return Response.json({error:'Aguarde o encerramento anterior'},{status:409});
        this.starting = true; acquiredStart = true;
        const stopVersion = this.stopVersion;
        const b = this.budgetToday();
        if (b.attempts >= 50000 || b.activeMs >= 12*3600000) return Response.json({error:'Limite diário de segurança atingido'},{status:429});
        const input = validateStart(await req.json());
        const {auth,...config} = input;
        const sealedAuth = auth ? await seal(auth,this.env.TOKEN_ENCRYPTION_KEY) : null;
        if (this.stopVersion !== stopVersion) throw new Error('Início cancelado pelo encerramento');
        this.token = auth || null;
        this.s = {active:true,phase:'monitoring',runId:crypto.randomUUID(),config,mode:config.mode,sealedAuth,
          startedAt:Date.now(),endsAt:Date.now()+config.durationMs,polls:0,errors:0,changes:0,
          intervals:[],latencies:[],seenCount:null,pending:null,lastValue:'',lastError:'',lastSuccess:null,errorStreak:0,nextPollAt:0};
        this.metricRun();
        await this.save();
        await this.ctx.storage.setAlarm(Date.now()+1);
      } else if (path === '/api/stop' && req.method === 'POST') {
        await this.finish('stopped');
      } else if (path === '/api/sync' && req.method === 'POST') {
        const sealed = this.s.active ? this.s.sealedAuth : this.s.syncUntil > Date.now() ? this.s.syncAuth : null;
        const auth = sealed ? await unseal(sealed,this.env.TOKEN_ENCRYPTION_KEY) : null;
        if (!this.s.active) { this.s.syncAuth = null; await this.save(); await this.ctx.storage.deleteAlarm(); }
        return Response.json({auth});
      } else if (path !== '/api/status' || req.method !== 'GET') return Response.json({error:'Rota inválida'},{status:404});
      return Response.json(this.status());
    } catch (e) { return Response.json({error:e.message},{status:400}); }
    finally { if (acquiredStart) this.starting = false; }
  }
  async refreshToken(force = false, timing = null) {
    const runId = this.s.runId;
    if (!this.token) this.token = await unseal(this.s.sealedAuth,this.env.TOKEN_ENCRYPTION_KEY);
    if (!force && this.token.expires_at > Date.now()+60000) return this.token.access_token;
    const res = await this.trackedFetch('spotify-auth','token','https://accounts.spotify.com/api/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({grant_type:'refresh_token',refresh_token:this.token.refresh_token,client_id:CLIENT_ID}),signal:AbortSignal.timeout(7000)},0,timing);
    const data = await res.json();
    if (!this.s.active || this.s.runId !== runId) throw new Error('Apresentação encerrada');
    if (!res.ok || !data.access_token) {
      const error = new Error('O Spotify precisa de uma nova conexão');
      error.fatal = res.status === 400 || res.status === 401 || res.status === 403;
      if(error.fatal)error.code='spotify-auth';
      throw error;
    }
    this.token = {access_token:data.access_token,refresh_token:data.refresh_token || this.token.refresh_token,expires_at:Date.now()+data.expires_in*1000};
    this.s.sealedAuth = await seal(this.token,this.env.TOKEN_ENCRYPTION_KEY);
    this.s.authUpdatedAt = Date.now();
    await this.save();
    return this.token.access_token;
  }
  async send(runId) {
    while (this.s.active && this.s.runId === runId && this.s.pending) {
      if (Date.now() < (this.s.spotifyRetryAt || 0)) return;
      const event = this.s.pending;
      if (event.retryAt && Date.now() < event.retryAt) return;
      const attempt = createUpdateAttempt(event.value,'remote');
      this.lastAttempt=attempt;
      const timing={id:attempt.id,runId,result:'pending',attemptStartedAt:attempt.at,requests:[]};
      for(const key of ['previousPollStartedAt','pollStartedAt','detectedAt'])if(Number.isSafeInteger(event[key]))timing[key]=event[key];
      (this.diag.deliveryTimings ||= []).push(timing);
      this.diag.deliveryTimings=this.diag.deliveryTimings.slice(-50);
      const finishTiming=()=>{timing.result=this.lastAttempt?.id===attempt.id?this.lastAttempt.result:'interrupted';timing.finishedAt=Date.now();};
      const result = buildSequence({name:event.value,catalog:this.s.config.catalog,opening:this.s.config.opening});
      if (result.error) { this.lastAttempt=finishUpdateAttempt(attempt,'invalid-sequence'); finishTiming(); this.s.lastError = result.error; this.s.pending = null; await this.save(); continue; }
      try {
        let access = await this.refreshToken(false,timing);
        timing.tokenReadyAt=Date.now();
        if (!this.s.active || this.s.runId !== runId) return;
        event.phase = 'sending';
        await this.save();
        this.spotifyAbort = new AbortController();
        const put = token => this.trackedFetch('spotify','playlist-items','https://api.spotify.com/v1/playlists/'+this.s.config.playlist+'/items',{
          method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
          body:JSON.stringify({uris:result.tracks.map(t=>t.uri)}),signal:AbortSignal.any([this.spotifyAbort.signal,AbortSignal.timeout(7000)])},result.tracks.length,timing);
        let res = await put(access);
        if (res.status === 401 && this.s.active) { access = await this.refreshToken(true,timing); if (this.s.active) res = await put(access); }
        const body = await res.json().catch(()=>({}));
        if (!this.s.active || this.s.runId !== runId) return;
        if (res.status === 429) {
          const after=res.headers.get('Retry-After');
          this.diag.lastSpotifyLimit={at:Date.now(),reason:body.error?.reason==='QUOTA_EXCEEDED'?'QUOTA_EXCEEDED':'',retryAfter:after!==null&&Number.isFinite(Number(after))?Number(after):null};
          event.phase = 'queued'; event.retryAt = Date.now()+Math.max(1000,(Number(res.headers.get('Retry-After')) || 15)*1000);
          this.s.spotifyRetryAt = event.retryAt;
          if (this.s.pending === event) this.s.pending = event;
          this.s.lastError = 'Spotify limitou os envios, aguardando o prazo solicitado';
          this.lastAttempt=finishUpdateAttempt(attempt,'rate-limit',429);
          finishTiming();
          await this.save(); return;
        }
        if (res.status === 401 || res.status === 403) {
          const error = new Error('O Spotify recusou o acesso, reconecte a conta e confira a playlist');
          error.status=res.status;error.fatal = true; throw error;
        }
        if (!res.ok || typeof body.snapshot_id !== 'string' || !body.snapshot_id) {
          const error=new Error(res.ok ? 'Spotify respondeu sem confirmação da playlist' : 'Spotify HTTP '+res.status+', confira a playlist');
          if(!res.ok)error.status=res.status;
          throw error;
        }
        this.lastAttempt=finishUpdateAttempt(attempt,'confirmed',res.status);
        timing.confirmedAt=Date.now();
        finishTiming();
        this.s.lastSuccess = {word:event.value,playlist:this.s.config.playlist,count:event.count,snapshotId:body.snapshot_id,at:Date.now()};
        this.s.lastError = '';
        this.s.spotifyRetryAt = 0;
      } catch(e) {
        if (this.s.runId !== runId) return;
        if(this.lastAttempt?.id===attempt.id && this.lastAttempt.result==='pending')this.lastAttempt=finishUpdateAttempt(attempt,updateAttemptError(e),e.status);
        finishTiming();
        this.s.lastError = e.message + ', envio não repetido automaticamente';
        if (e.fatal) { await this.finish('spotify-auth'); return; }
      } finally { this.spotifyAbort = null; }
      if (this.s.pending === event) this.s.pending = null;
      await this.save();
    }
  }
  kickDelivery(runId) {
    if (this.delivery || !this.s.pending || !this.s.active) return;
    this.delivery = this.send(runId).catch(async()=>{this.s.lastError='Falha no envio, confira a playlist'; await this.save();}).finally(()=>{this.delivery=null;});
    this.ctx.waitUntil(this.delivery);
  }
  async alarm() {
    if (!this.s.active) {
      if (this.s.syncAuth) {
        if (Date.now() >= this.s.syncUntil) { this.s.syncAuth = null; await this.save(); }
        else await this.ctx.storage.setAlarm(this.s.syncUntil);
      }
      return;
    }
    if (this.running) return;
    if (Date.now() >= this.s.endsAt) return this.finish('expired');
    this.running = true;
    this.diag.pollCheckpointOpen=true;
    await this.save();
    const runId = this.s.runId;
    const began = Date.now();
    const chunkEnd = Math.min(began+8000,this.s.endsAt);
    // Watchdog survives process replacement; polling timers are never the only recovery mechanism
    await this.ctx.storage.setAlarm(Date.now()+16000);
    try {
      while (this.s.active && this.s.runId === runId && Date.now() < chunkEnd) {
        const b = this.budgetToday();
        if (b.attempts >= 50000 || b.activeMs >= 12*3600000) { await this.finish('daily-limit'); break; }
        this.kickDelivery(runId);
        const start = Date.now();
        if (start < this.s.nextPollAt) { await sleep(Math.min(500,this.s.nextPollAt-start)); continue; }
        const previousPollStartedAt=this.s.lastPollAt;
        if (this.s.lastPollAt) sample(this.s.intervals,start-this.s.lastPollAt);
        this.s.lastPollAt = start;
        b.attempts++;
        this.abort = new AbortController();
        try {
          const event = await fetchInjectSelection(this.s.config.injectId,{timeout:4000,fetcher:(url,opts)=>this.trackedFetch('inject','selection',url,{...opts,signal:AbortSignal.any([this.abort.signal,opts.signal])})});
          if (!this.s.active || this.s.runId !== runId) break;
          this.s.polls++; this.s.lastReadAt = Date.now(); sample(this.s.latencies,Date.now()-start);
          this.s.errorStreak = 0; this.s.nextPollAt = 0;
          this.s.injectError = '';
          if (this.s.seenCount === null) this.s.seenCount = event.count;
          else if (this.s.seenCount !== event.count) {
            this.s.seenCount = event.count; this.s.changes++; this.s.lastValue = event.value;
            if (this.s.mode === 'live' && event.value) this.s.pending = {...event,phase:'queued',previousPollStartedAt,pollStartedAt:start,detectedAt:Date.now()};
            await this.save();
            this.kickDelivery(runId);
          }
        } catch(e) {
          if (!this.s.active || this.s.runId !== runId) break;
          this.s.errors++; this.s.errorStreak++;
          this.s.injectError = e.message;
          this.s.nextPollAt = Date.now()+Math.max(e.retryAfterMs || 0,Math.min(30000,1000*2**Math.min(5,this.s.errorStreak)));
        } finally { this.abort = null; }
        await sleep(Math.max(1,500-(Date.now()-start)));
      }
    } finally {
      this.diag.pollCheckpointOpen=false;
      this.budgetToday().activeMs += Date.now()-began;
      this.running = false;
      if (this.s.runId === runId) {
        if (Date.now() >= this.s.endsAt && this.s.active) await this.finish('expired');
        else { await this.save(); if (this.s.active) await this.ctx.storage.setAlarm(Date.now()+1); else if (this.s.syncAuth) await this.ctx.storage.setAlarm(this.s.syncUntil); else await this.ctx.storage.deleteAlarm(); }
      }
    }
  }
}
