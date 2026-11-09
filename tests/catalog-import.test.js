import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCandidateCatalog, candidateScore } from '../catalog-import.js';
import { ALPHABET } from '../engine.js';

const input = () => Object.fromEntries(ALPHABET.map(letter => [letter, []]));
test('A-Z selections preserve order and allow five songs per letter', () => {
  const choices = input();
  choices.A = Array.from({ length: 5 }, (_, i) => ({ name: 'A Song ' + i, artist: 'Artist' }));
  assert.deepEqual(validateCandidateCatalog(choices).A, choices.A);
  choices.A.push({ name: 'A Song 5', artist: 'Artist' });
  assert.throws(() => validateCandidateCatalog(choices), /até cinco/);
});
test('candidate validation blocks duplicates, wrong initials and forged IDs', () => {
  const c = input(); c.A = [{ name: 'Alone', artist: 'Band' }, { name: 'Alone', artist: 'Band' }];
  assert.throws(() => validateCandidateCatalog(c), /repetida/);
  c.A[1].name = 'Bingo';
  assert.throws(() => validateCandidateCatalog(c), /não começa/);
  c.A = [{ name:'Alone',artist:'Band',id:'fake' }];
  assert.throws(() => validateCandidateCatalog(c), /ID do Spotify/);
});
test('Spotify candidate matcher rejects covers and live versions, allows remasters', () => {
  const wanted = { name:'Billie Jean',artist:'Michael Jackson' };
  const original = {name:'Billie Jean',artists:[{name:'Michael Jackson'}],popularity:80};
  assert.ok(candidateScore(original,wanted) >= 145);
  assert.ok(candidateScore({...original,name:'Billie Jean - Remastered 2011'},wanted) >= 145);
  assert.equal(candidateScore({...original,artists:[{name:'Tribute Band'}]},wanted),-Infinity);
  assert.equal(candidateScore({...original,name:'Billie Jean - Live'},wanted),-Infinity);
  assert.equal(candidateScore({...original,name:'Billie Jean Karaoke'},wanted),-Infinity);
});

