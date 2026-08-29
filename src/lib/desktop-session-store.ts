'use client';

import { isTauriApp } from '@/lib/tauri-init';

const SESSION_SNAPSHOT_KEYS = [
  'handypos-auth-tokens',
  'handy-pos-auth-tokens',
  'handy-pos-user',
  'handy-pos-business',
  'handypos-business',
  'handypos-business-id',
  'handypos-business-name',
  'handypos-business-settings',
  'handypos-active-branch',
  'handypos-current-branch-id',
  'handypos-branches',
] as const;

const SESSION_SNAPSHOT_PREFIXES = ['handypos-branch-'] as const;

type SessionSnapshot = Record<string, string>;

const canUseBrowserStorage = (): boolean =>
  typeof window !== 'undefined' && typeof localStorage !== 'undefined';

const getDesktopInvoke = async () => {
  if (!canUseBrowserStorage() || !isTauriApp()) {
    return null;
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke;
  } catch (error) {
    const globalInvoke = (window as any).__TAURI__?.invoke;
    if (typeof globalInvoke === 'function') {
      return globalInvoke.bind((window as any).__TAURI__);
    }

    console.warn('[DesktopSessionStore] Tauri invoke unavailable:', error);
    return null;
  }
};

const collectSessionSnapshot = (): SessionSnapshot => {
  if (!canUseBrowserStorage()) {
    return {};
  }

  const snapshot: SessionSnapshot = {};

  SESSION_SNAPSHOT_KEYS.forEach((key) => {
    const value = localStorage.getItem(key);
    if (typeof value === 'string') {
      snapshot[key] = value;
    }
  });

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) {
      continue;
    }

    if (!SESSION_SNAPSHOT_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      continue;
    }

    const value = localStorage.getItem(key);
    if (typeof value === 'string') {
      snapshot[key] = value;
    }
  }

  return snapshot;
};

export const syncSessionSnapshotToDesktopStore = async (): Promise<void> => {
  if (!canUseBrowserStorage() || !isTauriApp()) {
    return;
  }

  try {
    const invoke = await getDesktopInvoke();
    if (!invoke) {
      return;
    }

    await invoke('save_session_snapshot', {
      entries: collectSessionSnapshot(),
    });
  } catch (error) {
    console.warn('[DesktopSessionStore] Failed to save session snapshot:', error);
  }
};

export const clearDesktopSessionSnapshot = async (): Promise<void> => {
  if (!canUseBrowserStorage() || !isTauriApp()) {
    return;
  }

  try {
    const invoke = await getDesktopInvoke();
    if (!invoke) {
      return;
    }

    await invoke('clear_session_snapshot');
  } catch (error) {
    console.warn('[DesktopSessionStore] Failed to clear session snapshot:', error);
  }
};

export const hydrateSessionSnapshotFromDesktopStore = async (): Promise<boolean> => {
  if (!canUseBrowserStorage() || !isTauriApp()) {
    return false;
  }

  const initialValues = new Map<string, string | null>();
  SESSION_SNAPSHOT_KEYS.forEach((key) => {
    initialValues.set(key, localStorage.getItem(key));
  });

  try {
    const invoke = await getDesktopInvoke();
    if (!invoke) {
      return false;
    }

    const entries = (await invoke('load_session_snapshot')) as SessionSnapshot | null;
    if (!entries || typeof entries !== 'object') {
      return false;
    }

    let restoredAny = false;
    Object.entries(entries).forEach(([key, value]) => {
      if (typeof value !== 'string' || !key) {
        return;
      }

      const shouldTrackKey =
        (SESSION_SNAPSHOT_KEYS as readonly string[]).includes(key) ||
        SESSION_SNAPSHOT_PREFIXES.some((prefix) => key.startsWith(prefix));
      if (!shouldTrackKey) {
        return;
      }

      const initialValue = initialValues.has(key) ? initialValues.get(key) : localStorage.getItem(key);
      const currentValue = localStorage.getItem(key);

      // If login or another auth action wrote newer local state while the
      // native snapshot was loading, never overwrite it with stale app data.
      if (currentValue !== initialValue) {
        return;
      }

      if (currentValue === value) {
        return;
      }

      localStorage.setItem(key, value);
      restoredAny = true;
    });

    return restoredAny;
  } catch (error) {
    console.warn('[DesktopSessionStore] Failed to hydrate session snapshot:', error);
    return false;
  }
};
