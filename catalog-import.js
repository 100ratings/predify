import { ALPHABET, MAX_TRACKS_PER_LETTER, letters, spotifyId } from './engine.js?v=1.3.14';

function normalized(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\bpt\.?\s*(\d+)\b/g, 'part $1')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function mainArtist(value) {
  return String(value || '').split(/\s+(?:feat\.?|ft\.?|&)\s+|,/i)[0].trim();
}
export function validateCandidateCatalog(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Seleção inválida');
  const selected = {};
  for (const letter of ALPHABET) {
    const entries = input[letter];
    if (!Array.isArray(entries) || entries.length > MAX_TRACKS_PER_LETTER) throw new Error('A letra ' + letter + ' deve ter até cinco sugestões');
    const seen = new Set();
    selected[letter] = entries.map(raw => {
      if (!raw || typeof raw.name !== 'string' || typeof raw.artist !== 'string' || !raw.name.trim() || !raw.artist.trim()) throw new Error('Música sem título ou artista na letra ' + letter);
      const name = raw.name.trim().slice(0, 300), artist = raw.artist.trim().slice(0, 300);
      if (letters(name)[0] !== letter) throw new Error('A música ' + name + ' não começa com a letra ' + letter);
      const key = normalized(name) + ':' + normalized(artist);
      if (seen.has(key)) throw new Error('Música repetida na letra ' + letter);
      seen.add(key);
      if (raw.id && !spotifyId(raw.id)) throw new Error('ID do Spotify inválido em ' + name);
      return { name, artist, ...(raw.id ? { id: spotifyId(raw.id) } : {}) };
    });
  }
  return selected;
}
export function candidateScore(item, expected) {
  if (!item || !expected) return -Infinity;
  const name = normalized(item.name);
  const wanted = normalized(expected.name);
  if (!name || !wanted) return -Infinity;
  const suffix = name.startsWith(wanted + ' ') ? name.slice(wanted.length + 1) : '';
  const exact = name === wanted;
  const version = !!suffix && /^(?:\d{4}\s+)?(?:remaster(?:ed)?|original|radio edit|single version|stereo|mono|edit|album version|from the)/.test(suffix);
  if (!exact && !version) return -Infinity;
  const artists = Array.isArray(item.artists) ? item.artists.map(a => a.name) : String(item.artist || '').split(',');
  const primary = normalized(mainArtist(expected.artist));
  if (!primary || !artists.some(a => normalized(a) === primary)) return -Infinity;
  const raw = (item.name + ' ' + (item.album?.name || '')).toLowerCase();
  if (/\b(karaoke|tribute|instrumental|sped up|slowed|nightcore|cover)\b/.test(raw)) return -Infinity;
  if (/\b(live|ao vivo|remix|acoustic|demo)\b/.test(raw)) return -Infinity;
  return (exact ? 150 : 146) + Math.min(4, Math.max(0, Number(item.popularity) || 0) / 25);
}
