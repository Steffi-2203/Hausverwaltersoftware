import { Brain, Lock, Sparkles, Loader2, AlertCircle, AlertTriangle, Info, CreditCard, FileText, Building, Eye, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useKiAutopilot } from '@/hooks/useKiAutopilot';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

interface Insight {
  type: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  entityId: string | null;
  entityType: string;
}

const severityConfig = {
  critical: { icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-500/10', badge: 'destructive' as const },
  warning: { icon: AlertTriangle, color: 'text-yellow-500', bg: 'bg-yellow-500/10', badge: 'secondary' as const },
  info: { icon: Info, color: 'text-blue-500', bg: 'bg-blue-500/10', badge: 'outline' as const },
};

const typeIcons: Record<string, typeof CreditCard> = {
  overdue_payment: CreditCard,
  expiring_lease: FileText,
  vacancy: Building,
  high_balance: Wallet,
};

export default function KiInsights() {
  const { isActive, isLoading: kiLoading } = useKiAutopilot();

  const { data: insights, isLoading } = useQuery<Insight[]>({
    queryKey: ['/api/ki/insights'],
    enabled: isActive,
  });

  if (kiLoading || isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isActive) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Lock className="h-8 w-8 text-muted-foreground" />
            </div>
            <CardTitle>KI-Autopilot erforderlich</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-muted-foreground">
              Die KI-Anomalieerkennung ist Teil des KI-Autopilot Add-ons.
            </p>
            <Link to="/checkout?plan=ki-autopilot">
              <Button data-testid="button-upgrade-ki">
                <Sparkles className="mr-2 h-4 w-4" />
                KI-Autopilot aktivieren
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const criticalCount = insights?.filter(i => i.severity === 'critical').length || 0;
  const warningCount = insights?.filter(i => i.severity === 'warning').length || 0;
  const infoCount = insights?.filter(i => i.severity === 'info').length || 0;

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <Brain className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold" data-testid="text-ki-insights-title">KI-Insights</h1>
        <Badge variant="secondary">KI-Autopilot</Badge>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold text-red-500" data-testid="text-critical-count">{criticalCount}</p>
            <p className="text-sm text-muted-foreground">Kritisch</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold text-yellow-500" data-testid="text-warning-count">{warningCount}</p>
            <p className="text-sm text-muted-foreground">Warnungen</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold text-blue-500" data-testid="text-info-count">{infoCount}</p>
            <p className="text-sm text-muted-foreground">Hinweise</p>
          </CardContent>
        </Card>
      </div>

      {!insights?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Brain className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="font-medium">Keine Auffälligkeiten erkannt</p>
            <p className="text-sm text-muted-foreground">Alle Kennzahlen sind im normalen Bereich.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {insights.map((insight, i) => {
            const config = severityConfig[insight.severity];
            const SeverityIcon = config.icon;
            const TypeIcon = typeIcons[insight.type] || Eye;

            return (
              <Card key={i} data-testid={`card-insight-${i}`}>
                <CardContent className="flex items-start gap-4 py-4">
                  <div className={`shrink-0 flex h-10 w-10 items-center justify-center rounded-full ${config.bg}`}>
                    <SeverityIcon className={`h-5 w-5 ${config.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-medium text-sm">{insight.title}</span>
                      <Badge variant={config.badge} className="text-xs">
                        {insight.severity === 'critical' ? 'Kritisch' : insight.severity === 'warning' ? 'Warnung' : 'Info'}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{insight.description}</p>
                  </div>
                  <TypeIcon className="h-5 w-5 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
