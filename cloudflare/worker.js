export { InjectMonitor } from './legacy-lab.js';
export { PresentationMonitor } from './presentation.js';
const ORIGIN = 'https://100ratings.github.io';
const cors = {'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Vary':'Origin','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
export default {
  async fetch(req,env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null,{status:204,headers:cors});
    if (url.pathname === '/health') return Response.json({service:'Predify remote',ready:!!env.PRESENTATION && !!env.REMOTE_KEY && !!env.TOKEN_ENCRYPTION_KEY},{headers:cors});
    // The completed test contains timing metrics only, never words or credentials
    if (url.pathname === '/lab') {
      const response = await env.MONITOR.get(env.MONITOR.idFromName('single-read-only-test')).fetch(new Request(new URL('/',url),{method:'GET'}));
      return new Response(response.body,{status:response.status,headers:cors});
    }
    if (!url.pathname.startsWith('/api/')) return Response.json({service:'Predify remote',message:'Controle pelo aplicativo Predify'},{headers:cors});
    if (!env.REMOTE_KEY || req.headers.get('Authorization') !== 'Bearer '+env.REMOTE_KEY) return Response.json({error:'Conecte o monitor remoto em Ajustes'},{status:401,headers:cors});
    const origin = req.headers.get('Origin');
    if (origin && origin !== ORIGIN) return Response.json({error:'Origem não permitida'},{status:403,headers:cors});
    if (Number(req.headers.get('Content-Length') || 0) > 200000) return Response.json({error:'Configuração muito grande'},{status:413,headers:cors});
    const response = await env.PRESENTATION.get(env.PRESENTATION.idFromName('owner')).fetch(req);
    return new Response(response.body,{status:response.status,headers:cors});
  }
};
