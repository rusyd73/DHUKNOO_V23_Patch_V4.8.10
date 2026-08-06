import { api } from "./apiClient";
import { API_ENDPOINTS } from "@obama/shared-api";

export const AuthAPI = {
  register: async (payload: any) =>
    (await api.post(API_ENDPOINTS.auth.register, payload)).data,

  login: async (payload: any) =>
    (await api.post(API_ENDPOINTS.auth.login, payload)).data,

  refresh: async (refreshToken: string) =>
    (await api.post(API_ENDPOINTS.auth.refresh, { refreshToken })).data,

  getProfile: async () =>
    (await api.get(API_ENDPOINTS.auth.profile)).data,

  changePassword: async (payload: any) =>
    (await api.post(API_ENDPOINTS.auth.changePassword, payload)).data,

  requestPasswordReset: async (payload: any) =>
    (await api.post(API_ENDPOINTS.auth.requestPasswordReset, payload)).data,

  confirmPasswordReset: async (payload: any) =>
    (await api.post(API_ENDPOINTS.auth.confirmPasswordReset, payload)).data,
};