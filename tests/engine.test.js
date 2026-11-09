import test from 'node:test';
import assert from 'node:assert/strict';
import { ALPHABET, letters, spotifyId, emptyCatalog, validateCatalog, validateOpening, buildSequence, moveCatalogTrack } from '../engine.js';
const id = n => String(n).padStart(22, '0');
const track = (letter, n) => ({ id: id(n), uri: 'spotify:track:' + id(n), name: letter + ' song ' + n, artist: 'Artist', image: '' });
function fixture() {
  const catalog = emptyCatalog(); let index = 1;
  for (const letter of ALPHABET) catalog[letter] = Array.from({ length: 5 }, () => track(letter, index++));
  const phrase = 'VOCÊ VAI PENSAR EM';
  const opening = { phrase, tracks: [...letters(phrase)].map(letter => catalog[letter][0]) };
  return { catalog, opening };
}
test('Portuguese accents, cedilla, spaces and punctuation normalize', () => {
  assert.equal(letters('Ana Júlia, Conceição!'), 'ANAJULIACONCEICAO');
});
test('only actual Spotify track links and IDs are accepted', () => {
  const value = id(1);
  assert.equal(spotifyId('https://open.spotify.com/intl-pt/track/' + value + '?si=abc'), value);
  assert.equal(spotifyId('spotify:track:' + value), value);
  assert.equal(spotifyId('https://evil.example/track/' + value), null);
  assert.equal(spotifyId('https://open.spotify.com/playlist/' + value), null);
  assert.equal(spotifyId('https://open.spotify.com.evil.example/track/' + value), null);
});
test('Camila produces exact initials and preserves the opening tracks', () => {
  const { catalog, opening } = fixture();
  const result = buildSequence({ name: 'Camila', catalog, opening, rng: () => 0 });
  assert.equal(result.error, '');
  assert.equal(result.tracks.map(track => track.letter).join(''), 'VOCEVAIPENSAREMCAMILA');
  assert.deepEqual(result.tracks.slice(0, opening.tracks.length).map(track => track.uri), opening.tracks.map(track => track.uri));
  const second = buildSequence({ name: 'Ana Júlia', catalog, opening, rng: () => .99 });
  assert.deepEqual(second.tracks.slice(0, opening.tracks.length).map(track => track.uri), opening.tracks.map(track => track.uri));
  assert.equal(second.tracks.map(track => track.letter).join(''), 'VOCEVAIPENSAREMANAJULIA');
});
test('repeated letters follow catalog priority and never repeat', () => {
  const { catalog } = fixture();
  const opening = { phrase: 'C', tracks: [catalog.C[0]] };
  const result = buildSequence({ name: 'AACAA', catalog, opening, rng: () => .99 });
  assert.equal(result.error, '');
  assert.deepEqual(result.tracks.slice(1).map(track => track.id), [
    catalog.A[0].id, catalog.A[1].id, catalog.C[1].id, catalog.A[2].id, catalog.A[3].id
  ]);
  assert.equal(new Set(result.tracks.map(track => track.id)).size, result.tracks.length);
});
test('a sixth occurrence or an exhausted opening blocks sending instead of reusing a song', () => {
  const { catalog } = fixture();
  assert.match(buildSequence({ name: 'AAAAAA', catalog }).error, /músicas diferentes suficientes/);
  assert.equal(buildSequence({ name: 'AAAAAA', catalog }).tracks.length, 0);
  const opening = { phrase: 'A', tracks: [catalog.A[0]] };
  const result = buildSequence({ name: 'AAAAA', catalog, opening });
  assert.match(result.error, /músicas diferentes suficientes/);
  assert.equal(result.tracks.length, 0);
});
test('saved songs compact after gaps and manual reordering changes priority', () => {
  const { catalog } = fixture();
  const before = [catalog.A[0].id, catalog.A[2].id, catalog.A[3].id, catalog.A[4].id];
  catalog.A[1] = null;
  const cleaned = validateCatalog(catalog);
  assert.deepEqual(cleaned.A.filter(Boolean).map(track => track.id), before);
  assert.equal(cleaned.A[4], null);
  cleaned.A = moveCatalogTrack(cleaned, 'A', 0, 2);
  assert.deepEqual(cleaned.A.filter(Boolean).map(track => track.id), [before[1], before[2], before[0], before[3]]);
  const result = buildSequence({ name: 'AAA', catalog: cleaned });
  assert.deepEqual(result.tracks.map(track => track.id), [before[1], before[2], before[0]]);
  assert.throws(() => moveCatalogTrack(cleaned, 'A', 0, 4));
});
test('missing letters block generation without selecting outside catalog', () => {
  const { catalog, opening } = fixture(); catalog.C = Array(5).fill(null);
  const result = buildSequence({ name: 'Ceci', catalog, opening });
  assert.deepEqual(result.missing, ['C']); assert.equal(result.tracks.length, 0);
});
test('empty or oversized names cannot be sent', () => {
  const { catalog, opening } = fixture();
  for (const name of ['', '123', 'A'.repeat(31)]) assert.ok(buildSequence({ name, catalog, opening }).error);
  assert.equal(buildSequence({ name: 'Ca', catalog, opening: null }).error, '');
});
test('import rejects wrong initials, duplicates, malformed IDs and excess slots', () => {
  const { catalog } = fixture();
  const normalized = validateCatalog(catalog);
  for (const letter of ALPHABET) {
    assert.deepEqual(normalized[letter].slice(0, 5), catalog[letter]);
    assert.equal(normalized[letter].length, 5);
  }
  for (const mutate of [c => c.A[0] = track('B', 2), c => c.A[1] = c.A[0], c => c.A[0].id = 'bad', c => c.A.push(...Array.from({length: 1}, (_, i) => track('A', 999 + i)))]) {
    const changed = structuredClone(catalog); mutate(changed);
    assert.throws(() => validateCatalog(changed));
  }
});
test('fixed opening can survive deletion of its source catalog slot', () => {
  const { catalog, opening } = fixture(); const first = opening.tracks[0].uri;
  catalog.V[0] = null;
  const result = buildSequence({ name: 'Ana', catalog, opening });
  assert.equal(result.tracks[0].uri, first);
  assert.throws(() => validateOpening('AB', [catalog.A[0]]));
});

