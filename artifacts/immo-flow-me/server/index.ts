import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import onFinished from "on-finished";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
// P0001-Audit-Handler: Erstregistrierung erfolgt jetzt bereits über den
// Bottom-of-file-Import in server/db.ts (garantiert auch in Skript-Kontexten).
// Dieser Import bleibt als Belt-and-Suspenders und ist ein No-Op wenn
// immutableViolationAudit.ts bereits via db.ts geladen wurde.
import "./lib/immutableViolationAudit";
import { parseEncryptionKey, isKeyRotationActive } from "./lib/fieldEncryption";
import { registerDsgvoRoutes } from "./routes/dsgvoRoutes";
import { registerSecurityRoutes, trackSession } from "./routes/securityRoutes";
import { registerTicketRoutes } from "./routes/ticketRoutes";
import { registerEsgRoutes } from "./routes/esgRoutes";
import { registerDamageRoutes } from "./routes/damageRoutes";
import { registerTenantPortalRoutes } from "./routes/tenantPortalRoutes";
import { registerTenantAuthRoutes } from "./routes/tenantAuthRoutes";
import { registerOwnerPortalRoutes } from "./routes/ownerPortalRoutes";
import { registerOwnerAuthRoutes } from "./routes/ownerAuthRoutes";
import { registerMetricsRoutes } from "./routes/metricsRoutes";
import { registerRetestRoutes } from "./routes/retestRoutes";
import { setupVite, serveStatic, log, logInfo, logError } from "./vite";
import { runMigrations } from 'stripe-replit-sync';
import { getStripeSync } from './stripeClient';
import { WebhookHandlers } from './webhookHandlers';
import { setupAuth, enforcePrivileged2FA, TokenLookupDbError } from "./auth";
import { pool } from "./db";
import { seedDistributionKeys } from "./seedDistributionKeys";
import { seedProductionDatabase } from "./seeds/production-seed";
import SESSION_SECRET from "./config/session";
import { csrfTokenMiddleware, csrfProtection, getCsrfToken } from "./middleware/csrf";
import { inputSanitizer } from "./middleware/sanitize";
import { logger, createRequestLogger } from "./lib/logger";
import { apiErrorHandler } from "./lib/apiErrors";
import { gracefulDegradation, getPerformanceStatus, bulkOperationsLimiter, exportLimiter, backpressureMiddleware } from "./middleware/performanceSafety";
import { ensureIndexes } from "./lib/ensureIndexes";
import { setupRLS } from "./lib/rlsPolicies";
import { setupFullTextSearch } from "./lib/fullTextSearch";
import { rlsMiddleware } from "./middleware/rlsMiddleware";
import { bearerSessionHydration } from "./middleware/bearerSessionHydration";
import promClient from "prom-client";
import { runSqlMigrations } from "./lib/runSqlMigrations";
import { populateAuditIntegrityQueue } from "./lib/populateAuditIntegrityQueue";
import { migrateFieldEncryption } from "./lib/migrateFieldEncryption";

promClient.collectDefaultMetrics();

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

const PgSession = connectPgSimple(session);

app.set("trust proxy", 1);

app.use(createRequestLogger());

// Security: Helmet for HTTP headers with CSP (nonce-based in production)
import crypto from "crypto";

app.use((req: any, _res, next) => {
  req.cspNonce = crypto.randomBytes(16).toString("base64");
  next();
});

app.use((req: any, res, next) => {
  const nonce = req.cspNonce;
  helmet({
    contentSecurityPolicy: isProduction ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", `'nonce-${nonce}'`],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'", "https://api.stripe.com", "https://*.replit.dev", "https://*.replit.app"],
        frameSrc: ["'self'", "https://js.stripe.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'", "https://*.replit.dev", "https://*.replit.app"],
        upgradeInsecureRequests: [],
      },
    } : false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  })(req, res, next);
});

app.use((_req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(self)");
  next();
});

// Security: Rate limiting - general API (100 req / 15 min per IP)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Zu viele Anfragen. Bitte versuchen Sie es später erneut.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !req.path.startsWith('/api'),
});
app.use(apiLimiter);

// Security: Rate limiting for auth routes (50 req / min per IP)
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 50,
  message: { error: 'Zu viele Anmeldeversuche. Bitte warten Sie eine Minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth', authLimiter);

app.use(gracefulDegradation);

app.use('/api/bulk', bulkOperationsLimiter, backpressureMiddleware);
app.use('/api/massen-aktionen', bulkOperationsLimiter, backpressureMiddleware);
app.use('/api/weg-reports', exportLimiter);
app.use('/api/weg/reports', exportLimiter);

