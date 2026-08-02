import { api } from "./apiClient";
import { API_ENDPOINTS } from "@obama/shared-api";

export const WalletAPI = {
  getBalance: async () =>
    (await api.get(API_ENDPOINTS.wallet.balance)).data,

  getTransactions: async (limit = 50, offset = 0) =>
    (
      await api.get(API_ENDPOINTS.wallet.transactions, {
        params: { limit, offset },
      })
    ).data,

  createTopupRequest: async (data: { amount: number; method: 'QRIS' | 'TRANSFER' | 'CASH'; proofImageUrl?: string; note?: string }) =>
    (await api.post('/api/wallet/topup-request', data)).data,

  getMyTopupRequests: async () =>
    (await api.get('/api/wallet/topup-requests/me')).data,

  topup: async (data: number | { amount: number; method?: string; proofImageUrl?: string; note?: string }) => {
    const payload = typeof data === 'number' ? { amount: data } : data;
    return (await api.post(API_ENDPOINTS.wallet.topup, payload)).data;
  },
};
