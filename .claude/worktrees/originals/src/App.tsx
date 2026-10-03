import { lazy, Suspense, useState, useEffect } from 'react'
import { Routes, Route, Link, NavLink, Navigate, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { useSettings } from './hooks/useSettings'
import { AuthGuard } from './components/auth/AuthGuard'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ProfileBadge } from './components/ProfileBadge'
import { OfflineIndicator } from './components/offline/OfflineIndicator'
import { ToastContainer } from './components/notifications/Toast'
import { Settings } from './components/Settings'
import { AppLockGuard } from './components/AppLockGuard'
import { ReferralRedeemer } from './components/ReferralRedeemer'
import { NativePushRegistrar } from './components/NativePushRegistrar'
import { CookieConsent } from './components/CookieConsent'
import { useSwipeBack } from './hooks/useSwipeBack'
import { initDeepLinks } from './lib/deeplinks'
import { initPushNotifications } from './lib/pushNotifications'
import { incrementMetric } from './lib/observability'

// Lazy-loaded routes for better code splitting
const Home = lazy(() => import('./pages/Home').then(m => ({ default: m.Home })))
const Sites = lazy(() => import('./pages/Sites').then(m => ({ default: m.Sites })))
const SiteDetail = lazy(() => import('./pages/SiteDetail').then(m => ({ default: m.SiteDetail })))
const Login = lazy(() => import('./pages/Login').then(m => ({ default: m.Login })))
const Landing = lazy(() => import('./pages/Landing').then(m => ({ default: m.Landing })))
const ListView = lazy(() => import('./pages/ListView').then(m => ({ default: m.ListView })))
const JoinList = lazy(() => import('./pages/JoinList').then(m => ({ default: m.JoinList })))
const PublicList = lazy(() => import('./pages/PublicList').then(m => ({ default: m.PublicList })))
const SharedListResource = lazy(() => import('./components/SharedListResource').then(m => ({ default: m.SharedListResource })))
const Profile = lazy(() => import('./pages/Profile').then(m => ({ default: m.Profile })))
const Explorer = lazy(() => import('./pages/Explorer').then(m => ({ default: m.Explorer })))
const Templates = lazy(() => import('./pages/Templates').then(m => ({ default: m.Templates })))
const PriorityFocus = lazy(() => import('./pages/PriorityFocus').then(m => ({ default: m.PriorityFocus })))
const Pricing = lazy(() => import('./pages/Pricing').then(m => ({ default: m.Pricing })))
const InviteLanding = lazy(() => import('./pages/InviteLanding').then(m => ({ default: m.InviteLanding })))
const Privacy = lazy(() => import('./pages/Privacy').then(m => ({ default: m.Privacy })))
const Terms = lazy(() => import('./pages/Terms').then(m => ({ default: m.Terms })))
const Compare = lazy(() => import('./pages/Compare').then(m => ({ default: m.Compare })))
const ApiQuickstart = lazy(() => import('./pages/ApiQuickstart').then(m => ({ default: m.ApiQuickstart })))
const NoteEditor = lazy(() => import('./pages/NoteEditor').then(m => ({ default: m.NoteEditor })))

/**
 * Authenticated layout wrapper with header and navigation.
 * Features dark mode support and improved styling.
 */
function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const { haptic, darkMode, toggleDarkMode } = useSettings();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <div className="min-h-screen-safe flex flex-col bg-stone-50 dark:bg-gray-950 transition-colors">
      {/* Skip to main content link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-amber-500 focus:text-white focus:rounded-lg focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>

      {/* Header */}
      <header className="flex-shrink-0 sticky top-0 z-40 bg-stone-50/90 dark:bg-gray-950/90 backdrop-blur-md border-b border-stone-200 dark:border-gray-800 safe-area-inset-top">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <Link
            to="/d"
            onClick={() => haptic('light')}
            className="boop-wordmark text-[20px] leading-none hover:opacity-80 transition-opacity"
            aria-label="boop — home"
          >
            <span className="boop-dot" aria-hidden="true" />
            <span>boop</span>
          </Link>

          <nav className="flex items-center gap-1 rounded-full bg-stone-100 dark:bg-gray-900 p-1" aria-label="Primary">
            {[
              { to: "/d", label: "Todos" },
              { to: "/e", label: "Explorer" },
              { to: "/s", label: "Sites" },
            ].map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => haptic('light')}
                className={({ isActive }) =>
                  [
                    "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                    isActive
                      ? "bg-white dark:bg-gray-800 text-stone-900 dark:text-stone-100 shadow-sm"
                      : "text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200",
                  ].join(" ")
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          
          <div className="flex items-center gap-2">
            {/* Settings button */}
            <button
              onClick={() => {
                haptic('light');
                setIsSettingsOpen(true);
              }}
              className="p-3 text-stone-400 dark:text-gray-400 hover:text-stone-600 dark:hover:text-gray-200 hover:bg-stone-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
              aria-label="Settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            {/* Dark mode quick toggle */}
            <button
              onClick={() => {
                haptic('light');
                toggleDarkMode();
              }}
              className="p-3 text-stone-400 dark:text-gray-400 hover:text-stone-600 dark:hover:text-gray-200 hover:bg-stone-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {darkMode ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>

            <ProfileBadge />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main id="main-content" className="container mx-auto px-4 py-6 safe-area-inset-bottom flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain" style={{ touchAction: "pan-y pinch-zoom" }}>
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>

      {/* Settings modal */}
      {isSettingsOpen && <Settings onClose={() => setIsSettingsOpen(false)} />}

      {/* Silently redeem any pending referral code after login */}
      <ReferralRedeemer />
      <NativePushRegistrar />
    </div>
  )
}

