const DEVICE_SERIAL_STORAGE_KEY = 'handypos-device-serial';
const TAURI_DEVICE_SERIAL_STORAGE_KEY = 'handypos-tauri-device-serial';
const DEVICE_MAC_ADDRESS_STORAGE_KEY = 'handypos-device-mac-address';

export const DEVICE_IDENTITY_CHANGED_EVENT = 'handypos-device-identity-changed';
export const DEFAULT_DEVICE_MAC_ADDRESS = '00-00-00-00-00-00';

let cachedDeviceSerial: string | null = null;
let cachedDeviceMacAddress: string | null = null;
let nativeIdentityPromise: Promise<string> | null = null;
let nativeMacAddressPromise: Promise<string> | null = null;

type TauriInvoke = <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;

const canUseBrowserStorage = (): boolean =>
  typeof window !== 'undefined' && typeof localStorage !== 'undefined';

const normalizeDeviceSerial = (value: unknown): string => {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length < 8 || normalized.length > 100) {
    return '';
  }
  return /^[A-Za-z0-9_-]+$/.test(normalized) ? normalized : '';
};

export const normalizeDeviceMacAddress = (value: unknown): string => {
  const hex = String(value ?? '')
    .trim()
    .replace(/[^0-9a-f]/gi, '')
    .toUpperCase();

  if (hex.length !== 12 || hex === '000000000000') {
    return '';
  }

  return hex.match(/.{1,2}/g)?.join('-') || '';
};

const readStoredDeviceSerial = (): string => {
  if (!canUseBrowserStorage()) return cachedDeviceSerial || '';

  const nativeSerial = normalizeDeviceSerial(localStorage.getItem(TAURI_DEVICE_SERIAL_STORAGE_KEY));
  const browserSerial = normalizeDeviceSerial(localStorage.getItem(DEVICE_SERIAL_STORAGE_KEY));
  const deviceSerial = nativeSerial || browserSerial || '';
  cachedDeviceSerial = deviceSerial || cachedDeviceSerial;
  return deviceSerial || cachedDeviceSerial || '';
};

const readStoredDeviceMacAddress = (): string => {
  if (!canUseBrowserStorage()) return cachedDeviceMacAddress || DEFAULT_DEVICE_MAC_ADDRESS;

  const storedMacAddress = normalizeDeviceMacAddress(localStorage.getItem(DEVICE_MAC_ADDRESS_STORAGE_KEY));
  const deviceMacAddress = storedMacAddress || DEFAULT_DEVICE_MAC_ADDRESS;
  cachedDeviceMacAddress = storedMacAddress || cachedDeviceMacAddress;
  return deviceMacAddress;
};

const publishDeviceIdentityChange = (detail: { deviceSerial?: string; macAddress?: string }): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DEVICE_IDENTITY_CHANGED_EVENT, { detail }));
};

const persistDeviceSerial = (deviceSerial: string, options: { native: boolean }): void => {
  if (!canUseBrowserStorage()) return;

  const normalized = normalizeDeviceSerial(deviceSerial);
  if (!normalized) return;

  const previous = readStoredDeviceSerial();
  cachedDeviceSerial = normalized;

  if (options.native) {
    localStorage.setItem(TAURI_DEVICE_SERIAL_STORAGE_KEY, normalized);
  }
  localStorage.setItem(DEVICE_SERIAL_STORAGE_KEY, normalized);

  if (previous.toLowerCase() !== normalized.toLowerCase()) {
    publishDeviceIdentityChange({ deviceSerial: normalized });
  }
};

const persistDeviceMacAddress = (macAddress: string): void => {
  if (!canUseBrowserStorage()) return;

  const normalized = normalizeDeviceMacAddress(macAddress);
  if (!normalized) return;

  const previous = readStoredDeviceMacAddress();
  cachedDeviceMacAddress = normalized;
  localStorage.setItem(DEVICE_MAC_ADDRESS_STORAGE_KEY, normalized);

  if (previous.toLowerCase() !== normalized.toLowerCase()) {
    publishDeviceIdentityChange({ macAddress: normalized });
  }
};

export function getDetectedOS(): string {
  if (typeof window === 'undefined') return 'Web';

  const userAgent = window.navigator.userAgent.toLowerCase();
  if (userAgent.includes('win')) return 'Windows';
  if (userAgent.includes('mac')) return 'macOS';
  if (userAgent.includes('linux')) return 'Linux';
  if (userAgent.includes('android')) return 'Android';
  if (userAgent.includes('iphone') || userAgent.includes('ipad')) return 'iOS';
  return 'Web';
}

