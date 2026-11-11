import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {createPlaylistCache,PLAYLIST_CACHE_KEY} from '../playlist-cache.js';
function fixture() {
  const saved=new Map();
  const storage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
  return {storage,saved,cache:createPlaylistCache(storage)};
}
const playlist={id:'p'.repeat(22),name:'Minha playlist',public:true,items:{total:1},images:[{url:'https://i.scdn.co/image/cover'}]};
const items=[{id:'t'.repeat(22),uri:'spotify:track:'+'t'.repeat(22),name:'Música',artists:[{name:'Artista'}]}];
test('playlist list, cover and complete cached contents survive reopening and clear on disconnect',()=>{
  const f=fixture();
  f.cache.saveList([playlist],{id:'owner',display_name:'Nome',access_token:'secret'});
  f.cache.saveDetails(playlist,items);
  const restored=createPlaylistCache(f.storage);
  assert.equal(restored.list()[0].name,playlist.name);
  assert.equal(restored.list()[0].coverUrl,playlist.images[0].url);
  assert.equal(restored.details(playlist.id).items[0].uri,items[0].uri);
  assert.equal(f.saved.get(PLAYLIST_CACHE_KEY).includes('secret'),false);
  restored.clear();f.cache.reload();
  assert.deepEqual(f.cache.list(),[]);
  assert.equal(f.cache.details(playlist.id),null);
});
test('cache never silently retains a truncated playlist, and unavailable storage is nonfatal',()=>{
  const f=fixture();f.cache.saveList([playlist],null);
  assert.equal(f.cache.saveDetails(playlist,Array(1001).fill(items[0])),false);
  assert.equal(f.cache.details(playlist.id),null);
  const unavailable=createPlaylistCache({getItem:()=>'{broken',setItem:()=>{throw Error('full')}});
  assert.deepEqual(unavailable.list(),[]);
  assert.equal(unavailable.saveList([playlist],null),false);
});
test('ordinary startup and auth storage events restore cached playlists without fetching, cached switching returns before network reads',()=>{
  const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const startup=app.slice(app.indexOf('async function start() {'));
  assert.ok(startup.indexOf('restoreSavedPlaylists();') < startup.indexOf('await finishLogin()'));
  assert.match(startup,/if \(connected\) restoreSavedPlaylists\(\);/);
  assert.doesNotMatch(startup,/if \(auth\(\)\) await loadPlaylists\(\)/);
  assert.match(app,/event.key === 'predify.auth.v1' \|\| event.key === PLAYLIST_CACHE_KEY\) restoreSavedPlaylists\(\)/);
  const refresh=app.slice(app.indexOf('async function refreshPlaylistItems('),app.indexOf('function suggestionKey('));
  assert.ok(refresh.indexOf('if (saved)')<refresh.indexOf('playlistTracks(selectedId)'));
  assert.match(refresh,/if \(saved\) \{[\s\S]*?paintPlaylist\(\); return;/);
});
