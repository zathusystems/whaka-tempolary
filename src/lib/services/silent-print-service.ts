'use client';

/**
 * Silent Print Service
 * Handles silent printing by sending directly to printer without dialog
 * Uses system-level printing when available
 */

export interface SilentPrintOptions {
  printerName?: string;
  printerId?: string;
  copies?: number;
  paperSize?: '80mm' | '58mm';
  printerPaperSize?: '80mm' | '58mm';
  timeout?: number;
}

class SilentPrintService {
  /**
   * Print silently using system print command (if available)
   * This works best with Tauri or Electron apps
   */
  async printSilentlyViaSystem(
    htmlContent: string,
    options: SilentPrintOptions = {}
  ): Promise<boolean> {
    try {
      const {
        printerName = 'default',
        printerId,
        copies = 1,
        paperSize = '80mm',
        printerPaperSize = paperSize,
        timeout = 5000
      } = options;

      console.log('[SilentPrint] Attempting system print to:', printerName);

      // Check if running in Tauri environment
      if (this.isTauriAvailable()) {
        const resolvedPrinterId = await this.resolvePrinterId(printerId, printerName);
        if (resolvedPrinterId) {
          return await this.printViaTauri(htmlContent, resolvedPrinterId, copies, paperSize, printerPaperSize);
        }

        // No usable native printer ID: fallback to browser print path.
        console.warn('[SilentPrint] Could not resolve a native printer ID, falling back to browser print.');
        return await this.printViaAutoSubmit(htmlContent, copies, paperSize);
      }

      // Check if running in Electron environment
      if (this.isElectronAvailable()) {
        return await this.printViaElectron(htmlContent, printerName, copies, paperSize);
      }

      // Fallback: Use browser's print API with auto-submit
      return await this.printViaAutoSubmit(htmlContent, copies, paperSize);
    } catch (error) {
      console.error('[SilentPrint] Error in system print:', error);
      return false;
    }
  }

  /**
   * Check if Tauri is available
   */
  private isTauriAvailable(): boolean {
    try {
      const hasGlobalInvoke = typeof (window as any).__TAURI__?.invoke === 'function';
      const hasInternalInvoke = typeof (window as any).__TAURI_INTERNALS__?.invoke === 'function';
      const userAgent = navigator.userAgent.toLowerCase();
      const isTauriWebview = userAgent.includes('tauri') || userAgent.includes('wry');
      return hasGlobalInvoke || hasInternalInvoke || isTauriWebview;
    } catch {
      return false;
    }
  }

  /**
   * Check if Electron is available
   */
  private isElectronAvailable(): boolean {
    try {
      return typeof (window as any).electron !== 'undefined' || 
             typeof (window as any).require !== 'undefined';
    } catch {
      return false;
    }
  }

  /**
   * Print via Tauri (desktop app)
   */
  private async printViaTauri(
    htmlContent: string,
    printerId: string,
    copies: number,
    paperSize: '80mm' | '58mm',
    printerPaperSize: '80mm' | '58mm'
  ): Promise<boolean> {
    try {
      const invoke = await this.getTauriInvoke();
      if (!invoke) {
        throw new Error('Tauri invoke API not available');
      }
      
      console.log('[SilentPrint] Using Tauri for silent printing');

      // Use Tauri command args with the default camelCase naming.
      const result = await invoke('print_receipt', {
        html: htmlContent,
        printerId,
        copies,
        paperSize,
        printerPaperWidth: printerPaperSize,
      });

      console.log('[SilentPrint] Tauri print result:', result);
      return result === true || result === 'success';
    } catch (error) {
      console.error('[SilentPrint] Tauri print error:', error);
      return false;
    }
  }

  private isNativePrinterId(value?: string): boolean {
    if (typeof value !== 'string') {
      return false;
    }

    const normalized = value.trim();
    if (!normalized) {
      return false;
    }

    if (/^[0-9a-fA-F]{4}:[0-9a-fA-F]{4}$/.test(normalized)) {
      return true; // Raw USB VID:PID
    }

    if (normalized.toLowerCase().startsWith('cups:')) {
      return true; // System print queue (USB/Network/Bluetooth)
    }

    if (normalized.toLowerCase().startsWith('bt:')) {
      return true; // Paired Bluetooth alias
    }

    return false;
  }

