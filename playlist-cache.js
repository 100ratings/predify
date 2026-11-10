import { spotifyId } from './engine.js?v=1.3.11';
export const PLAYLIST_CACHE_KEY = 'predify.playlists.cache.v1';
export function createPlaylistCache(storage = globalThis.localStorage) {
  let state = { me:null, items:[], details:{} };
  const reload = () => {
    state = {me:null,items:[],details:{}};
    try {
      const saved = JSON.parse(storage?.getItem(PLAYLIST_CACHE_KEY));
      if (saved && Array.isArray(saved.items) && saved.details && typeof saved.details === 'object') state = saved;
    } catch { /* A missing or damaged cache must not affect the saved catalog */ }
  };
  reload();
  const persist = () => { try { storage?.setItem(PLAYLIST_CACHE_KEY,JSON.stringify(state)); return true; } catch { return false; } };
  const metadata = item => ({id:item.id,name:String(item.name || 'Playlist salva'),public:item.public,
    items:{total:item.items?.total ?? item.tracks?.total ?? 0},
    coverUrl:item.coverUrl || item.images?.[0]?.url || '',firstAlbumUrl:item.firstAlbumUrl || ''});
  return {
    reload,
    list: () => state.items.filter(item=>item && spotifyId(item.id,'playlist')).map(metadata),
    profile: () => state.me,
    details: id => state.details[id]?.items ? state.details[id] : null,
    saveList: (items,me) => {
      state.items = items.filter(item=>spotifyId(item.id,'playlist')).map(metadata);
      state.me = me ? {id:me.id,display_name:me.display_name || ''} : null;
      const ids = new Set(state.items.map(item=>item.id));
      for (const id of Object.keys(state.details)) if (!ids.has(id)) delete state.details[id];
      return persist();
    },
    saveDetails: (playlist,items) => {
      if (!playlist || !spotifyId(playlist.id,'playlist')) return false;
      const index = state.items.findIndex(item=>item.id === playlist.id);
      if (index >= 0) state.items[index] = metadata(playlist);
      // Very large playlists remain usable, but are not silently cached in part
      if (items.length > 1000) { delete state.details[playlist.id]; persist(); return false; }
      state.details[playlist.id] = {at:Date.now(),items:items.map(track=>({id:track.id,uri:track.uri,name:track.name,
        artist:track.artist,image:track.image,artists:track.artists?.map(a=>({name:a.name})),
        album:track.album ? {images:track.album.images?.map(image=>({url:image.url}))} : undefined}))};
      const oldest = Object.keys(state.details).sort((a,b)=>state.details[a].at-state.details[b].at);
      while(oldest.length>5) delete state.details[oldest.shift()];
      return persist();
    },
    clear: () => { state={me:null,items:[],details:{}}; try { storage?.removeItem(PLAYLIST_CACHE_KEY); } catch { /* Optional cache */ } }
  };
}
