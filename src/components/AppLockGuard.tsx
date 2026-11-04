/**
 * AppLockGuard - Biometric authentication gate for the app.
 * Shows a lock screen and requires Face ID/fingerprint if enabled in settings.
 */

import { useState, useEffect, type ReactNode } from 'react';
import { biometrics } from '../lib/biometrics';
import { getBiometricLockEnabled } from '../lib/storage';
import { Icon } from './ui/Icon';

interface AppLockGuardProps {
  children: ReactNode;
}

export function AppLockGuard({ children }: AppLockGuardProps) {
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsError, setSettingsError] = useState(false);
  const [isLocked, setIsLocked] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [biometricLockEnabled, setBiometricLockEnabled] = useState(false);

  useEffect(() => {
    getBiometricLockEnabled().then((lockEnabled) => {
      setBiometricLockEnabled(lockEnabled);
      setSettingsReady(true);
      if (lockEnabled) {
        // Attempt authentication on mount
        authenticate();
      } else {
        // If lock is not enabled, unlock immediately
        setIsLocked(false);
      }
    }).catch(() => setSettingsError(true));
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

  // Do not mount children (including mutations in effects) before the async
  // preference is known. A read failure must never silently bypass the lock.
  if (!settingsReady) return <div role="status" className="min-h-screen flex items-center justify-center">
    {settingsError ? 'Unable to read app lock settings. Reload to try again.' : 'Checking app lock…'}
  </div>;

  // If lock is not enabled or already unlocked, render children
  if (!biometricLockEnabled || !isLocked) {
    return <>{children}</>;
  }

  // Show lock screen
  return (
    <div className="fixed inset-0 bg-[var(--boop-bg)] flex items-center justify-center z-50">
      <div className="text-center px-6">
        <div className="mb-8">
          <span className="mx-auto flex items-center justify-center w-20 h-20 rounded-full border-[3px] border-[var(--boop-accent)] text-[var(--boop-accent)]">
            <Icon name="lock" className="w-9 h-9" />
          </span>
        </div>
        <h1
          className="text-[var(--boop-ink)] mb-3"
          style={{
            fontFamily: 'var(--font-sans)',
            fontWeight: 800,
            fontSize: 30,
            letterSpacing: -1,
          }}
        >
          boop is locked
        </h1>
        <p className="text-[var(--boop-muted)] mb-8">
          Use Face ID or fingerprint to unlock
        </p>
        <button
          onClick={authenticate}
          disabled={isAuthenticating}
          className="px-8 py-4 bg-[var(--boop-accent)] hover:bg-[var(--boop-accent-deep)] disabled:opacity-60 disabled:cursor-not-allowed text-white dark:text-[var(--boop-bg)] rounded-2xl font-semibold transition-colors text-lg"
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
            'Unlock'
          )}
        </button>
      </div>
    </div>
  );
}
