import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import { Capacitor } from '@capacitor/core'
import { AuthProvider } from './hooks/useAuth'
import { ToastProvider } from './hooks/useToast'
import { SettingsProvider } from './hooks/useSettings'
import { registerServiceWorker } from './lib/sw-registration'
import { initDarkMode } from './lib/storage'
import { initNativePlatform, initKeyboardHandling } from './lib/native'
import { initNetworkMonitoring } from './lib/network'
import { initAnalyticsIfConsented } from './lib/analyticsConsent'
import { initSentry } from './lib/sentry'
import './index.css'
import './pages/Landing.css'
import App from './App.tsx'

// Initialize Sentry before anything else (no-op if VITE_SENTRY_DSN is not set)
initSentry();

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string)

// Initialize dark mode early to avoid a flash on load
initDarkMode();

// Initialize native platform features (status bar, keyboard)
initNativePlatform();
initKeyboardHandling();

// Initialize network monitoring for offline support
initNetworkMonitoring();

// Initialize analytics only if user has previously consented
initAnalyticsIfConsented();

// Register service worker for offline support (web only, production only)
if (!Capacitor.isNativePlatform() && import.meta.env.PROD) {
  registerServiceWorker({
    onUpdate: () => {
      console.log('App update available. Refresh to get the latest version.');
    },
    onSuccess: () => {
      console.log('App is ready for offline use.');
    },
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <AuthProvider>
        <ToastProvider>
          <SettingsProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </SettingsProvider>
        </ToastProvider>
      </AuthProvider>
    </ConvexProvider>
  </StrictMode>,
)
