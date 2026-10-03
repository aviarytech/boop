/**
 * Push notification utilities for web push API.
 * Handles subscription management and permission requests.
 */

// VAPID public key - this should match the server's public key
// For now, we'll use a placeholder that can be configured via env
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';

/**
 * Check if the browser supports push notifications.
 */
export function supportsPushNotifications(): boolean {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Get the current notification permission state.
 */
export function getNotificationPermission(): NotificationPermission {
  if (!('Notification' in window)) {
    return 'denied';
  }
  return Notification.permission;
}

/**
 * Request notification permission from the user.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    return 'denied';
  }
  return await Notification.requestPermission();
}

/**
 * Convert a base64 string to Uint8Array for VAPID key.
 */
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer as ArrayBuffer;
}

/**
 * Subscribe to push notifications.
 */
export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!supportsPushNotifications()) {
    console.warn('Push notifications not supported');
    return null;
  }

  const permission = await requestNotificationPermission();
  if (permission !== 'granted') {
    console.warn('Notification permission denied');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    
    // Check for existing subscription
    let subscription = await registration.pushManager.getSubscription();
    
    if (!subscription && VAPID_PUBLIC_KEY) {
      // Create new subscription
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    return subscription;
  } catch (error) {
    console.error('Failed to subscribe to push:', error);
    return null;
  }
}

/**
 * Unsubscribe from push notifications.
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    
    if (subscription) {
      await subscription.unsubscribe();
      return true;
    }
    return false;
  } catch (error) {
    console.error('Failed to unsubscribe from push:', error);
    return false;
  }
}

/**
 * Get current push subscription.
 */
export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!supportsPushNotifications()) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Show a local notification (for testing or immediate notifications).
 */
export async function showLocalNotification(
  title: string,
  options?: NotificationOptions
): Promise<void> {
  if (getNotificationPermission() !== 'granted') {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, {
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      ...options,
    });
  } catch (error) {
    console.error('Failed to show notification:', error);
  }
}

/**
 * Schedule a local notification for a due date.
 * This uses the Notification API directly for immediate notifications.
 */
export function scheduleLocalDueNotification(
  itemName: string,
  dueDate: number,
  listId: string,
  itemId: string
): number | null {
  const now = Date.now();
  const timeDiff = dueDate - now;

  // Don't schedule if already past
  if (timeDiff <= 0) {
    return null;
  }

  // Schedule notification
  const timeoutId = window.setTimeout(() => {
    showLocalNotification(`📅 "${itemName}" is due now!`, {
      body: 'Tap to view the item',
      tag: `due-${itemId}`,
      data: {
        url: `/list/${listId}`,
        itemId,
        listId,
      },
      requireInteraction: true,
    });
  }, timeDiff);

  return timeoutId;
}

/**
 * Schedule a reminder notification (e.g., 1 hour before due).
 */
export function scheduleReminderNotification(
  itemName: string,
  dueDate: number,
  listId: string,
  itemId: string,
  reminderMinutes: number = 60
): number | null {
  const now = Date.now();
  const reminderTime = dueDate - reminderMinutes * 60 * 1000;
  const timeDiff = reminderTime - now;

  // Don't schedule if reminder time already past
  if (timeDiff <= 0) {
    return null;
  }

  const timeoutId = window.setTimeout(() => {
    const timeLeft = reminderMinutes >= 60 
      ? `${Math.round(reminderMinutes / 60)} hour${reminderMinutes >= 120 ? 's' : ''}`
      : `${reminderMinutes} minutes`;
    
    showLocalNotification(`⏰ Reminder: "${itemName}"`, {
      body: `Due in ${timeLeft}`,
      tag: `reminder-${itemId}`,
      data: {
        url: `/list/${listId}`,
        itemId,
        listId,
      },
    });
  }, timeDiff);

  return timeoutId;
}
