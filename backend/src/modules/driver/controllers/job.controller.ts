import { Response } from 'express';
import { AuthenticatedRequest } from '../../../core/middleware/auth.middleware';
import { JobService } from '../services/job.service';
import { AppError } from '../../../core/errors/AppError';
import { logger } from '../../../config/logger';

export class JobController {
  private jobService = new JobService();

  // ============================================================
  // 🔒 GET ELIGIBLE JOBS FOR DRIVER
  // ============================================================
  getEligibleJobs = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const driverId = req.user!.id;
      const { limit = 20, offset = 0 } = req.query;

      const result = await this.jobService.getEligibleJobs(
        driverId,
        Number(limit),
        Number(offset)
      );

      return res.status(200).json({
        success: true,
        data: result.jobs,
        pagination: {
          total: result.total,
          limit: Number(limit),
          offset: Number(offset),
        },
        metadata: {
          driverId: result.driverId,
          serviceType: result.serviceType,
          minimumDeposit: result.minimumDeposit,
          balance: result.balance,
        },
      });

    } catch (err: any) {
      logger.error('JobController.getEligibleJobs error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal mengambil daftar job.',
      });
    }
  };

  // ============================================================
  // 🔒 GET JOB DETAIL - HANYA JIKA ELIGIBLE ATAU ASSIGNED
  // ============================================================
  getJobDetail = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const driverId = req.user!.id;
      const { orderId } = req.params;

      const result = await this.jobService.getJobDetail(driverId, orderId);

      return res.status(200).json({
        success: true,
        data: result,
      });

    } catch (err: any) {
      logger.error('JobController.getJobDetail error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal mengambil detail job.',
      });
    }
  };
}