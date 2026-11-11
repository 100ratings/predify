// Run before the body is parsed so iOS never paints the temporary HTML state
(() => {
  const root = document.documentElement;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const portrait = screen.height > screen.width && innerHeight > innerWidth;
  const height = ios && standalone && portrait ? Math.max(screen.height, innerHeight) : innerHeight;
  root.style.setProperty('--app-h', height + 'px');
  root.style.setProperty('--app-top', '0px');
  root.classList.add('app-starting');
  // Fail open if a module cannot load, never leave the interface hidden indefinitely
  const reveal = () => { clearTimeout(fallback); root.classList.remove('app-starting'); };
  const fallback = setTimeout(reveal, 3000);
  document.addEventListener('predify:ready', reveal, { once: true });
})();
