// src/api/response.helper.ts
import { ApiResponse } from './merchant.api';

/**
 * Extract data from API response
 * @param response - API response dengan wrapper
 * @returns Data yang diekstrak
 */
export function extractData<T>(response: { data: ApiResponse<T> }): T {
  // Memastikan response sukses dan data tidak bernilai undefined/null
  if (!response.data.success || response.data.data === undefined || response.data.data === null) {
    throw new Error(response.data.message || 'Request failed or data is empty');
  }
  
  // TypeScript otomatis tahu bahwa data di sini pasti bertipe T (bukan undefined)
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
