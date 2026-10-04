import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';

let launchHandled = false;
let nativeEventDelivered = false;

export async function initDeepLinks(navigate: (path: string) => void, signal?: AbortSignal) {
  const handles: PluginListenerHandle[] = [];
  let stopped = signal?.aborted ?? false;
  const cleanup = () => {
    stopped = true;
    signal?.removeEventListener('abort', cleanup);
    for (const handle of handles.splice(0)) void handle.remove();
  };
  if (!Capacitor.isNativePlatform() || stopped) return cleanup;
  signal?.addEventListener('abort', cleanup, { once: true });
  const listen = async (handle: Promise<PluginListenerHandle>) => {
    const registered = await handle;
    if (stopped) await registered.remove();
    else handles.push(registered);
  };
  const open = (value: string) => {
    if (stopped) return;
    try {
      const url = new URL(value);
      if (url.origin !== 'https://boop.ad') return;
      navigate(`${url.pathname}${url.search}${url.hash}`);
    } catch { /* Ignore malformed native launch URLs. */ }
  };
  try {
    await listen(App.addListener('appUrlOpen', event => {
      if (stopped) return;
      // Capacitor retains the cold-start event until a listener consumes it.
      // A delivered event takes precedence over the later launch lookup.
      try {
        if (new URL(event.url).origin === 'https://boop.ad') nativeEventDelivered = true;
      } catch { /* The shared parser below ignores malformed URLs. */ }
      open(event.url);
    }));
    if (stopped) return cleanup;
    await listen(App.addListener('backButton', ({ canGoBack }) => {
      if (stopped) return;
      if (canGoBack) window.history.back();
      else void App.exitApp();
    }));
    if (!stopped && !launchHandled) {
      const launch = await App.getLaunchUrl();
      // An aborted StrictMode setup must not consume the next setup's launch.
      if (!stopped && !launchHandled) {
        launchHandled = true;
        if (launch?.url && !nativeEventDelivered) open(launch.url);
      }
    }
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}
