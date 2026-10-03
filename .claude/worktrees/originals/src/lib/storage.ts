/**
 * Local storage utilities for app settings.
 *
 * All functions use the async storageAdapter, which uses Capacitor Preferences
 * on native platforms and localStorage on web. This ensures native offline
 * support works correctly.
 *
 * Exception: initDarkMode() stays synchronous — it must run before first render
 * to prevent a flash of unstyled content on web.
 */

import { storageAdapter } from './storageAdapter';

const STORAGE_KEYS = {
  DARK_MODE: 'boop:darkMode',
  LIST_SORT: 'boop:listSort',
  HAPTICS_ENABLED: 'boop:hapticsEnabled',
  ONBOARDING_COMPLETE: 'boop:onboardingComplete',
  NOTIFICATIONS_ENABLED: 'boop:notificationsEnabled',
  REMINDER_MINUTES: 'boop:reminderMinutes',
  BIOMETRIC_LOCK_ENABLED: 'boop:biometricLockEnabled',
} as const;

export type SortOption = 'name-asc' | 'name-desc' | 'newest' | 'oldest';

/**
 * Initialize dark mode from storage synchronously.
 * Must be called before first render to avoid FOUC.
 * Reads localStorage directly — storageAdapter is async and would yield too late.
 */
export function initDarkMode(): void {
  if (typeof window === 'undefined') return;
  const stored = localStorage.getItem(STORAGE_KEYS.DARK_MODE);
  const isDark =
    stored !== null
      ? stored === 'true'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (isDark) {
    document.documentElement.classList.add('dark');
  }
}

export async function getDarkMode(): Promise<boolean> {
  const stored = await storageAdapter.get(STORAGE_KEYS.DARK_MODE);
  if (stored !== null) return stored === 'true';
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export async function setDarkMode(enabled: boolean): Promise<void> {
  await storageAdapter.set(STORAGE_KEYS.DARK_MODE, String(enabled));
  if (enabled) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

export async function getListSort(): Promise<SortOption> {
  const stored = await storageAdapter.get(STORAGE_KEYS.LIST_SORT);
  return (stored as SortOption) || 'newest';
}

export async function setListSort(sort: SortOption): Promise<void> {
  await storageAdapter.set(STORAGE_KEYS.LIST_SORT, sort);
}

export async function getHapticsEnabled(): Promise<boolean> {
  const stored = await storageAdapter.get(STORAGE_KEYS.HAPTICS_ENABLED);
  return stored !== 'false'; // Default to enabled
}

export async function setHapticsEnabled(enabled: boolean): Promise<void> {
  await storageAdapter.set(STORAGE_KEYS.HAPTICS_ENABLED, String(enabled));
}

export async function isOnboardingComplete(): Promise<boolean> {
  const stored = await storageAdapter.get(STORAGE_KEYS.ONBOARDING_COMPLETE);
  return stored === 'true';
}

export async function completeOnboarding(): Promise<void> {
  await storageAdapter.set(STORAGE_KEYS.ONBOARDING_COMPLETE, 'true');
}

export async function getNotificationsEnabled(): Promise<boolean> {
  const stored = await storageAdapter.get(STORAGE_KEYS.NOTIFICATIONS_ENABLED);
  return stored === 'true';
}

export async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  await storageAdapter.set(STORAGE_KEYS.NOTIFICATIONS_ENABLED, String(enabled));
}

export async function getReminderMinutes(): Promise<number> {
  const stored = await storageAdapter.get(STORAGE_KEYS.REMINDER_MINUTES);
  return stored ? parseInt(stored, 10) : 60;
}

export async function setReminderMinutes(minutes: number): Promise<void> {
  await storageAdapter.set(STORAGE_KEYS.REMINDER_MINUTES, String(minutes));
}

export async function getBiometricLockEnabled(): Promise<boolean> {
  const stored = await storageAdapter.get(STORAGE_KEYS.BIOMETRIC_LOCK_ENABLED);
  return stored === 'true';
}

export async function setBiometricLockEnabled(enabled: boolean): Promise<void> {
  await storageAdapter.set(STORAGE_KEYS.BIOMETRIC_LOCK_ENABLED, String(enabled));
}
