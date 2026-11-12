import { APP_VERSION, BUILD_ID } from './version.js?v=1.3.24';
export const CHECK_INTERVAL = 60_000;
export function validRelease(value) {
  if (!value || !/^\d+\.\d+\.\d+$/.test(value.version) || !/^[a-zA-Z0-9._-]{1,100}$/.test(value.build)) throw new Error('Não foi possível conferir a versão publicada');
  return { version: value.version, build: value.build };
}
export function newerRelease(release, currentBuild = BUILD_ID) { return release.build !== currentBuild; }
export function canApplyUpdate({ latest, currentBuild = BUILD_ID, online = true, busy = false, safe = true }) {
  return !!latest && newerRelease(latest, currentBuild) && online && !busy && safe;
}
export async function fetchRelease({ fetcher = fetch, base = location.href, time = Date.now() } = {}) {
  const url = new URL('./version.json', base);
  url.searchParams.set('_', String(time));
  const response = await fetcher(url.href, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Não foi possível verificar atualizações agora');
  return validRelease(await response.json());
}
// Exported separately so the sixty-second schedule and overlap protection are testable
export function pollPeriodically(check, { active = () => true, schedule = setInterval, cancel = clearInterval } = {}) {
  let running = false; let stopped = false;
  const tick = async () => {
    if (stopped || running || !active()) return;
    running = true;
    try { await check(); } finally { running = false; }
  };
  const timer = schedule(tick, CHECK_INTERVAL);
  tick();
  return { tick, stop() { stopped = true; cancel(timer); } };
}
async function waitForActivation(registration) {
  const worker = registration.installing || registration.waiting;
  if (!worker || worker.state === 'activated') return;
  await new Promise((resolve, reject) => {
    const done = error => { clearTimeout(timer); worker.removeEventListener('statechange', changed); error ? reject(error) : resolve(); };
    const changed = () => { if (worker.state === 'activated') done(); else if (worker.state === 'redundant') done(new Error('A atualização não pôde ser instalada, tente novamente')); };
    const timer = setTimeout(() => done(new Error('A atualização demorou, tente novamente em instantes')), 20000);
    worker.addEventListener('statechange', changed); changed();
  });
}
export function watchAppUpdates({ versionLabel, button, status, canReload = () => true, notify = () => {} }) {
  versionLabel.textContent = `Versão ${APP_VERSION}`;
  let latest = null; let pending = null; let busy = false; let error = '';
  const render = () => {
    const available = latest && newerRelease(latest);
    const buttonText = busy ? 'Atualizando…' : 'Atualizar o app';
    if (button.textContent !== buttonText) button.textContent = buttonText;
    button.disabled = !canApplyUpdate({ latest, online: navigator.onLine, busy, safe: canReload() });
    button.classList.toggle('update-available', !!available);
    const message = busy ? 'Baixando a versão publicada, aguarde' : !navigator.onLine ? 'Sem internet, a verificação volta quando a conexão retornar' : error || (available ? `Versão ${latest.version} disponível · toque para atualizar` : latest ? 'App atualizado · verificação a cada 60 s' : 'Verificando atualizações a cada 60 s');
    if (status.textContent !== message) status.textContent = message;
  };
  const check = async () => {
    if (pending) return pending;
    pending = (async () => {
      try { latest = await fetchRelease(); error = ''; }
      catch (failure) { error = failure.message; }
      finally { pending = null; render(); }
      return latest;
    })();
    return pending;
  };
  const poller = pollPeriodically(check, { active: () => !document.hidden && navigator.onLine && !busy });
  const resume = () => { render(); if (!document.hidden && navigator.onLine && !busy) poller.tick(); };
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', resume); window.addEventListener('offline', resume);
  button.onclick = async () => {
    if (!canApplyUpdate({ latest, online: navigator.onLine, busy, safe: canReload() })) return;
    busy = true; render();
    try {
      // Require a successful current version read before leaving this page
      if (pending) await pending;
      const release = await fetchRelease(); latest = release;
      if (!newerRelease(release)) { busy = false; error = ''; render(); return; }
      const registration = await navigator.serviceWorker?.getRegistration();
      if (registration) { await registration.update(); await waitForActivation(registration); }
      const url = new URL(location.href);
      url.searchParams.set('app-update', release.build + '-' + Date.now());
      location.replace(url.href);
    } catch (failure) { error = failure.message; busy = false; render(); notify(error); }
  };
  render();
  return () => { poller.stop(); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); window.removeEventListener('offline', resume); };
}
