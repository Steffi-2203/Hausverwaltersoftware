import { ocrCircuitBreaker } from "./circuitBreaker";

interface OcrUsageRecord {
  orgId: string;
  tenantId: string | null;
  promptTokens: number;
  completionTokens: number;
  model: string;
  cost: number;
  timestamp: Date;
}

interface ReconciliationRecord {
  orgId: string;
  propertyId: string | null;
  balanced: boolean;
  difference: number;
  timestamp: Date;
}

export interface AlertRule {
  id: string;
  metric: string;
  threshold: number;
  comparison: "gt" | "lt" | "eq";
  severity: "warning" | "critical";
  message: string;
}

interface TriggeredAlert {
  rule: AlertRule;
  currentValue: number;
  triggeredAt: Date;
}

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 },
  "gpt-4o": { input: 2.50 / 1_000_000, output: 10.0 / 1_000_000 },
};

const DEFAULT_PRICING = MODEL_PRICING["gpt-4o"];

function getModelPricing(model: string): { input: number; output: number } {
  const normalized = model.toLowerCase().trim();
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (normalized.includes(key)) return pricing;
  }
  return DEFAULT_PRICING;
}

class MetricsService {
  private ocrUsage: OcrUsageRecord[] = [];
  private reconciliations: ReconciliationRecord[] = [];
  private circuitOpenEvents = 0;
  private circuitOpenSince: number | null = null;
  private lastKnownCircuitState: string = "closed";
  private activeAlerts: TriggeredAlert[] = [];
  private startTime = Date.now();

  private alertRules: AlertRule[] = [
    {
      id: "circuit_open_count",
      metric: "circuit_open_count",
      threshold: 3,
      comparison: "gt",
      severity: "critical",
      message: "Circuit Breaker wiederholt offen",
    },
    {
      id: "reconciliation_failure_rate",
      metric: "reconciliation_failure_rate",
      threshold: 0.05,
      comparison: "gt",
      severity: "warning",
      message: "Abstimmungsfehlerquote über 5%",
    },
    {
      id: "ocr_daily_cost",
      metric: "ocr_daily_cost",
      threshold: 50,
      comparison: "gt",
      severity: "warning",
      message: "OCR-Tageskosten über €50",
    },
  ];

  private updateCircuitBreakerTracking(): void {
    const stats = ocrCircuitBreaker.getStats();
    const currentState = stats.state;

    if (currentState === "open" && this.lastKnownCircuitState !== "open") {
      this.circuitOpenEvents++;
      this.circuitOpenSince = Date.now();
    }

    if (currentState !== "open" && this.lastKnownCircuitState === "open") {
      this.circuitOpenSince = null;
    }

    this.lastKnownCircuitState = currentState;
  }

  getCircuitBreakerMetrics(): {
    state: string;
    failures: number;
    lastFailureTime: string | null;
    circuitOpenEvents: number;
    circuitOpenDurationSeconds: number;
    name: string;
  } {
    this.updateCircuitBreakerTracking();
    const stats = ocrCircuitBreaker.getStats();
    let openDuration = 0;
    if (this.circuitOpenSince) {
      openDuration = Math.round((Date.now() - this.circuitOpenSince) / 1000);
    }

    return {
      name: stats.name,
      state: stats.state,
      failures: stats.failures,
      lastFailureTime: stats.lastFailureTime,
      circuitOpenEvents: this.circuitOpenEvents,
      circuitOpenDurationSeconds: openDuration,
    };
  }

  recordOcrUsage(
    orgId: string,
    tenantId: string | null,
    promptTokens: number,
    completionTokens: number,
    model: string
  ): void {
    const pricing = getModelPricing(model);
    const cost = promptTokens * pricing.input + completionTokens * pricing.output;

    this.ocrUsage.push({
      orgId,
      tenantId,
      promptTokens,
      completionTokens,
      model,
      cost,
      timestamp: new Date(),
    });
  }

  getOcrCostsByOrg(orgId: string): {
    orgId: string;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCost: number;
    requestCount: number;
    dailyCost: number;
  } {
    const orgRecords = this.ocrUsage.filter((r) => r.orgId === orgId);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dailyRecords = orgRecords.filter((r) => r.timestamp >= todayStart);

    return {
      orgId,
      totalPromptTokens: orgRecords.reduce((s, r) => s + r.promptTokens, 0),
      totalCompletionTokens: orgRecords.reduce((s, r) => s + r.completionTokens, 0),
      totalCost: orgRecords.reduce((s, r) => s + r.cost, 0),
      requestCount: orgRecords.length,
      dailyCost: dailyRecords.reduce((s, r) => s + r.cost, 0),
    };
  }

