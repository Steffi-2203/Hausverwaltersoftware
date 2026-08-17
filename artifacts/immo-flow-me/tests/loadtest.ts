const BASE_URL = "http://localhost:5000";

const ENDPOINTS = [
  { name: "Properties", path: "/api/properties" },
  { name: "Units", path: "/api/units" },
  { name: "Tenants", path: "/api/tenants" },
  { name: "Invoices", path: "/api/invoices" },
  { name: "Payments", path: "/api/payments" },
  { name: "Expenses", path: "/api/expenses" },
];

const CONCURRENCY_LEVELS = [1000, 2000, 5000];

interface RequestResult {
  endpoint: string;
  status: number;
  duration: number;
  error?: string;
}

function randomPage(): number {
  return Math.floor(Math.random() * 5) + 1;
}

function randomLimit(): number {
  return [10, 20, 50, 100][Math.floor(Math.random() * 4)];
}

async function makeRequest(endpoint: { name: string; path: string }, cookie: string): Promise<RequestResult> {
  const page = randomPage();
  const limit = randomLimit();
  const url = `${BASE_URL}${endpoint.path}?page=${page}&limit=${limit}`;
  const start = performance.now();
  try {
    const res = await fetch(url, {
      headers: cookie ? { Cookie: cookie } : {},
      signal: AbortSignal.timeout(30000),
    });
    const duration = performance.now() - start;
    return { endpoint: endpoint.name, status: res.status, duration };
  } catch (err: any) {
    const duration = performance.now() - start;
    return { endpoint: endpoint.name, status: 0, duration, error: err.message || String(err) };
  }
}

async function getSessionCookie(): Promise<string> {
  try {
    const res = await fetch(`${BASE_URL}/api/auth/session`, { redirect: "manual" });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) return setCookie.split(";")[0];
  } catch {}
  return "";
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function formatMs(ms: number): string {
  return ms.toFixed(0) + "ms";
}

interface EndpointStats {
  name: string;
  total: number;
  ok2xx: number;
  auth4xx: number;
  errors5xx: number;
  connErrors: number;
  errorRate: string;
  min: string;
  avg: string;
  p95: string;
  p99: string;
  max: string;
}

function analyzeResults(results: RequestResult[]): { byEndpoint: EndpointStats[]; overall: any } {
  const byEndpoint: EndpointStats[] = [];
  const grouped: Record<string, RequestResult[]> = {};

  for (const r of results) {
    if (!grouped[r.endpoint]) grouped[r.endpoint] = [];
    grouped[r.endpoint].push(r);
  }

  for (const [name, reqs] of Object.entries(grouped)) {
    const durations = reqs.map((r) => r.duration).sort((a, b) => a - b);
    const ok2xx = reqs.filter((r) => r.status >= 200 && r.status < 300).length;
    const auth4xx = reqs.filter((r) => r.status >= 400 && r.status < 500).length;
    const errors5xx = reqs.filter((r) => r.status >= 500).length;
    const connErrors = reqs.filter((r) => r.status === 0).length;
    const totalErrors = errors5xx + connErrors;

    byEndpoint.push({
      name,
      total: reqs.length,
      ok2xx,
      auth4xx,
      errors5xx,
      connErrors,
      errorRate: ((totalErrors / reqs.length) * 100).toFixed(1) + "%",
      min: formatMs(durations[0]),
      avg: formatMs(durations.reduce((a, b) => a + b, 0) / durations.length),
      p95: formatMs(percentile(durations, 95)),
      p99: formatMs(percentile(durations, 99)),
      max: formatMs(durations[durations.length - 1]),
    });
  }

  const allDurations = results.map((r) => r.duration).sort((a, b) => a - b);
  const totalOk = results.filter((r) => r.status >= 200 && r.status < 300).length;
  const total4xx = results.filter((r) => r.status >= 400 && r.status < 500).length;
  const total5xx = results.filter((r) => r.status >= 500).length;
  const totalConn = results.filter((r) => r.status === 0).length;

  return {
    byEndpoint,
    overall: {
      totalRequests: results.length,
      ok2xx: totalOk,
      auth4xx: total4xx,
      errors5xx: total5xx,
      connErrors: totalConn,
      hardErrorRate: (((total5xx + totalConn) / results.length) * 100).toFixed(1) + "%",
      min: formatMs(allDurations[0]),
      avg: formatMs(allDurations.reduce((a, b) => a + b, 0) / allDurations.length),
      p95: formatMs(percentile(allDurations, 95)),
      p99: formatMs(percentile(allDurations, 99)),
      max: formatMs(allDurations[allDurations.length - 1]),
    },
  };
}

