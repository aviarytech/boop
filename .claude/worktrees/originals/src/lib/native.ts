import { Capacitor } from '@capacitor/core';

/**
 * Update the native status bar style to match the current theme.
 * Safe to call at any time — no-ops on web.
 */
export async function updateStatusBarStyle() {
  if (!Capacitor.isNativePlatform()) return;

  const { StatusBar, Style } = await import('@capacitor/status-bar');
  const isDark = document.documentElement.classList.contains('dark');
  await StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light });
}

export async function initNativePlatform() {
  if (!Capacitor.isNativePlatform()) return;

  // Set initial status bar style
  await updateStatusBarStyle();

  // On Android, make status bar transparent for edge-to-edge
  if (Capacitor.getPlatform() === 'android') {
    const { StatusBar } = await import('@capacitor/status-bar');
    await StatusBar.setBackgroundColor({ color: '#00000000' });
    await StatusBar.setOverlaysWebView({ overlay: true });
  }

  // Watch for dark mode changes and sync status bar
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.attributeName === 'class') {
        updateStatusBarStyle();
      }
    }
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

export async function initKeyboardHandling() {
  if (!Capacitor.isNativePlatform()) return;

  const { Keyboard } = await import('@capacitor/keyboard');

  // On iOS, use resize mode that doesn't push the whole webview up
  // This prevents janky layout shifts when the keyboard opens
  if (Capacitor.getPlatform() === 'ios') {
    await Keyboard.setAccessoryBarVisible({ isVisible: true });
  }

  // Scroll focused input into view when keyboard opens
  Keyboard.addListener('keyboardWillShow', () => {
    const activeEl = document.activeElement as HTMLElement | null;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
      // Small delay to let keyboard animation start
      setTimeout(() => {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  });
}