// Security: CORS with whitelist
const allowedOrigins = [
  process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : '',
  process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` : '',
  process.env.REPLIT_DEPLOYMENT_ID ? `https://${process.env.REPL_SLUG}.replit.app` : '',
  'https://immoflowme.com',
  'https://www.immoflowme.com',
  'https://app.immoflowme.com',
  'https://immoflow.me',
  'https://www.immoflow.me',
  'https://immoflowme.at',
  'https://www.immoflowme.at',
  'https://app.immoflowme.at',
].filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-csrf-token');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(cookieParser());

app.use(csrfTokenMiddleware);

app.use(session({
  name: isProduction ? '__Secure-immo_sid' : 'immo_sid',
  store: new PgSession({
    pool: pool as any,
    tableName: 'user_sessions',
    createTableIfMissing: false,
  }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    sameSite: 'none' as const,
    maxAge: 1000 * 60 * 60 * 24, // 24 hours
  },
}));

// Bearer-Token → Session-Hydration (inkl. organizationId, Audit-Befund K2).
// Extrahiert nach middleware/bearerSessionHydration.ts, damit E2E-Tests exakt
// dieselbe Middleware verwenden.
app.use(bearerSessionHydration(pool, (msg, meta) => logger.error(msg, meta)));

// Stricter rate limit for Stripe webhooks
const webhookLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: 5,
  message: { error: 'Too many webhook requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.post(
  '/api/stripe/webhook',
  webhookLimiter,
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];

    if (!signature) {
      return res.status(400).json({ error: 'Missing stripe-signature' });
    }

    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;

      if (!Buffer.isBuffer(req.body)) {
        console.error('STRIPE WEBHOOK ERROR: req.body is not a Buffer');
        return res.status(500).json({ error: 'Webhook processing error' });
      }

      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (error: any) {
      console.error('Webhook error:', error.message);
      res.status(400).json({ error: 'Webhook processing error' });
    }
  }
);

app.use(compression());

app.get("/sitemap.xml", (_req, res) => {
  const baseUrl = "https://www.immoflowme.at";
  const pages = [
    { loc: "/", priority: "1.0", changefreq: "weekly" },
    { loc: "/preise", priority: "0.9", changefreq: "monthly" },
    { loc: "/demo", priority: "0.8", changefreq: "monthly" },
    { loc: "/login", priority: "0.5", changefreq: "yearly" },
    { loc: "/impressum", priority: "0.3", changefreq: "yearly" },
    { loc: "/datenschutz", priority: "0.3", changefreq: "yearly" },
    { loc: "/agb", priority: "0.3", changefreq: "yearly" },
    { loc: "/avv", priority: "0.3", changefreq: "yearly" },
    { loc: "/sla", priority: "0.4", changefreq: "yearly" },
    { loc: "/loeschkonzept", priority: "0.3", changefreq: "yearly" },
  ];
  const today = new Date().toISOString().split("T")[0];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(p => `  <url>
    <loc>${baseUrl}${p.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join("\n")}
</urlset>`;
  res.set("Content-Type", "application/xml");
  res.set("Cache-Control", "public, max-age=86400");
  res.send(xml);
});

app.get("/health", (_req, res) => {
  const rotationWindowOpen = isKeyRotationActive();
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    ...(rotationWindowOpen ? { keyRotationWindowOpen: true } : {}),
  });
});

// Uptime-Monitoring-Endpunkt (extern angepingt, z. B. UptimeRobot):
// prüft zusätzlich die Datenbank — 503 wenn die DB nicht erreichbar ist.
app.get("/api/healthz", async (_req, res) => {
  const rotationWindowOpen = isKeyRotationActive();
  try {
    await pool.query("SELECT 1");
    res.status(200).json({
      status: "ok",
      db: "ok",
      uptime: Math.round(process.uptime()),
      ...(rotationWindowOpen ? { keyRotationWindowOpen: true } : {}),
    });
  } catch {
    res.status(503).json({
      status: "degraded",
      db: "unreachable",
      ...(rotationWindowOpen ? { keyRotationWindowOpen: true } : {}),
    });
  }
});

app.get("/api/admin/performance", (_req, res) => {
  res.json(getPerformanceStatus());
});

app.get("/ready", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ ready: true });
  } catch {
    res.status(503).json({ ready: false, error: "db" });
  }
});

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", promClient.register.contentType);
  res.end(await promClient.register.metrics());
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false, limit: "10mb" }));

