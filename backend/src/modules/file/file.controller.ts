// modules/file/file.controller.ts
import { Response } from 'express';
import { AuthenticatedRequest } from '../../core/middleware/auth.middleware';
import { FileService } from './file.service';
import { logger } from '../../config/logger';
import { AppError } from '../../core/errors/AppError';

export class FileController {
  private fileService = new FileService();

  // ============================================================
  // 🔒 GET FILE DENGAN AUTHORIZATION
  // ============================================================
  getFile = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const role = req.user!.role;
      const fileId = req.params.id;

      if (!fileId) {
        return res.status(400).json({ error: 'File ID required' });
      }

      const fileInfo = await this.fileService.getFileInfo(fileId);

      if (!fileInfo) {
        return res.status(404).json({ error: 'File not found' });
      }

      const isAuthorized = await this.fileService.checkAuthorization(
        userId,
        role,
        fileInfo
      );

      if (!isAuthorized) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const filePath = fileInfo.path;
      const fileName = fileInfo.originalName || fileId;

      res.setHeader('Content-Type', fileInfo.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      
      return res.sendFile(filePath, { root: '.' });

    } catch (err: any) {
      logger.error('FileController.getFile error:', err);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Failed to get file' });
    }
  };

  // ============================================================
  // 🔒 UPLOAD FILE DENGAN AUTHORIZATION
  // ============================================================
  uploadFile = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const role = req.user!.role;
      const { type, entityId } = req.body;

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const result = await this.fileService.saveFile(
        userId,
        role,
        type,
        entityId,
        req.file
      );

      return res.status(200).json({
        success: true,
        data: result,
      });

    } catch (err: any) {
      logger.error('FileController.uploadFile error:', err);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Failed to upload file' });
    }
  };

  // ============================================================
  // 🔒 DELETE FILE
  // ============================================================
  deleteFile = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const role = req.user!.role;
      const fileId = req.params.id;

      const result = await this.fileService.deleteFile(fileId, userId, role);

      return res.status(200).json({
        success: true,
        message: 'File deleted successfully',
        data: result,
      });

    } catch (err: any) {
      logger.error('FileController.deleteFile error:', err);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Failed to delete file' });
    }
  };
}