  private async getTauriInvoke(): Promise<((command: string, args?: Record<string, unknown>) => Promise<any>) | null> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      if (typeof invoke === 'function') {
        return invoke as (command: string, args?: Record<string, unknown>) => Promise<any>;
      }
    } catch {
      // Ignore and try global fallbacks.
    }

    try {
      const tauriInvoke = (window as any).__TAURI__?.invoke;
      if (typeof tauriInvoke === 'function') {
        return tauriInvoke.bind((window as any).__TAURI__);
      }

      const internalInvoke = (window as any).__TAURI_INTERNALS__?.invoke;
      if (typeof internalInvoke === 'function') {
        return internalInvoke.bind((window as any).__TAURI_INTERNALS__);
      }
    } catch {
      // Ignore global access errors.
    }

    return null;
  }

  private async resolvePrinterId(printerId?: string, printerName?: string): Promise<string | null> {
    if (this.isNativePrinterId(printerId)) {
      return printerId!.trim();
    }

    if (this.isNativePrinterId(printerName)) {
      return printerName!.trim();
    }

    const invoke = await this.getTauriInvoke();
    if (!invoke) {
      return null;
    }

    try {
      const printers = await invoke('get_printers');
      if (!Array.isArray(printers) || !printerName) {
        return null;
      }

      const normalizedTargetName = printerName.trim().toLowerCase();
      const match = printers.find((printer: any) => {
        const name = String(printer?.name || '').trim().toLowerCase();
        const id = String(printer?.id || '').trim();
        return name === normalizedTargetName && this.isNativePrinterId(id);
      });

      return match ? String(match.id).trim() : null;
    } catch (error) {
      console.error('[SilentPrint] Failed to resolve printer ID from discovery:', error);
      return null;
    }
  }

  /**
   * Print via Electron (desktop app)
   */
  private async printViaElectron(
    htmlContent: string,
    printerName: string,
    copies: number,
    paperSize: '80mm' | '58mm'
  ): Promise<boolean> {
    try {
      const electron = (window as any).electron || (window as any).require('electron');
      
      console.log('[SilentPrint] Using Electron for silent printing');

      // Use Electron's print API
      const result = await electron.ipcRenderer.invoke('print-receipt', {
        html: htmlContent,
        printer: printerName,
        copies: copies,
        paperSize,
      });

      console.log('[SilentPrint] Electron print result:', result);
      return result === true || result === 'success';
    } catch (error) {
      console.error('[SilentPrint] Electron print error:', error);
      return false;
    }
  }

  /**
   * Print via browser with auto-submit (best effort)
   * This creates a print window and attempts to auto-submit
   */
  private async printViaAutoSubmit(
    htmlContent: string,
    copies: number,
    paperSize: '80mm' | '58mm'
  ): Promise<boolean> {
    try {
      console.log('[SilentPrint] Using browser auto-submit method');

      const printWidth = paperSize === '58mm' ? '58mm' : '80mm';

      for (let i = 0; i < copies; i++) {
        const printWindow = window.open('', '', 'width=800,height=600');
        
        if (!printWindow) {
          console.error('[SilentPrint] Could not open print window');
          return false;
        }

        // Write content to print window
        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <style>
                * {
                  margin: 0;
                  padding: 0;
                  box-sizing: border-box;
                }
                body {
                  font-family: 'Courier New', monospace;
                  font-size: 12px;
                  width: ${printWidth};
                  margin: 0;
                  padding: 0;
                }
                @media print {
                  * {
                    margin: 0 !important;
                    padding: 0 !important;
                  }
                  @page {
                    size: ${printWidth} auto;
                    margin: 0;
                  }
                }
              </style>
            </head>
            <body>
              ${i > 0 ? `<div style="text-align: center; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px dashed; font-weight: bold;">*** COPY #${i + 1} ***</div>` : ''}
              ${htmlContent}
              <script>
                // Auto-print after content loads
                window.addEventListener('load', function() {
                  setTimeout(function() {
                    window.print();
                    // Close after print dialog appears
                    setTimeout(function() {
                      window.close();
                    }, 500);
                  }, 100);
                });
              </script>
            </body>
          </html>
        `);
        printWindow.document.close();

        // Wait between copies
        if (i < copies - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      console.log('[SilentPrint] Auto-submit print completed');
      return true;
    } catch (error) {
      console.error('[SilentPrint] Auto-submit print error:', error);
      return false;
    }
  }

  /**
   * Enable auto-print mode (stores preference)
   */
  enableAutoPrint(): void {
    localStorage.setItem('handy-pos-auto-print-enabled', 'true');
    console.log('[SilentPrint] Auto-print mode enabled');
  }

  /**
   * Disable auto-print mode
   */
  disableAutoPrint(): void {
    localStorage.removeItem('handy-pos-auto-print-enabled');
    console.log('[SilentPrint] Auto-print mode disabled');
  }

  /**
   * Check if auto-print is enabled
   */
  isAutoPrintEnabled(): boolean {
    return localStorage.getItem('handy-pos-auto-print-enabled') === 'true';
  }

  /**
   * Get available print methods
   */
  getAvailableMethods(): string[] {
    const methods: string[] = [];

    if (this.isTauriAvailable()) {
      methods.push('tauri');
    }

    if (this.isElectronAvailable()) {
      methods.push('electron');
    }

    methods.push('browser');

    return methods;
  }
}

export const silentPrintService = new SilentPrintService();
