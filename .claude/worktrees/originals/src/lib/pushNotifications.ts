/**
 * Push notification registration for native (iOS) and web platforms.
 * Uses APNs directly for iOS via Capacitor, Web Push for Android/web.
 * No Firebase dependency.
 */

import { Capacitor } from '@capacitor/core';

/**
 * Initialize push notification listeners (native only).
 * For web, use the useNotifications hook instead.
 * Call registerNativePushToken separately after getting the convex client + userDid.
 */
export async function initPushNotifications() {
  if (!Capacitor.isNativePlatform()) return;

  const { PushNotifications } = await import('@capacitor/push-notifications');

  const permResult = await PushNotifications.requestPermissions();
  if (permResult.receive !== 'granted') {
    console.log('Push notification permission not granted');
    return;
  }

  await PushNotifications.register();

  PushNotifications.addListener('registration', (token) => {
    console.log('Push registration success, token:', token.value);
    // Token will be sent to Convex via registerNativePushToken
    // Store it for later registration
    window.__pooAppAPNsToken = token.value;
  });

  PushNotifications.addListener('registrationError', (error) => {
    console.error('Push registration error:', error);
  });

  PushNotifications.addListener('pushNotificationReceived', (notification) => {
    console.log('Push notification received:', notification);
  });

  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    console.log('Push notification action:', action);
    const data = action.notification.data;
    if (data?.listId) {
      window.location.href = `/list/${data.listId}`;
    }
  });
}

/**
 * Register the native APNs token with Convex.
 * Call after auth is established and convex client is available.
 */
export async function registerNativePushToken(
  convexMutation: (args: { userDid: string; token: string; platform: 'ios' | 'android' | 'web' }) => Promise<unknown>,
  userDid: string
) {
  const token = window.__pooAppAPNsToken;
  if (!token) return;

  await convexMutation({
    userDid,
    token,
    platform: 'ios',
  });
}

export async function getDeliveredNotifications() {
  if (!Capacitor.isNativePlatform()) return [];
  const { PushNotifications } = await import('@capacitor/push-notifications');
  const { notifications } = await PushNotifications.getDeliveredNotifications();
  return notifications;
}

// Extend window for APNs token storage
declare global {
  interface Window {
    __pooAppAPNsToken?: string;
  }
}
