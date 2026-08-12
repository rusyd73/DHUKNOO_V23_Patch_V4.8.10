// modules/ledger/ledger.types.ts
export enum LedgerEntryType {
  CUSTOMER_PAYMENT = 'CUSTOMER_PAYMENT',
  DRIVER_EARNING = 'DRIVER_EARNING',
  MERCHANT_EARNING = 'MERCHANT_EARNING',
  PLATFORM_FEE = 'PLATFORM_FEE',
  MERCHANT_FEE = 'MERCHANT_FEE',
  DRIVER_COMMISSION = 'DRIVER_COMMISSION',
  REFUND = 'REFUND',
}

export interface LedgerEntry {
  id: string;
  orderId: string;
  userId: string;
  type: LedgerEntryType;
  amount: number;
  description: string;
  reference: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

export interface OrderFeeBreakdown {
  orderId: string;
  customerPayment: number;
  driverEarning: number;
  merchantEarning: number;
  platformFee: number;
  merchantFee: number;
  driverCommission: number;
  breakdown: {
    itemsSubtotal?: number;
    deliveryFee?: number;
    shippingFee?: number;
    discount?: number;
    // details per component
  };
}