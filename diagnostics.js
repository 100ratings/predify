import { APP_VERSION, BUILD_ID } from './version.js?v=1.3.8';
const KEY = 'predify.diagnostics.v1';
const LIMIT = 400;
let events = [];
try { const saved = JSON.parse(localStorage.getItem(KEY)); if (Array.isArray(saved)) events = saved.slice(-LIMIT); } catch { /* Diagnostics must never interrupt the app */ }
const allowedEvents = new Set(['app-start','spotify-response','spotify-network-error','spotify-wait','remote-response','remote-network-error','remote-state']);
const allowedOperations = new Set(['profile','playlists','playlist-items','playlist-images','track','search','other','status','start','stop','sync']);
function cleanEvent(name, details, at = Date.now()) {
  const event = {at, event:allowedEvents.has(name) ? name : 'other',version:APP_VERSION};
  if (allowedOperations.has(details.operation)) event.operation = details.operation;
  if (['GET','POST','PUT','DELETE'].includes(details.method)) event.method = details.method;
  for (const key of ['status','ms','retryAfter','polls','errors','changes']) if (Number.isFinite(details[key])) event[key] = Math.max(0,Math.round(details[key]));
  if (details.reason === 'QUOTA_EXCEEDED') event.reason = details.reason;
  if (typeof details.active === 'boolean') event.active = details.active;
  if (typeof details.hasError === 'boolean') event.hasError = details.hasError;
  if (typeof details.reported === 'boolean') event.reported = details.reported;
  return event;
}
export function recordDiagnostic(name, details = {}) {
  try {
    events.push(cleanEvent(name,details)); events = events.slice(-LIMIT);
    localStorage.setItem(KEY,JSON.stringify(events));
  } catch { /* No credentials or app data are required for diagnostics */ }
}
export function spotifyOperation(path) {
  if (path === '/me') return 'profile';
  if (path.startsWith('/me/playlists')) return 'playlists';
  if (/^\/playlists\/[^/]+\/items/.test(path)) return 'playlist-items';
  if (/^\/playlists\/[^/]+\/images/.test(path)) return 'playlist-images';
  if (path.startsWith('/tracks/')) return 'track';
  if (path.startsWith('/search')) return 'search';
  return 'other';
}
export function diagnosticReport() {
  return {app:'Predify',version:APP_VERSION,build:BUILD_ID,exportedAt:new Date().toISOString(),limit:LIMIT,
    events:events.map(e=>cleanEvent(e.event,e,Number.isFinite(e.at)?e.at:Date.now()))};
}
