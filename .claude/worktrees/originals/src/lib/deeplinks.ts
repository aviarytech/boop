import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

export async function initDeepLinks(navigate: (path: string) => void) {
  if (!Capacitor.isNativePlatform()) return;

  // Handle app opened via deep link
  App.addListener('appUrlOpen', (event) => {
    const url = new URL(event.url);
    // Extract path from universal link
    const path = url.pathname;
    if (path) {
      navigate(path);
    }
  });

  // Handle back button on Android
  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
    } else {
      App.exitApp();
    }
  });
}
