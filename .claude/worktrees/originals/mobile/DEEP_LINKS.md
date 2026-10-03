# Deep Linking Configuration

This document describes the native configuration required for deep linking support in the boop app.

## Overview

The app supports two types of deep links:
- **Custom URL scheme:** `boop://` - Opens the app directly
- **Universal links (iOS) / App Links (Android):** `https://boop.ad/list/*` - Seamless web-to-app transitions

## iOS Configuration

### 1. URL Scheme (`boop://`)

Add the following to `ios/App/App/Info.plist`:

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key>
    <string>ad.boop</string>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>boop</string>
    </array>
  </dict>
</array>
```

### 2. Universal Links (`https://boop.ad/*`)

1. Add Associated Domains capability to `ios/App/App.entitlements`:

```xml
<key>com.apple.developer.associated-domains</key>
<array>
  <string>applinks:boop.ad</string>
</array>
```

2. Host an Apple App Site Association (AASA) file at `https://boop.ad/.well-known/apple-app-site-association`:

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "TEAM_ID.ad.boop.app",
        "paths": ["/list/*", "/join/*", "/public/*"]
      }
    ]
  }
}
```

Replace `TEAM_ID` with your Apple Developer Team ID.

## Android Configuration

### 1. Intent Filters for URL Scheme and App Links

Add the following intent filters to `android/app/src/main/AndroidManifest.xml` inside the `<activity>` tag:

```xml
<!-- Custom URL scheme -->
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="boop" />
</intent-filter>

<!-- App Links (verified) -->
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data
    android:scheme="https"
    android:host="boop.ad"
    android:pathPrefix="/list" />
  <data
    android:scheme="https"
    android:host="boop.ad"
    android:pathPrefix="/join" />
  <data
    android:scheme="https"
    android:host="boop.ad"
    android:pathPrefix="/public" />
</intent-filter>
```

### 2. Digital Asset Links

Host an `assetlinks.json` file at `https://boop.ad/.well-known/assetlinks.json`:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "ad.boop.app",
      "sha256_cert_fingerprints": [
        "CERTIFICATE_FINGERPRINT_HERE"
      ]
    }
  }
]
```

Get your certificate fingerprint by running:
```bash
keytool -list -v -keystore my-release-key.keystore
```

## Applying Changes

These native configurations will be applied when:
1. You regenerate the Capacitor native projects: `npx cap sync`
2. You manually update the native project files

After making changes to native files, rebuild the app:
```bash
npx cap sync
npx cap open ios   # or npx cap open android
# Then build from Xcode or Android Studio
```

## Testing Deep Links

### Custom scheme (`boop://`)
```bash
# iOS Simulator
xcrun simctl openurl booted boop://list/123

# Android
adb shell am start -W -a android.intent.action.VIEW -d "boop://list/123" ad.boop.app
```

### Universal/App Links
```bash
# iOS Simulator
xcrun simctl openurl booted https://boop.ad/list/123

# Android
adb shell am start -W -a android.intent.action.VIEW -d "https://boop.ad/list/123" ad.boop.app
```

## Notes

- Universal Links (iOS) and App Links (Android) require the domain verification files to be hosted at the specified URLs
- The app will gracefully fall back to web browser if the app is not installed
- Deep linking only works on native platforms (iOS/Android), not in web builds
