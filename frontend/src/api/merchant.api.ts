// src/api/merchant.api.ts

// ============================================================
// 🆕 TYPE DEFINITION
// ============================================================
export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data: T;
}

// ============================================================
// 🆕 PERBAIKAN #2 (Aktifkan Merchant / Link ke Ekosistem):
// File ini sebelumnya memakai axios instance TERPISAH (`./client`) yang:
//   1. Mengambil token dari `localStorage.getItem('token')` — padahal
//      seluruh app menyimpan token di key `dhuknoo_token` lewat useAuthStore
//      (lihat store/useAuthStore.ts). Jadi SEMUA request merchant yang butuh
//      login (getMyMerchant, addProduct, toggleMerchant, dst) diam-diam
//      terkirim TANPA header Authorization -> selalu 401.
//   2. Memanggil path '/api/merchants' (JAMAK) sementara backend mendaftarkan
//      modul ini di '/api/merchant' (TUNGGAL) — lihat backend/src/app.ts
//      (`app.use('/api/merchant', merchantRouter)`). Jadi bahkan endpoint
//      PUBLIK (list, search, popular, detail) pun selalu 404.
// Akibatnya portal Merchant (Dashboard, Register, listing publik) terlihat
// "ada" di UI tapi sama sekali tidak tersambung ke backend/ekosistem yang
// sudah dibangun. Perbaikannya: pakai instance `api` yang sama dengan
// auth/customer/driver/dll (lihat ./apiClient.ts, sudah otomatis kirim token
// asli dari useAuthStore + auto-refresh saat 401), dan pakai path tunggal
// '/api/merchant' yang konsisten dengan API_ENDPOINTS.merchant.
// ============================================================

import { api } from './apiClient';

export const merchantApi = {
  // ============================================================
  // 🔥 PUBLIC ENDPOINTS
  // ============================================================

  // Get all merchants
  getAll: (params?: { category?: string; isOpen?: boolean; limit?: number }) =>
    api.get('/api/merchant', { params }),

  // Get merchant detail
  getById: (id: string) =>
    api.get(`/api/merchant/${id}`),

  // Get merchant products
  getProducts: (merchantId: string, includeUnavailable?: boolean) =>
    api.get(`/api/merchant/${merchantId}/products`, {
      params: { includeUnavailable },
    }),

  // Register merchant
  register: (data: any) =>
    api.post('/api/merchant/register', data),

  // Search merchants
  search: (query: string, limit?: number) =>
    api.get('/api/merchant/search', {
      params: { q: query, limit },
    }),

  // Get popular merchants
  getPopular: (limit?: number) =>
    api.get('/api/merchant/popular', { params: { limit } }),

  // ============================================================
  // 🔥 MERCHANT OWNER ENDPOINTS (Butuh Auth)
  // ============================================================

  // Get my merchant
  getMyMerchant: () =>
    api.get('/api/merchant/my/merchant'),

  // Update my merchant
  updateMyMerchant: (data: any) =>
    api.put('/api/merchant/my/merchant', data),

  // Toggle merchant status
  toggleMerchant: (merchantId: string, isOpen: boolean) =>
    api.patch(`/api/merchant/my/merchant/toggle`, { isOpen }),

  // Get my stats
  getMyStats: () =>
    api.get('/api/merchant/my/stats'),

  // 🆕 (Link Merchant <-> Order): pesanan yang masuk ke toko sendiri
  getMyOrders: () =>
    api.get('/api/merchant/my/orders'),

  // ============================================================
  // 🔥 PRODUCT MANAGEMENT
  // ============================================================

  // Add product
  addProduct: (data: any) =>
    api.post('/api/merchant/my/products', data),

  // Bulk add products
  bulkAddProducts: (products: any[]) =>
    api.post('/api/merchant/my/products/bulk', { products }),

  // Update product
  updateProduct: (productId: string, data: any) =>
    api.put(`/api/merchant/my/products/${productId}`, data),

  // Delete product
  deleteProduct: (productId: string) =>
    api.delete(`/api/merchant/my/products/${productId}`),

  // ============================================================
  // 🔥 ADMIN ENDPOINTS
  // ============================================================

  // Admin create merchant
  createByAdmin: (data: any) =>
    api.post('/api/merchant', data),

  // Admin update merchant
  updateByAdmin: (merchantId: string, data: any) =>
    api.put(`/api/merchant/${merchantId}`, data),

  // Admin delete merchant
  deleteByAdmin: (merchantId: string) =>
    api.delete(`/api/merchant/${merchantId}`),

  // Admin toggle merchant
  toggleByAdmin: (merchantId: string, isOpen: boolean) =>
    api.patch(`/api/merchant/${merchantId}/toggle`, { isOpen }),

  // Admin get merchant stats
  getStatsByAdmin: (merchantId: string) =>
    api.get(`/api/merchant/${merchantId}/stats`),
};