# Push Notifications Setup Guide

This document outlines the setup requirements for native push notifications in the boop app using Capacitor.

## Overview

The app uses `@capacitor/push-notifications` to handle native push notifications on iOS and Android. The scaffolding has been added, but platform-specific configuration is required for full functionality.

## Code Structure

- **Service**: `src/lib/pushNotifications.ts` - Core push notification logic
- **Initialization**: `src/App.tsx` - Initializes push notifications after user authentication
- **Settings UI**: `src/components/Settings.tsx` - Contains notification toggle (currently web push only)

## iOS Setup (Required)

### 1. Apple Developer Portal Configuration

1. Log in to [Apple Developer Portal](https://developer.apple.com)
2. Navigate to **Certificates, Identifiers & Profiles**
3. Create or update your App ID:
   - Enable **Push Notifications** capability
4. Create an **APNs Key** (preferred) or **APNs Certificate**:
   - **Key**: More flexible, doesn't expire annually
   - **Certificate**: Traditional method, expires yearly
5. Download the key/certificate and keep it secure

### 2. Xcode Configuration

1. Open the iOS project in Xcode:
   ```bash
   npx cap open ios
   ```
2. Select the project in the navigator
3. Go to **Signing & Capabilities**
4. Add **Push Notifications** capability if not present
5. Ensure your provisioning profile includes push notifications

### 3. Backend Integration

You'll need to send the APNs key/certificate to your backend for push delivery. The push token is logged in the `registration` listener in `pushNotifications.ts`.

## Android Setup (Required)

### 1. Firebase Project Setup

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project or select existing one
3. Add an Android app to your Firebase project:
   - **Package name**: Must match your `android/app/build.gradle` `applicationId`
   - Example: `ad.boop.app`
4. Download `google-services.json`

### 2. Add google-services.json

1. Place the downloaded `google-services.json` in:
   ```
   android/app/google-services.json
   ```
2. Verify the file is gitignored (it contains API keys)

### 3. Firebase Cloud Messaging (FCM)

The `@capacitor/push-notifications` plugin handles FCM registration automatically once `google-services.json` is in place.

## Backend Requirements

### Store Push Tokens

When a device registers for push notifications, the token is logged in the console. You need to:

1. Send this token to your Convex backend
2. Store it in the user's record
3. Example Convex mutation:

```typescript
// convex/users.ts
export const storePushToken = mutation({
  args: { token: v.string(), platform: v.union(v.literal('ios'), v.literal('android')) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Not authenticated');
    
    const user = await ctx.db
      .query('users')
      .withIndex('by_did', (q) => q.eq('did', identity.subject))
      .first();
    
    if (!user) throw new Error('User not found');
    
    // Store or update push token
    await ctx.db.patch(user._id, {
      pushToken: args.token,
      pushPlatform: args.platform,
      pushTokenUpdatedAt: Date.now(),
    });
  },
});
```

### Send Push Notifications

Create Convex actions or scheduled functions to send pushes:

**For iOS (APNs):**
- Use `node-apn` or HTTP/2 API
- Requires the APNs key/certificate from Apple Developer Portal

**For Android (FCM):**
- Use `firebase-admin` SDK
- Requires Firebase service account key

Example payload structure:
```json
{
  "notification": {
    "title": "Task Due Soon!",
    "body": "Your task 'Buy groceries' is due in 30 minutes"
  },
  "data": {
    "listId": "123",
    "itemId": "456"
  }
}
```

## Testing

### iOS Simulator Limitations

- **Push notifications DO NOT work in the iOS Simulator**
- You must test on a **physical iOS device**
- Simulator will show permission prompts but won't receive actual pushes

### Android Emulator

- **Push notifications CAN work in Android emulators** (with Play Services)
- Use an emulator with **Google Play Store** installed
- Ensure `google-services.json` is in place

### Testing Commands

**Run on iOS device:**
```bash
npx cap run ios
# Select your connected device (not simulator)
```

**Run on Android emulator:**
```bash
npx cap run android
# Select emulator with Play Services
```

### Test Push Flow

1. Build and deploy the app to a physical device (iOS) or emulator (Android)
2. Log in to the app
3. Check console logs for:
   - Permission request result
   - Registration success with token
4. Copy the token from logs
5. Use Firebase Console (FCM) or your backend to send a test push
6. Verify:
   - Notification appears when app is in background
   - `pushNotificationReceived` listener fires when app is in foreground
   - Tapping notification navigates correctly

## Debugging Tips

### Check Logs

**iOS (Xcode console):**
```bash
npx cap open ios
# Run app and check Xcode console for push logs
```

**Android (logcat):**
```bash
npx cap run android
# Check Android Studio logcat or:
adb logcat | grep -i push
```

### Common Issues

1. **"Push registration error"**: 
   - iOS: Check provisioning profile and APNs capability
   - Android: Verify `google-services.json` is present and package name matches

2. **Notifications not appearing**:
   - Check device notification settings (may be blocked)
   - Verify push token was sent to backend
   - Check backend push sending logs

3. **Permission denied**:
   - iOS: User must accept permission prompt (can only ask once!)
   - Android: Usually auto-granted, but check device settings

## Next Steps

1. ✅ Install `@capacitor/push-notifications` (done)
2. ✅ Create `pushNotifications.ts` service (done)
3. ✅ Initialize in `App.tsx` (done)
4. ⬜ Set up Apple Developer Portal APNs key/certificate
5. ⬜ Configure Firebase project and add `google-services.json`
6. ⬜ Create Convex mutations to store push tokens
7. ⬜ Create Convex actions to send pushes via APNs/FCM
8. ⬜ Test on physical devices/emulators
9. ⬜ Integrate push token storage with auth flow
10. ⬜ Add UI toggle in Settings for enabling/disabling native push (optional)

## References

- [Capacitor Push Notifications Plugin](https://capacitorjs.com/docs/apis/push-notifications)
- [Apple Push Notification Service](https://developer.apple.com/documentation/usernotifications)
- [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging)
- [Convex Actions for External APIs](https://docs.convex.dev/functions/actions)
