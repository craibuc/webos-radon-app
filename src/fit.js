// Scale the fixed 1920x1080 layout to the window so it is usable in a desktop browser (handy when developing with
// file:// in Chrome). On the TV the window is exactly 1920x1080, so the scale is 1 and this does nothing.
(() => {
  const fit = () => {
    const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    document.body.style.transformOrigin = '0 0';
    document.body.style.transform = s === 1 ? '' : 'scale(' + s + ')';
  };
  window.addEventListener('resize', fit);
  fit();
})();
