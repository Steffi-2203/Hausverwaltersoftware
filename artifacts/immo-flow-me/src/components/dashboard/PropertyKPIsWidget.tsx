import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useUnits } from "@/hooks/useUnits";
import { useTenants } from "@/hooks/useTenants";
import { useInvoices } from "@/hooks/useInvoices";
import { Building2, AlertCircle, Banknote, UserX, TrendingDown, CheckCircle, Calendar, FileWarning } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function PropertyKPIsWidget() {
  const { data: allUnits, isLoading: unitsLoading } = useUnits();
  const { data: allTenants, isLoading: tenantsLoading } = useTenants();
  const { data: invoices, isLoading: invoicesLoading } = useInvoices();

  const isLoading = unitsLoading || tenantsLoading || invoicesLoading;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingDown className="h-5 w-5" />
            Kennzahlen
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const units = allUnits || [];
  const tenants = allTenants || [];
  
  const totalUnits = units.length;
  const vacantUnits = units.filter(u => u.status !== 'aktiv').length;
  const vacancyRate = totalUnits > 0 ? (vacantUnits / totalUnits) * 100 : 0;

  const openInvoices = (invoices || []).filter(i => 
    i.status === 'offen' || i.status === 'ueberfaellig' || i.status === 'teilbezahlt'
  );
  const overdueInvoices = openInvoices.filter(i => {
    if (!i.faellig_am) return false;
    return new Date(i.faellig_am) < new Date();
  });
  // Überfälliger Betrag = Restschuld nach Abzug bereits geleisteter Teilzahlungen
  const overdueAmount = overdueInvoices.reduce((sum, i) => {
    const total = Number(i.gesamtbetrag || 0);
    const paid  = Number((i as any).paid_amount || 0);
    return sum + Math.max(0, total - paid);
  }, 0);

  const invoicesWithDunning = (invoices || []).filter(i => 
    Number(i.mahnstufe || 0) > 0 && i.status !== 'bezahlt'
  );
  const dunningLevel1 = invoicesWithDunning.filter(i => Number(i.mahnstufe) === 1).length;
  const dunningLevel2 = invoicesWithDunning.filter(i => Number(i.mahnstufe) === 2).length;
  const dunningLevel3 = invoicesWithDunning.filter(i => Number(i.mahnstufe) >= 3).length;

  // Auslaufende Verträge (in den nächsten 90 Tagen)
  const today = new Date();
  const in30Days = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const in60Days = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);
  const in90Days = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
  
  const parseDate = (dateStr: string | null | undefined): Date | null => {
    if (!dateStr) return null;
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
  };
  
  const expiringContracts = tenants.filter(t => {
    const endDate = parseDate(t.mietvertragEnde);
    if (!endDate) return false;
    return endDate >= today && endDate <= in90Days;
  });
  
  const expiringIn30Days = expiringContracts.filter(t => {
    const endDate = parseDate(t.mietvertragEnde);
    return endDate && endDate <= in30Days;
  });
  
  const expiringIn60Days = expiringContracts.filter(t => {
    const endDate = parseDate(t.mietvertragEnde);
    return endDate && endDate > in30Days && endDate <= in60Days;
  });
  
  const expiringIn90Days = expiringContracts.filter(t => {
    const endDate = parseDate(t.mietvertragEnde);
    return endDate && endDate > in60Days && endDate <= in90Days;
  });

  const getVacancyColor = () => {
    if (vacancyRate === 0) return 'text-success';
    if (vacancyRate < 5) return 'text-primary';
    if (vacancyRate < 10) return 'text-warning';
    return 'text-destructive';
  };

  const getVacancyBadge = () => {
    if (vacancyRate === 0) return <Badge className="bg-success text-success-foreground">Vollvermietung</Badge>;
    if (vacancyRate < 5) return <Badge className="bg-primary text-primary-foreground">Gering</Badge>;
    if (vacancyRate < 10) return <Badge className="bg-warning text-warning-foreground">Mittel</Badge>;
    return <Badge variant="destructive">Hoch</Badge>;
  };

  return (
    <Card data-testid="widget-property-kpis">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingDown className="h-5 w-5" />
            Kennzahlen
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg border bg-card" data-testid="kpi-vacancy">
            <div className="flex items-start justify-between mb-2">
              <div className="p-2 rounded-lg bg-muted">
                <Building2 className="h-5 w-5 text-muted-foreground" />
              </div>
              {getVacancyBadge()}
            </div>
            <div className="space-y-1">
              <p className={`text-2xl font-bold ${getVacancyColor()}`}>
                {vacancyRate.toFixed(1)}%
              </p>
              <p className="text-sm text-muted-foreground">Leerstandsquote</p>
              <p className="text-xs text-muted-foreground">
                {vacantUnits} von {totalUnits} Einheiten leer
              </p>
            </div>
            {vacantUnits > 0 && (
              <Button variant="link" asChild className="p-0 h-auto mt-2">
                <Link to="/einheiten">Leerstände ansehen</Link>
              </Button>
            )}
          </div>

          <div className="p-4 rounded-lg border bg-card" data-testid="kpi-receivables">
            <div className="flex items-start justify-between mb-2">
              <div className="p-2 rounded-lg bg-muted">
                <Banknote className="h-5 w-5 text-muted-foreground" />
              </div>
              {overdueAmount > 0 ? (
                <Badge variant="destructive">Offen</Badge>
              ) : (
                <Badge className="bg-success text-success-foreground">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Aktuell
                </Badge>
              )}
            </div>
            <div className="space-y-1">
              <p className={`text-2xl font-bold ${overdueAmount > 0 ? 'text-destructive' : 'text-success'}`}>
                € {overdueAmount.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-sm text-muted-foreground">Offene Forderungen</p>
              <p className="text-xs text-muted-foreground">
                {overdueInvoices.length} überfällige Rechnungen
              </p>
            </div>
            {overdueInvoices.length > 0 && (
              <Button variant="link" asChild className="p-0 h-auto mt-2">
                <Link to="/zahlungen">Zahlungen prüfen</Link>
              </Button>
            )}
          </div>

          <div className="p-4 rounded-lg border bg-card" data-testid="kpi-dunning">
            <div className="flex items-start justify-between mb-2">
              <div className="p-2 rounded-lg bg-muted">
                <AlertCircle className="h-5 w-5 text-muted-foreground" />
              </div>
              {invoicesWithDunning.length > 0 ? (
                <Badge variant="destructive">
                  <UserX className="h-3 w-3 mr-1" />
                  {invoicesWithDunning.length}
                </Badge>
              ) : (
                <Badge className="bg-success text-success-foreground">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Keine
                </Badge>
              )}
            </div>
            <div className="space-y-1">
              <p className={`text-2xl font-bold ${invoicesWithDunning.length > 0 ? 'text-warning' : 'text-success'}`}>
                {invoicesWithDunning.length}
              </p>
              <p className="text-sm text-muted-foreground">Im Mahnverfahren</p>
              {invoicesWithDunning.length > 0 && (
                <div className="flex gap-2 text-xs flex-wrap text-muted-foreground">
                  {dunningLevel1 > 0 && <span>Stufe 1: {dunningLevel1}</span>}
                  {dunningLevel2 > 0 && <span className="text-warning">Stufe 2: {dunningLevel2}</span>}
                  {dunningLevel3 > 0 && <span className="text-destructive">Stufe 3+: {dunningLevel3}</span>}
                </div>
              )}
            </div>
            {invoicesWithDunning.length > 0 && (
              <Button variant="link" asChild className="p-0 h-auto mt-2">
                <Link to="/mahnwesen">Mahnwesen öffnen</Link>
              </Button>
            )}
          </div>

          <div className="p-4 rounded-lg border bg-card" data-testid="kpi-expiring-contracts">
            <div className="flex items-start justify-between mb-2">
              <div className="p-2 rounded-lg bg-muted">
                <Calendar className="h-5 w-5 text-muted-foreground" />
              </div>
              {expiringContracts.length > 0 ? (
                <Badge variant={expiringIn30Days.length > 0 ? 'destructive' : 'secondary'}>
                  <FileWarning className="h-3 w-3 mr-1" />
                  {expiringContracts.length}
                </Badge>
              ) : (
                <Badge variant="secondary">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Keine
                </Badge>
              )}
            </div>
            <div className="space-y-1">
              <p className={`text-2xl font-bold ${expiringIn30Days.length > 0 ? 'text-destructive' : expiringContracts.length > 0 ? 'text-warning' : 'text-muted-foreground'}`}>
                {expiringContracts.length}
              </p>
              <p className="text-sm text-muted-foreground">Auslaufende Verträge</p>
              {expiringContracts.length > 0 && (
                <div className="flex gap-2 text-xs flex-wrap text-muted-foreground">
                  {expiringIn30Days.length > 0 && <span className="text-destructive">30 Tage: {expiringIn30Days.length}</span>}
                  {expiringIn60Days.length > 0 && <span>60 Tage: {expiringIn60Days.length}</span>}
                  {expiringIn90Days.length > 0 && <span>90 Tage: {expiringIn90Days.length}</span>}
                </div>
              )}
            </div>
            {expiringContracts.length > 0 && (
              <Button variant="link" asChild className="p-0 h-auto mt-2" data-testid="link-expiring-contracts">
                <Link to="/mieter">Verträge ansehen</Link>
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
