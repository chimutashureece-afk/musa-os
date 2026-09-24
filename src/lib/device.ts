// Desktop/phone app helpers: online state, the browser's "install app" prompt,
// and whether we're already running as an installed app.
import { useEffect, useState, useSyncExternalStore } from 'react';

// --- online / offline -------------------------------------------------------
const onlineSub = (cb: () => void) => { addEventListener('online', cb); addEventListener('offline', cb); return () => { removeEventListener('online', cb); removeEventListener('offline', cb); }; };
export const useOnline = () => useSyncExternalStore(onlineSub, () => navigator.onLine, () => true);

// --- install prompt ----------------------------------------------------------
type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let deferred: BIPEvent | null = null;
const listeners = new Set<() => void>();
const ping = () => listeners.forEach((l) => l());
if (typeof window !== 'undefined') {
  // must be caught early — Chrome/Edge fire it once, soon after the page loads
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BIPEvent; ping(); });
  addEventListener('appinstalled', () => { deferred = null; ping(); });
}

/** True inside the Windows app or when opened from an installed shortcut. */
export const isInstalledApp = () =>
  typeof window !== 'undefined' && (!!(window as any).musaDesktop || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches);

export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => { const l = () => force((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return {
    /** The browser offers one-click install (Chrome, Edge). */
    canInstall: !!deferred && !isInstalledApp(),
    installed: isInstalledApp(),
    install: async () => {
      if (!deferred) return false;
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null; ping();
      return outcome === 'accepted';
    },
  };
}

/** Link to the Windows installer, if one has been published (set VITE_DESKTOP_DOWNLOAD_URL). */
export const WINDOWS_DOWNLOAD_URL = (import.meta.env.VITE_DESKTOP_DOWNLOAD_URL as string | undefined) || '';

// --- Windows app bridge (desktop/preload.js) ---------------------------------
export interface DesktopBridge {
  platform: string;
  version: string;
  setTitleBarColors?: (c: { color: string; symbolColor: string }) => void;
  setBadge?: (count: number) => void;
  onRoute?: (cb: (route: string) => void) => void;
  minimize?: () => void;
}
export const desktop: DesktopBridge | undefined = typeof window !== 'undefined' ? (window as any).musaDesktop : undefined;
