import { Capacitor } from '@capacitor/core';

interface BiometricService {
  isAvailable(): Promise<boolean>;
  authenticate(reason?: string): Promise<boolean>;
}

class NativeBiometric implements BiometricService {
  private plugin: any = null;
  
  private async getPlugin() {
    if (!this.plugin) {
      // Try to import whichever plugin was installed
      try {
        const mod = await import('capacitor-native-biometric');
        this.plugin = mod.NativeBiometric;
      } catch {
        return null;
      }
    }
    return this.plugin;
  }
  
  async isAvailable(): Promise<boolean> {
    const plugin = await this.getPlugin();
    if (!plugin) return false;
    try {
      const result = await plugin.isAvailable();
      return result.isAvailable;
    } catch { return false; }
  }
  
  async authenticate(reason = 'Verify your identity'): Promise<boolean> {
    const plugin = await this.getPlugin();
    if (!plugin) return false;
    try {
      await plugin.verifyIdentity({ reason, title: 'boop' });
      return true;
    } catch { return false; }
  }
}

class WebBiometric implements BiometricService {
  async isAvailable() { return false; }
  async authenticate() { return true; } // Skip on web
}

export const biometrics: BiometricService = Capacitor.isNativePlatform()
  ? new NativeBiometric()
  : new WebBiometric();