  getOcrCostsByTenant(orgId: string): Array<{
    tenantId: string | null;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCost: number;
    requestCount: number;
  }> {
    const orgRecords = this.ocrUsage.filter((r) => r.orgId === orgId);
    const byTenant = new Map<
      string | null,
      { promptTokens: number; completionTokens: number; cost: number; count: number }
    >();

    for (const record of orgRecords) {
      const key = record.tenantId;
      const existing = byTenant.get(key) || {
        promptTokens: 0,
        completionTokens: 0,
        cost: 0,
        count: 0,
      };
      existing.promptTokens += record.promptTokens;
      existing.completionTokens += record.completionTokens;
      existing.cost += record.cost;
      existing.count++;
      byTenant.set(key, existing);
    }

    return Array.from(byTenant.entries()).map(([tenantId, data]) => ({
      tenantId,
      totalPromptTokens: data.promptTokens,
      totalCompletionTokens: data.completionTokens,
      totalCost: data.cost,
      requestCount: data.count,
    }));
  }

  recordReconciliation(
    orgId: string,
    propertyId: string | null,
    balanced: boolean,
    difference: number
  ): void {
    this.reconciliations.push({
      orgId,
      propertyId,
      balanced,
      difference,
      timestamp: new Date(),
    });
  }

  getReconciliationStats(orgId?: string): {
    totalChecks: number;
    failures: number;
    failureRate: number;
    lastCheckTimestamp: string | null;
  } {
    const records = orgId
      ? this.reconciliations.filter((r) => r.orgId === orgId)
      : this.reconciliations;

    const totalChecks = records.length;
    const failures = records.filter((r) => !r.balanced).length;
    const failureRate = totalChecks > 0 ? failures / totalChecks : 0;
    const lastRecord = records.length > 0 ? records[records.length - 1] : null;

    return {
      totalChecks,
      failures,
      failureRate,
      lastCheckTimestamp: lastRecord ? lastRecord.timestamp.toISOString() : null,
    };
  }

  private getMetricValue(metric: string): number {
    switch (metric) {
      case "circuit_open_count":
        this.updateCircuitBreakerTracking();
        return this.circuitOpenEvents;

      case "reconciliation_failure_rate": {
        const stats = this.getReconciliationStats();
        return stats.failureRate;
      }

      case "ocr_daily_cost": {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return this.ocrUsage
          .filter((r) => r.timestamp >= todayStart)
          .reduce((s, r) => s + r.cost, 0);
      }

      default:
        return 0;
    }
  }

  evaluateAlerts(): TriggeredAlert[] {
    const triggered: TriggeredAlert[] = [];

    for (const rule of this.alertRules) {
      const value = this.getMetricValue(rule.metric);
      let isTriggered = false;

      switch (rule.comparison) {
        case "gt":
          isTriggered = value > rule.threshold;
          break;
        case "lt":
          isTriggered = value < rule.threshold;
          break;
        case "eq":
          isTriggered = Math.abs(value - rule.threshold) < 0.001;
          break;
      }

      if (isTriggered) {
        triggered.push({
          rule,
          currentValue: value,
          triggeredAt: new Date(),
        });
      }
    }

    this.activeAlerts = triggered;
    return triggered;
  }

  getActiveAlerts(): TriggeredAlert[] {
    return this.activeAlerts;
  }

  getMetricsSummary(orgId?: string): {
    circuitBreaker: ReturnType<MetricsService["getCircuitBreakerMetrics"]>;
    ocrCosts: ReturnType<MetricsService["getOcrCostsByOrg"]> | null;
    reconciliation: ReturnType<MetricsService["getReconciliationStats"]>;
    activeAlerts: TriggeredAlert[];
    systemUptime: number;
    timestamp: string;
  } {
    this.evaluateAlerts();

    return {
      circuitBreaker: this.getCircuitBreakerMetrics(),
      ocrCosts: orgId ? this.getOcrCostsByOrg(orgId) : null,
      reconciliation: this.getReconciliationStats(orgId),
      activeAlerts: this.activeAlerts,
      systemUptime: Math.round((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
    };
  }
}

export const metricsService = new MetricsService();
