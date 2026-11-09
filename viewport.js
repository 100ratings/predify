// Keep the full-screen layout while idle, use the actual visible region only
// when editing with the keyboard open, without disabling pinch-to-zoom
export function viewportLayout({ ios, standalone, screenHeight, screenWidth, innerHeight, innerWidth, visualHeight = innerHeight, visualTop = 0, scale = 1, editing = false }) {
  const portrait = screenHeight > screenWidth && innerHeight > innerWidth;
  const full = ios && standalone && portrait ? Math.max(screenHeight, innerHeight) : innerHeight;
  const keyboard = editing && scale < 1.1 && full - visualHeight > 120;
  return { height: keyboard ? visualHeight : full, top: keyboard ? visualTop : 0, keyboard };
}

// Scroll only as far as necessary to expose the entire manual composer above
// the iPhone keyboard while preserving the playlist section when possible
export function keyboardComposerScrollDelta({ composerBottom, viewportBottom, padding = 10 }) {
  const distance = composerBottom + padding - viewportBottom;
  return Number.isFinite(distance) ? Math.max(0, Math.ceil(distance)) : 0;
}

// Final offset selected on the iPhone with the temporary calibration panel
export const MANUAL_KEYBOARD_OFFSET_PX = 10;