app.use(inputSanitizer);

app.get("/api/csrf-token", getCsrfToken);
app.use(csrfProtection);

// Sanitize sensitive data from logs
function sanitize(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") return obj;

  const clone = structuredClone(obj) as Record<string, unknown>;
  const sensitiveKeys = ["password", "token", "access_token", "refresh_token", "session", "secret", "apiKey", "api_key", "authorization"];

  for (const key of sensitiveKeys) {
    if (clone[key]) clone[key] = "***REDACTED***";
  }

  return clone;
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

  const isDev = !isProduction;
  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  onFinished(res, () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const meta: Record<string, unknown> = {
        method: req.method,
        path,
        statusCode: res.statusCode,
        duration,
        requestId: req.requestId,
        ip: req.ip,
      };

      if (isDev && req.body && Object.keys(req.body).length > 0) {
        meta.body = sanitize(req.body);
      }

      const logLine = `${req.method} ${path} ${res.statusCode} ${duration}ms`;

      if (res.statusCode >= 500) {
        logger.error(logLine, meta);
      } else if (res.statusCode >= 400) {
        logger.warn(logLine, meta);
      } else {
        logger.info(logLine, meta);
      }
    }
  });

  next();
});

async function initStripe() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log('Skipping Stripe init: DATABASE_URL not set');
    return;
  }

  try {
    console.log('Initializing Stripe schema...');
    let migrationSuccess = false;
    try {
      await runMigrations({ databaseUrl });
      console.log('Stripe schema ready');
      migrationSuccess = true;
    } catch (migrationError: any) {
      console.warn('Stripe migration skipped (schema may already exist or require manual setup)');
    }

    if (migrationSuccess) {
      const stripeSync = await getStripeSync();

      const webhookBaseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;
      if (webhookBaseUrl && webhookBaseUrl !== 'https://undefined') {
        console.log('Setting up Stripe webhook...');
        const { webhook } = await stripeSync.findOrCreateManagedWebhook(
          `${webhookBaseUrl}/api/stripe/webhook`
        );
        console.log(`Stripe webhook configured: ${webhook.url}`);
      }

      stripeSync.syncBackfill()
        .then(() => console.log('Stripe data synced'))
        .catch((err: any) => console.error('Stripe sync error:', err.message));
    } else {
      console.log('Stripe sync skipped - using existing integration');
    }
  } catch (error: any) {
    console.error('Stripe init error:', error.message);
  }
}

