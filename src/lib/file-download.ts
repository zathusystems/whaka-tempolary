import { isTauriApp } from '@/lib/tauri-init';

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
};

export const downloadTextFile = (
  content: string,
  filename: string,
  mimeType = 'text/csv;charset=utf-8;'
): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (error) {
    console.error('[Download] Failed to trigger file download:', error);
    return false;
  }
};

export const downloadBlobFile = (blob: Blob, filename: string): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (error) {
    console.error('[Download] Failed to trigger file download:', error);
    return false;
  }
};

/**
 * Save a binary export in both browsers and Tauri WebViews. Tauri's native
 * command writes to Downloads (with Documents/data/cache fallbacks), which is
 * more reliable than triggering an anchor download inside a WebView.
 */
export const saveBlobFile = async (blob: Blob, filename: string): Promise<boolean> => {
  if (typeof window === 'undefined') return false;

  if (!isTauriApp()) {
    return downloadBlobFile(blob, filename);
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await invoke('save_export_file', {
      filename,
      contentBase64: bytesToBase64(bytes),
    });
    return true;
  } catch (error) {
    console.error('[Download] Failed to save export through Tauri:', error);
    return false;
  }
};
