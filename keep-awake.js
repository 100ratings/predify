// Keep the visible Predify screen awake with the native Screen Wake Lock API
export const KEEP_AWAKE_KEY = 'predify.keep-awake.v1';
export function createKeepAwake({
  wakeLock = typeof navigator !== 'undefined' ? navigator.wakeLock : undefined,
  isVisible = () => typeof document !== 'undefined' && !document.hidden,
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
  onState = () => {}
} = {}) {
  let desired = false;
  let sentinel = null;
  let requesting = false;
  let generation = 0;
  const notify = (status, message = '') => {
    try { onState({ status, enabled: desired, active: !!sentinel, message }); }
    catch { /* UI feedback must not interfere with wake management */ }
  };
  const releaseCurrent = () => {
    const old = sentinel;
    sentinel = null;
    if (old) {
      try {
        const result = old.release();
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch { /* Already released by iOS */ }
    }
  };
  const acquire = async () => {
    if (!desired || !isVisible() || requesting || sentinel) return false;
    if (!wakeLock || typeof wakeLock.request !== 'function') {
      desired = false;
      notify('unsupported');
      return false;
    }
    const token = generation;
    requesting = true;
    notify('requesting');
    try {
      const lock = await wakeLock.request('screen');
      if (!desired || token !== generation || !isVisible()) {
        try { await lock.release(); } catch { /* Already released */ }
        return false;
      }
      sentinel = lock;
      lock.addEventListener('release', () => {
        if (sentinel !== lock) return;
        sentinel = null;
        if (desired && isVisible()) {
          // Keep the saved user preference, but wait for a real interaction to retry
          notify('interrupted');
        } else if (desired) {
          notify('paused');
        }
      }, { once: true });
      notify('active');
      return true;
    } catch (error) {
      if (desired && token === generation) {
        // Safari may reject a request made at startup without user activation
        // Retain the user preference and allow a retry on the next user gesture
        notify('error', error?.message || 'Solicitação recusada');
      }
      return false;
    } finally {
      requesting = false;
      if (desired && token !== generation && !sentinel && isVisible()) void acquire();
    }
  };
  const enable = () => {
    if (desired) return acquire();
    desired = true;
    generation++;
    try { storage?.setItem(KEEP_AWAKE_KEY, 'true'); }
    catch { /* A blocked storage area must not prevent using the wake lock */ }
    if (!isVisible()) notify('paused');
    return acquire();
  };
  const disable = () => {
    desired = false;
    generation++;
    try { storage?.removeItem(KEEP_AWAKE_KEY); }
    catch { /* The current wake lock can still be released */ }
    releaseCurrent();
    notify('off');
  };
  const restore = () => {
    try {
      if (storage?.getItem(KEEP_AWAKE_KEY) === 'true') return enable();
    } catch { /* Storage may be blocked in private browsing */ }
    return Promise.resolve(false);
  };
  // Must be called directly inside a trusted click handler so Safari can use
  // the transient user activation of that gesture without any extra tap
  const retryOnInteraction = () => {
    if (!desired || sentinel || requesting || !isVisible()) return Promise.resolve(false);
    return acquire();
  };
  const onVisibilityChange = () => {
    if (!isVisible()) {
      releaseCurrent();
      if (desired) notify('paused');
    } else if (desired) {
      void acquire();
    }
  };
  return {
    enable,
    disable,
    restore,
    retryOnInteraction,
    toggle: () => desired ? disable() : enable(),
    onVisibilityChange,
    snapshot: () => ({ enabled: desired, active: !!sentinel, requesting })
  };
}
