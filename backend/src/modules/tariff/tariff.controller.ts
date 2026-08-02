import { Response } from 'express';
import { AuthenticatedRequest } from '../../core/middleware/auth.middleware';
import { TariffEngineService } from './tariff.service';
import { TariffRepository } from './tariff.repository';
import { AppError } from '../../core/errors/AppError';
import { logger } from '../../config/logger';
import { AuditLogger } from '../../core/logging/audit.logger';

export class TariffController {
  private tariffEngine = new TariffEngineService();
  private tariffRepo = new TariffRepository();

  // ── Preview (siapa saja yang login boleh pakai, untuk pratinjau harga di app) ──
  previewFare = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const breakdown = await this.tariffEngine.calculateFare(req.body);
      return res.status(200).json({ breakdown });
    } catch (err: any) {
      logger.error('TariffController.previewFare error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal menghitung estimasi tarif.' });
    }
  };

  // ── Zones ──
  listZones = async (_req: AuthenticatedRequest, res: Response) => {
    const zones = await this.tariffRepo.listZones();
    return res.status(200).json({ zones });
  };

  createZone = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const zone = await this.tariffRepo.createZone(req.body.name);
      await AuditLogger.log(req.user!.id, 'TARIFF_ZONE_CREATE', `Membuat zona tarif: ${zone.name}`);
      return res.status(201).json({ message: 'Zona tarif berhasil dibuat!', zone });
    } catch (err: any) {
      logger.error('TariffController.createZone error: %s', err.message);
      return res.status(400).json({ error: err.message || 'Gagal membuat zona tarif.' });
    }
  };

  // ── Pricing Rules ──
  listRules = async (req: AuthenticatedRequest, res: Response) => {
    const zoneId = req.query.zoneId as string | undefined;
    const rules = await this.tariffRepo.listRules(zoneId);
    return res.status(200).json({ rules });
  };

  createRule = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const rule = await this.tariffRepo.createRule(req.body);
      await AuditLogger.log(
        req.user!.id,
        'TARIFF_RULE_CREATE',
        `Membuat PricingRule untuk ${req.body.serviceType} (baseFare Rp${req.body.baseFare})`
      );
      return res.status(201).json({ message: 'Aturan tarif berhasil dibuat!', rule });
    } catch (err: any) {
      logger.error('TariffController.createRule error: %s', err.message);
      return res.status(400).json({ error: err.message || 'Gagal membuat aturan tarif.' });
    }
  };

  updateRule = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const rule = await this.tariffRepo.updateRule(req.params.id, req.body);
      await AuditLogger.log(req.user!.id, 'TARIFF_RULE_UPDATE', `Memperbarui PricingRule #${req.params.id}`);
      return res.status(200).json({ message: 'Aturan tarif berhasil diperbarui!', rule });
    } catch (err: any) {
      logger.error('TariffController.updateRule error: %s', err.message);
      return res.status(400).json({ error: err.message || 'Gagal memperbarui aturan tarif.' });
    }
  };

  // ── Regional Policies ──
  listRegionalPolicies = async (_req: AuthenticatedRequest, res: Response) => {
    const policies = await this.tariffRepo.listRegionalPolicies();
    return res.status(200).json({ policies });
  };

  createRegionalPolicy = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const policy = await this.tariffRepo.createRegionalPolicy(req.body);
      await AuditLogger.log(req.user!.id, 'TARIFF_POLICY_CREATE', `Membuat RegionalPolicy untuk zona #${req.body.zoneId}`);
      return res.status(201).json({ message: 'Kebijakan regional berhasil dibuat!', policy });
    } catch (err: any) {
      logger.error('TariffController.createRegionalPolicy error: %s', err.message);
      return res.status(400).json({ error: err.message || 'Gagal membuat kebijakan regional.' });
    }
  };

  updateRegionalPolicy = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const policy = await this.tariffRepo.updateRegionalPolicy(req.params.id, req.body);
      await AuditLogger.log(req.user!.id, 'TARIFF_POLICY_UPDATE', `Memperbarui RegionalPolicy #${req.params.id}`);
      return res.status(200).json({ message: 'Kebijakan regional berhasil diperbarui!', policy });
    } catch (err: any) {
      logger.error('TariffController.updateRegionalPolicy error: %s', err.message);
      return res.status(400).json({ error: err.message || 'Gagal memperbarui kebijakan regional.' });
    }
  };

  // ── Tariff Versions (komisi tiered) ──
  listTariffVersions = async (_req: AuthenticatedRequest, res: Response) => {
    const versions = await this.tariffRepo.listTariffVersions();
    return res.status(200).json({ versions });
  };

  createTariffVersion = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { versionName, commissionTiers, description } = req.body;
      const version = await this.tariffRepo.createTariffVersion(versionName, commissionTiers, description);
      await AuditLogger.log(req.user!.id, 'TARIFF_VERSION_CREATE', `Membuat TariffVersion: ${versionName}`);
      return res.status(201).json({ message: 'Versi tarif berhasil dibuat! (belum aktif — aktifkan lewat endpoint activate)', version });
    } catch (err: any) {
      logger.error('TariffController.createTariffVersion error: %s', err.message);
      return res.status(400).json({ error: err.message || 'Gagal membuat versi tarif.' });
    }
  };

  activateTariffVersion = async (req: AuthenticatedRequest, res: Response) => {
    try {
      await this.tariffRepo.activateTariffVersion(req.params.id);
      await AuditLogger.log(req.user!.id, 'TARIFF_VERSION_ACTIVATE', `Mengaktifkan TariffVersion #${req.params.id}`);
      return res.status(200).json({ message: 'Versi tarif berhasil diaktifkan! Berlaku langsung tanpa perlu rilis aplikasi baru.' });
    } catch (err: any) {
      logger.error('TariffController.activateTariffVersion error: %s', err.message);
      return res.status(400).json({ error: err.message || 'Gagal mengaktifkan versi tarif.' });
    }
  };

  // ── Platform Config (mis. minimum deposit driver) ──
  listConfig = async (_req: AuthenticatedRequest, res: Response) => {
    const config = await this.tariffRepo.listConfig();
    return res.status(200).json({ config });
  };

  upsertConfig = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { key } = req.params;
      const { value, description } = req.body;
      const config = await this.tariffRepo.upsertConfig(key, value, description);
      await AuditLogger.log(req.user!.id, 'PLATFORM_CONFIG_UPDATE', `Mengubah konfigurasi ${key} menjadi ${value}`);
      return res.status(200).json({ message: 'Konfigurasi berhasil disimpan!', config });
    } catch (err: any) {
      logger.error('TariffController.upsertConfig error: %s', err.message);
      return res.status(400).json({ error: err.message || 'Gagal menyimpan konfigurasi.' });
    }
  };
}
