export const INJECT_INTERVAL = 500;
export const INJECT_ID_KEY = 'predify.inject.id.v1';
export const INJECT_COUNT_PREFIX = 'predify.inject.count.v1.';

export function validInjectId(value) {
  return typeof value === 'string' && /^[0-9]{4}$/.test(value);
}

export function parseInjectSelection(payload) {
  const data = payload?.selection ?? payload?.data ?? payload;
  if (!data || typeof data !== 'object') throw new Error('O Inject não retornou um objeto JSON');
  const rawCount = data.count;
  if (!(typeof rawCount === 'number' && Number.isSafeInteger(rawCount) && rawCount >= 0)
    && !(typeof rawCount === 'string' && /^[0-9]+$/.test(rawCount))) {
    throw new Error('A resposta do Inject não contém um count válido');
  }
  if (typeof data.value !== 'string') throw new Error('A resposta do Inject não contém um value de texto');
  return { count: String(rawCount), value: data.value.trim().replace(/\s+/g, ' ').slice(0, 100) };
}

export async function fetchInjectSelection(id, { fetcher = fetch, timeout = 7000 } = {}) {
  if (!validInjectId(id)) throw new Error('Informe exatamente os 4 dígitos do Inject ID');
  const url = 'https://11z.co/_w/' + id + '/selection';
  let response;
  try {
    response = await fetcher(url, {
      method: 'GET', mode: 'cors', cache: 'no-store', credentials: 'omit',
      signal: AbortSignal.timeout(timeout)
    });
  } catch (error) {
    const message = error?.name === 'TimeoutError'
      ? 'O Inject não respondeu a tempo'
      : 'Não foi possível acessar o Inject, confira a internet e se 11z.co permite acesso de outros sites (CORS)';
    const failure = new Error(message);
    failure.cause = error;
    throw failure;
  }
  if (!response.ok) {
    const error = new Error('Inject HTTP ' + response.status);
    error.status = response.status;
    const after = Number(response.headers?.get?.('Retry-After'));
    if (Number.isFinite(after) && after > 0) error.retryAfterMs = Math.ceil(after * 1000);
    throw error;
  }
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error('O Inject não retornou JSON válido'); }
  return parseInjectSelection(payload);
}

export function createInjectMonitor({
  read = fetchInjectSelection,
  onSelection,
  onStatus = () => {},
  active = () => true,
  storage = localStorage,
  schedule = setInterval,
  cancel = clearInterval,
  now = Date.now
}) {
  let id = '', count = null, timer = null, reading = false;
  let delivering = false, queued = null, generation = 0, stopped = false;
  let errorStreak = 0, retryAt = 0;
  const report = event => { try { onStatus(event); } catch { /* Status rendering must not stop polling */ } };
  const saveCount = (currentId, value) => {
    try { storage.setItem(INJECT_COUNT_PREFIX + currentId, value); }
    catch { /* In-memory deduplication still works within this session */ }
  };
  const deliver = async () => {
    if (delivering || !queued || stopped || !active()) return;
    delivering = true;
    try {
      while (queued && !stopped && active()) {
        const event = queued;
        if (event.id !== id) { queued = null; break; }
        queued = null;
        try {
          const result = await onSelection(event);
          if (event.id !== id || stopped) continue;
          if (result === 'defer') {
            if (!queued) queued = event;
            report({ kind: 'waiting', ...event });
            break;
          }
          report({ kind: result === true ? 'sent' : 'send-failed', ...event });
        } catch (error) {
          if (event.id === id && !stopped) report({ kind: 'send-failed', ...event, message: error.message });
        }
      }
    } finally { delivering = false; }
  };
  const tick = async () => {
    if (stopped || !id || !active()) return;
    if (queued) void deliver();
    if (reading || now() < retryAt) return;
    const currentId = id, currentGeneration = generation;
    reading = true;
    try {
      const response = await read(currentId);
      if (stopped || currentGeneration !== generation || !active()) return;
      const selection = parseInjectSelection(response);
      errorStreak = 0; retryAt = 0;
      if (count === null) {
        count = selection.count;
        saveCount(currentId, count);
        report({ kind: 'baseline', id: currentId, ...selection });
      } else if (count !== selection.count) {
        count = selection.count;
        saveCount(currentId, count);
        if (selection.value) {
          queued = { id: currentId, ...selection };
          report({ kind: 'detected', id: currentId, ...selection });
          void deliver();
        } else report({ kind: 'empty', id: currentId, ...selection });
      }
    } catch (error) {
      if (stopped || currentGeneration !== generation) return;
      errorStreak += 1;
      const backoff = Math.min(30000, 1000 * 2 ** Math.min(5, errorStreak));
      retryAt = now() + Math.max(backoff, error.retryAfterMs || 0);
      report({ kind: 'error', id: currentId, message: error.message, retryAt });
    } finally { reading = false; }
  };
  const setId = value => {
    const next = validInjectId(value) ? value : '';
    if (id === next && !stopped) return;
    generation += 1;
    if (timer !== null) cancel(timer);
    id = next; count = null; queued = null; retryAt = 0; errorStreak = 0; stopped = false;
    if (id) {
      try {
        const stored = storage.getItem(INJECT_COUNT_PREFIX + id);
        if (typeof stored === 'string' && /^[0-9]+$/.test(stored)) count = stored;
      } catch { /* Ignore inaccessible storage */ }
      timer = schedule(() => { void tick(); }, INJECT_INTERVAL);
      report({ kind: 'started', id });
      void tick();
    } else {
      timer = null;
      report({ kind: 'inactive' });
    }
  };
  const stop = () => {
    stopped = true; generation += 1; queued = null;
    if (timer !== null) cancel(timer);
    timer = null;
  };
  return { setId, tick, resume: () => { void tick(); }, stop, snapshot: () => ({ id, count, queued, reading, delivering, retryAt }) };
}
