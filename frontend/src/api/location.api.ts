import { api } from "./apiClient";
import { API_ENDPOINTS } from "@obama/shared-api";

// PERBARUAN: sebelumnya tidak ada client API sama sekali untuk driver
// mengirim update lokasi GPS mereka sendiri di luar sesi trip aktif --
// dipakai oleh DriverDashboardMap untuk auto-update lokasi berkala begitu
// driver online (termasuk saat baru kembali online setelah offline).
export const LocationAPI = {
  updateMyLocation: async (latitude: number, longitude: number, isOnline?: boolean) =>
    (
      await api.patch(API_ENDPOINTS.location.updateDriver, {
        latitude,
        longitude,
        ...(isOnline !== undefined ? { isOnline } : {}),
      })
    ).data,
};
