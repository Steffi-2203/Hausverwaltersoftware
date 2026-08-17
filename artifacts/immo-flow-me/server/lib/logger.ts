import crypto from "crypto";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  [key: string]: unknown;
}

const isProduction = process.env.NODE_ENV === "production";

const PII_PATTERNS: Array<{ regex: RegExp; replacer: (match: string, ...groups: string[]) => string }> = [
  {
    regex: /\b(AT|DE)\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}(?:\s?\d{0,4})?\b/g,
    replacer: (match) => {
      const cleaned = match.replace(/\s/g, "");
      const prefix = cleaned.slice(0, 4);
      const suffix = cleaned.slice(-4);
      return `${prefix}${"*".repeat(cleaned.length - 8)}${suffix}`;
    },
  },
  {
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacer: (match) => {
      const [local, domain] = match.split("@");
      return `${local[0]}***@${domain}`;
    },
  },
  {
    regex: /\+43[\s\-]?(?:\d[\s\-]?){5,15}/g,
    replacer: (match) => {
      const cleaned = match.replace(/[\s\-]/g, "");
      return `+43***${cleaned.slice(-2)}`;
    },
  },
  {
    regex: /\+49[\s\-]?(?:\d[\s\-]?){5,15}/g,
    replacer: (match) => {
      const cleaned = match.replace(/[\s\-]/g, "");
      return `+49***${cleaned.slice(-2)}`;
    },
  },
  {
    regex: /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g,
    replacer: (match) => {
      const cleaned = match.replace(/[\s\-]/g, "");
      return `****${cleaned.slice(-4)}`;
    },
  },
  {
    regex: /\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g,
    replacer: (match) => {
      return `${match.slice(0, 3)}****`;
    },
  },
];

export function redactPII(input: string): string {
  let result = input;
  for (const { regex, replacer } of PII_PATTERNS) {
    regex.lastIndex = 0;
    result = result.replace(regex, replacer);
  }
  return result;
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactPII(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = redactValue(v);
    }
    return result;
  }
  return value;
}

function formatLog(entry: LogEntry): string {
  if (isProduction) {
    return JSON.stringify(entry);
  }
  const { timestamp, level, message, requestId, ...meta } = entry;
  const rid = requestId ? ` [${requestId.slice(0, 8)}]` : "";
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  return `${timestamp} [${level.toUpperCase()}]${rid} ${message}${metaStr}`;
}

function writeLog(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const redactedMessage = redactPII(message);
  const redactedMeta = meta ? redactValue(meta) as Record<string, unknown> : undefined;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message: redactedMessage,
    ...redactedMeta,
  };

  const formatted = formatLog(entry);

  switch (level) {
    case "error":
      console.error(formatted);
      break;
    case "warn":
      console.warn(formatted);
      break;
    case "debug":
      if (!isProduction) console.log(formatted);
      break;
    default:
      console.log(formatted);
  }
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => writeLog("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => writeLog("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => writeLog("error", message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => writeLog("debug", message, meta),
};

export function createRequestLogger() {
  return (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    req.requestId = crypto.randomUUID();
    res.setHeader("X-Request-Id", req.requestId);

    const redactedUrl = redactPII(req.originalUrl || req.url);
    const redactedQuery = redactValue(req.query) as Record<string, unknown>;
    const redactedBody = req.body ? redactValue(req.body) : undefined;

    logger.info(`${req.method} ${redactedUrl}`, {
      requestId: req.requestId,
      ...(Object.keys(redactedQuery).length > 0 && { query: redactedQuery }),
      ...(redactedBody && Object.keys(redactedBody as Record<string, unknown>).length > 0 && { body: redactedBody }),
    });

    next();
  };
}
