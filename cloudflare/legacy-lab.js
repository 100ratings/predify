import { DurableObject } from "cloudflare:workers";
export class InjectMonitor extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.s = null;
    this.running = false;
    ctx.blockConcurrencyWhile(async () => {
      this.s = await ctx.storage.get("state") || {phase:"ready",polls:0,errors:0,changes:0,intervals:[],latencies:[]};
    });
  }
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/start" && req.method === "POST" && this.s.phase === "ready") {
      this.s.phase = "running";
      this.s.startedAt = Date.now();
      this.s.endsAt = Date.now() + 180000;
      await this.ctx.storage.put("state", this.s);
      await this.ctx.storage.setAlarm(Date.now() + 100);
    }
    if (path === "/stop" && req.method === "POST") {
      this.s.phase = "stopped";
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.put("state", this.s);
    }
    const sorted = a => [...a].sort((x,y)=>x-y);
    const summary = a => {
      const v = sorted(a);
      return v.length ? {samples:v.length,min:v[0],p50:v[Math.floor(v.length*.5)],p95:v[Math.floor(v.length*.95)],max:v[v.length-1]} : null;
    };
    const {lastCount, intervals, latencies, ...out} = this.s;
    return Response.json({...out, intervalMs:summary(intervals),fetchMs:summary(latencies),serverNow:Date.now(),spotifyEnabled:false}, {headers:{"Cache-Control":"no-store"}});
  }
  async alarm() {
    if (this.running || this.s.phase !== "running") return;
    this.running = true;
    const chunkEnd = Math.min(Date.now()+20000, this.s.endsAt);
    await this.ctx.storage.setAlarm(Date.now()+25000);
    try {
      while (this.s.phase === "running" && Date.now() < chunkEnd) {
        const start = Date.now();
        if (this.s.lastPollAt) {
          this.s.intervals.push(start-this.s.lastPollAt);
          if (this.s.intervals.length > 2000) this.s.intervals.shift();
        }
        this.s.lastPollAt = start;
        try {
          const res = await fetch("https://11z.co/_w/"+this.env.LAB_INJECT_ID+"/selection",{headers:{"Cache-Control":"no-cache"},signal:AbortSignal.timeout(4000)});
          if (!res.ok) throw new Error("HTTP "+res.status);
          const data = await res.json();
          if (data.count === undefined || typeof data.value !== "string") throw new Error("Invalid Inject response");
          this.s.polls++;
          this.s.latencies.push(Date.now()-start);
          if (this.s.latencies.length > 2000) this.s.latencies.shift();
          if (this.s.lastCount !== undefined && data.count !== this.s.lastCount) this.s.changes++;
          this.s.lastCount = data.count;
          this.s.lastSuccessAt = Date.now();
          this.s.lastError = null;
        } catch(e) {
          this.s.errors++;
          this.s.lastError = String(e.message).slice(0,160);
        }
        await new Promise(resolve=>setTimeout(resolve,Math.max(1,500-(Date.now()-start))));
      }
    } finally {
      this.running = false;
      if (Date.now() >= this.s.endsAt && this.s.phase === "running") this.s.phase = "completed";
      await this.ctx.storage.put("state",this.s);
      if (this.s.phase === "running") await this.ctx.storage.setAlarm(Date.now()+1);
      else await this.ctx.storage.deleteAlarm();
    }
  }
}
export default {
  async fetch(req,env) {
    if (!env.MONITOR) return Response.json({service:"Predify Inject lab",status:"binding_required",spotifyEnabled:false});
    return env.MONITOR.get(env.MONITOR.idFromName("single-read-only-test")).fetch(req);
  }
};

