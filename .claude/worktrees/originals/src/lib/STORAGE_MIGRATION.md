# Storage Migration Guide

## Overview

This codebase now includes a native storage abstraction layer (`storageAdapter.ts`) that provides a unified interface for both web and native platforms:

- **Web**: Uses `localStorage` (synchronous)
- **Native (iOS/Android)**: Uses Capacitor Preferences (async, secure native storage)

## Current State

Most of the codebase still uses `localStorage` directly with synchronous APIs. This works fine on web but doesn't leverage native platform capabilities on mobile.

## Migration Path

### Files Marked for Migration

The following files have `TODO` comments indicating they should be migrated to use the async storage adapter:

1. **`src/lib/storage.ts`** - Settings storage functions
   - `getDarkMode()`, `setDarkMode()`
   - `getListSort()`, `setListSort()`
   - `getHapticsEnabled()`, `setHapticsEnabled()`
   - All other settings functions

2. **`src/hooks/useAuth.tsx`** - Authentication state
   - JWT token storage (`JWT_STORAGE_KEY`)
   - Auth state persistence (`AUTH_STORAGE_KEY`)

3. **`src/lib/webvh.ts`** - DID key storage
   - Private key storage for WebVH DIDs

### How to Migrate

#### Step 1: Update Function Signatures

Change synchronous functions to async:

```ts
// Before
export function getDarkMode(): boolean {
  const stored = localStorage.getItem(STORAGE_KEYS.DARK_MODE);
  return stored === 'true';
}

// After
export async function getDarkMode(): Promise<boolean> {
  const stored = await storageAdapter.get(STORAGE_KEYS.DARK_MODE);
  return stored === 'true';
}
```

#### Step 2: Update Callers

Update all code that calls the migrated functions:

```ts
// Before
const darkMode = getDarkMode();

// After
const darkMode = await getDarkMode();
```

For React hooks, use async effects:

```ts
// Before
const [darkMode, setDarkMode] = useState(() => getDarkMode());

// After
const [darkMode, setDarkMode] = useState<boolean | null>(null);

useEffect(() => {
  getDarkMode().then(setDarkMode);
}, []);
```

#### Step 3: Test on Both Platforms

- **Web**: Test in browser (localStorage should still work via WebStorage adapter)
- **Native**: Test on iOS/Android (should use Capacitor Preferences)

## Benefits of Migration

1. **Better Security**: Native platforms can use secure storage (encrypted, OS-managed)
2. **Platform Consistency**: Same API works across web and native
3. **Future-Proof**: Ready for additional platforms (e.g., Electron, native desktop)
4. **Better Privacy**: Native storage respects OS-level privacy controls

## Using the Storage Adapter

### Low-Level API

For new code, use the storage adapter directly:

```ts
import { storageAdapter } from '../lib/storageAdapter';

// Get value
const value = await storageAdapter.get('myKey');

// Set value
await storageAdapter.set('myKey', 'myValue');

// Remove value
await storageAdapter.remove('myKey');

// Clear all
await storageAdapter.clear();

// Get all keys
const keys = await storageAdapter.keys();
```

### Type-Safe Wrappers

For complex data, create type-safe wrappers:

```ts
interface UserPreferences {
  theme: 'light' | 'dark';
  language: string;
}

async function getUserPreferences(): Promise<UserPreferences> {
  const json = await storageAdapter.get('user-preferences');
  return json ? JSON.parse(json) : { theme: 'light', language: 'en' };
}

async function setUserPreferences(prefs: UserPreferences): Promise<void> {
  await storageAdapter.set('user-preferences', JSON.stringify(prefs));
}
```

## Migration Priority

Suggested order for migration:

1. **Settings** (`storage.ts`) - Most impactful, easiest to migrate
2. **WebVH Keys** (`webvh.ts`) - Security-critical, should use native secure storage
3. **Auth State** (`useAuth.tsx`) - Complex, requires careful testing

## Notes

- The storage adapter lazy-loads `@capacitor/preferences` on native platforms to avoid bundling it unnecessarily on web
- All values are stored as strings; use `JSON.stringify`/`JSON.parse` for objects
- The adapter automatically detects platform using `Capacitor.isNativePlatform()`
