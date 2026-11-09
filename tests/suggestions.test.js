import test from 'node:test';
import assert from 'node:assert/strict';
import { SUGGESTIONS } from '../suggestions.js';
import { ALPHABET, letters, emptyCatalog, validateCatalog } from '../engine.js';
import { validateCandidateCatalog } from '../catalog-import.js';

test('all 26 letters have five offline suggestions without fabricated Spotify IDs', () => {
  const suggestions = validateCandidateCatalog(SUGGESTIONS);
  assert.equal(Object.values(suggestions).flat().length,130);
  for (const letter of ALPHABET) {
    assert.equal(suggestions[letter].length,5,letter);
    for (const song of suggestions[letter]) {
      assert.equal(letters(song.name)[0],letter);
      assert.equal(song.id,undefined);
    }
  }
  assert.equal(suggestions.A[0].name,'Another Brick in the Wall, Part 2');
  assert.equal(suggestions.A[1].name,'Anna Júlia');
  assert.deepEqual(suggestions.X.map(t=>t.name),['X','Xibom Bombom','Xote dos Milagres','Xote da Alegria','Xanadu']);
});
test('catalog remains empty before a suggestion is confirmed via Spotify', () => {
  const catalog=validateCatalog(emptyCatalog());
  assert.equal(Object.values(catalog).flat().filter(Boolean).length,0);
});
