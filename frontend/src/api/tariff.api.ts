import { api } from "./apiClient";
import { API_ENDPOINTS } from "@obama/shared-api";

export const TariffAPI = {
  /* ==========================================================================
     Preview Tarif
     ========================================================================== */
  preview: async (payload: {
    serviceType: "BIKE" | "CAR" | "SEND";
    distanceKm: number;
    zoneName?: string;
    waitMinutes?: number;
    hasToll?: boolean;
    hasParking?: boolean;
    isBadWeather?: boolean;
    isHoliday?: boolean;
    promoDiscount?: number;
  }) =>
    (await api.post(API_ENDPOINTS.tariff.preview, payload)).data,

  /* ==========================================================================
     Zona
     ========================================================================== */
  listZones: async () =>
    (await api.get(API_ENDPOINTS.tariff.zones)).data,

  createZone: async (name: string) =>
    (await api.post(API_ENDPOINTS.tariff.zones, { name })).data,

  /* ==========================================================================
     Rules
     ========================================================================== */
  listRules: async (zoneId?: string) =>
    (
      await api.get(API_ENDPOINTS.tariff.rules, {
        params: zoneId ? { zoneId } : {},
      })
    ).data,

  createRule: async (payload: any) =>
    (await api.post(API_ENDPOINTS.tariff.rules, payload)).data,

  updateRule: async (ruleId: string, payload: any) =>
    (
      await api.patch(
        API_ENDPOINTS.tariff.updateRule(ruleId),
        payload
      )
    ).data,

  /* ==========================================================================
     Regional Policies
     ========================================================================== */
  listRegionalPolicies: async () =>
    (
      await api.get(API_ENDPOINTS.tariff.regionalPolicies)
    ).data,

  createRegionalPolicy: async (payload: any) =>
    (
      await api.post(
        API_ENDPOINTS.tariff.regionalPolicies,
        payload
      )
    ).data,

  updateRegionalPolicy: async (
    policyId: string,
    payload: any
  ) =>
    (
      await api.patch(
        API_ENDPOINTS.tariff.updateRegionalPolicy(policyId),
        payload
      )
    ).data,

  /* ==========================================================================
     Versioning
     ========================================================================== */
  listVersions: async () =>
    (
      await api.get(API_ENDPOINTS.tariff.versions)
    ).data,

  createVersion: async (payload: {
    versionName: string;
    commissionTiers: any[];
    description?: string;
  }) =>
    (
      await api.post(
        API_ENDPOINTS.tariff.versions,
        payload
      )
    ).data,

  activateVersion: async (versionId: string) =>
    (
      await api.post(
        API_ENDPOINTS.tariff.activateVersion(versionId)
      )
    ).data,

  /* ==========================================================================
     Config
     ========================================================================== */
  listConfig: async () =>
    (
      await api.get(API_ENDPOINTS.tariff.config)
    ).data,

  updateConfig: async (
    key: string,
    value: string,
    description?: string
  ) =>
    (
      await api.patch(
        API_ENDPOINTS.tariff.updateConfig(key),
        {
          value,
          description,
        }
      )
    ).data,
};