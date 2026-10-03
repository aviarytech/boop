/**
 * AppLockGuard - Biometric authentication gate for the app.
 * Shows a lock screen and requires Face ID/fingerprint if enabled in settings.
 */

import { useState, useEffect, type ReactNode } from 'react';
import { biometrics } from '../lib/biometrics';
import { getBiometricLockEnabled } from '../lib/storage';

interface AppLockGuardProps {
  children: ReactNode;
}

export function AppLockGuard({ children }: AppLockGuardProps) {
  const [isLocked, setIsLocked] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [biometricLockEnabled, setBiometricLockEnabled] = useState(false);

  useEffect(() => {
    getBiometricLockEnabled().then((lockEnabled) => {
      setBiometricLockEnabled(lockEnabled);
      if (lockEnabled) {
        // Attempt authentication on mount
        authenticate();
      } else {
        // If lock is not enabled, unlock immediately
        setIsLocked(false);
      }
    });
  }, []);

  const authenticate = async () => {
    setIsAuthenticating(true);
    try {
      const success = await biometrics.authenticate('Unlock boop');
      if (success) {
        setIsLocked(false);
      }
    } catch (error) {
      console.error('Biometric authentication error:', error);
    } finally {
      setIsAuthenticating(false);
    }
  };

  // If lock is not enabled or already unlocked, render children
  if (!biometricLockEnabled || !isLocked) {
    return <>{children}</>;
  }

  // Show lock screen
  return (
    <div className="fixed inset-0 bg-amber-100 dark:bg-gray-900 flex items-center justify-center z-50">
      <div className="text-center px-6">
        <div className="mb-8">
          <span className="text-8xl">🔒</span>
        </div>
        <h1
          className="text-gray-900 dark:text-gray-100 mb-3"
          style={{
            fontFamily: 'Nunito, system-ui, sans-serif',
            fontWeight: 800,
            fontSize: 30,
            letterSpacing: -1,
          }}
        >
          boop is locked
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-8">
          Use Face ID or fingerprint to unlock
        </p>
        <button
          onClick={authenticate}
          disabled={isAuthenticating}
          className="px-8 py-4 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-2xl font-semibold transition-colors text-lg shadow-lg"
        >
          {isAuthenticating ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Authenticating...
            </span>
          ) : (
            '🔓 Unlock'
          )}
        </button>
      </div>
    </div>
  );
}
