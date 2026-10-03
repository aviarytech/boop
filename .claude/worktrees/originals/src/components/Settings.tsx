/**
 * Settings panel component.
 * Uses Panel for slide-up drawer experience.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useSettings } from '../hooks/useSettings';
import { useNotifications } from '../hooks/useNotifications';
import { useAuth } from '../hooks/useAuth';
import { ReferralInviteCurrentUser } from './ReferralInvite';
import { supportsHaptics } from '../lib/haptics';
import { supportsPushNotifications } from '../lib/notifications';
import { biometrics } from '../lib/biometrics';
import { checkForUpdateAndApply, clearAllCachesAndReload } from '../lib/sw-registration';
import { Panel } from './ui/Panel';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { useToast } from '../hooks/useToast';

interface SettingsProps {
  onClose: () => void;
}

export function Settings({ onClose }: SettingsProps) {
  const { darkMode, toggleDarkMode, hapticsEnabled, setHapticsEnabled, biometricLockEnabled, setBiometricLockEnabled, haptic } = useSettings();
  const { user, logout } = useAuth();
  const { addToast } = useToast();
  const {
    permission: notificationPermission,
    isEnabled: notificationsEnabled,
    isLoading: notificationsLoading,
    reminderMinutes,
    toggleNotifications,
    setReminderMinutes,
  } = useNotifications({ userDid: user?.did ?? null });

  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackBody, setFeedbackBody] = useState('');
  const [feedbackCategory, setFeedbackCategory] = useState<'bug' | 'feature' | 'praise' | 'confusion' | 'churn_risk'>('feature');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);

  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'updating' | 'current'>('idle');

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const convexUser = useQuery(
    api.auth.getUserByTurnkeyId,
    user?.turnkeySubOrgId ? { turnkeySubOrgId: user.turnkeySubOrgId } : 'skip'
  );
  const submitFeedback = useMutation(api.feedback.submit);
  const deleteUserData = useMutation(api.users.deleteUserData);

  useEffect(() => {
    biometrics.isAvailable().then(setBiometricsAvailable);
  }, []);

  const handleFeedbackSubmit = async () => {
    if (!feedbackBody.trim() || !convexUser?._id) return;
    setFeedbackSubmitting(true);
    try {
      await submitFeedback({ userId: convexUser._id, body: feedbackBody.trim(), category: feedbackCategory });
      addToast("Thanks, we'll read this today.", 'info');
      setFeedbackBody('');
      setFeedbackCategory('feature');
      setFeedbackOpen(false);
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!convexUser?._id) return;
    setDeleteSubmitting(true);
    try {
      await deleteUserData({ userId: convexUser._id });
      await logout();
    } catch {
      addToast('Failed to delete account. Please try again.', 'error');
      setDeleteSubmitting(false);
    }
  };

  const handleCheckForUpdate = async () => {
    haptic('light');
    setUpdateChecking(true);
    setUpdateStatus('checking');
    try {
      const found = await checkForUpdateAndApply();
      if (found) {
        setUpdateStatus('updating');
        // The controllerchange listener in sw-registration will reload the page
      } else {
        setUpdateStatus('current');
        setTimeout(() => setUpdateStatus('idle'), 3000);
      }
    } catch {
      setUpdateStatus('idle');
    } finally {
      setUpdateChecking(false);
    }
  };

  const handleForceRefresh = async () => {
    haptic('medium');
    setUpdateStatus('updating');
    await clearAllCachesAndReload();
  };

  const handleToggle = (current: boolean, setter: (v: boolean) => void) => {
    haptic('light');
    setter(!current);
  };

  const header = (
    <>
      <h2 id="settings-title" className="text-xl font-bold text-gray-900 dark:text-gray-100">
        ⚙️ Settings
      </h2>
      <button
        onClick={onClose}
        className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        aria-label="Close settings"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </>
  );

  const footer = (
    <div className="p-4 bg-gray-50 dark:bg-gray-900/50">
      <button
        onClick={onClose}
        className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold transition-colors"
      >
        Done
      </button>
    </div>
  );

  return (
    <>
    {feedbackOpen && (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={() => setFeedbackOpen(false)}>
        <div
          className="w-full sm:max-w-md bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl p-6 space-y-4"
          onClick={e => e.stopPropagation()}
        >
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Send Feedback</h3>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
            <select
              value={feedbackCategory}
              onChange={e => setFeedbackCategory(e.target.value as typeof feedbackCategory)}
              className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg border-0 focus:ring-2 focus:ring-amber-500"
            >
              <option value="bug">Bug Report</option>
              <option value="feature">Feature Request</option>
              <option value="praise">Praise</option>
              <option value="confusion">Confusion / UX issue</option>
              <option value="churn_risk">Thinking of leaving</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Your feedback</label>
            <textarea
              value={feedbackBody}
              onChange={e => setFeedbackBody(e.target.value)}
              placeholder="Tell us anything..."
              rows={4}
              className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg border-0 focus:ring-2 focus:ring-amber-500 resize-none"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setFeedbackOpen(false)}
              className="flex-1 py-2 rounded-xl border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleFeedbackSubmit}
              disabled={!feedbackBody.trim() || feedbackSubmitting}
              className="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {feedbackSubmitting ? 'Sending…' : 'Submit'}
            </button>
          </div>
        </div>
      </div>
    )}
    {deleteConfirmOpen && (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={() => { if (!deleteSubmitting) setDeleteConfirmOpen(false); }}>
        <div
          className="w-full sm:max-w-md bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl p-6 space-y-4"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl leading-none">⚠️</span>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Delete my data</h3>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            This permanently deletes your account, all lists, items, and personal data. This cannot be undone.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Type <span className="font-mono font-bold">delete</span> to confirm
            </label>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              placeholder="delete"
              autoCapitalize="none"
              className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg border-0 focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => { setDeleteConfirmOpen(false); setDeleteConfirmText(''); }}
              disabled={deleteSubmitting}
              className="flex-1 py-2 rounded-xl border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleDeleteAccount}
              disabled={deleteConfirmText !== 'delete' || deleteSubmitting}
              className="flex-1 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {deleteSubmitting ? 'Deleting…' : 'Delete everything'}
            </button>
          </div>
        </div>
      </div>
    )}
    <Panel
      isOpen={true}
      onClose={onClose}
      header={header}
      footer={footer}
      ariaLabelledBy="settings-title"
    >
      {/* Settings List */}
      <div className="p-6 space-y-6">
        {/* Appearance Section */}
        <section>
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
            Appearance
          </h3>
          
          {/* Dark Mode Toggle */}
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl leading-none">{darkMode ? '🌙' : '☀️'}</span>
              <div>
                <p className="font-medium text-gray-900 dark:text-gray-100">Dark Mode</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {darkMode ? 'Currently in dark mode' : 'Currently in light mode'}
                </p>
              </div>
            </div>
            <button
              onClick={() => handleToggle(darkMode, toggleDarkMode)}
              className={`relative w-14 h-8 rounded-full transition-colors ${
                darkMode ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600'
              }`}
              role="switch"
              aria-checked={darkMode}
              aria-label="Toggle dark mode"
            >
              <div
                className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow-md transition-transform ${
                  darkMode ? 'translate-x-7' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </section>

        {/* Accessibility Section */}
        {supportsHaptics() && (
          <section>
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
              Accessibility
            </h3>
            
            {/* Haptic Feedback Toggle */}
            <div className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl leading-none">📳</span>
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100">Haptic Feedback</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Vibrate on interactions
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleToggle(hapticsEnabled, setHapticsEnabled)}
                className={`relative w-14 h-8 rounded-full transition-colors ${
                  hapticsEnabled ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600'
                }`}
                role="switch"
                aria-checked={hapticsEnabled}
                aria-label="Toggle haptic feedback"
              >
                <div
                  className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow-md transition-transform ${
                    hapticsEnabled ? 'translate-x-7' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </section>
        )}

        {/* Security Section */}
        {biometricsAvailable && (
          <section>
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
              Security
            </h3>
            
            {/* Biometric Lock Toggle */}
            <div className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl leading-none">🔒</span>
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100">App Lock</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Require Face ID / fingerprint on launch
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleToggle(biometricLockEnabled, setBiometricLockEnabled)}
                className={`relative w-14 h-8 rounded-full transition-colors ${
                  biometricLockEnabled ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600'
                }`}
                role="switch"
                aria-checked={biometricLockEnabled}
                aria-label="Toggle app lock"
              >
                <div
                  className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow-md transition-transform ${
                    biometricLockEnabled ? 'translate-x-7' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </section>
        )}

        {/* Notifications Section */}
        {supportsPushNotifications() && (
          <section>
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
              Notifications
            </h3>
            
            {/* TODO: Native mobile push notifications (Capacitor) are initialized in App.tsx
                 This toggle currently handles web push notifications only.
                 Consider adding a separate toggle or combining status for native push. */}
            
            {/* Push Notifications Toggle */}
            <div className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl leading-none">🔔</span>
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100">Push Notifications</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {notificationPermission === 'denied' 
                      ? 'Blocked in browser settings'
                      : notificationsEnabled 
                        ? 'Get notified when items are due' 
                        : 'Enable notifications for due dates'}
                  </p>
                </div>
              </div>
              <button
                onClick={async () => {
                  haptic('light');
                  await toggleNotifications();
                }}
                disabled={notificationsLoading || notificationPermission === 'denied'}
                className={`relative w-14 h-8 rounded-full transition-colors ${
                  notificationsEnabled ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600'
                } ${notificationsLoading || notificationPermission === 'denied' ? 'opacity-50 cursor-not-allowed' : ''}`}
                role="switch"
                aria-checked={notificationsEnabled}
                aria-label="Toggle push notifications"
              >
                <div
                  className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow-md transition-transform ${
                    notificationsEnabled ? 'translate-x-7' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Reminder Time */}
            {notificationsEnabled && (
              <div className="py-3">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl leading-none">⏰</span>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100">Reminder Time</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      How early to remind you before due date
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 ml-11">
                  {[
                    { value: 15, label: '15m' },
                    { value: 30, label: '30m' },
                    { value: 60, label: '1h' },
                    { value: 120, label: '2h' },
                    { value: 1440, label: '1d' },
                  ].map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => {
                        haptic('light');
                        setReminderMinutes(value);
                      }}
                      className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                        reminderMinutes === value
                          ? 'bg-amber-500 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Invite Friends Section */}
        <section>
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
            Invite Friends
          </h3>
          <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
            <ReferralInviteCurrentUser />
          </div>
        </section>

        {/* Account Section */}
        <section>
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
            Account
          </h3>
          
          <Link
            to="/profile"
            onClick={() => {
              haptic('light');
              onClose();
            }}
            className="flex items-center justify-between py-3 px-4 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-xl transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl leading-none">👤</span>
              <div>
                <p className="font-medium text-gray-900 dark:text-gray-100">Your Profile</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  View stats and account details
                </p>
              </div>
            </div>
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </section>

        {/* Feedback Section */}
        <section>
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
            Feedback
          </h3>
          <button
            onClick={() => { haptic('light'); setFeedbackOpen(true); }}
            className="flex items-center justify-between w-full py-3 px-4 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-xl transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl leading-none">💬</span>
              <div className="text-left">
                <p className="font-medium text-gray-900 dark:text-gray-100">Send Feedback</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">We read every message</p>
              </div>
            </div>
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </section>

        {/* Privacy & Data Section */}
        <section>
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
            Privacy & Data
          </h3>
          <div className="space-y-2">
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between py-3 px-4 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-xl transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl leading-none">📄</span>
                <p className="font-medium text-gray-900 dark:text-gray-100">Privacy Policy</p>
              </div>
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
            <button
              onClick={() => { haptic('light'); setDeleteConfirmOpen(true); setDeleteConfirmText(''); }}
              className="flex items-center justify-between w-full py-3 px-4 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl leading-none">🗑️</span>
                <div className="text-left">
                  <p className="font-medium text-red-700 dark:text-red-400">Delete my data</p>
                  <p className="text-sm text-red-500 dark:text-red-500">Permanently erase all your data</p>
                </div>
              </div>
            </button>
          </div>
        </section>

        {/* App Updates Section */}
        {'serviceWorker' in navigator && (
          <section>
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
              App Updates
            </h3>
            <div className="space-y-2">
              <button
                onClick={handleCheckForUpdate}
                disabled={updateChecking || updateStatus === 'updating'}
                className="flex items-center justify-between w-full py-3 px-4 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-xl transition-colors disabled:opacity-50"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl leading-none">
                    {updateStatus === 'current' ? '✅' : '🔄'}
                  </span>
                  <div className="text-left">
                    <p className="font-medium text-gray-900 dark:text-gray-100">Check for Updates</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {updateStatus === 'checking' && 'Checking...'}
                      {updateStatus === 'updating' && 'Updating, please wait...'}
                      {updateStatus === 'current' && 'You\'re on the latest version'}
                      {updateStatus === 'idle' && 'Tap to check for a new version'}
                    </p>
                  </div>
                </div>
              </button>
              <button
                onClick={handleForceRefresh}
                disabled={updateStatus === 'updating'}
                className="flex items-center justify-between w-full py-3 px-4 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-xl transition-colors disabled:opacity-50"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl leading-none">🧹</span>
                  <div className="text-left">
                    <p className="font-medium text-gray-900 dark:text-gray-100">Force Refresh</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Clear cache and reload the app</p>
                  </div>
                </div>
              </button>
            </div>
          </section>
        )}

        {/* About Section */}
        <section>
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
            About
          </h3>
          
          <div className="bg-stone-50 dark:bg-gray-700 rounded-xl p-4 border border-stone-200/70 dark:border-transparent">
            <div className="flex items-center gap-3 mb-3">
              <div className="boop-wordmark text-[22px] leading-none">
                <span className="boop-dot" aria-hidden="true" />
                <span>boop</span>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 ml-auto">v1.0.0</p>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              A calm place for the things you need to do. Powered by Originals Protocol.
            </p>
          </div>
        </section>
      </div>
    </Panel>
    </>
  );
}
