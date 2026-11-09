import test from 'node:test';
import assert from 'node:assert/strict';
import { CUSTOM_ALEATORIEDADES_ART, playlistCoverAssets } from '../playlist-cover.js';

test('Aleatoriedades - Demian uses the supplied image, with Spotify cover only as fallback', () => {
  assert.deepEqual(playlistCoverAssets({
    name: 'Aleatoriedades - Demian', coverUrl: 'https://i.scdn.co/image/playlist',
    firstAlbumUrl: 'https://i.scdn.co/image/first-album'
  }), {primary:CUSTOM_ALEATORIEDADES_ART, fallback:'https://i.scdn.co/image/playlist'});
  assert.equal(playlistCoverAssets({name:'Aleatoriedades – Demian'}).primary,CUSTOM_ALEATORIEDADES_ART);
});
test('other playlists choose their own Spotify cover before album art', () => {
  assert.deepEqual(playlistCoverAssets({name:'Outra playlist',images:[{url:'cover'}],firstAlbumUrl:'track'}),
    {primary:'cover',fallback:'track'});
  assert.deepEqual(playlistCoverAssets({name:'Outra playlist',firstAlbumUrl:'track'}),
    {primary:'track',fallback:''});
  assert.deepEqual(playlistCoverAssets(null),{primary:'',fallback:''});
});
