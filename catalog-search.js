import { letters, cleanTrack } from './engine.js?v=1.3.8';
export const SEARCH_PAGE_SIZE = 5;
export function searchPage(tracks, page = 0) {
  const index = Math.max(0, Number.isInteger(page) ? page : 0) * SEARCH_PAGE_SIZE;
  return (tracks || []).slice(index, index + SEARCH_PAGE_SIZE);
}
export function searchQuery(letter, text = '') {
  if (!/^[A-Z]$/.test(letter)) throw new Error('Escolha uma letra de A a Z');
  const term = text.trim().replace(/[":*]/g, ' ').replace(/\s+/g, ' ').slice(0, 100).trim();
  return term ? `track:${term}` : `track:${letter.toLowerCase()}*`;
}
export function matchingTracks(items, letter) {
  const seen = new Set();
  return (items || []).flatMap(track => {
    if (!track || track.is_local || track.is_playable === false || letters(track.name)[0] !== letter || seen.has(track.id)) return [];
    try {
      const clean = cleanTrack({ ...track, artist: (track.artists || []).map(artist => artist.name).join(', '), image: track.album?.images?.at(-1)?.url || '' });
      seen.add(clean.id); return [clean];
    } catch { return []; }
  });
}
