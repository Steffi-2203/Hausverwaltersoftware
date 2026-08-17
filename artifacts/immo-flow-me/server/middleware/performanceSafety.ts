import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";

export const bulkOperationsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Zu viele Massenoperationen. Bitte warten Sie eine Minute.', retryAfter: 60 },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    return (req as any).user?.id || req.ip || 'anonymous';
  },
});

export const exportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Zu viele Export-Anfragen. Bitte warten Sie eine Minute.', retryAfter: 60 },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    return (req as any).user?.id || req.ip || 'anonymous';
  },
});

export const ocrLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Zu viele OCR-Anfragen. Bitte warten Sie eine Minute.', retryAfter: 60 },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    return (req as any).user?.organizationId || req.ip || 'anonymous';
  },
});

export const reportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  message: { error: 'Zu viele Berichts-Anfragen. Bitte warten Sie eine Minute.', retryAfter: 60 },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    return (req as any).user?.id || req.ip || 'anonymous';
  },
});

class BackpressureController {
  private activeBulkJobs = 0;
  private queuedRequests = 0;
  private readonly maxConcurrentBulkJobs: number;
  private readonly maxQueueDepth: number;

  constructor(maxConcurrent = 3, maxQueue = 10) {
    this.maxConcurrentBulkJobs = maxConcurrent;
    this.maxQueueDepth = maxQueue;
  }

  canAcceptJob(): boolean {
    return this.activeBulkJobs < this.maxConcurrentBulkJobs;
  }

  canQueue(): boolean {
    return this.queuedRequests < this.maxQueueDepth;
  }

  startJob(): void {
    this.activeBulkJobs++;
  }

  finishJob(): void {
    this.activeBulkJobs = Math.max(0, this.activeBulkJobs - 1);
  }

  addToQueue(): void {
    this.queuedRequests++;
  }

  removeFromQueue(): void {
    this.queuedRequests = Math.max(0, this.queuedRequests - 1);
  }

  getStatus() {
    return {
      activeBulkJobs: this.activeBulkJobs,
      maxConcurrentBulkJobs: this.maxConcurrentBulkJobs,
      queuedRequests: this.queuedRequests,
      maxQueueDepth: this.maxQueueDepth,
      accepting: this.canAcceptJob() || this.canQueue(),
      load: this.activeBulkJobs / this.maxConcurrentBulkJobs,
    };
  }
}

export const backpressure = new BackpressureController(3, 10);

export function backpressureMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!backpressure.canAcceptJob()) {
    if (!backpressure.canQueue()) {
      return res.status(503).json({
        error: 'Server ist ausgelastet. Bitte versuchen Sie es in einigen Minuten erneut.',
        retryAfter: 30,
        status: backpressure.getStatus(),
      });
    }
    backpressure.addToQueue();
    const checkInterval = setInterval(() => {
      if (backpressure.canAcceptJob()) {
        clearInterval(checkInterval);
        clearTimeout(timeout);
        backpressure.removeFromQueue();
        backpressure.startJob();
        res.on('finish', () => backpressure.finishJob());
        next();
      }
    }, 500);

    const timeout = setTimeout(() => {
      clearInterval(checkInterval);
      backpressure.removeFromQueue();
      res.status(503).json({
        error: 'Warteschlange voll. Bitte versuchen Sie es später erneut.',
        retryAfter: 60,
      });
    }, 30000);
    return;
  }

  backpressure.startJob();
  res.on('finish', () => backpressure.finishJob());
  next();
}

export function gracefulDegradation(req: Request, res: Response, next: NextFunction) {
  const memUsage = process.memoryUsage();
  const heapUsedPercent = memUsage.heapUsed / memUsage.heapTotal;

  if (heapUsedPercent > 0.95) {
    if (req.path.includes('/export') || req.path.includes('/massen') || req.path.includes('/bulk')) {
      return res.status(503).json({
        error: 'System unter hoher Last. Nicht-kritische Operationen sind vorübergehend eingeschränkt.',
        retryAfter: 120,
      });
    }
  }

  if (heapUsedPercent > 0.85) {
    res.setHeader('X-Degraded-Mode', 'true');
    res.setHeader('X-Memory-Pressure', Math.round(heapUsedPercent * 100).toString());
  }

  next();
}

export function getPerformanceStatus() {
  const memUsage = process.memoryUsage();
  return {
    backpressure: backpressure.getStatus(),
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      rss: Math.round(memUsage.rss / 1024 / 1024),
      heapUsedPercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
    },
    uptime: Math.round(process.uptime()),
  };
}
