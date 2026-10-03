/**
 * Low-level storage adapter for native and web platforms.
 * 
 * Uses Capacitor Preferences on native platforms and localStorage on web.
 * This provides a unified async interface for both platforms.
 */

import { Capacitor } from '@capacitor/core';

interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
}

class WebStorage implements StorageAdapter {
  async get(key: string) {
    return localStorage.getItem(key);
  }
  
  async set(key: string, value: string) {
    localStorage.setItem(key, value);
  }
  
  async remove(key: string) {
    localStorage.removeItem(key);
  }
  
  async clear() {
    localStorage.clear();
  }
  
  async keys() {
    return Object.keys(localStorage);
  }
}

class NativeStorage implements StorageAdapter {
  private prefs: any = null;
  private initDone: Promise<void> | null = null;
  private fallbackToWeb = false;
  private webStorage = new WebStorage();

  /**
   * Ensure Preferences plugin is loaded. Stores result on this.prefs.
   *
   * NOTE: We intentionally do NOT return the Preferences object from the
   * promise chain. Capacitor plugin proxies intercept all property access
   * (including .then), so returning a plugin from a Promise causes JS to
   * treat it as a thenable — triggering "Preferences.then() is not
   * implemented on ios".
   */
  private ensurePrefs(): Promise<void> {
    if (this.fallbackToWeb) return Promise.resolve();
    if (!this.initDone) {
      this.initDone = import('@capacitor/preferences').then(
        (mod) => {
          this.prefs = mod.Preferences;
        },
        (err) => {
          console.warn('[storageAdapter] Preferences not available, falling back to localStorage', err);
          this.fallbackToWeb = true;
        }
      );
    }
    return this.initDone;
  }

  async get(key: string) {
    await this.ensurePrefs();
    if (!this.prefs) return this.webStorage.get(key);
    const { value } = await this.prefs.get({ key });
    return value;
  }

  async set(key: string, value: string) {
    await this.ensurePrefs();
    if (!this.prefs) return this.webStorage.set(key, value);
    await this.prefs.set({ key, value });
  }

  async remove(key: string) {
    await this.ensurePrefs();
    if (!this.prefs) return this.webStorage.remove(key);
    await this.prefs.remove({ key });
  }

  async clear() {
    await this.ensurePrefs();
    if (!this.prefs) return this.webStorage.clear();
    await this.prefs.clear();
  }

  async keys() {
    await this.ensurePrefs();
    if (!this.prefs) return this.webStorage.keys();
    const { keys } = await this.prefs.keys();
    return keys;
  }
}

export const storageAdapter: StorageAdapter = Capacitor.isNativePlatform()
  ? new NativeStorage()
  : new WebStorage();
