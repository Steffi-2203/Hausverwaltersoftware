import type { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction) {
  req.requestId = uuidv4();
  next();
}

export function globalErrorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const status = (err as any)?.status || (err as any)?.statusCode || 500;
  const message = (err as any)?.message || "Internal Server Error";
  const code = (err as any)?.code;
  const stack = (err as any)?.stack;

  const userId = (req as any).session?.userId;
  console.error(JSON.stringify({
    level: "error",
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    userId: userId || null,
    error: message,
    code: code || undefined,
    stack: stack || undefined,
    timestamp: new Date().toISOString(),
  }));

  const isProduction = process.env.NODE_ENV === "production";

  res.status(status).json({
    error: isProduction && status === 500 ? "Internal Server Error" : message,
    ...(code && { code }),
    ...(req.requestId && { requestId: req.requestId }),
  });
}
