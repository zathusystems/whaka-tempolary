/**
 * ✅ Clean API client for Tauri desktop app
 * 
 * Features:
 * - Standard fetch (no Tauri IPC)
 * - Environment variable support
 * - Error handling
 * - Type-safe responses
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://pos.express-travel-ticketing.online';

export class APIClient {
  private apiUrl: string = API_URL;

  constructor() {
    console.log('[API] Initialized with URL:', this.apiUrl);
  }

  /**
   * Health check - verify backend is running
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/api/health/`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      return response.ok;
    } catch (error) {
      console.error('[API] Health check failed:', error);
      return false;
    }
  }

  /**
   * Generic GET request
   */
  async get<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.apiUrl}${endpoint}`, {
      ...options,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Generic POST request
   */
  async post<T>(endpoint: string, data?: any, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.apiUrl}${endpoint}`, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Generic PUT request
   */
  async put<T>(endpoint: string, data?: any, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.apiUrl}${endpoint}`, {
      ...options,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Generic DELETE request
   */
  async delete<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.apiUrl}${endpoint}`, {
      ...options,
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // ========== POS-Specific Endpoints ==========

  async getProducts() {
    return this.get('/api/inventory/products/');
  }

  async getCustomers() {
    return this.get('/api/business/customers/');
  }

  async createTransaction(data: any) {
    return this.post('/api/pos/transactions/', data);
  }

  async getTransactions(filters?: any) {
    const params = new URLSearchParams(filters || {});
    return this.get(`/api/pos/transactions/?${params.toString()}`);
  }

  async getInventory() {
    return this.get('/api/inventory/');
  }

  async updateInventory(id: string, data: any) {
    return this.put(`/api/inventory/${id}/`, data);
  }
}

// ✅ Singleton instance
export const apiClient = new APIClient();
