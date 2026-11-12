import { recordDiagnostic, spotifyOperation, diagnosticFetch } from './diagnostics.js?v=1.3.25';
import { spotifyId, cleanTrack } from './engine.js?v=1.3.25';
import { candidateScore } from './catalog-import.js?v=1.3.25';
import { searchQuery, matchingTracks } from './catalog-search.js?v=1.3.25';
export const CLIENT_ID = 'ea812e9b0ada47778150c48b62bf02ee';
export const SCOPES = ['playlist-modify-public', 'playlist-modify-private', 'playlist-read-private'];
const KEY = 'predify.auth.v1';
let refreshInFlight;
const timeoutSignal = () => AbortSignal.timeout(25000);
export function redirectUri() { return new URL('./', location.href).href.split('?')[0].split('#')[0]; }
export function auth() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } }
export function disconnect() { localStorage.removeItem(KEY); }
function saveAuth(data, previous = {}) {
  const saved = { access_token: data.access_token, refresh_token: data.refresh_token || previous.refresh_token, expires_at: Date.now() + data.expires_in * 1000, scope: data.scope || previous.scope || '' };
  localStorage.setItem(KEY, JSON.stringify(saved));
  return saved;
}
async function tokenRequest(body) {
  const response = await diagnosticFetch('spotify-auth','token','https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body), signal: timeoutSignal() });
  const result = await response.json();
  if (!response.ok) {
    if (result.error === 'invalid_grant') {
      if (body.grant_type === 'refresh_token') {
        disconnect();
        const error=new Error('A sessão do Spotify expirou ou foi revogada, conecte novamente');error.code='spotify-auth';throw error;
      }
      throw new Error('O código de autorização do Spotify expirou ou já foi utilizado, toque novamente em Conectar Spotify');
    }
    throw new Error('O Spotify recusou a conexão (' + (result.error || response.status) + '), tente novamente');
  }
  return result;
}
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
export async function connect() {
  const verifier = random(); const state = random();
  // localStorage preserves the verifier if iOS returns through another app window
  localStorage.setItem('predify.oauth', JSON.stringify({ verifier, state, redirect: redirectUri(), time: Date.now() }));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const params = new URLSearchParams({ client_id: CLIENT_ID, response_type: 'code', redirect_uri: redirectUri(), scope: SCOPES.join(' '), state, code_challenge_method: 'S256', code_challenge: challenge });
  location.assign('https://accounts.spotify.com/authorize?' + params);
}
export async function finishLogin() {
  const params = new URLSearchParams(location.search);
  if (!params.has('code') && !params.has('error')) return false;
  history.replaceState(null, '', location.pathname);
  let pending = null;
  try { pending = JSON.parse(localStorage.getItem('predify.oauth') || 'null'); } catch { /* Invalid stored request */ }
  localStorage.removeItem('predify.oauth');
  if (params.has('error')) throw new Error('O Spotify não autorizou a conexão (' + params.get('error') + '), tente novamente');
  if (!pending) throw new Error('O Spotify retornou sem encontrar a solicitação de login neste navegador, isso pode ocorrer quando o iPhone abre o retorno em outra janela, tente conectar novamente no mesmo navegador');
  if (pending.state !== params.get('state')) throw new Error('O retorno do Spotify não corresponde à solicitação de login, tente novamente');
  if (Date.now() - pending.time > 10 * 60 * 1000) throw new Error('O login do Spotify demorou demais e expirou, tente novamente');
  if (pending.redirect !== redirectUri()) throw new Error('O retorno do Spotify abriu em um endereço diferente, conecte novamente no mesmo navegador');
  const data = await tokenRequest({ grant_type: 'authorization_code', code: params.get('code'), client_id: CLIENT_ID, redirect_uri: pending.redirect, code_verifier: pending.verifier });
  if (!SCOPES.every(scope => (data.scope || '').split(' ').includes(scope))) throw new Error('Faltaram permissões de playlist, conecte novamente');
  saveAuth(data); return true;
}
export async function accessToken(force = false) {
  const current = auth();
  if (!current) throw new Error('Conecte sua conta do Spotify');
  if (!force && current.expires_at > Date.now() + 60000) return current.access_token;
  if (!current.refresh_token) { disconnect(); throw new Error('Conecte o Spotify novamente para manter sua sessão'); }
  if (!refreshInFlight) refreshInFlight = tokenRequest({ grant_type: 'refresh_token', refresh_token: current.refresh_token, client_id: CLIENT_ID }).then(data => saveAuth(data, current).access_token).finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}
const COOLDOWN_KEY = 'predify.spotify.cooldown.v1';
function spotifyCooldown() {
  try { return JSON.parse(localStorage.getItem(COOLDOWN_KEY)) || {}; } catch { return {}; }
}
function cooldownError(state) {
  const seconds = Math.max(1, Math.ceil((state.until - Date.now()) / 1000));
  const duration = seconds >= 60 ? Math.ceil(seconds / 60) + ' min' : seconds + ' s';
  const kind = state.reason === 'QUOTA_EXCEEDED' ? 'Cota de consultas do Spotify atingida' : 'Spotify limitou temporariamente as consultas';
  const error = new Error(kind + ', ' + (state.reported ? 'aguarde ' : 'nova tentativa em ') + duration + (state.reported ? ' (prazo informado pelo Spotify)' : ' (prazo não informado pelo Spotify)'));
  error.retryAfter = seconds;
  error.status = 429;
  error.reason = state.reason || '';
  return error;
}
export async function api(path, options = {}, retry = true) {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Caminho da API inválido');
  const cooldown = spotifyCooldown();
  if (cooldown.until > Date.now()) {
    recordDiagnostic('cooldown-blocked',{operation:spotifyOperation(path),retryAfter:Math.ceil((cooldown.until-Date.now())/1000),reason:cooldown.reason,reported:cooldown.reported});
    throw cooldownError(cooldown);
  }
  const token = await accessToken();
  const currentCooldown = spotifyCooldown();
  if (currentCooldown.until > Date.now()) {recordDiagnostic('cooldown-blocked',{operation:spotifyOperation(path)});throw cooldownError(currentCooldown);}
  const method = options.method || 'GET';
  let itemCount = 0;
  try { itemCount = JSON.parse(options.body || '{}').uris?.length || 0; } catch { /* Never log request bodies */ }
  const response = await diagnosticFetch('spotify',spotifyOperation(path),'https://api.spotify.com/v1' + path,
    { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: timeoutSignal() },itemCount);
  if (response.status === 401 && retry) { await accessToken(true); return api(path, options, false); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 429) {
      const header = response.headers.get('Retry-After');
      const seconds = header !== null && header.trim() !== '' ? Number(header) : NaN;
      const reported = Number.isFinite(seconds) && seconds >= 0;
      const state = { until: Date.now() + Math.max(1, reported ? seconds : 60) * 1000, reported, reason: data.error?.reason || '' };
      const previous = spotifyCooldown();
      if (previous.until > state.until) state.until = previous.until;
      try { localStorage.setItem(COOLDOWN_KEY, JSON.stringify(state)); } catch { /* Storage may be unavailable */ }
      recordDiagnostic('spotify-wait',{operation:spotifyOperation(path),method,status:429,retryAfter:Math.ceil((state.until-Date.now())/1000),reason:state.reason,reported});
      throw cooldownError(state);
    }
    const message=response.status===403?'O Spotify recusou o acesso, confira a conta Premium, as permissões e se a playlist é sua':response.status===404?'Música ou playlist não encontrada no Spotify':`Spotify ${response.status}: ${data.error?.message || 'não foi possível concluir'}`;
    const error=new Error(message);error.status=response.status;throw error;
  }
  return data;
}
export async function myPlaylists() {
  const me = await api('/me'); const items = []; let path = '/me/playlists?limit=50';
  while (path) {
    const page = await api(path);
    items.push(...(page.items || []).filter(item => item && item.owner?.id === me.id));
    path = page.next ? page.next.replace('https://api.spotify.com/v1', '') : null;
  }
  return { me, items };
}
export async function trackFromLink(link) {
  const id = spotifyId(link);
  if (!id) throw new Error('Cole o link de uma música do Spotify, não o link de álbum ou playlist');
  const track = await api('/tracks/' + id);
  if (track.is_playable === false) throw new Error('Essa música não está disponível para sua conta');
  return { id: track.id, uri: track.uri, name: track.name, artist: (track.artists || []).map(artist => artist.name).join(', '), image: track.album?.images?.at(-1)?.url || '' };
}
export async function playlistCoverImages(id) {
  if (!spotifyId(id, 'playlist')) throw new Error('Playlist inválida');
  const images = await api('/playlists/' + id + '/images');
  return Array.isArray(images) ? images : [];
}
export async function playlistTracks(id, { preserveUnavailable = false } = {}) {
  const tracks = []; let path = `/playlists/${id}/items?limit=50`;
  while (path) {
    const page = await api(path);
    const entries = (page.items || []).map(item => item.item || item.track || null);
    tracks.push(...(preserveUnavailable ? entries : entries.filter(Boolean)));
    path = page.next ? page.next.replace('https://api.spotify.com/v1', '') : null;
  }
  return tracks;
}
export async function replacePlaylist(id, tracks) {
  if (!spotifyId(id, 'playlist') || !tracks.length || tracks.length > 100) throw new Error('Playlist ou lista de músicas inválida');
  const result = await api(`/playlists/${id}/items`, { method: 'PUT', body: JSON.stringify({ uris: tracks.map(track => track.uri) }) });
  if (typeof result?.snapshot_id !== 'string' || !result.snapshot_id) {
    const error=new Error('Spotify respondeu sem confirmação da playlist, confira antes de repetir');error.code='missing-confirmation';throw error;
  }
  return result;
}

