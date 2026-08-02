import { api } from "./apiClient";
import { API_ENDPOINTS } from "@obama/shared-api";

export const DriverAPI = {
  getProfile: async () =>
    (await api.get(API_ENDPOINTS.driver.profile)).data,

  updateProfile: async (payload: any) =>
    (await api.patch(API_ENDPOINTS.driver.profile, payload)).data,

  getJobs: async () =>
    (await api.get(API_ENDPOINTS.driver.jobs)).data,

  acceptJob: async (jobId: string) =>
    (await api.patch(API_ENDPOINTS.order.accept(jobId))).data,

  updateJobStatus: async (jobId: string, status: string) =>
    (
      await api.post(
        API_ENDPOINTS.driver.updateJobStatus(jobId),
        { status }
      )
    ).data,

  toggleOnlineStatus: async (isOnline: boolean) =>
    (
      await api.patch(
        API_ENDPOINTS.driver.status,
        { isOnline }
      )
    ).data,

  toggleAutoAccept: async (autoAcceptEnabled: boolean) =>
    (
      await api.patch(
        '/api/driver/auto-accept',
        { autoAcceptEnabled }
      )
    ).data,

  getMyDocuments: async () =>
    (await api.get(API_ENDPOINTS.driver.myDocuments)).data,

  uploadDocument: async (type: string, imageUrl: string) =>
    (
      await api.post(
        API_ENDPOINTS.driver.uploadDocument,
        {
          type,
          imageUrl,
        }
      )
    ).data,
};