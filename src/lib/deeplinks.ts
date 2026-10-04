import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

export async function initDeepLinks(navigate: (path: string) => void) {
  if (!Capacitor.isNativePlatform()) return;

  const open = (value: string) => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.hostname !== 'boop.ad') return;
      navigate(`${url.pathname}${url.search}${url.hash}`);
    } catch { /* Ignore malformed native launch URLs. */ }
  };
  // Warm links and cold-start links use the same route, including sign-in continuation.
  await App.addListener('appUrlOpen', event => open(event.url));
  const launch = await App.getLaunchUrl();
  if (launch?.url) open(launch.url);

  // Handle back button on Android
  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
    } else {
      App.exitApp();
    }
  });
}
