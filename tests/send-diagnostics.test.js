import test from 'node:test';
import assert from 'node:assert/strict';
import {sendBlockReasons} from '../send-diagnostics.js';
test('blocked-send reasons distinguish remote ownership, missing data and invalid sequence without inspecting input',()=>{
 assert.deepEqual(sendBlockReasons({}),[]);
 assert.deepEqual(sendBlockReasons({remoteActive:true,hasTracks:false}),['remote-active','sequence-empty']);
 assert.deepEqual(sendBlockReasons({remoteUnknown:true,connected:false,hasPlaylist:false}),['remote-unknown','spotify-disconnected','playlist-missing']);
 assert.deepEqual(sendBlockReasons({invalidSequence:true,injectIdValid:false}),['sequence-invalid','inject-id-invalid']);
});
