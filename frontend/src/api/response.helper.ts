// api/response.helper.ts
import { ApiResponse } from './merchant.api';

/**
 * Extract data from API response
 * @param response - API response dengan wrapper
 * @returns Data yang diekstrak
 */
export function extractData<T>(response: { data: ApiResponse<T> }): T {
  if (!response.data.success) {
    throw new Error(response.data.message || 'Request failed');
  }
  return response.data.data;
}

/**
 * Extract data with fallback
 */
export function extractDataOrThrow<T>(
  response: { data: ApiResponse<T> },
  errorMessage?: string
): T {
  if (!response.data.success || !response.data.data) {
    throw new Error(errorMessage || response.data.message || 'Data not found');
  }
  return response.data.data;
}

// Penggunaan di Dashboard:
// const merchant = extractData(await merchantApi.getMyMerchant());
// const stats = extractData(await merchantApi.getMyStats());