import test from 'node:test';
import assert from 'node:assert/strict';
import { searchQuery, matchingTracks, SEARCH_PAGE_SIZE, searchPage } from '../catalog-search.js';
import { viewportLayout } from '../viewport.js';
const song = (name, n, extra = {}) => ({ id: String(n).padStart(22, '0'), uri: 'spotify:track:' + String(n).padStart(22, '0'), name, artists: [{name:'Artist'}], album: {images:[]}, ...extra });
test('search query supports initial suggestions and user typed song names', () => {
  assert.equal(searchQuery('O'), 'track:o*');
  assert.equal(searchQuery('A', 'A Sky Full of Stars'), 'track:A Sky Full of Stars');
  assert.throws(() => searchQuery('OO'));
});
test('suggestions include only matching initials and remove unavailable tracks and duplicates', () => {
  const results = matchingTracks([song('One', 1),song('The One', 2),song('Óculos', 3),song('One', 1),song('Only',4,{is_playable:false}),null], 'O');
  assert.deepEqual(results.map(track=>track.name), ['One','Óculos']);
  assert.equal(results[0].artist,'Artist');
});
const iphone = {ios:true,standalone:true,screenHeight:926,screenWidth:428,innerHeight:882,innerWidth:428,visualHeight:882};
test('idle iPhone keeps the full screen height', () => {
  assert.deepEqual(viewportLayout(iphone),{height:926,top:0,keyboard:false});
});
test('keyboard uses visible height while editing and restores the full screen afterwards', () => {
  assert.deepEqual(viewportLayout({...iphone,visualHeight:550,visualTop:18,editing:true}),{height:550,top:18,keyboard:true});
  assert.deepEqual(viewportLayout({...iphone,editing:false}),{height:926,top:0,keyboard:false});
});
test('pinch zoom does not trigger keyboard mode', () => {
  assert.equal(viewportLayout({...iphone,visualHeight:500,scale:1.8,editing:true}).keyboard,false);
});

test('Spotify suggestions display five per page without repeating previous pages', () => {
  const tracks = Array.from({length:12}, (_, index) => song('A' + index, index + 1));
  assert.equal(SEARCH_PAGE_SIZE, 5);
  assert.deepEqual(searchPage(tracks, 0), tracks.slice(0,5));
  assert.deepEqual(searchPage(tracks, 1), tracks.slice(5,10));
  assert.deepEqual(searchPage(tracks, 2), tracks.slice(10));
});
