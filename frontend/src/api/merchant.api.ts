// api/merchant.api.ts
import { api } from './apiClient';
import type { Merchant, Product, MerchantStats } from '../types/merchant.types';

// ============================================================
// API RESPONSE WRAPPER
// ============================================================
export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
  errors?: Record<string, string[]>;
}

// ============================================================
// MERCHANT API
// ============================================================
export const merchantApi = {
  // ============================================================
  // PUBLIC ENDPOINTS
  // ============================================================
  getAll: (params?: { category?: string; isOpen?: boolean; limit?: number }) =>
    api.get<Merchant[]>('/api/merchant', { params }),

  getById: (id: string) =>
    api.get<Merchant>(`/api/merchant/${id}`),

  getProducts: (merchantId: string, includeUnavailable?: boolean) =>
    api.get<Product[]>(`/api/merchant/${merchantId}/products`, {
      params: { includeUnavailable },
    }),

  register: (data: Partial<Merchant>) =>
    api.post<Merchant>('/api/merchant/register', data),

  search: (query: string, limit?: number) =>
    api.get<Merchant[]>('/api/merchant/search', {
      params: { q: query, limit },
    }),

  getPopular: (limit?: number) =>
    api.get<Merchant[]>('/api/merchant/popular', { params: { limit } }),

  // ============================================================
  // MERCHANT OWNER ENDPOINTS (Butuh Auth)
  // ============================================================
  getMyMerchant: () =>
    api.get<Merchant>('/api/merchant/my/merchant'),

  updateMyMerchant: (data: Partial<Merchant>) =>
    api.put<Merchant>('/api/merchant/my/merchant', data),

  toggleMerchant: (merchantId: string, isOpen: boolean) =>
    api.patch<{ success: boolean; isOpen: boolean }>(
      `/api/merchant/my/merchant/toggle`,
      { isOpen }
    ),

  getMyStats: () =>
    api.get<MerchantStats>('/api/merchant/my/stats'),

  // ============================================================
  // PRODUCT MANAGEMENT
  // ============================================================
  addProduct: (data: Omit<Product, 'id' | 'merchantId'>) =>
    api.post<Product>('/api/merchant/my/products', data),

  bulkAddProducts: (products: Omit<Product, 'id' | 'merchantId'>[]) =>
    api.post<{ success: boolean; count: number }>(
      '/api/merchant/my/products/bulk',
      { products }
    ),

  updateProduct: (productId: string, data: Partial<Product>) =>
    api.put<Product>(`/api/merchant/my/products/${productId}`, data),

  deleteProduct: (productId: string) =>
    api.delete<{ success: boolean }>(`/api/merchant/my/products/${productId}`),

  // ============================================================
  // ADMIN ENDPOINTS
  // ============================================================
  createByAdmin: (data: Omit<Merchant, 'id' | 'createdAt' | 'updatedAt'>) =>
    api.post<Merchant>('/api/merchant', data),

  updateByAdmin: (merchantId: string, data: Partial<Merchant>) =>
    api.put<Merchant>(`/api/merchant/${merchantId}`, data),

  deleteByAdmin: (merchantId: string) =>
    api.delete<{ success: boolean }>(`/api/merchant/${merchantId}`),

  toggleByAdmin: (merchantId: string, isOpen: boolean) =>
    api.patch<{ success: boolean; isOpen: boolean }>(
      `/api/merchant/${merchantId}/toggle`,
      { isOpen }
    ),

  getStatsByAdmin: (merchantId: string) =>
    api.get<MerchantStats>(`/api/merchant/${merchantId}/stats`),
};

export default merchantApi;