import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { authenticateToken, authorizeRoles } from '../../core/middleware/auth.middleware';

const router = Router();

const surveySchema = z.object({
  audience: z.enum(['CUSTOMER', 'DRIVER', 'MERCHANT', 'GENERAL']),
  answers: z.record(z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])),
  source: z.string().max(120).optional(),
});

const betaSchema = z.object({
  audience: z.enum(['CUSTOMER', 'DRIVER', 'MERCHANT']),
  fullName: z.string().trim().min(2).max(120),
  whatsapp: z.string().trim().min(8).max(30),
  city: z.string().trim().min(2).max(120),
  note: z.string().trim().max(1000).optional(),
  consent: z.literal(true),
  source: z.string().max(120).optional(),
});

router.post('/survey', async (req, res, next) => {
  try {
    const parsed = surveySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Data survey tidak valid.', details: parsed.error.flatten() });
    }
    const row = await prisma.publicSurveyResponse.create({
      data: {
        audience: parsed.data.audience,
        answers: parsed.data.answers,
        source: parsed.data.source || null,
        userAgent: req.get('user-agent')?.slice(0, 500) || null,
      },
      select: { id: true, createdAt: true },
    });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    next(error);
  }
});

router.post('/beta', async (req, res, next) => {
  try {
    const parsed = betaSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Data pendaftaran beta tidak valid.', details: parsed.error.flatten() });
    }
    const row = await prisma.publicBetaRegistration.create({
      data: {
        audience: parsed.data.audience,
        fullName: parsed.data.fullName,
        whatsapp: parsed.data.whatsapp,
        city: parsed.data.city,
        note: parsed.data.note || null,
        consent: parsed.data.consent,
        source: parsed.data.source || null,
      },
      select: { id: true, createdAt: true },
    });
    return res.status(201).json({ success: true, data: row });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ success: false, error: 'Nomor WhatsApp ini sudah terdaftar untuk Public Beta.' });
    }
    next(error);
  }
});

router.get('/insights', authenticateToken as any, authorizeRoles('ADMIN') as any, async (_req, res, next) => {
  try {
    const [surveyTotal, betaTotal, surveyGroups, betaGroups, latestSurvey, latestBeta] = await Promise.all([
      prisma.publicSurveyResponse.count(),
      prisma.publicBetaRegistration.count(),
      prisma.publicSurveyResponse.groupBy({ by: ['audience'], _count: { _all: true } }),
      prisma.publicBetaRegistration.groupBy({ by: ['audience'], _count: { _all: true } }),
      prisma.publicSurveyResponse.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.publicBetaRegistration.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    return res.json({ success: true, data: { surveyTotal, betaTotal, surveyGroups, betaGroups, latestSurvey, latestBeta } });
  } catch (error) {
    next(error);
  }
});

export const publicRouter = router;