const getBrowserFallbackDeviceSerial = (): string => {
  const stored = readStoredDeviceSerial();
  if (stored) return stored;
  if (!canUseBrowserStorage()) return '';

  const userAgent = window.navigator.userAgent;
  const language = window.navigator.language;
  const platform = window.navigator.platform;
  const hardwareConcurrency = (window.navigator as any).hardwareConcurrency || 'unknown';
  const deviceMemory = (window.navigator as any).deviceMemory || 'unknown';
  const maxTouchPoints = (window.navigator as any).maxTouchPoints || 0;
  const fingerprint = `${userAgent}-${language}-${platform}-${hardwareConcurrency}-${deviceMemory}-${maxTouchPoints}`;

  let hash = 0;
  for (let index = 0; index < fingerprint.length; index += 1) {
    const char = fingerprint.charCodeAt(index);
    hash = ((hash << 5) - hash) + char;
    hash &= hash;
  }

  const os = getDetectedOS().substring(0, 3).toUpperCase();
  const timestamp = Date.now().toString(36).toUpperCase();
  const hashHex = Math.abs(hash).toString(16).toUpperCase().substring(0, 8);
  const deviceSerial = `HANDY-${os}-${hashHex}-${timestamp}`;
  persistDeviceSerial(deviceSerial, { native: false });
  return deviceSerial;
};

const hasTauriRuntime = (): boolean => {
  if (typeof window === 'undefined') return false;
  const windowRef = window as any;
  return Boolean(
    windowRef.__TAURI__ ||
    windowRef.__TAURI_INTERNALS__ ||
    typeof windowRef.__TAURI_IPC__ === 'function'
  );
};

const getTauriInvoke = async (): Promise<TauriInvoke | null> => {
  if (!hasTauriRuntime()) {
    return null;
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    if (typeof invoke === 'function') {
      return invoke as TauriInvoke;
    }
  } catch (error) {
    console.warn('[DeviceIdentity] Tauri core invoke unavailable:', error);
  }

  const globalInvoke = (window as any).__TAURI__?.invoke;
  if (typeof globalInvoke === 'function') {
    return globalInvoke.bind((window as any).__TAURI__);
  }

  const internalInvoke = (window as any).__TAURI_INTERNALS__?.invoke;
  if (typeof internalInvoke === 'function') {
    return internalInvoke.bind((window as any).__TAURI_INTERNALS__);
  }

  return null;
};

export async function ensureTauriDeviceIdentity(): Promise<string> {
  if (!canUseBrowserStorage()) return '';

  const preferredSerial = getBrowserFallbackDeviceSerial();
  if (!hasTauriRuntime()) {
    return preferredSerial;
  }

  if (!nativeIdentityPromise) {
    nativeIdentityPromise = (async () => {
      try {
        const invoke = await getTauriInvoke();
        if (!invoke) {
          return preferredSerial;
        }

        const nativeSerial = normalizeDeviceSerial(await invoke<string>('get_device_identity', {
          preferredSerial,
        }));
        if (!nativeSerial) {
          return preferredSerial;
        }

        persistDeviceSerial(nativeSerial, { native: true });
        return nativeSerial;
      } catch (error) {
        console.warn('[DeviceIdentity] Failed to load native Tauri device identity:', error);
        return preferredSerial;
      } finally {
        nativeIdentityPromise = null;
      }
    })();
  }

  return nativeIdentityPromise;
}

export async function ensureTauriDeviceMacAddress(): Promise<string> {
  if (!canUseBrowserStorage()) return DEFAULT_DEVICE_MAC_ADDRESS;

  const storedMacAddress = readStoredDeviceMacAddress();
  if (!hasTauriRuntime()) {
    return storedMacAddress;
  }

  if (!nativeMacAddressPromise) {
    nativeMacAddressPromise = (async () => {
      try {
        const invoke = await getTauriInvoke();
        if (!invoke) {
          return storedMacAddress;
        }

        const nativeMacAddress = normalizeDeviceMacAddress(await invoke<string | null>('get_device_mac_address'));
        if (!nativeMacAddress) {
          return storedMacAddress;
        }

        persistDeviceMacAddress(nativeMacAddress);
        return nativeMacAddress;
      } catch (error) {
        console.warn('[DeviceIdentity] Failed to load native Tauri MAC address:', error);
        return storedMacAddress;
      } finally {
        nativeMacAddressPromise = null;
      }
    })();
  }

  return nativeMacAddressPromise;
}

export function getDeviceSerial(): string {
  const stored = readStoredDeviceSerial();
  if (stored) {
    if (hasTauriRuntime() && canUseBrowserStorage() && !localStorage.getItem(TAURI_DEVICE_SERIAL_STORAGE_KEY)) {
      void ensureTauriDeviceIdentity();
    }
    return stored;
  }

  const fallback = getBrowserFallbackDeviceSerial();
  void ensureTauriDeviceIdentity();
  return fallback;
}

export function getDeviceMacAddress(): string {
  const stored = readStoredDeviceMacAddress();
  if (hasTauriRuntime() && stored === DEFAULT_DEVICE_MAC_ADDRESS) {
    void ensureTauriDeviceMacAddress();
  }
  return stored;
}
