import test from 'node:test';
import assert from 'node:assert/strict';
const values = new Map();
global.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
const { accessToken, auth } = await import('../spotify.js');
test('persistent session refresh is shared and rotated without a client secret', async () => {
  values.set('predify.auth.v1', JSON.stringify({ access_token: 'expired-test', refresh_token: 'old-test', expires_at: 0, scope: 'playlist-modify-public' }));
  let calls = 0;
  global.fetch = async (url, options) => {
    calls++; assert.equal(url, 'https://accounts.spotify.com/api/token');
    assert.equal(options.body.get('grant_type'), 'refresh_token');
    assert.equal(options.body.get('refresh_token'), 'old-test');
    assert.equal(options.body.has('client_secret'), false);
    return { ok: true, json: async () => ({ access_token: 'new-test', refresh_token: 'rotated-test', expires_in: 3600 }) };
  };
  assert.deepEqual(await Promise.all([accessToken(), accessToken()]), ['new-test', 'new-test']);
  assert.equal(calls, 1); assert.equal(auth().refresh_token, 'rotated-test');
  assert.equal(await accessToken(), 'new-test'); assert.equal(calls, 1);
});
test('playlist replacement and reading use the current Spotify items endpoint', async () => {
  const { replacePlaylist, playlistTracks } = await import('../spotify.js');
  const playlist = 'p'.repeat(22), trackId = 't'.repeat(22), uri = 'spotify:track:' + trackId;
  values.set('predify.auth.v1', JSON.stringify({ access_token: 'ok', refresh_token: 'ok', expires_at: Date.now() + 3600000 }));
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null});
    return { ok: true, json: async () => url.includes('/items?')
      ? { items:[{item:{id:trackId,uri,name:'Track'}}],next:null } : {snapshot_id:'new'} };
  };
  await replacePlaylist(playlist, [{uri}]);
  const tracks = await playlistTracks(playlist);
  assert.equal(tracks[0].uri, uri);
  assert.equal(requests[0].method, 'PUT');
  assert.deepEqual(requests[0].body, {uris:[uri]});
  assert.equal(requests[1].method, 'GET');
  assert.ok(requests.every(r => r.url.includes('/playlists/' + playlist + '/items')));
  assert.match(requests[1].url, /limit=50/);
});
test('revoked refresh token removes the saved connection', async () => {
  values.set('predify.auth.v1', JSON.stringify({ access_token: 'expired-test', refresh_token: 'revoked-test', expires_at: 0 }));
  global.fetch = async () => ({ ok: false, json: async () => ({ error: 'invalid_grant' }) });
  await assert.rejects(accessToken(), /expirou ou foi revogada/);
  assert.equal(auth(), null);
});

test('retrieves the selected playlist cover without modifying Spotify', async () => {
  const { playlistCoverImages } = await import('../spotify.js');
  const id = 'p'.repeat(22), imageUrl = 'https://i.scdn.co/image/example';
  values.set('predify.auth.v1', JSON.stringify({ access_token: 'ok', refresh_token: 'ok', expires_at: Date.now() + 3600000 }));
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.spotify.com/v1/playlists/' + id + '/images');
    assert.equal(options.method || 'GET', 'GET');
    return { ok: true, json: async () => [{url:imageUrl,height:300,width:300}] };
  };
  assert.equal((await playlistCoverImages(id))[0].url, imageUrl);
});

test('all Spotify search requests respect the development mode limit of 10', async () => {
  const { searchTracks, resolveCatalogCandidate } = await import('../spotify.js');
  values.set('predify.auth.v1', JSON.stringify({
    access_token: 'ok', refresh_token: 'ok', expires_at: Date.now() + 3600000
  }));
  const limits = [];
  global.fetch = async url => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, '/v1/search');
    const limit = Number(parsed.searchParams.get('limit'));
    limits.push(limit);
    assert.ok(limit >= 1 && limit <= 10, 'Invalid Spotify search limit: ' + limit);
    return { ok: true, json: async () => ({
      tracks: { items: [], next: null, offset: Number(parsed.searchParams.get('offset') || 0) }
    }) };
  };
  await resolveCatalogCandidate({name:'Imagine',artist:'John Lennon'});
  await searchTracks('A','Aquarela');
  assert.ok(limits.length >= 3);
  assert.ok(limits.every(limit => limit === 10));
});

test('Spotify cooldown persists, identifies quota errors and blocks new network calls until Retry-After', async () => {
  const { api } = await import('../spotify.js');
  values.set('predify.auth.v1', JSON.stringify({access_token:'ok',refresh_token:'ok',expires_at:Date.now()+3600000}));
  let calls = 0;
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    global.fetch = async () => {
      calls++;
      return {ok:false,status:429,headers:{get:()=> '125'},json:async()=>({error:{reason:'QUOTA_EXCEEDED'}})};
    };
    await assert.rejects(api('/me'), e => e.status === 429 && e.reason === 'QUOTA_EXCEEDED' && e.retryAfter === 125 && /prazo informado pelo Spotify/.test(e.message));
    const reloaded = await import('../spotify.js?cooldown-test');
    await assert.rejects(reloaded.api('/me'), /Cota de consultas/);
    assert.equal(calls,1);
    now += 126000;
    global.fetch = async () => { calls++; return {ok:true,json:async()=>({id:'owner'})}; };
    assert.deepEqual(await reloaded.api('/me'),{id:'owner'});
    assert.equal(calls,2);
  } finally { Date.now = originalNow; values.delete('predify.spotify.cooldown.v1'); }
});

test('missing Retry-After is reported as unknown rather than zero seconds', async () => {
  const { api } = await import('../spotify.js');
  values.set('predify.auth.v1', JSON.stringify({access_token:'ok',refresh_token:'ok',expires_at:Date.now()+3600000}));
  global.fetch = async () => ({ok:false,status:429,headers:{get:()=>null},json:async()=>({error:{}})});
  try { await assert.rejects(api('/me'), e => e.retryAfter === 60 && /prazo não informado/.test(e.message)); }
  finally { values.delete('predify.spotify.cooldown.v1'); }
});
