import { api } from "./apiClient";
import { API_ENDPOINTS } from "@obama/shared-api";

export const PaymentAPI = {

  charge: async (payload: any) =>
    (
      await api.post(
        API_ENDPOINTS.payment.charge,
        payload
      )
    ).data,

  chargeOrder: async (
    orderId: string,
    idempotencyKey: string
  ) =>
    (
      await api.post(
        API_ENDPOINTS.payment.charge,
        {
          orderId,
          idempotencyKey,
        }
      )
    ).data,

  confirmCash: async (orderId: string) =>
    (
      await api.post(
        API_ENDPOINTS.payment.confirmCash,
        {
          orderId,
        }
      )
    ).data,

  submitProof: async (
    orderId: string,
    method: string,
    imageUrl: string,
    note?: string
  ) =>
    (
      await api.post(
        API_ENDPOINTS.payment.submitProof,
        {
          orderId,
          method,
          // PERBAIKAN: backend (submitPaymentProofSchema) mewajibkan field
          // "proofImageUrl", bukan "imageUrl" — mismatch ini yang bikin Zod
          // menolak request dengan 400 Bad Request.
          proofImageUrl: imageUrl,
          note,
        }
      )
    ).data,

  getPendingProofs: async () =>
    (
      await api.get(
        API_ENDPOINTS.payment.pendingProofs
      )
    ).data,

  reviewProof: async (
    proofId: string,
    status: string
  ) =>
    (
      // PERBAIKAN: backend mendaftarkan route ini sebagai router.patch(...),
      // bukan POST — request sebelumnya akan gagal (404/405).
      await api.patch(
        API_ENDPOINTS.payment.reviewProof(proofId),
        { status }
      )
    ).data,
};