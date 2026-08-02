/**
 * ─────────────────────────────────────────────────────────────────────────────
 * REPORT MODULE TYPES & INTERFACES
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type ReportFormat = 'pdf' | 'excel';

export type ReportStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export type ReportType = 'orders' | 'payments' | 'wallet' | 'customers' | 'drivers' | 'merchant' | 'promo';

/**
 * Filter pencarian data laporan yang dikirim dari client (Query Params)
 */
export interface ReportFilters {
  startDate?: string;
  endDate?: string;
  status?: string;
  merchantId?: string;
  customerId?: string;
  driverId?: string;
  paymentMethod?: string;
  serviceType?: string;
}

/**
 * Representasi muatan data (Payload) yang disimpan ke dalam antrean BullMQ
 */
export interface ReportJobPayload {
  userId: string;
  reportType: ReportType;
  format: ReportFormat;
  filters: ReportFilters;
}

/**
 * Response objek hasil keluaran worker setelah berkas berhasil diunggah ke cloud storage
 */
export interface ReportResult {
  success: boolean;
  downloadUrl: string;
  fileName?: string;
  generatedAt?: Date;
}

/**
 * Pemantauan progress pengerjaan background job laporan
 */
export interface ReportProgress {
  jobId: string;
  progress: number;
  status: ReportStatus;
}
