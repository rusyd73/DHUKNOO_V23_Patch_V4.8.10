// src/types/merchant.types.ts

export interface Merchant {
  id: string;
  name: string;
  description?: string;
  category: string;
  isOpen: boolean;
  logo?: string;
  coverImage?: string;
  address: string;
  phone?: string;
  email?: string;
  latitude?: number;
  longitude?: number;
  rating?: number;
  totalReviews?: number;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface MerchantFormData {
  name: string;
  description?: string;
  category: string;
  address: string;
  phone?: string;
  email?: string;
  logo?: string;
  coverImage?: string;
  // HAPUS isOpen
}

export interface Product {
  id: string;
  merchantId: string;
  name: string;
  description?: string;
  price: number;
  category: string;
  isAvailable: boolean;
  image?: string;
  stock?: number;
  weight?: number;
  createdAt: string;
  updatedAt: string;
}

export interface MerchantStats {
  totalProducts: number;
  totalOrders: number;
  totalRevenue: number;
  averageRating: number;
  totalCustomers: number;
  ordersToday: number;
  revenueToday: number;
  pendingOrders: number;
  completedOrders: number;
  cancelledOrders: number;
}

// ❌ HAPUS baris ini (conflict dengan export di atas):
// export type { Merchant, Product, MerchantStats, MerchantFormData };