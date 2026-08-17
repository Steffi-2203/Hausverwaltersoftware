export class ApiError extends Error {
  statusCode: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(statusCode: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.name = "ApiError";
  }
}

export const Errors = {
  notFound: (resource: string) => new ApiError(404, "NOT_FOUND", `${resource} nicht gefunden`),
  forbidden: (reason?: string) => new ApiError(403, "FORBIDDEN", reason || "Zugriff verweigert"),
  unauthorized: () => new ApiError(401, "UNAUTHORIZED", "Nicht authentifiziert"),
  badRequest: (message: string, details?: Record<string, unknown>) => new ApiError(400, "BAD_REQUEST", message, details),
  conflict: (message: string) => new ApiError(409, "CONFLICT", message),
  validation: (errors: Record<string, string>) => new ApiError(422, "VALIDATION_ERROR", "Validierungsfehler", { fields: errors }),
  periodLocked: (year: number, month: number) => new ApiError(423, "PERIOD_LOCKED", `Buchungsperiode ${month}/${year} ist gesperrt`),
  rateLimited: () => new ApiError(429, "RATE_LIMITED", "Zu viele Anfragen"),
  internal: (message?: string) => new ApiError(500, "INTERNAL_ERROR", message || "Interner Serverfehler"),
};

export function apiErrorHandler(err: Error, req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) {
  // TokenLookupDbError: DB war beim Token-Lookup nicht erreichbar → 503 damit das
  // Mobilgerät weiß, dass ein Retry sinnvoll ist (statt stiller 401 oder generischer 500).
  // Verglichen per name-String um einen Zirkularimport zu vermeiden.
  if (err.name === "TokenLookupDbError") {
    const response: Record<string, unknown> = {
      message: "Dienst vorübergehend nicht verfügbar — bitte kurz warten und erneut versuchen",
      retryable: true,
      code: "TOKEN_DB_ERROR",
    };
    if (req.requestId) response.requestId = req.requestId;
    return res.status(503).json(response);
  }

  if (err instanceof ApiError) {
    const response: Record<string, unknown> = {
      error: err.message,
      code: err.code,
    };
    if (err.details) {
      response.details = err.details;
    }
    if (req.requestId) {
      response.requestId = req.requestId;
    }
    return res.status(err.statusCode).json(response);
  }

  console.error("Unhandled error:", err);
  const response: Record<string, unknown> = {
    error: "Interner Serverfehler",
    code: "INTERNAL_ERROR",
  };
  if (req.requestId) {
    response.requestId = req.requestId;
  }
  res.status(500).json(response);
}
