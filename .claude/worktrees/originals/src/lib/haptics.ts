/**
 * Haptic feedback utilities using Capacitor Haptics plugin.
 * Uses native haptic engine (Taptic Engine on iOS, vibration on Android).
 * Falls back gracefully on web where navigator.vibrate is available,
 * and silently no-ops on unsupported platforms.
 */

import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';

type HapticPattern = 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'warning' | 'selection';

const isNative = Capacitor.isNativePlatform();

// Web fallback patterns (vibration duration in ms)
const webPatterns: Record<HapticPattern, number | number[]> = {
  light: 10,
  medium: 25,
  heavy: 50,
  selection: 5,
  success: [10, 50, 10],
  error: [50, 30, 50, 30, 50],
  warning: [30, 50, 30],
};

/**
 * Trigger haptic feedback.
 * On native platforms, uses the Capacitor Haptics plugin for true haptic engine feedback.
 * On web, falls back to navigator.vibrate().
 */
export function haptic(pattern: HapticPattern = 'light'): void {
  try {
    if (isNative) {
      // Use native Capacitor Haptics
      switch (pattern) {
        case 'light':
          Haptics.impact({ style: ImpactStyle.Light });
          break;
        case 'medium':
          Haptics.impact({ style: ImpactStyle.Medium });
          break;
        case 'heavy':
          Haptics.impact({ style: ImpactStyle.Heavy });
          break;
        case 'selection':
          Haptics.selectionStart();
          Haptics.selectionChanged();
          Haptics.selectionEnd();
          break;
        case 'success':
          Haptics.notification({ type: NotificationType.Success });
          break;
        case 'error':
          Haptics.notification({ type: NotificationType.Error });
          break;
        case 'warning':
          Haptics.notification({ type: NotificationType.Warning });
          break;
      }
    } else {
      // Web fallback using Vibration API
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(webPatterns[pattern]);
      }
    }
  } catch {
    // Ignore errors - haptics are non-essential
  }
}

/**
 * Check if haptic feedback is available.
 */
export function supportsHaptics(): boolean {
  if (isNative) return true;
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}
