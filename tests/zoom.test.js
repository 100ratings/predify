import test from 'node:test';
import assert from 'node:assert/strict';
import { preventZoom } from '../zoom.js';
function gesture(target,type,properties={}) {
  const event=new Event(type,{cancelable:true});
  for(const [key,value] of Object.entries(properties))Object.defineProperty(event,key,{value});
  target.dispatchEvent(event);return event.defaultPrevented;
}
test('pinch and double-click defaults are blocked',()=>{
  const target=new EventTarget();preventZoom(target);
  for(const type of ['gesturestart','gesturechange','gestureend','dblclick'])assert.equal(gesture(target,type),true);
  assert.equal(gesture(target,'touchstart',{touches:[{},{}]}),true);
  assert.equal(gesture(target,'touchmove',{touches:[{},{}]}),true);
});
test('single-finger scrolling remains available and a rapid second tap is blocked',()=>{
  const target=new EventTarget();preventZoom(target);
  assert.equal(gesture(target,'touchmove',{touches:[{}]}),false);
  assert.equal(gesture(target,'touchend',{changedTouches:[{}],touches:[]}),false);
  assert.equal(gesture(target,'touchend',{changedTouches:[{}],touches:[]}),true);
});
