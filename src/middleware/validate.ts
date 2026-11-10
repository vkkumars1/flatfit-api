import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

type Where = 'body' | 'query' | 'params';
// why: Zod validates every request so bad input never reaches services.
export const validate = (schema: ZodType<any>, where: Where = 'body'): RequestHandler => (req, _res, next) => {
  const result = schema.safeParse((req as any)[where]);
  if (!result.success) return next(result.error);
  (req as any)[where] = result.data;
  next();
};
