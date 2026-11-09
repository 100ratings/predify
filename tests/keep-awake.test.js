import test from 'node:test';
import assert from 'node:assert/strict';
import { KEEP_AWAKE_KEY, createKeepAwake } from '../keep-awake.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function fakeLock() {
  let released = false;
  const handlers = [];
  return {
    get released() { return released; },
    addEventListener(event, callback) { if (event === 'release') handlers.push(callback); },
    async release() { released = true; handlers.forEach(callback => callback()); }
  };
}

test('requires an explicit click to acquire and releases when turned off', async () => {
  const lock = fakeLock(), states = [], kinds = [];
  const awake = createKeepAwake({
    wakeLock: { request: async type => { kinds.push(type); return lock; } },
    isVisible: () => true, onState: state => states.push(state)
  });
  assert.equal(awake.snapshot().active, false);
  assert.equal(kinds.length, 0);
  await awake.toggle();
  assert.deepEqual(kinds, ['screen']);
  assert.deepEqual(awake.snapshot(), { enabled: true, active: true, requesting: false });
  assert.equal(states.at(-1).status, 'active');
  awake.toggle();
  assert.equal(lock.released, true);
  assert.deepEqual(awake.snapshot(), { enabled: false, active: false, requesting: false });
  assert.equal(states.at(-1).status, 'off');
});

test('pauses when hidden and restores the lock when visible again', async () => {
  let visible = true;
  const locks = [fakeLock(), fakeLock()];
  let count = 0;
  const awake = createKeepAwake({
    wakeLock: { request: async () => locks[count++] },
    isVisible: () => visible
  });
  await awake.enable();
  visible = false;
  awake.onVisibilityChange();
  assert.equal(locks[0].released, true);
  assert.equal(awake.snapshot().enabled, true);
  assert.equal(awake.snapshot().active, false);
  visible = true;
  awake.onVisibilityChange();
  await flush();
  assert.equal(count, 2);
  assert.equal(awake.snapshot().active, true);
});

test('an unsupported browser reports clearly instead of claiming protection', async () => {
  const states = [];
  const awake = createKeepAwake({ wakeLock: null, isVisible: () => true, onState: state => states.push(state) });
  assert.equal(await awake.enable(), false);
  assert.equal(states.at(-1).status, 'unsupported');
  assert.equal(awake.snapshot().active, false);
  assert.equal(awake.snapshot().enabled, false);
});

test('system rejection does not show a false successful wake lock', async () => {
  const states = [];
  const awake = createKeepAwake({
    wakeLock: { request: async () => { throw new Error('Permission denied'); } },
    isVisible: () => true, onState: state => states.push(state)
  });
  assert.equal(await awake.enable(), false);
  assert.equal(states.at(-1).status, 'error');
  assert.equal(awake.snapshot().enabled, true);
});

test('deactivation during a pending request releases the late sentinel', async () => {
  const lock = fakeLock();
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  const awake = createKeepAwake({ wakeLock: { request: () => pending }, isVisible: () => true });
  const activation = awake.enable();
  awake.disable();
  resolve(lock);
  await activation;
  assert.equal(lock.released, true);
  assert.equal(awake.snapshot().active, false);
  assert.equal(awake.snapshot().enabled, false);
});

test('system-driven release reports interruption, and does not automatically spin on errors', async () => {
  const states = [];
  let requests = 0;
  const lock = fakeLock();
  const awake = createKeepAwake({
    wakeLock: { request: async () => { requests++; return lock; } },
    isVisible: () => true, onState: state => states.push(state)
  });
  await awake.enable();
  await lock.release();
  assert.equal(awake.snapshot().enabled, true);
  assert.equal(awake.snapshot().active, false);
  assert.equal(states.at(-1).status, 'interrupted');
  assert.equal(requests, 1);
});

function fakeStore(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: key => items.delete(key)
  };
}

