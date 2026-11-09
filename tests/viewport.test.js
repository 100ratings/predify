import test from 'node:test';
import assert from 'node:assert/strict';
import { keyboardComposerScrollDelta, viewportLayout } from '../viewport.js';

test('keyboard reveal scrolls just enough to show the manual playlist button and note', () => {
  assert.equal(keyboardComposerScrollDelta({composerBottom: 1110, viewportBottom: 895}), 225);
  assert.equal(keyboardComposerScrollDelta({composerBottom: 877, viewportBottom: 895}), 0);
  assert.equal(keyboardComposerScrollDelta({composerBottom: 886, viewportBottom: 895}), 1);
  assert.equal(keyboardComposerScrollDelta({composerBottom: 879, viewportBottom: 895}), 0);
  assert.equal(keyboardComposerScrollDelta({composerBottom: 999, viewportBottom: 895, padding: 24}), 128);
});
test('keyboard calculations are safe with missing viewport information', () => {
  assert.equal(keyboardComposerScrollDelta({composerBottom: NaN, viewportBottom: 900}), 0);
  assert.equal(keyboardComposerScrollDelta({composerBottom: 1100, viewportBottom: undefined}), 0);
});
test('viewport layout remains unchanged without keyboard and switches only during editing', () => {
  const base={ios:true,standalone:true,screenHeight:852,screenWidth:393,innerHeight:800,innerWidth:393,visualHeight:520,visualTop:0,scale:1};
  assert.equal(viewportLayout({...base,editing:false}).keyboard,false);
  assert.equal(viewportLayout({...base,editing:true}).keyboard,true);
  assert.equal(viewportLayout({...base,editing:true}).height,520);
  assert.equal(viewportLayout({...base,editing:false}).height,852);
});


test('manual keyboard offset is the calibrated +10 pixels', async () => {
  const { MANUAL_KEYBOARD_OFFSET_PX } = await import('../viewport.js');
  assert.equal(MANUAL_KEYBOARD_OFFSET_PX, 10);
});
