import { Capacitor } from '@capacitor/core';

type NetworkStatusListener = (connected: boolean) => void;
const listeners: NetworkStatusListener[] = [];
let isConnected = true;

export function getNetworkStatus() { return isConnected; }

export function onNetworkChange(listener: NetworkStatusListener) {
  listeners.push(listener);
  return () => { 
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

export async function initNetworkMonitoring() {
  if (!Capacitor.isNativePlatform()) {
    // Web fallback
    isConnected = navigator.onLine;
    window.addEventListener('online', () => { isConnected = true; listeners.forEach(l => l(true)); });
    window.addEventListener('offline', () => { isConnected = false; listeners.forEach(l => l(false)); });
    return;
  }
  
  const { Network } = await import('@capacitor/network');
  const status = await Network.getStatus();
  isConnected = status.connected;
  
  Network.addListener('networkStatusChange', (status: { connected: boolean }) => {
    isConnected = status.connected;
    listeners.forEach(l => l(status.connected));
  });
}
