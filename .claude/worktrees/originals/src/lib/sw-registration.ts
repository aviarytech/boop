/**
 * Service Worker Registration Helper
 *
 * Handles registration, updates, and lifecycle events for the service worker.
 */

export interface SWRegistrationConfig {
  onUpdate?: (registration: ServiceWorkerRegistration) => void;
  onSuccess?: (registration: ServiceWorkerRegistration) => void;
  onError?: (error: Error) => void;
}

/**
 * Detect stale asset errors (MIME type errors from 404s returning HTML)
 * and force a full refresh when detected
 */
function setupStaleAssetDetection(): void {
  // Listen for script loading errors
  window.addEventListener('error', (event) => {
    if (event.target instanceof HTMLScriptElement) {
      const src = event.target.src;
      // If a hashed asset fails to load, it's likely a stale cache issue
      if (src && src.includes('/assets/') && /[-\.][a-f0-9]{8,}\.js/.test(src)) {
        console.error('[SW] Stale asset detected, forcing refresh:', src);
        forceFullRefresh();
      }
    }
  }, true); // Use capture phase to catch errors before they bubble

  // Also catch dynamic import failures (common with Vite code splitting)
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    if (reason instanceof Error) {
      // Check for MIME type errors or failed dynamic imports
      const isModuleError = 
        reason.message.includes('MIME type') ||
        reason.message.includes('Failed to fetch dynamically imported module') ||
        reason.message.includes('failed to load');
      
      if (isModuleError) {
        console.error('[SW] Module load error, forcing refresh:', reason.message);
        forceFullRefresh();
      }
    }
  });
}

/**
 * Force a full refresh: clear all caches and reload
 */
async function forceFullRefresh(): Promise<void> {
  // Prevent multiple refreshes
  if (sessionStorage.getItem('poo-app-refreshing')) {
    return;
  }
  sessionStorage.setItem('poo-app-refreshing', 'true');

  try {
    // Clear all caches
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
      console.log('[SW] All caches cleared');
    }

    // Unregister service worker
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
      console.log('[SW] Service worker unregistered');
    }

    // Hard reload to get fresh assets
    window.location.reload();
  } catch (error) {
    console.error('[SW] Force refresh failed:', error);
    // Last resort: just reload
    window.location.reload();
  }
}

export async function registerServiceWorker(
  config: SWRegistrationConfig = {}
): Promise<ServiceWorkerRegistration | undefined> {
  // Set up stale asset detection first
  setupStaleAssetDetection();

  if (!('serviceWorker' in navigator)) {
    console.log('Service workers not supported');
    return undefined;
  }

  // Only register in production or when explicitly testing
  // In development, SW can interfere with hot reloading
  // Exception: always register on Capacitor native (assets are local)
  const isNative = typeof (window as unknown as Record<string, unknown>).Capacitor !== 'undefined';
  if (import.meta.env.DEV && !import.meta.env.VITE_ENABLE_SW && !isNative) {
    console.log('Service worker disabled in development');
    return undefined;
  }

  // Clear the refresh flag on successful load
  sessionStorage.removeItem('poo-app-refreshing');

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      // Force update check on every page load
      updateViaCache: 'none',
    });

    // Check for updates immediately
    registration.update().catch(() => {
      // Ignore update check errors
    });

    // Check for updates periodically (every 5 minutes)
    setInterval(() => {
      registration.update().catch(() => {});
    }, 5 * 60 * 1000);

    // Check for updates when user returns to the tab
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        registration.update().catch(() => {});
      }
    });

    // Check for updates periodically
    registration.addEventListener('updatefound', () => {
      const installingWorker = registration.installing;
      if (!installingWorker) return;

      installingWorker.addEventListener('statechange', () => {
        if (installingWorker.state === 'installed') {
          if (navigator.serviceWorker.controller) {
            // New update available - activate it immediately
            console.log('[SW] New service worker available, activating...');
            installingWorker.postMessage('skipWaiting');
            config.onUpdate?.(registration);
          } else {
            // First install
            console.log('[SW] Service worker installed');
            config.onSuccess?.(registration);
          }
        }
      });
    });

    // Handle controller change (new SW took over)
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      console.log('[SW] New controller, reloading for fresh assets');
      window.location.reload();
    });

    // Log current SW state
    if (registration.active) {
      console.log('[SW] Service worker active');
    }

    return registration;
  } catch (error) {
    console.error('[SW] Service worker registration failed:', error);
    config.onError?.(error as Error);
    return undefined;
  }
}

/**
 * Unregister all service workers
 * Useful for debugging or when you need to clear SW state
 */
export async function unregisterServiceWorker(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const success = await registration.unregister();
    if (success) {
      console.log('[SW] Service worker unregistered');
    }
    return success;
  } catch (error) {
    console.error('[SW] Failed to unregister service worker:', error);
    return false;
  }
}

/**
 * Skip waiting and activate new service worker immediately
 */
export function skipWaitingAndReload(): void {
  navigator.serviceWorker.controller?.postMessage('skipWaiting');
  window.location.reload();
}

/**
 * Check for a service worker update and apply it if available.
 * Returns true if an update was found, false otherwise.
 */
export async function checkForUpdateAndApply(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();

    // If there's a waiting worker, activate it immediately
    if (registration.waiting) {
      registration.waiting.postMessage('skipWaiting');
      return true;
    }

    return false;
  } catch (error) {
    console.error('[SW] Update check failed:', error);
    return false;
  }
}

/**
 * Force clear all caches and reload
 * Exposed for manual debugging
 */
export async function clearAllCachesAndReload(): Promise<void> {
  await forceFullRefresh();
}