test('opening draft can be independent of the catalog and detects overlap and repetition', async () => {
  const { catalog } = fixture();
  const { validateOpeningDraft, checkOpeningCandidate, openingConflicts } = await import('../engine.js');
  const own = track('V', 600);
  const own2 = track('O', 601);
  const draft = validateOpeningDraft('VO', [own, own2]);
  assert.equal(checkOpeningCandidate(own, catalog, draft, 0), '');
  assert.match(checkOpeningCandidate(catalog.A[0], catalog, draft, 0), /catálogo/);
  assert.match(checkOpeningCandidate(own, catalog, draft, 1), /outra posição/);
  assert.deepEqual(openingConflicts(draft, catalog), []);
  draft.tracks[1] = own;
  assert.equal(openingConflicts(draft, catalog).length, 1);
  assert.throws(() => validateOpeningDraft('VO', [own, null, own2]));
});

test('Ca without an opening sends just two catalog tracks', () => {
  const { catalog } = fixture();
  const result = buildSequence({name:'Ca',catalog,opening:null,rng:()=>0});
  assert.equal(result.error,'');
  assert.equal(result.tracks.length,2);
  assert.equal(result.tracks.map(track=>track.letter).join(''),'CA');
  assert.ok(result.tracks.every(track=>track.section==='name'));
});

test('five priority positions support five occurrences and reject the sixth', () => {
  const catalog = emptyCatalog();
  assert.equal(catalog.A.length, 5);
  catalog.A = Array.from({length:5}, (_, i) => track('A', i + 1000));
  const checked = validateCatalog(catalog);
  assert.deepEqual(buildSequence({name:'AAAAA',catalog:checked}).tracks.map(t=>t.id),checked.A.map(t=>t.id));
  assert.match(buildSequence({name:'AAAAAA',catalog:checked}).error,/músicas diferentes suficientes/);
});
test('percentages use five as the minimum and flag duplicated opening tracks', async () => {
  const {catalogHealth} = await import('../engine.js');
  const catalog = emptyCatalog();
  for (const letter of ALPHABET) catalog[letter] = Array.from({length:5},(_,i)=>track(letter,i+1500+letter.charCodeAt(0)*100));
  catalog.X = catalog.X.slice(0,4);
  const first = catalogHealth(catalog);
  assert.equal(first.byLetter.X.percentage,80);
  assert.equal(first.byLetter.X.complete,false);
  assert.equal(first.byLetter.Z.percentage,100);
  assert.equal(first.ready,25);
  assert.equal(first.percentage,96);
  const conflict = catalogHealth(catalog,{phrase:'A',tracks:[catalog.A[0]]});
  assert.equal(conflict.byLetter.A.complete,false);
  assert.match(conflict.byLetter.A.problems[0],/abertura fixa/);
  assert.equal(conflict.ready,24);
  const pending = catalogHealth(catalog,null,null,{Z:[{name:'Zombie',artist:'Banda',reason:'sem correspondência'}]});
  assert.match(pending.byLetter.Z.problems[0],/Zombie/);
});
