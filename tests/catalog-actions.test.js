import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyCatalog, catalogHealth, MAX_TRACKS_PER_LETTER } from '../engine.js';
import { SUGGESTIONS } from '../suggestions.js';
import { sameSong, removeCatalogSlot, applySuggestedTrack } from '../catalog-actions.js';

function spotifyTrack(song, index, alternativeName = song.name) {
  const id = String(index + 1).padStart(22, '0');
  return {id,uri:'spotify:track:' + id,name:alternativeName,artist:song.artist,image:'https://i.scdn.co/image/test'};
}
test('simulate adding five suggestions for A consecutively, verifying saved slots and UI status after each', async () => {
  const catalog = emptyCatalog();
  const expected = SUGGESTIONS.A;
  assert.equal(MAX_TRACKS_PER_LETTER,5);
  assert.equal(catalogHealth(catalog).byLetter.A.percentage,0);
  const names = ['Another Brick in the Wall, Pt. 2 - 2011 Remastered',
    'Anna Júlia','Another One Bites the Dust','Anunciação','All of Me'];
  for (let i = 0; i < 5; i++) {
    const saved = await Promise.resolve(spotifyTrack(expected[i],i,names[i]));
    const choice = applySuggestedTrack(catalog.A,'A',expected[i],saved);
    assert.equal(choice.index,i);
    catalog.A = choice.slots;
    assert.equal(catalog.A.filter(Boolean).length,i+1);
    assert.equal(catalogHealth(catalog).byLetter.A.percentage,(i+1)*20);
    for (let j = 0; j <= i; j++) assert.ok(catalog.A.some(item => sameSong(item,expected[j])), 'Added status should appear for '+expected[j].name);
    assert.equal(new Set(catalog.A.filter(Boolean).map(t=>t.id)).size,i+1);
  }
  assert.equal(catalogHealth(catalog).byLetter.A.complete,true);
  assert.throws(()=>applySuggestedTrack(catalog.A,'A',{name:'Aquarela',artist:'Toquinho'},spotifyTrack({name:'Aquarela',artist:'Toquinho'},15)),/cinco músicas/);
  assert.throws(()=>applySuggestedTrack(catalog.A,'A',expected[0],spotifyTrack(expected[0],0,names[0]),{forcedIndex:4}),/já está cadastrada/);
});
test('deleting a song then adding again fills the vacant position and preserves the others', () => {
  const initial = SUGGESTIONS.A.map((song,i)=>spotifyTrack(song,i));
  const afterDelete = removeCatalogSlot(initial,0);
  assert.equal(afterDelete.filter(Boolean).length,4);
  assert.equal(afterDelete[4],null);
  const result = applySuggestedTrack(afterDelete,'A',SUGGESTIONS.A[0],spotifyTrack(SUGGESTIONS.A[0],0),{replacingSlot:null});
  assert.equal(result.index,4);
  assert.equal(new Set(result.slots.map(t=>t.id)).size,5);
  assert.equal(result.slots[0].name,SUGGESTIONS.A[1].name);
  assert.equal(result.slots[4].name,SUGGESTIONS.A[0].name);
});
test('explicit replacement changes only the chosen song and never duplicates another', () => {
  const current = SUGGESTIONS.A.map((song,i)=>spotifyTrack(song,i));
  const alt = {name:'Aquarela',artist:'Toquinho'};
  const result = applySuggestedTrack(current,'A',alt,spotifyTrack(alt,20),{forcedIndex:2});
  assert.equal(result.index,2);
  assert.equal(result.slots.length,5);
  assert.equal(result.slots[2].name,'Aquarela');
  assert.equal(result.slots[0].id,current[0].id);
  assert.equal(result.slots[4].id,current[4].id);
});
test('sameSong accounts for Spotify remasters and Pt. in titles', () => {
  const wanted=SUGGESTIONS.A[0];
  const spotify=spotifyTrack(wanted,1,'Another Brick in the Wall, Pt. 2 - 2011 Remastered');
  assert.equal(sameSong(spotify,wanted),true);
  assert.equal(sameSong(wanted,spotify),true);
  assert.equal(sameSong({name:'Another Brick in the Wall',artist:'Different Artist'},wanted),false);
});
