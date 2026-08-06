// src/types/merchant.types.ts

// ============================================================
// REQUEST TYPES (Validation)
// ============================================================

export interface CreateMerchantRequest {
  name: string;
  description?: string;
  category: string;
  address: string;
  phone?: string;
  email?: string;
  latitude?: number;
  longitude?: number;
  logo?: string;
  coverImage?: string;
}

export interface UpdateMerchantRequest {
  name?: string;
  description?: string;
  category?: string;
  isOpen?: boolean;
  address?: string;
  phone?: string;
  email?: string;
  latitude?: number;
  longitude?: number;
  logo?: string;
  coverImage?: string;
}

export interface CreateProductRequest {
  name: string;
  description?: string;
  price: number;
  category: string;
  isAvailable?: boolean;
  image?: string;
  stock?: number;
  weight?: number;
  minOrder?: number;
  preparationTime?: number;
}

export interface UpdateProductRequest {
  name?: string;
  description?: string;
  price?: number;
  category?: string;
  isAvailable?: boolean;
  image?: string;
  stock?: number;
  weight?: number;
  minOrder?: number;
  preparationTime?: number;
}

export interface SearchMerchantQuery {
  q?: string;
  category?: string;
  isOpen?: boolean;
  latitude?: number;
  longitude?: number;
  radius?: number;
  limit?: number;
  page?: number;
}

// ============================================================
// RESPONSE TYPES
// ============================================================

export interface MerchantResponse {
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
  user?: {
    id: string;
    name: string;
    email: string;
  };
  products?: ProductResponse[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductResponse {
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
  minOrder?: number;
  preparationTime?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MerchantStatsResponse {
  merchantId: string;
  merchantName: string;
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
  topProducts: Array<{
    productId: string;
    productName: string;
    totalSold: number;
    revenue: number;
  }>;
  recentOrders: Array<{
    id: string;
    customerName: string;
    totalPrice: number;
    status: string;
    createdAt: Date;
  }>;
}

// ============================================================
// DATABASE TYPES (Optional - Prisma sudah generate sendiri)
// ============================================================

import { Merchant, Product, Order } from '@prisma/client';

export type MerchantWithProducts = Merchant & {
  products: Product[];
};

export type MerchantWithOrders = Merchant & {
  orders: Order[];
};

export type MerchantWithDetails = Merchant & {
  products: Product[];
  user: {
    id: string;
    name: string;
    email: string;
  };
};

// ============================================================
// VALIDATION SCHEMAS (Zod)
// ============================================================

import { z } from 'zod';

export const CreateMerchantSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().max(500).optional(),
  category: z.string().min(2).max(50),
  address: z.string().min(5).max(200),
  phone: z.string().regex(/^[0-9+\-\s()]+$/).optional(),
  email: z.string().email().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  logo: z.string().url().optional(),
  coverImage: z.string().url().optional(),
});

export const UpdateMerchantSchema = z.object({
  name: z.string().min(3).max(100).optional(),
  description: z.string().max(500).optional(),
  category: z.string().min(2).max(50).optional(),
  isOpen: z.boolean().optional(),
  address: z.string().min(5).max(200).optional(),
  phone: z.string().regex(/^[0-9+\-\s()]+$/).optional(),
  email: z.string().email().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  logo: z.string().url().optional(),
  coverImage: z.string().url().optional(),
});

export const CreateProductSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().max(500).optional(),
  price: z.number().positive().min(100),
  category: z.string().min(2).max(50),
  isAvailable: z.boolean().default(true),
  image: z.string().url().optional(),
  stock: z.number().int().nonnegative().optional(),
  weight: z.number().positive().optional(),
  minOrder: z.number().int().positive().optional(),
  preparationTime: z.number().int().positive().optional(),
});

// ============================================================
// ✅ HAPUS export default { ... } di sini!
// ============================================================