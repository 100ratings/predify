// The performer requested a fixed-scale interface for this PWA
export function preventZoom(target = document) {
  const cancel = event => event.preventDefault();
  const multiple = event => { if (event.touches.length > 1) event.preventDefault(); };
  let lastTap = 0; let lastTarget = null;
  const doubleTap = event => {
    if (event.changedTouches.length !== 1 || event.touches.length) return;
    const now = Date.now();
    if (lastTarget === event.target && now - lastTap < 300) event.preventDefault();
    lastTap = now; lastTarget = event.target;
  };
  for (const name of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick']) target.addEventListener(name, cancel, { passive: false });
  target.addEventListener('touchstart', multiple, { passive: false });
  target.addEventListener('touchmove', multiple, { passive: false });
  target.addEventListener('touchend', doubleTap, { passive: false });
}