/**
 * Protected route wrapper combining AuthGuard with authenticated layout.
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <AuthenticatedLayout>{children}</AuthenticatedLayout>
    </AuthGuard>
  )
}

/**
 * Loading fallback for lazy-loaded routes.
 */
function PageLoadingFallback() {
  return (
    <div className="min-h-screen bg-stone-50 dark:bg-gray-950 flex items-center justify-center">
      <div className="text-center">
        <div
          className="mx-auto mb-5 rounded-full"
          style={{
            width: 56,
            height: 56,
            background: 'var(--boop-accent)',
            animation: 'pulse-ring 2s ease-in-out infinite',
          }}
          aria-hidden="true"
        />
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-stone-200 dark:bg-gray-700 rounded w-48 mx-auto"></div>
          <div className="h-3 bg-stone-200 dark:bg-gray-700 rounded w-32 mx-auto"></div>
        </div>
      </div>
    </div>
  )
}

function App() {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Enable swipe-right from left edge to go back (mobile PWA)
  useSwipeBack()

  // Initialize deep links for mobile
  useEffect(() => {
    initDeepLinks(navigate)
  }, [navigate])

  // Initialize push notifications after user is authenticated
  useEffect(() => {
    if (isAuthenticated) {
      initPushNotifications();
    }
  }, [isAuthenticated]);

  // Route-aware client error rate baseline
  useEffect(() => {
    const onError = () => {
      incrementMetric('client_error_total', {
        route: location.pathname,
        errorType: 'window_error',
        env: import.meta.env.MODE,
      })
    }

    const onUnhandledRejection = () => {
      incrementMetric('client_error_total', {
        route: location.pathname,
        errorType: 'unhandled_rejection',
        env: import.meta.env.MODE,
      })
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)

    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [location.pathname])

  useEffect(() => {
    incrementMetric('route_view_total', {
      route: location.pathname,
      env: import.meta.env.MODE,
    })
  }, [location.pathname])

  return (
    <>
      <Suspense fallback={<PageLoadingFallback />}>
        <Routes>
          {/* Static marketing/docs pages — no user data, reachable without app unlock */}
          <Route path="/" element={isAuthenticated ? <Navigate to="/d" replace /> : <Landing />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/compare/:competitor" element={<Compare />} />
          <Route path="/docs/quickstart" element={<ApiQuickstart />} />

          {/* Everything below stays behind the (opt-in) biometric app lock,
              including content-bearing public routes like invites and shared lists.
              The offline indicator and toasts can surface list data (queued-change
              counts, item names), so they live inside the guard too. */}
          <Route
            element={
              <AppLockGuard>
                <OfflineIndicator />
                <Outlet />
                <ToastContainer />
              </AppLockGuard>
            }
          >
            {/* Public routes - accessible without authentication */}
            <Route path="/invite/:code" element={<InviteLanding />} />
            <Route path="/login" element={isAuthenticated ? <Navigate to="/d" replace /> : <Login />} />
            <Route path="/join/:listId/:token" element={<JoinList />} />
            <Route path="/public/:did" element={<PublicList />} />
            <Route path="/:userPath/resources/:resourceId" element={<SharedListResource />} />

            {/* Protected routes - require authentication */}
            <Route path="/d" element={<ProtectedRoute><Home /></ProtectedRoute>} />
            <Route path="/e" element={<ProtectedRoute><Explorer /></ProtectedRoute>} />
            <Route path="/s" element={<ProtectedRoute><Sites /></ProtectedRoute>} />
            <Route path="/s/:siteId" element={<ProtectedRoute><SiteDetail /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="/templates" element={<ProtectedRoute><Templates /></ProtectedRoute>} />
            <Route path="/priority" element={<ProtectedRoute><PriorityFocus /></ProtectedRoute>} />
            <Route path="/list/:id" element={<ProtectedRoute><ListView /></ProtectedRoute>} />
            <Route path="/note/:itemId" element={<ProtectedRoute><NoteEditor /></ProtectedRoute>} />

            {/* Fallback - redirect to app (AuthGuard will handle login redirect if needed) */}
            <Route path="*" element={<ProtectedRoute><Navigate to="/d" replace /></ProtectedRoute>} />
          </Route>
        </Routes>
      </Suspense>
      <CookieConsent />
    </>
  )
}

export default App
