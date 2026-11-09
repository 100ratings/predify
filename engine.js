export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
export const MAX_TRACKS_PER_LETTER = 5;
export const MIN_TRACKS_PER_LETTER = 5;
export const DEFAULT_PHRASE = 'VOCÊ VAI PENSAR EM';
export function letters(text) {
  return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
}
export function emptyCatalog() { return Object.fromEntries(ALPHABET.map(letter => [letter, Array(MAX_TRACKS_PER_LETTER).fill(null)])); }
export function spotifyId(value, type = 'track') {
  const input = String(value).trim();
  const uri = input.match(new RegExp(`^spotify:${type}:([A-Za-z0-9]{22})$`));
  if (uri) return uri[1];
  if (/^[A-Za-z0-9]{22}$/.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com') return null;
    return url.pathname.match(new RegExp(`^/(?:intl-[a-z-]+/)?${type}/([A-Za-z0-9]{22})/?$`))?.[1] || null;
  } catch { return null; }
}
export function cleanTrack(track) {
  if (!track || typeof track.name !== 'string' || !spotifyId(track.id || track.uri)) throw new Error('Música inválida');
  const id = spotifyId(track.id || track.uri);
  return { id, uri: `spotify:track:${id}`, name: track.name.slice(0, 300), artist: String(track.artist || '').slice(0, 300), image: typeof track.image === 'string' && /^https:\/\/(?:i\.scdn\.co|mosaic\.scdn\.co)\//.test(track.image) ? track.image : '' };
}
export function validateCatalog(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Catálogo inválido');
  const catalog = emptyCatalog();
  for (const letter of ALPHABET) {
    const slots = input[letter];
    if (!Array.isArray(slots) || slots.length > MAX_TRACKS_PER_LETTER) throw new Error('A letra ' + letter + ' precisa ter até cinco músicas');
    const ids = new Set();
    const ordered = slots.filter(Boolean).map(entry => {
      const track = cleanTrack(entry);
      if (letters(track.name)[0] !== letter) throw new Error('“' + track.name + '” não começa com ' + letter);
      if (ids.has(track.id)) throw new Error('Música repetida na letra ' + letter);
      ids.add(track.id);
      return track;
    });
    catalog[letter] = [...ordered, ...Array(MAX_TRACKS_PER_LETTER - ordered.length).fill(null)];
  }
  return catalog;
}
export function moveCatalogTrack(catalog, letter, from, to) {
  if (!ALPHABET.includes(letter)) throw new Error('Letra inválida');
  const ordered = (catalog[letter] || []).filter(Boolean);
  if (![from, to].every(Number.isInteger) || from < 0 || to < 0 || from >= ordered.length || to >= ordered.length) throw new Error('Posição inválida');
  const [track] = ordered.splice(from, 1);
  ordered.splice(to, 0, track);
  return [...ordered, ...Array(MAX_TRACKS_PER_LETTER - ordered.length).fill(null)];
}
export function validateOpening(phrase, tracks) {
  const normalized = letters(phrase);
  if (!normalized || normalized.length > 70) throw new Error('A abertura precisa ter entre 1 e 70 letras');
  if (!Array.isArray(tracks) || tracks.length !== normalized.length) throw new Error('Escolha todas as músicas da abertura');
  return tracks.map((entry, index) => {
    const track = cleanTrack(entry);
    if (letters(track.name)[0] !== normalized[index]) throw new Error(`Confira a música ${index + 1} da abertura`);
    return track;
  });
}
export function openingConflicts(opening, catalog) {
  if (!opening?.tracks?.length) return [];
  const catalogIds = new Set(Object.values(catalog || {}).flat().filter(Boolean).map(track => track.id));
  const used = new Set();
  return opening.tracks.flatMap((track, index) => {
    if (!track) return [];
    const reason = catalogIds.has(track.id) ? 'também está no catálogo' : used.has(track.id) ? 'se repete na abertura' : '';
    used.add(track.id);
    return reason ? [{ index, track, reason }] : [];
  });
}
export function validateOpeningDraft(phrase, entries) {
  const normalized = letters(phrase);
  if (!normalized || normalized.length > 70) throw new Error('Use uma frase de 1 a 70 letras');
  if (!Array.isArray(entries) || entries.length !== normalized.length) throw new Error('Rascunho da abertura inválido');
  return { phrase: String(phrase).trim(), tracks: entries.map((entry, index) => {
    if (!entry) return null;
    const track = cleanTrack(entry);
    if (letters(track.name)[0] !== normalized[index]) throw new Error('Música inválida na posição ' + (index + 1));
    return track;
  }) };
}
export function checkOpeningCandidate(track, catalog, draft, index) {
  const clean = cleanTrack(track);
  if (Object.values(catalog).some(slots => slots.some(entry => entry?.id === clean.id))) return 'Esta música já está no catálogo, escolha outra para a abertura fixa';
  if (draft?.tracks?.some((entry, position) => position !== index && entry?.id === clean.id)) return 'Esta música já está em outra posição da abertura fixa';
  return '';
}
function musicKey(t) {
  const normalized = value => String(value || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return normalized(t?.name) + ':' + normalized(t?.artist);
}
export function catalogHealth(catalog, opening = null, draft = null, unresolved = {}) {
  const reserved = [...(opening?.tracks || []), ...(draft?.tracks || [])].filter(Boolean);
  const fixedIds = new Set(reserved.map(t => t.id)), fixedKeys = new Set(reserved.map(musicKey));
  const all = Object.values(catalog || {}).flat().filter(Boolean);
  const ids = new Map(), keys = new Map();
  all.forEach(t => {
    ids.set(t.id, (ids.get(t.id) || 0) + 1);
    keys.set(musicKey(t), (keys.get(musicKey(t)) || 0) + 1);
  });
  const byLetter = {}; let ready = 0, total = 0, problemLetters = 0;
  for (const letter of ALPHABET) {
    const songs = (catalog?.[letter] || []).filter(Boolean);
    const problems = [];
    for (const track of songs) {
      if (fixedIds.has(track.id) || fixedKeys.has(musicKey(track)))
        problems.push('“' + track.name + '” também está na abertura fixa');
      if ((ids.get(track.id) || 0) > 1 || (keys.get(musicKey(track)) || 0) > 1)
        problems.push('“' + track.name + '” está repetida no catálogo');
    }
    for (const entry of unresolved?.[letter] || [])
      problems.push('Não encontrada no Spotify: “' + entry.name + '” (' + entry.artist + ')' + (entry.reason ? ', ' + entry.reason : ''));
    const count = songs.length, percentage = Math.min(100, Math.round(count / MIN_TRACKS_PER_LETTER * 100));
    const complete = count >= MIN_TRACKS_PER_LETTER && !problems.length;
    byLetter[letter] = {count, percentage, complete, problems: [...new Set(problems)]};
    if (complete) ready++;
    if (problems.length) problemLetters++;
    total += count;
  }
  return {byLetter, ready, total, problemLetters, percentage: Math.round(ready / ALPHABET.length * 100)};
}
export function buildSequence({ name, catalog, opening }) {
  const normalized = letters(name);
  if (!normalized) return { tracks: [], missing: [], error: 'Digite uma palavra para montar a playlist' };
  if (normalized.length > 30) return { tracks: [], missing: [], error: 'Use um nome com até 30 letras' };
  const prefix = opening?.tracks?.length ? validateOpening(opening.phrase, opening.tracks) : [];
  const missing = [...new Set(normalized.split('').filter(letter => !(catalog[letter] || []).some(Boolean)))];
  if (missing.length) return { tracks: [], missing, error: 'Cadastre pelo menos uma música para: ' + missing.join(', ') };
  const used = new Set(prefix.map(track => track.id));
  const suffix = [];
  for (const letter of normalized) {
    const track = (catalog[letter] || []).find(candidate => candidate && !used.has(candidate.id));
    if (!track) return { tracks: [], missing: [], error: 'Não há músicas diferentes suficientes para a letra ' + letter + ', ajuste o nome, a abertura ou o catálogo' };
    used.add(track.id);
    suffix.push({ ...track, letter, section: 'name' });
  }
  const tracks = [...prefix.map((track, index) => ({ ...track, letter: letters(opening.phrase)[index], section: 'opening' })), ...suffix];
  if (tracks.length > 100) return { tracks: [], missing: [], error: 'A playlist deve ter no máximo 100 músicas' };
  return { tracks, missing: [], error: '' };
}
