import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';


export const validateBody = (schema: ZodSchema) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      req.body = await schema.parseAsync(req.body);
      next();

    } catch (err) {

      if (err instanceof ZodError) {

        const issues = err.issues.map(
          (i) => `${i.path.join('.')}: ${i.message}`
        );

        return res.status(400).json({
          error: issues[0] || 'Validasi request gagal!',
          details: issues,
        });
      }

      next(err);
    }
  };
};



/**
 * Validate query string
 *
 * Digunakan untuk:
 * GET /location/search
 * GET /location/reverse
 *
 * Karena req.query berasal dari URL,
 * hasil parse akan menggantikan req.query.
 */
export const validateQuery = (schema: ZodSchema) => {

  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {

    try {

      Object.assign(req.query, await schema.parseAsync(req.query));

      next();

    } catch (err) {

      if (err instanceof ZodError) {

        const issues = err.issues.map(
          (i) => `${i.path.join('.')}: ${i.message}`
        );

        return res.status(400).json({
          error: issues[0] || 'Validasi query gagal!',
          details: issues,
        });
      }

      next(err);
    }
  };
};