import { Router } from 'express';
import { TariffController } from './tariff.controller';
import { authenticateToken, authorizeRoles } from '../../core/middleware/auth.middleware';
import { validateBody } from '../../core/middleware/validation.middleware';
import {
  createPricingZoneSchema,
  createPricingRuleSchema,
  updatePricingRuleSchema,
  createRegionalPolicySchema,
  updateRegionalPolicySchema,
  createTariffVersionSchema,
  previewFareSchema,
  updateConfigSchema,
} from '../../core/validation/schemas';

const router = Router();
const tariffController = new TariffController();

// Pratinjau tarif — dipakai app customer untuk menampilkan estimasi SEBELUM order dibuat.
// Siapa saja yang login boleh akses (bukan cuma admin), karena ini dipakai di layar booking.
router.post('/preview', authenticateToken as any, validateBody(previewFareSchema), tariffController.previewFare as any);

// ── Sisanya semua khusus ADMIN — inilah "panel admin" untuk Tariff Engine ──
router.use(authenticateToken as any, authorizeRoles('ADMIN') as any);

router.get('/zones', tariffController.listZones as any);
router.post('/zones', validateBody(createPricingZoneSchema), tariffController.createZone as any);

router.get('/rules', tariffController.listRules as any);
router.post('/rules', validateBody(createPricingRuleSchema), tariffController.createRule as any);
router.patch('/rules/:id', validateBody(updatePricingRuleSchema), tariffController.updateRule as any);

router.get('/regional-policies', tariffController.listRegionalPolicies as any);
router.post('/regional-policies', validateBody(createRegionalPolicySchema), tariffController.createRegionalPolicy as any);
router.patch('/regional-policies/:id', validateBody(updateRegionalPolicySchema), tariffController.updateRegionalPolicy as any);

router.get('/versions', tariffController.listTariffVersions as any);
router.post('/versions', validateBody(createTariffVersionSchema), tariffController.createTariffVersion as any);
router.post('/versions/:id/activate', tariffController.activateTariffVersion as any);

router.get('/config', tariffController.listConfig as any);
router.put('/config/:key', validateBody(updateConfigSchema), tariffController.upsertConfig as any);

export const tariffRouter = router;
