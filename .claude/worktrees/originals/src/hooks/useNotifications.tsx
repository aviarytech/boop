/**
 * Hook for managing push notifications.
 * Handles permission requests, subscription management, and local notification scheduling.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import {
  supportsPushNotifications,
  getNotificationPermission,
  requestNotificationPermission,
  subscribeToPush,
  unsubscribeFromPush,
  getCurrentSubscription,
  scheduleLocalDueNotification,
  scheduleReminderNotification,
} from '../lib/notifications';
import {
  getNotificationsEnabled,
  setNotificationsEnabled as storeNotificationsEnabled,
  getReminderMinutes,
  setReminderMinutes as storeReminderMinutes,
} from '../lib/storage';
import type { Doc } from '../../convex/_generated/dataModel';

interface UseNotificationsOptions {
  userDid: string | null;
}

interface ScheduledNotification {
  itemId: string;
  dueTimeoutId: number | null;
  reminderTimeoutId: number | null;
}

export function useNotifications({ userDid }: UseNotificationsOptions) {
  const [isSupported] = useState(() => supportsPushNotifications());
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    getNotificationPermission()
  );
  const [isEnabled, setIsEnabled] = useState(false);
  const [reminderMinutes, setReminderMinutesState] = useState(60);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Track scheduled notifications
  const scheduledNotifications = useRef<Map<string, ScheduledNotification>>(new Map());

  // Load persisted notification settings from async storage on mount.
  useEffect(() => {
    getNotificationsEnabled().then(setIsEnabled);
    getReminderMinutes().then(setReminderMinutesState);
  }, []);

  // Convex mutations for subscription management
  const saveSubscription = useMutation(api.notifications.saveSubscription);
  const removeSubscription = useMutation(api.notifications.removeSubscription);
  const registerPushToken = useMutation(api.notifications.registerPushToken);
  const unregisterPushToken = useMutation(api.notifications.unregisterPushToken);

  // Check if user has server-side subscription
  const hasServerSubscription = useQuery(
    api.notifications.hasSubscription,
    userDid ? { userDid } : 'skip'
  );

  // Check current subscription status on mount
  useEffect(() => {
    async function checkSubscription() {
      const subscription = await getCurrentSubscription();
      setIsSubscribed(!!subscription);
    }
    if (isSupported) {
      checkSubscription();
    }
  }, [isSupported]);

  /**
   * Enable notifications - request permission and subscribe.
   */
  const enableNotifications = useCallback(async () => {
    if (!isSupported || !userDid) return false;

    setIsLoading(true);
    try {
      // Request permission
      const perm = await requestNotificationPermission();
      setPermission(perm);

      if (perm !== 'granted') {
        setIsLoading(false);
        return false;
      }

      // Subscribe to push
      const subscription = await subscribeToPush();

      if (subscription) {
        // Save to Convex (both legacy and new pushTokens table)
        const json = subscription.toJSON();
        await saveSubscription({
          userDid,
          endpoint: json.endpoint!,
          keys: {
            p256dh: json.keys!.p256dh,
            auth: json.keys!.auth,
          },
        });
        await registerPushToken({
          userDid,
          token: json.endpoint!,
          platform: 'web',
          webPushKeys: {
            p256dh: json.keys!.p256dh,
            auth: json.keys!.auth,
          },
        });

        setIsSubscribed(true);
        setIsEnabled(true);
        storeNotificationsEnabled(true);
        setIsLoading(false);
        return true;
      }

      // Even without server push, enable local notifications
      setIsEnabled(true);
      storeNotificationsEnabled(true);
      setIsLoading(false);
      return true;
    } catch (error) {
      console.error('Failed to enable notifications:', error);
      setIsLoading(false);
      return false;
    }
  }, [isSupported, userDid, saveSubscription]);

  /**
   * Disable notifications - unsubscribe and clean up.
   */
  const disableNotifications = useCallback(async () => {
    setIsLoading(true);
    try {
      // Unsubscribe from push
      const subscription = await getCurrentSubscription();
      if (subscription && userDid) {
        await unsubscribeFromPush();
        await removeSubscription({
          endpoint: subscription.endpoint,
          userDid,
        });
        await unregisterPushToken({
          token: subscription.endpoint,
          userDid,
        });
      }

      // Clear scheduled notifications
      scheduledNotifications.current.forEach((scheduled) => {
        if (scheduled.dueTimeoutId) clearTimeout(scheduled.dueTimeoutId);
        if (scheduled.reminderTimeoutId) clearTimeout(scheduled.reminderTimeoutId);
      });
      scheduledNotifications.current.clear();

      setIsSubscribed(false);
      setIsEnabled(false);
      storeNotificationsEnabled(false);
      setIsLoading(false);
      return true;
    } catch (error) {
      console.error('Failed to disable notifications:', error);
      setIsLoading(false);
      return false;
    }
  }, [userDid, removeSubscription]);

  /**
   * Toggle notifications on/off.
   */
  const toggleNotifications = useCallback(async () => {
    if (isEnabled) {
      return disableNotifications();
    } else {
      return enableNotifications();
    }
  }, [isEnabled, enableNotifications, disableNotifications]);

  /**
   * Set reminder time.
   */
  const setReminderMinutes = useCallback((minutes: number) => {
    setReminderMinutesState(minutes);
    storeReminderMinutes(minutes);
  }, []);

  /**
   * Schedule notification for an item with a due date.
   */
  const scheduleItemNotification = useCallback(
    (item: Doc<'items'>) => {
      if (!isEnabled || permission !== 'granted' || !item.dueDate || item.checked) {
        return;
      }

      const itemId = item._id;

      // Clear existing notifications for this item
      const existing = scheduledNotifications.current.get(itemId);
      if (existing) {
        if (existing.dueTimeoutId) clearTimeout(existing.dueTimeoutId);
        if (existing.reminderTimeoutId) clearTimeout(existing.reminderTimeoutId);
      }

      // Schedule due notification
      const dueTimeoutId = scheduleLocalDueNotification(
        item.name,
        item.dueDate,
        item.listId,
        itemId
      );

      // Schedule reminder notification
      const reminderTimeoutId = scheduleReminderNotification(
        item.name,
        item.dueDate,
        item.listId,
        itemId,
        reminderMinutes
      );

      scheduledNotifications.current.set(itemId, {
        itemId,
        dueTimeoutId,
        reminderTimeoutId,
      });
    },
    [isEnabled, permission, reminderMinutes]
  );

  /**
   * Cancel notification for an item.
   */
  const cancelItemNotification = useCallback((itemId: string) => {
    const scheduled = scheduledNotifications.current.get(itemId);
    if (scheduled) {
      if (scheduled.dueTimeoutId) clearTimeout(scheduled.dueTimeoutId);
      if (scheduled.reminderTimeoutId) clearTimeout(scheduled.reminderTimeoutId);
      scheduledNotifications.current.delete(itemId);
    }
  }, []);

  /**
   * Schedule notifications for multiple items.
   */
  const scheduleItemsNotifications = useCallback(
    (items: Doc<'items'>[]) => {
      if (!isEnabled || permission !== 'granted') return;

      items.forEach((item) => {
        if (item.dueDate && !item.checked) {
          scheduleItemNotification(item);
        }
      });
    },
    [isEnabled, permission, scheduleItemNotification]
  );

  return {
    // State
    isSupported,
    permission,
    isEnabled,
    isSubscribed,
    isLoading,
    reminderMinutes,
    hasServerSubscription,

    // Actions
    enableNotifications,
    disableNotifications,
    toggleNotifications,
    setReminderMinutes,
    scheduleItemNotification,
    cancelItemNotification,
    scheduleItemsNotifications,
  };
}
