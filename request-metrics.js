// Counts HTTP attempts initiated by Predify, never Spotify's undisclosed quota units
export const METRIC_SERVICES = ['spotify','spotify-auth','inject','cloudflare-control'];
export const METRIC_OPERATIONS = ['profile','playlists','playlist-items','playlist-images','track','search','token','selection','status','start','stop','sync','other'];
export const METRIC_METHODS = ['GET','POST','PUT','DELETE'];
export const metricDay = (at = Date.now()) => new Date(at).toLocaleDateString('sv-SE',{timeZone:'America/Sao_Paulo'});
const cell = () => ({attempts:0,responses:0,successes:0,httpErrors:0,networkErrors:0,totalMs:0,maxMs:0,itemsSubmitted:0,statuses:{}});
export function emptyMetrics() { return {}; }
export function metricKey(service,operation,method) {
  return [METRIC_SERVICES.includes(service)?service:'spotify',METRIC_OPERATIONS.includes(operation)?operation:'other',METRIC_METHODS.includes(method)?method:'GET'].join('|');
}
export function countAttempt(metrics,key,items = 0) {
  const c=metrics[key] ||= cell(); c.attempts++;
  if(Number.isSafeInteger(items) && items>=0 && items<=100)c.itemsSubmitted+=items;
}
export function countResult(metrics,key,status,ms = 0) {
  const c=metrics[key] ||= cell();
  if (Number.isInteger(status) && status>=100 && status<=599) {
    c.responses++; c.statuses[status]=(c.statuses[status]||0)+1;
    if(status>=200 && status<300)c.successes++; else c.httpErrors++;
  } else c.networkErrors++;
  const elapsed=Number.isFinite(ms)?Math.max(0,Math.round(ms)):0;
  c.totalMs+=elapsed;c.maxMs=Math.max(c.maxMs,elapsed);
}
export function mergeMetrics(...sources) {
  const result={};
  for(const source of sources) for(const [key,original] of Object.entries(source||{})) {
    if (!/^(spotify|spotify-auth|inject|cloudflare-control)\|(profile|playlists|playlist-items|playlist-images|track|search|token|selection|status|start|stop|sync|other)\|(GET|POST|PUT|DELETE)$/.test(key))continue;
    const target=result[key] ||= cell();
    for(const field of ['attempts','responses','successes','httpErrors','networkErrors','totalMs','itemsSubmitted'])if(Number.isFinite(original?.[field]) && original[field]>=0)target[field]+=Math.round(original[field]);
    if(Number.isFinite(original?.maxMs))target.maxMs=Math.max(target.maxMs,original.maxMs);
    for(const [status,n]of Object.entries(original?.statuses||{}))if(/^[1-5][0-9]{2}$/.test(status)&&Number.isFinite(n)&&n>=0)target.statuses[status]=(target.statuses[status]||0)+Math.round(n);
  }
  return result;
}
export function metricCount(metrics,service,field='attempts') {
  return Object.entries(metrics||{}).filter(([key])=>key.startsWith(service+'|')).reduce((n,[,value])=>n+(value[field]||0),0);
}
