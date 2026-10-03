import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ad.boop.app',
  appName: 'boop',
  webDir: 'dist',
  // Allow service worker and offline caching in native WebView
  server: {
    // Use https scheme on both platforms for proper cookie/CORS handling
    androidScheme: 'https',
    iosScheme: 'https',
    // Allow WebSocket and HTTP connections to backend
    allowNavigation: [
      'convex-backend-production-8e02.up.railway.app',
      'convex.x51.ca',
    ],
  },
  plugins: {
    CapacitorHttp: {
      // Route fetch() through native HTTP on iOS/Android to avoid
      // CORS issues when the WebView origin is https://localhost
      enabled: true,
    },
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#FFFFFF',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    Keyboard: {
      // 'native' resize mode on iOS avoids pushing the whole webview up
      resize: 'native',
      resizeOnFullScreen: true,
    },
    // No special config needed for Network plugin - it works out of the box
  },
  // iOS: allow offline usage and background fetch
  ios: {
    allowsLinkPreview: false,
  },
};

export default config;
