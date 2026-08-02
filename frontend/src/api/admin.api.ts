import { api } from "./apiClient";
import { API_ENDPOINTS } from "@obama/shared-api";

export const AdminAPI = {
  getDashboard: async () =>
    (await api.get(API_ENDPOINTS.admin.dashboard)).data,

  getPendingDriverDocuments: async () =>
    (
      await api.get(
        API_ENDPOINTS.admin.pendingDriverDocuments
      )
    ).data,

  reviewDriverDocument: async (
    documentId: string,
    status: string
  ) =>
    (
      await api.post(
        API_ENDPOINTS.admin.reviewDriverDocument(documentId),
        { status }
      )
    ).data,

  getPendingTopupRequests: async () =>
    (await api.get('/api/admin/topup-requests/pending')).data,

  reviewTopupRequest: async (id: string, status: 'APPROVED' | 'REJECTED', reviewNote?: string) =>
    (await api.post(`/api/admin/topup-requests/${id}/review`, { status, reviewNote })).data,

  verifyDriver: async (driverId: string) =>
    (
      await api.post(
        API_ENDPOINTS.admin.verifyDriver(driverId)
      )
    ).data,

  suspendDriver: async (driverId: string) =>
    (
      await api.post(
        API_ENDPOINTS.admin.suspendDriver(driverId)
      )
    ).data,

  getLogs: async () =>
    (await api.get(API_ENDPOINTS.admin.logs)).data,

  getCommissionAudit: async () =>
    (await api.get('/api/admin/commission-audit')).data,

  getRecap: async (timeframe: 'daily' | 'weekly' | 'monthly' = 'daily') =>
    (await api.get('/api/admin/recap', { params: { timeframe } })).data,

  // Export file (Excel/PDF) — responseType 'blob' wajib supaya axios tidak
  // mencoba parse binary sebagai JSON, lalu trigger download lewat <a> sementara.
  exportRecap: async (format: 'excel' | 'pdf', timeframe: 'daily' | 'weekly' | 'monthly' = 'daily') => {
    const res = await api.get(`/api/admin/export/${format}`, {
      params: { timeframe },
      responseType: 'blob',
    });
    const contentDisposition = res.headers['content-disposition'] as string | undefined;
    const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
    const filename = filenameMatch?.[1] || `dhuknoo-rekap-${timeframe}.${format === 'excel' ? 'xlsx' : 'pdf'}`;

    const blobUrl = window.URL.createObjectURL(new Blob([res.data]));
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(blobUrl);
  },
};
