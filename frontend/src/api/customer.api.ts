import { api } from "./apiClient";
import { API_ENDPOINTS } from "@obama/shared-api";

export const CustomerAPI = {
  getProfile: async () =>
    (await api.get(API_ENDPOINTS.customer.profile)).data,

  createOrder: async (payload: any) =>
    (await api.post(API_ENDPOINTS.order.create, payload)).data,

  getOrders: async () =>
    (await api.get(API_ENDPOINTS.customer.orders)).data,

  giveDriverTip: async (orderId: string, amount: number) =>
    (await api.post(`/api/order/${orderId}/tip`, { amount })).data,

  topupWallet: async (data: number | { amount: number; method?: string; proofImageUrl?: string; note?: string }) => {
    const payload = typeof data === 'number' ? { amount: data } : data;
    return (await api.post(API_ENDPOINTS.wallet.topup, payload)).data;
  },

  sendReceiptEmail: async (orderId: string) =>
    (
      await api.post(
        API_ENDPOINTS.order.sendReceiptEmail(orderId)
      )
    ).data,

  // 🆕 (Link Merchant <-> Order): checkout keranjang belanja dari satu toko.
  previewMerchantCheckout: async (payload: {
    merchantId: string;
    items: { productId: string; quantity: number }[];
    dropoffAddress: string;
    dropoffLat: number;
    dropoffLng: number;
    paymentMethod?: string;
  // Endpoint eksplisit menjaga runtime Windows tetap benar walau salinan
  // workspace package di node_modules belum tersinkron setelah patch.
  }) => (await api.post('/api/order/merchant-checkout/preview', payload)).data,

  checkoutMerchant: async (payload: {
    merchantId: string;
    items: { productId: string; quantity: number }[];
    dropoffAddress: string;
    dropoffLat: number;
    dropoffLng: number;
    paymentMethod?: string;
    notes?: string;
    expectedTotal?: number;
  }) => (await api.post(API_ENDPOINTS.order.merchantCheckout, payload)).data,
};
