import { api } from "./apiClient";
import { API_ENDPOINTS } from "@obama/shared-api";

export const AdminAPI = {
  getDashboard: async () =>
    (await api.get(API_ENDPOINTS.admin.dashboard)).data,

  createAdmin: async (data: { email: string; password: string; fullName: string }) =>
    (await api.post('/api/admin/create-admin', data)).data,

  getAdmins: async () =>
    (await api.get('/api/admin/admins')).data,

  deactivateAdmin: async (adminId: string, reason?: string) =>
    (await api.patch(`/api/admin/admins/${adminId}/deactivate`, { reason })).data,

  getPendingDriverDocuments: async () =>
    (
      await api.get(
        API_ENDPOINTS.admin.pendingDriverDocuments
      )
    ).data,

  getDriverDocumentFile: async (documentId: string) =>
    (
      await api.get(
        `/api/admin/driver-documents/${documentId}/file`,
        { responseType: 'blob' }
      )
    ).data as Blob,

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

  // ============================================================
  // 🔒 TARIFF MANAGEMENT (Admin only)
  // ============================================================

  // Get all pricing rules (filter by serviceType optional)
  getPricingRules: async (serviceType?: string) =>
    (await api.get('/api/tariff/rules', { params: { serviceType } })).data,

  // Create new pricing rule
  createPricingRule: async (data: {
    serviceType: string;
    baseFare: number;
    pickupFee?: number;
    perKmFee: number;
    perMinuteWaitFee?: number;
    zoneId?: string;
  }) =>
    (await api.post('/api/tariff/rules', data)).data,

  // Update existing pricing rule
  updatePricingRule: async (id: string, data: any) =>
    (await api.patch(`/api/tariff/rules/${id}`, data)).data,

  // ============================================================
  // 🔒 PRICING ZONE MANAGEMENT (Admin only)
  // ============================================================

  // Get all pricing zones
  getPricingZones: async () =>
    (await api.get('/api/tariff/zones')).data,

  // Create new pricing zone
  createPricingZone: async (name: string) =>
    (await api.post('/api/tariff/zones', { name })).data,

  // ============================================================
  // 🔒 REGIONAL POLICY MANAGEMENT (Admin only)
  // ============================================================

  // Get all regional policies
  getRegionalPolicies: async () =>
    (await api.get('/api/tariff/regional-policies')).data,

  // Create new regional policy
  createRegionalPolicy: async (data: {
    zoneId: string;
    tollFee?: number;
    parkingFee?: number;
    weatherSurcharge?: number;
    holidaySurcharge?: number;
  }) =>
    (await api.post('/api/tariff/regional-policies', data)).data,

  // Update regional policy
  updateRegionalPolicy: async (id: string, data: any) =>
    (await api.patch(`/api/tariff/regional-policies/${id}`, data)).data,

  // ============================================================
  // 🔒 TARIFF VERSION MANAGEMENT (Admin only)
  // ============================================================

  // Get all tariff versions
  getTariffVersions: async () =>
    (await api.get('/api/tariff/versions')).data,

  // Create new tariff version
  createTariffVersion: async (data: {
    versionName: string;
    commissionTiers: Array<{ maxOrderValue: number | null; rate: number }>;
    description?: string;
  }) =>
    (await api.post('/api/tariff/versions', data)).data,

  // Activate tariff version
  activateTariffVersion: async (id: string) =>
    (await api.post(`/api/tariff/versions/${id}/activate`)).data,

  // ============================================================
  // 🔒 PLATFORM CONFIG MANAGEMENT (Admin only)
  // ============================================================

  // Get all platform configs
  getPlatformConfigs: async () =>
    (await api.get('/api/tariff/config')).data,

  // Update platform config
  updatePlatformConfig: async (key: string, value: string, description?: string) =>
    (await api.put(`/api/tariff/config/${key}`, { value, description })).data,
};