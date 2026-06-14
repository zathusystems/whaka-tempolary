'use client';

import { useCallback, useEffect, useState } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://pos3.express-travel-ticketing.online/api';
const HEALTH_URL = `${API_BASE_URL.replace(/\/$/, '')}/health/`;
const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_MIN_INTERVAL_MS = 5000;

export type BackendReachability = {
  isReachable: boolean;
  isChecking: boolean;
  checkedAt: string | null;
  error: string | null;
};

export type BackendConnectionIssue = {
  title: string;
  description: string;
};

let snapshot: BackendReachability = {
  isReachable: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  isChecking: false,
  checkedAt: null,
  error: null,
};

let lastCheckStartedAt = 0;
let inFlightCheck: Promise<BackendReachability> | null = null;
let listenersAttached = false;
const listeners = new Set<(state: BackendReachability) => void>();

const publish = (next: BackendReachability) => {
  snapshot = next;
  listeners.forEach((listener) => listener(snapshot));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('handypos-backend-reachability-changed', {
        detail: snapshot,
      })
    );
  }
};

const setOfflineBecauseBrowserIsOffline = () => {
  publish({
    isReachable: false,
    isChecking: false,
    checkedAt: new Date().toISOString(),
    error: 'Device network is offline.',
  });
};

const ensureConnectivityListeners = () => {
  if (listenersAttached || typeof window === 'undefined') {
    return;
  }

  listenersAttached = true;

  window.addEventListener('online', () => {
    void checkBackendReachability({ force: true });
  });
  window.addEventListener('offline', setOfflineBecauseBrowserIsOffline);
  window.addEventListener('focus', () => {
    void checkBackendReachability();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void checkBackendReachability();
    }
  });
};

export const getBackendReachabilitySnapshot = (): BackendReachability => snapshot;

export const getBackendConnectionIssue = (
  state: Partial<BackendReachability> = snapshot
): BackendConnectionIssue => {
  const browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (browserOffline) {
    return {
      title: 'Internet connection required',
      description: 'This device appears to be offline. Connect to the internet before completing the sale so the POS server can issue and store the receipt.',
    };
  }

  const error = String(state.error || '').trim();
  const lowerError = error.toLowerCase();
  const serverHint = lowerError.includes('timed out')
    ? 'The POS server did not respond in time.'
    : lowerError.includes('http')
      ? 'The POS server responded with an error.'
      : 'Your internet may be connected, but the POS server could not be reached.';

  return {
    title: 'POS server unavailable',
    description: `${serverHint} Check server availability, DNS/VPN/hotspot settings, then try the sale again.${error ? ` (${error})` : ''}`,
  };
};

export const subscribeToBackendReachability = (
  listener: (state: BackendReachability) => void
): (() => void) => {
  ensureConnectivityListeners();
  listeners.add(listener);
  listener(snapshot);

  return () => {
    listeners.delete(listener);
  };
};

export const checkBackendReachability = async (options?: {
  force?: boolean;
  timeoutMs?: number;
  minIntervalMs?: number;
}): Promise<BackendReachability> => {
  ensureConnectivityListeners();

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setOfflineBecauseBrowserIsOffline();
    return snapshot;
  }

  const force = options?.force === true;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const minIntervalMs = options?.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const now = Date.now();

  if (!force && inFlightCheck) {
    return inFlightCheck;
  }

  if (!force && snapshot.checkedAt && now - lastCheckStartedAt < minIntervalMs) {
    return snapshot;
  }

  lastCheckStartedAt = now;
  publish({ ...snapshot, isChecking: true });

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  inFlightCheck = fetch(`${HEALTH_URL}?t=${Date.now()}`, {
    method: 'GET',
    cache: 'no-store',
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Backend health check failed with HTTP ${response.status}`);
      }

      const next: BackendReachability = {
        isReachable: true,
        isChecking: false,
        checkedAt: new Date().toISOString(),
        error: null,
      };
      publish(next);
      return next;
    })
    .catch((error: any) => {
      const next: BackendReachability = {
        isReachable: false,
        isChecking: false,
        checkedAt: new Date().toISOString(),
        error:
          error?.name === 'AbortError'
            ? 'Backend health check timed out.'
            : error?.message || 'Backend is unreachable.',
      };
      publish(next);
      return next;
    })
    .finally(() => {
      window.clearTimeout(timeoutId);
      inFlightCheck = null;
    });

  return inFlightCheck;
};

export function useBackendReachability(options?: {
  intervalMs?: number;
  timeoutMs?: number;
  enabled?: boolean;
}) {
  const enabled = options?.enabled !== false;
  const intervalMs = options?.intervalMs ?? 15000;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const [state, setState] = useState<BackendReachability>(() => getBackendReachabilitySnapshot());

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    const unsubscribe = subscribeToBackendReachability(setState);
    void checkBackendReachability({ timeoutMs });
    const intervalId = window.setInterval(() => {
      void checkBackendReachability({ timeoutMs });
    }, intervalMs);

    return () => {
      unsubscribe();
      window.clearInterval(intervalId);
    };
  }, [enabled, intervalMs, timeoutMs]);

  const checkNow = useCallback(
    (force = true) => checkBackendReachability({ force, timeoutMs, minIntervalMs: 0 }),
    [timeoutMs]
  );

  return {
    ...state,
    checkNow,
  };
}