export async function searchTracks(letter, text = '', offset = 0) {
  const q = searchQuery(letter, text);
  const tracks = [];
  let nextOffset = offset;
  let more = false;
  // A bounded batch: Spotify returns up to ten raw results per request
  // Filter locally because a title-field match is not necessarily an initial match
  for (let pageIndex = 0; pageIndex < 3; pageIndex++) {
    const params = new URLSearchParams({ q, type: 'track', limit: '10', offset: String(nextOffset) });
    const result = await api('/search?' + params);
    const page = result.tracks || {};
    tracks.push(...matchingTracks(page.items, letter));
    nextOffset = (page.offset ?? nextOffset) + (page.items?.length || 0);
    more = !!page.next && nextOffset <= 1000 && !!page.items?.length;
    if (!more || tracks.length >= 8) break;
  }
  const unique = [...new Map(tracks.map(track => [track.id, track])).values()];
  return { tracks: unique, offset: nextOffset, more };
}

export async function resolveCatalogCandidate(candidate) {
  if (candidate.id) {
    const known = await trackFromLink(candidate.id);
    if (candidateScore(known, candidate) >= 145) return cleanTrack(known);
  }
  const firstArtist = candidate.artist.split(/\s+(?:feat\.?|ft\.?|&)\s+/i)[0];
  const queries = [candidate.name + ' ' + firstArtist, 'track:' + candidate.name];
  let best = null, bestScore = -Infinity;
  for (const q of queries) {
    const params = new URLSearchParams({ q, type: 'track', limit: '10', market: 'BR' });
    const response = await api('/search?' + params);
    for (const item of response.tracks?.items || []) {
      if (!item?.id || item.is_local || item.is_playable === false) continue;
      const score = candidateScore(item, candidate);
      if (score > bestScore) { bestScore = score; best = item; }
    }
    if (bestScore >= 145) break;
  }
  if (!best || bestScore < 145) return null;
  return cleanTrack({ ...best, artist: (best.artists || []).map(item => item.name).join(', '), image: best.album?.images?.at(-1)?.url || '' });
}