test('remembers an enabled choice across app launches and restores it automatically', async () => {
  const storage = fakeStore();
  let requests = 0;
  const first = createKeepAwake({ storage, wakeLock: { request: async () => fakeLock() }, isVisible: () => true });
  await first.enable();
  assert.equal(storage.getItem(KEEP_AWAKE_KEY), 'true');
  const second = createKeepAwake({
    storage, wakeLock: { request: async type => { requests++; assert.equal(type, 'screen'); return fakeLock(); } },
    isVisible: () => true
  });
  assert.equal(second.snapshot().enabled, false);
  assert.equal(await second.restore(), true);
  assert.equal(requests, 1);
  assert.equal(second.snapshot().active, true);
  second.disable();
  assert.equal(storage.getItem(KEEP_AWAKE_KEY), null);
  const third = createKeepAwake({
    storage, wakeLock: { request: async () => { throw new Error('Should not request'); } },
    isVisible: () => true
  });
  assert.equal(await third.restore(), false);
  assert.equal(third.snapshot().enabled, false);
});

test('when iOS denies auto-restoration the preference remains saved for next launch', async () => {
  const storage = fakeStore({ [KEEP_AWAKE_KEY]: 'true' });
  let requests = 0;
  const states = [];
  const awake = createKeepAwake({
    storage,
    wakeLock: { request: async () => { requests++; if (requests === 1) throw new Error('NotAllowedError'); return fakeLock(); } },
    isVisible: () => true,
    onState: state => states.push(state)
  });
  assert.equal(await awake.restore(), false);
  assert.equal(storage.getItem(KEEP_AWAKE_KEY), 'true');
  assert.equal(awake.snapshot().active, false);
  assert.equal(awake.snapshot().enabled, true);
  assert.equal(states.at(-1).status, 'error');
  assert.equal(await awake.retryOnInteraction(), true);
  assert.equal(awake.snapshot().active, true);
  assert.equal(storage.getItem(KEEP_AWAKE_KEY), 'true');
});

test('storage failures do not prevent requesting or releasing the screen wake lock', async () => {
  const lock = fakeLock();
  const storage = { getItem: () => { throw new Error('Blocked'); },
    setItem: () => { throw new Error('Blocked'); }, removeItem: () => { throw new Error('Blocked'); } };
  const awake = createKeepAwake({ storage, wakeLock: { request: async () => lock }, isVisible: () => true });
  assert.equal(await awake.restore(), false);
  assert.equal(await awake.enable(), true);
  awake.disable();
  assert.equal(lock.released, true);
});

test('failed startup request is retried by a regular interaction without changing saved choice', async () => {
  const storage = fakeStore({ [KEEP_AWAKE_KEY]: 'true' });
  let calls = 0, allowed = false;
  const awake = createKeepAwake({
    storage,
    isVisible: () => true,
    wakeLock: { request: () => {
      calls++;
      if (!allowed) return Promise.reject(new Error('User activation required'));
      return Promise.resolve(fakeLock());
    } }
  });
  assert.equal(await awake.restore(), false);
  assert.equal(storage.getItem(KEEP_AWAKE_KEY), 'true');
  assert.deepEqual(awake.snapshot(), {enabled:true,active:false,requesting:false});
  allowed = true;
  assert.equal(await awake.retryOnInteraction(), true);
  assert.equal(calls, 2);
  assert.deepEqual(awake.snapshot(), {enabled:true,active:true,requesting:false});
  assert.equal(await awake.retryOnInteraction(), false);
  assert.equal(calls, 2);
  awake.disable();
  assert.equal(storage.getItem(KEEP_AWAKE_KEY), null);
  assert.equal(await awake.retryOnInteraction(), false);
  assert.equal(calls, 2);
});

test('a system release retains preference and can reacquire on the next tap', async () => {
  const storage = fakeStore({ [KEEP_AWAKE_KEY]: 'true' });
  const locks = [fakeLock(),fakeLock()];
  let calls=0;
  const awake = createKeepAwake({
    storage,isVisible:()=>true,
    wakeLock:{request:async()=>locks[calls++]}
  });
  await awake.restore();
  await locks[0].release();
  assert.equal(awake.snapshot().enabled,true);
  assert.equal(storage.getItem(KEEP_AWAKE_KEY),'true');
  await awake.retryOnInteraction();
  assert.equal(calls,2);
  assert.equal(awake.snapshot().active,true);
});
