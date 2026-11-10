import { recordDiagnostic } from './diagnostics.js?v=1.3.10';
let lastDiagnosticState = '';
export const REMOTE_URL = 'https://predify-inject-lab.omentalistademian.workers.dev';
export const REMOTE_KEY_STORAGE = 'predify.remote.key.v1';
export function isNewRemoteConfirmation(sent, current) {
  return Number.isFinite(sent?.at) && sent.at > (Number.isFinite(current?.at) ? current.at : 0);
}
export function remoteKey() { try { return localStorage.getItem(REMOTE_KEY_STORAGE) || ''; } catch { return ''; } }
export function saveRemoteKey(value) {
  const key = String(value).trim();
  if (!/^[A-Za-z0-9_-]{43,100}$/.test(key)) throw new Error('Chave do monitor inválida');
  localStorage.setItem(REMOTE_KEY_STORAGE,key);
}
export function consumeRemoteLink() {
  const params = new URLSearchParams(location.hash.slice(1));
  const key = params.get('remote-key');
  if (!key) return false;
  saveRemoteKey(key);
  history.replaceState(null,'',location.pathname+location.search+'#perform');
  return true;
}
export async function remoteRequest(action, body) {
  const key = remoteKey();
  if (!key) throw new Error('Conecte o monitor remoto em Ajustes');
  const started = Date.now();
  const res = await fetch(REMOTE_URL+'/api/'+action,{
    method:body === undefined ? 'GET' : 'POST', cache:'no-store',credentials:'omit',
    headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),signal:AbortSignal.timeout(12000)
  }).catch(error => { recordDiagnostic('remote-network-error',{operation:action,ms:Date.now()-started}); throw error; });
  if (action !== 'status' || !res.ok) recordDiagnostic('remote-response',{operation:action,status:res.status,ms:Date.now()-started});
  const data = await res.json();
  if (res.ok && action === 'status') {
    const state = {active:!!data.active,hasError:!!data.lastError,errors:Number(data.errors)||0,changes:Number(data.changes)||0};
    const fingerprint = JSON.stringify(state);
    if (fingerprint !== lastDiagnosticState) {
      lastDiagnosticState = fingerprint;
      recordDiagnostic('remote-state',{...state,polls:Number(data.polls)||0});
    }
  }
  if (!res.ok) throw new Error(data.error || 'Monitor remoto HTTP '+res.status);
  return data;
}
