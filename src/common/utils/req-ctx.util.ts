import { Request } from 'express';
import { ReqCtx } from '../interfaces/req-ctx.interface';

export const reqCtx = (req: Request): ReqCtx => ({
  ip: req.ip,
  userAgent: req.headers['user-agent'],
  requestId: (req as any).requestId,
});
