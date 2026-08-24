export type UserRole = 'CUSTOMER' | 'DRIVER' | 'ADMIN' | 'MERCHANT';

export type OrderStatus = 'PENDING' | 'ACCEPTED' | 'ON_THE_WAY' | 'ARRIVED' | 'COMPLETED' | 'CANCELLED';

export type ServiceType = 'BIKE' | 'CAR' | 'SEND' | 'MART';

export type TransactionType = 'TOPUP' | 'PAYMENT' | 'EARNING' | 'PLATFORM_FEE' | 'REFUND';

export type PromoType = 'PERCENTAGE' | 'FIXED';

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerProfile {
  id: string;
  userId: string;
  phoneNumber?: string;
  isAppInstalled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DriverProfile {
  id: string;
  userId: string;
  vehicleModel: string;
  vehiclePlate: string;
  isVerified: boolean;
  isOnline: boolean;
  latitude?: number;
  longitude?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Wallet {
  id: string;
  userId: string;
  balance: number;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  walletId: string;
  type: TransactionType;
  amount: number;
  description: string;
  orderId?: string;
  createdAt: string;
}

export interface Order {
  id: string;
  serviceType: ServiceType;
  price: number;
  discount: number;
  isPaid: boolean;
  status: OrderStatus;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  customerId: string;
  driverId?: string;
  promoId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Promo {
  id: string;
  code: string;
  type: PromoType;
  value: number;
  maxDiscount?: number;
  minOrderPrice: number;
  quota: number;
  usedCount: number;
  isActive: boolean;
  expiresAt?: string;
  createdAt: string;
}

export interface Review {
  id: string;
  orderId: string;
  driverId: string;
  rating: number;
  comment?: string;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  userId: string;
  action: string;
  details?: string;
  createdAt: string;
}

export interface Merchant {
  id: string;
  name: string;
  category: string;
  address: string;
  latitude: number;
  longitude: number;
  phone?: string;
  imageUrl?: string;
  isOpen: boolean;
  ownerId?: string;
  products?: Product[];
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  merchantId: string;
  name: string;
  description?: string;
  price: number;
  imageUrl?: string;
  isAvailable: boolean;
  createdAt: string;
  updatedAt: string;
}