(async () => {
  const bootStart = Date.now();

  // 1. Schema-Migrationen — blockierend; Fehler brechen den Boot ab.
  await runSqlMigrations();

  // 1b. FIELD_ENCRYPTION_KEY — in Produktion zwingend erforderlich.
  //     Ohne den Schlüssel würde encryptField() werfen und Schreibzugriffe auf
  //     IBAN-Felder scheitern. Früher Fail verhindert einen halb-gestarteten Server.
  {
    const encKey = process.env.FIELD_ENCRYPTION_KEY;
    if (!encKey) {
      if (isProduction) {
        logger.error(
          "[boot] FATAL: FIELD_ENCRYPTION_KEY nicht gesetzt. " +
          "Einen 32-Byte-Base64-Schlüssel als Umgebungsvariable setzen und neu starten."
        );
        process.exit(1);
      } else {
        logger.warn(
          "[boot] WARNUNG: FIELD_ENCRYPTION_KEY nicht gesetzt. " +
          "IBAN-Verschlüsselung ist DEAKTIVIERT. Für Produktion FIELD_ENCRYPTION_KEY setzen."
        );
      }
    } else {
      try {
        // Exakt dieselbe Validierung wie encryptField()/decryptField(): genau 32 Byte.
        parseEncryptionKey(encKey);
        logger.info("[boot] FIELD_ENCRYPTION_KEY gesetzt und valide ✓");
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        if (isProduction) {
          logger.error(`[boot] FATAL: FIELD_ENCRYPTION_KEY ungültig — ${detail}`);
          process.exit(1);
        }
        logger.warn(
          `[boot] WARNUNG: FIELD_ENCRYPTION_KEY ungültig — ${detail} ` +
          "Schreibzugriffe auf IBAN-Felder werden fehlschlagen. In Production wäre das fatal."
        );
      }
    }
  }

  // 2. RLS — immer ausführen (upsert-Logik ist idempotent und schnell).
  //    Ein Fehler hier ist fatal: lieber kein Server als ein fail-open Server.
  try {
    logger.info("[boot] Running RLS setup (fail-closed)...");
    await setupRLS();
    logger.info("[boot] RLS setup complete.");
  } catch (rlsErr: any) {
    logger.error(`[boot] FATAL: RLS setup failed — refusing to start: ${rlsErr.message}`);
    process.exit(1);
  }

  // 3. Auth + Routen registrieren (keine DB-Calls beim Registrieren)
  setupAuth(app);
  // 2FA-Erzwingung für privilegierte Rollen — direkt nach Auth, vor allen Routen.
  app.use(enforcePrivileged2FA);
  app.use(trackSession);
  app.use(rlsMiddleware);
  registerDsgvoRoutes(app);
  registerSecurityRoutes(app);
  registerTicketRoutes(app);
  registerEsgRoutes(app);
  registerDamageRoutes(app);
  registerTenantAuthRoutes(app);
  registerTenantPortalRoutes(app);
  registerOwnerAuthRoutes(app);
  registerOwnerPortalRoutes(app);
  registerMetricsRoutes(app);
  registerRetestRoutes(app);
  const server = await registerRoutes(app);

  app.use(apiErrorHandler);

  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // 3b. Feldverschlüsselung: bestehende Klartext-IBANs vor dem ersten Request migrieren.
  //     Läuft vor listen() damit keine Anfrage auf unverschlüsselte Felder trifft.
  //     Ein Fehler ist fatal — lieber kein Server als verschlüsselte und unverschlüsselte
  //     Zeilen nebeneinander bei aktivem Schlüssel.
  if (process.env.FIELD_ENCRYPTION_KEY) {
    try {
      logger.info("[boot] Starte IBAN-Feldverschlüsselung...");
      await migrateFieldEncryption();
    } catch (migErr: any) {
      logger.error(`[boot] FATAL: IBAN-Feldverschlüsselung fehlgeschlagen — ${migErr.message}`);
      process.exit(1);
    }
  }

  const port = parseInt(process.env.PORT ?? '5000', 10);
  const msBeforeListen = Date.now() - bootStart;
  logger.info(`[boot] Server ready to listen after ${msBeforeListen}ms — starting on port ${port}`);

  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    logger.info(`ImmoFlowMe server started`, { port, env: app.get("env"), pid: process.pid });
    log(`serving on port ${port}`);

    // 4. Hintergrund-Initialisierungen NACH listen() — werden nach dem ersten Request
    //    gestartet. In diesem kurzen Post-Listen-Fenster (typisch < 5 Sek.) sind
    //    Stripe-Webhooks, Seed-Daten, Zusatz-Indizes und der Audit-Backfill noch
    //    nicht verfügbar. Dies ist bewusst so gestaltet:
    //    - Schema + RLS sind bereits vor listen() sichergestellt (Schritte 1–2 oben).
    //    - Die hier aufgelisteten Operationen sind alle idempotent und nicht
    //      sicherheitskritisch für eingehende Requests.
    //    - Ohne diese Verzögerung würde der Produktions-Health-Check (GET /) nach
    //      >80 Sek. einen Timeout melden und das Deployment abbrechen.
    setImmediate(async () => {
      try {
        await initStripe();
      } catch (err: any) {
        logger.error("[boot] Stripe init failed (non-fatal)", { error: err.message });
      }
      try {
        await seedProductionDatabase();
      } catch (err: any) {
        logger.error("[boot] Production seed failed (non-fatal)", { error: err.message });
      }
      try {
        await seedDistributionKeys();
      } catch (err: any) {
        logger.error("[boot] Distribution keys seed failed (non-fatal)", { error: err.message });
      }
      try {
        await ensureIndexes();
      } catch (err: any) {
        logger.error("[boot] ensureIndexes failed (non-fatal)", { error: err.message });
      }
      // migrateFieldEncryption läuft jetzt vor listen() (Schritt 3b)
      // RLS wird bereits vor listen() eingerichtet — kein zweiter Aufruf notwendig.
      try {
        await setupFullTextSearch();
      } catch (err: any) {
        logger.error("[boot] Full-text search setup failed (non-fatal)", { error: err.message });
      }
      // Deferred audit-integrity backfill — runs the heavy INSERT ... SELECT
      // from audit_logs/audit_events AFTER listen() so health-check is never blocked.
      try {
        await populateAuditIntegrityQueue();
      } catch (err: any) {
        logger.error("[boot] Audit integrity queue backfill failed (non-fatal)", { error: err.message });
      }
      logger.info(`[boot] Background initialization complete (total boot: ${Date.now() - bootStart}ms)`);
    });
  });
})();