async function runLoadLevel(concurrency: number, cookie: string): Promise<any> {
  const perEndpoint = Math.floor(concurrency / ENDPOINTS.length);
  const actualTotal = perEndpoint * ENDPOINTS.length;

  console.log(`\n${"=".repeat(70)}`);
  console.log(`  LASTSTUFE: ${concurrency} (effektiv ${actualTotal}) gleichzeitige Anfragen`);
  console.log(`  ${perEndpoint} pro Endpunkt x ${ENDPOINTS.length} Endpunkte`);
  console.log(`  Variierte Parameter: page=[1-5], limit=[10,20,50,100]`);
  console.log(`${"=".repeat(70)}`);

  const requests: Promise<RequestResult>[] = [];
  const startTime = performance.now();

  for (const endpoint of ENDPOINTS) {
    for (let i = 0; i < perEndpoint; i++) {
      requests.push(makeRequest(endpoint, cookie));
    }
  }

  const results = await Promise.all(requests);
  const totalTime = performance.now() - startTime;
  const analysis = analyzeResults(results);
  const throughput = (results.length / (totalTime / 1000)).toFixed(0);

  console.log(`\n  Gesamtdauer: ${(totalTime / 1000).toFixed(2)}s | Durchsatz: ${throughput} req/s`);
  console.log(`\n  Gesamt:`);
  console.log(`    Anfragen: ${analysis.overall.totalRequests}`);
  console.log(`    2xx OK: ${analysis.overall.ok2xx} | 4xx Auth: ${analysis.overall.auth4xx} | 5xx Server: ${analysis.overall.errors5xx} | Conn-Fehler: ${analysis.overall.connErrors}`);
  console.log(`    Harte Fehlerrate (5xx+conn): ${analysis.overall.hardErrorRate}`);
  console.log(`    Latenz: Min=${analysis.overall.min} Avg=${analysis.overall.avg} P95=${analysis.overall.p95} P99=${analysis.overall.p99} Max=${analysis.overall.max}`);

  console.log(`\n  Pro Endpunkt:`);
  console.log(`  ${"Endpunkt".padEnd(14)} ${"Tot".padStart(5)} ${"2xx".padStart(5)} ${"4xx".padStart(5)} ${"5xx".padStart(5)} ${"Conn".padStart(5)} ${"Err%".padStart(6)} ${"Min".padStart(8)} ${"Avg".padStart(8)} ${"P95".padStart(8)} ${"P99".padStart(8)} ${"Max".padStart(8)}`);
  console.log(`  ${"-".repeat(94)}`);

  for (const ep of analysis.byEndpoint) {
    console.log(
      `  ${ep.name.padEnd(14)} ${String(ep.total).padStart(5)} ${String(ep.ok2xx).padStart(5)} ${String(ep.auth4xx).padStart(5)} ${String(ep.errors5xx).padStart(5)} ${String(ep.connErrors).padStart(5)} ${ep.errorRate.padStart(6)} ${ep.min.padStart(8)} ${ep.avg.padStart(8)} ${ep.p95.padStart(8)} ${ep.p99.padStart(8)} ${ep.max.padStart(8)}`
    );
  }

  const errorSamples = results.filter((r) => r.status === 0 || r.status >= 500).slice(0, 5);
  if (errorSamples.length > 0) {
    console.log(`\n  Beispiel-Fehler (erste 5):`);
    for (const e of errorSamples) {
      console.log(`    ${e.endpoint}: Status=${e.status} ${e.error || ""}`);
    }
  }

  return { concurrency: actualTotal, throughput: Number(throughput), totalTime, analysis };
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║       ImmoflowMe — Lasttest (Load Test) v2                         ║");
  console.log("║       Variierte Seiten/Limits, getrennte Fehlerklassen              ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝");
  console.log(`\nServer: ${BASE_URL}`);
  console.log(`Endpunkte: ${ENDPOINTS.map((e) => e.name).join(", ")}`);
  console.log(`Laststufen: ${CONCURRENCY_LEVELS.join(", ")} gleichzeitige Anfragen`);

  const cookie = await getSessionCookie();
  console.log(`Auth: ${cookie ? "Session-Cookie erhalten" : "Unauthentifiziert (401/403 erwartet)"}`);

  const summaries: any[] = [];

  for (const level of CONCURRENCY_LEVELS) {
    const result = await runLoadLevel(level, cookie);
    summaries.push(result);
    if (level < CONCURRENCY_LEVELS[CONCURRENCY_LEVELS.length - 1]) {
      console.log("\n  Pause 3s vor naechster Stufe...");
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log("  ZUSAMMENFASSUNG");
  console.log(`${"=".repeat(70)}`);
  console.log(`  ${"Stufe".padEnd(10)} ${"Req/s".padStart(8)} ${"Dauer".padStart(8)} ${"Err%".padStart(8)} ${"Avg".padStart(8)} ${"P95".padStart(8)} ${"P99".padStart(8)} ${"Max".padStart(8)}`);
  console.log(`  ${"-".repeat(66)}`);
  for (const s of summaries) {
    console.log(
      `  ${String(s.concurrency).padEnd(10)} ${String(s.throughput).padStart(8)} ${(s.totalTime / 1000).toFixed(1).padStart(7)}s ${s.analysis.overall.hardErrorRate.padStart(8)} ${s.analysis.overall.avg.padStart(8)} ${s.analysis.overall.p95.padStart(8)} ${s.analysis.overall.p99.padStart(8)} ${s.analysis.overall.max.padStart(8)}`
    );
  }

  const maxP99 = Math.max(...summaries.map((s: any) => {
    const val = s.analysis.overall.p99;
    return parseInt(val);
  }));
  const maxErrRate = Math.max(...summaries.map((s: any) => parseFloat(s.analysis.overall.hardErrorRate)));

  console.log(`\n  Bewertung:`);
  if (maxErrRate === 0) {
    console.log(`  [BESTANDEN] Keine harten Fehler (5xx/Verbindung) bei allen Laststufen`);
  } else if (maxErrRate < 1) {
    console.log(`  [WARNUNG] Fehlerrate unter 1% - akzeptabel fuer Produktion`);
  } else {
    console.log(`  [DURCHGEFALLEN] Fehlerrate ueber 1% - nicht produktionsreif`);
  }

  if (maxP99 < 3000) {
    console.log(`  [BESTANDEN] P99 Latenz unter 3s bei allen Stufen`);
  } else if (maxP99 < 10000) {
    console.log(`  [WARNUNG] P99 Latenz ${maxP99}ms - akzeptabel mit Caching/CDN`);
  } else {
    console.log(`  [DURCHGEFALLEN] P99 Latenz ${maxP99}ms - zu hoch fuer Produktion`);
  }

  console.log(`\n${"=".repeat(70)}`);
}

main().catch(console.error);
