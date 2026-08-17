import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Plus, Search, Download, Upload, Mail, CreditCard, AlertTriangle, ShieldCheck, Lock, FileImage } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTenants } from '@/hooks/useTenants';
import { calculateTotalRent, calculateSonstigeKostenTotal, hasSonstigeKosten as checkHasSonstigeKosten, formatSonstigeKostenBreakdown } from '@/utils/fieldNormalizer';
import { useUnits } from '@/hooks/useUnits';
import { useProperties } from '@/hooks/useProperties';
import { TenantImportDialog } from '@/components/tenants/TenantImportDialog';
import { PdfScanDialog } from '@/components/tenants/PdfScanDialog';
import { useUnpaidTenantFees, FEE_TYPE_LABELS } from '@/hooks/useTenantFees';
import { useHasFinanceAccess } from '@/hooks/useUserRole';
import { maskEmail } from '@/lib/dataMasking';
import { LimitGuard } from '@/components/subscription/FeatureGuard';

const statusLabels = {
  aktiv: 'Aktiv',
  leerstand: 'Leerstand',
  beendet: 'Beendet',
};

const statusStyles = {
  aktiv: 'bg-success/10 text-success border-success/30',
  leerstand: 'bg-warning/10 text-warning border-warning/30',
  beendet: 'bg-muted text-muted-foreground border-border',
};

export default function TenantList() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const propertyIdFromUrl = searchParams.get('propertyId');

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>(propertyIdFromUrl || 'all');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [pdfScanDialogOpen, setPdfScanDialogOpen] = useState(false);

  const { data: properties = [] } = useProperties();
  const { data: allUnits = [] } = useUnits(); // All units for filtering
  const { data: propertyUnits = [] } = useUnits(selectedPropertyId !== 'all' ? selectedPropertyId : undefined);
  const { data: tenants = [], isLoading, refetch } = useTenants();
  const { data: unpaidFees = [] } = useUnpaidTenantFees();
  const { hasAccess: hasFinanceAccess } = useHasFinanceAccess();
  
  const units = selectedPropertyId === 'all' ? allUnits : propertyUnits;

  // Filter tenants
  const filteredTenants = tenants.filter((tenant: any) => {
    const matchesSearch = searchTerm === '' || 
      `${tenant.first_name} ${tenant.last_name}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tenant.email?.toLowerCase().includes(searchTerm.toLowerCase());
    
    if (selectedPropertyId === 'all') return matchesSearch;
    
    const tenantUnit = units.find((u: any) => u.id === tenant.unit_id);
    return matchesSearch && tenantUnit?.property_id === selectedPropertyId;
  });

  const getUnit = (unitId: string) => units.find((u: any) => u.id === unitId);
  const getProperty = (unitId: string) => {
    const unit = units.find((u: any) => u.id === unitId);
    if (!unit) return null;
    return properties.find((p: any) => p.id === (unit as any).property_id);
  };

  const activeCount = filteredTenants.filter((t: any) => t.status === 'aktiv').length;
  const sepaCount = filteredTenants.filter((t: any) => t.sepa_mandat).length;
  const totalKaution = filteredTenants.reduce((sum: number, t: any) => sum + (t.kaution || 0), 0);

  // Helper function to get unpaid fees for a tenant
  const getUnpaidFeesForTenant = (tenantId: string) => {
    return unpaidFees.filter(fee => fee.tenant_id === tenantId);
  };

  const tenantsWithFees = filteredTenants.filter((t: any) => getUnpaidFeesForTenant(t.id).length > 0).length;

  // Get units for the selected property for import
  const importUnits = selectedPropertyId !== 'all' 
    ? units.map((u: any) => ({ id: u.id, top_nummer: u.top_nummer }))
    : [];

  return (
    <MainLayout title="Mieter" subtitle="Alle Mietverhältnisse verwalten">
      {/* Actions Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4 w-full sm:w-auto">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input 
              type="search" 
              placeholder="Mieter suchen..." 
              className="pl-9"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Alle Liegenschaften" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Liegenschaften</SelectItem>
              {properties.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => {
            if (!filteredTenants || filteredTenants.length === 0) {
              return;
            }
            const headers = ['Vorname', 'Nachname', 'Email', 'Telefon', 'Mietbeginn', 'Grundmiete', 'BK', 'HK', 'Status'];
            const rows = filteredTenants.map((t: any) => [
              t.first_name, t.last_name, t.email ?? '', t.phone ?? '',
              t.mietbeginn, Number(t.grundmiete), Number(t.betriebskosten_vorschuss), Number(t.heizungskosten_vorschuss), t.status,
            ]);
            const csv = [headers.join(';'), ...rows.map((r: any) => r.join(';'))].join('\n');
            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'mieter.csv';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
          }}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          {selectedPropertyId !== 'all' && (
            <>
              <Button variant="outline" onClick={() => setPdfScanDialogOpen(true)} data-testid="button-pdf-scan">
                <FileImage className="h-4 w-4 mr-2" />
                PDF scannen
              </Button>
              <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
                <Upload className="h-4 w-4 mr-2" />
                CSV Import
              </Button>
            </>
          )}
          <LimitGuard 
            type="tenant" 
            currentCount={tenants?.length || 0}
            fallback={
              <Button variant="outline" disabled className="gap-2" data-testid="button-tenant-limit-reached">
                <Lock className="h-4 w-4" />
                Mieter-Limit erreicht
              </Button>
            }
          >
            <Button onClick={() => navigate('/mieter/neu')} data-testid="button-create-tenant">
              <Plus className="h-4 w-4 mr-2" />
              Neuer Mieter
            </Button>
          </LimitGuard>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-2xl font-bold text-foreground">{filteredTenants.length}</p>
          <p className="text-sm text-muted-foreground">Mieter gesamt</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-2xl font-bold text-success">{activeCount}</p>
          <p className="text-sm text-muted-foreground">Aktive Verträge</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-2xl font-bold text-primary">{sepaCount}</p>
          <p className="text-sm text-muted-foreground">SEPA-Mandate</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-2xl font-bold text-foreground">
            €{totalKaution.toLocaleString('de-AT')}
          </p>
          <p className="text-sm text-muted-foreground">Kautionen gesamt</p>
        </div>
        {tenantsWithFees > 0 && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-2xl font-bold text-destructive">{tenantsWithFees}</p>
            <p className="text-sm text-muted-foreground">Mieter mit offenen Gebühren</p>
          </div>
        )}
      </div>

      {/* Tenant Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Laden...</div>
        ) : filteredTenants.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            {searchTerm ? 'Keine Mieter gefunden' : 'Noch keine Mieter vorhanden'}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Mieter</TableHead>
                <TableHead>Einheit</TableHead>
                <TableHead>Liegenschaft</TableHead>
                <TableHead>Miete gesamt</TableHead>
                <TableHead>Mietbeginn</TableHead>
                <TableHead>SEPA</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTenants.map((tenant: any) => {
                const unit = getUnit(tenant.unit_id);
                const property = getProperty(tenant.unit_id);
                const totalRent = calculateTotalRent(tenant);
                const sonstigeTotal = calculateSonstigeKostenTotal(tenant.sonstige_kosten);
                const hasSonstige = checkHasSonstigeKosten(tenant.sonstige_kosten);

                return (
                  <TableRow 
                    key={tenant.id} 
                    className="hover:bg-muted/30 cursor-pointer"
                    onClick={() => navigate(`/mieter/${tenant.id}`)}
                  >
                    <TableCell>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-foreground">
                            {tenant.first_name} {tenant.last_name}
                          </p>
                          {getUnpaidFeesForTenant(tenant.id).length > 0 && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="destructive" className="cursor-help">
                                    <AlertTriangle className="h-3 w-3 mr-1" />
                                    {getUnpaidFeesForTenant(tenant.id).length} Gebühr(en)
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <div className="text-sm">
                                    <p className="font-medium mb-1">Offene Gebühren:</p>
                                    <ul className="space-y-1">
                                      {getUnpaidFeesForTenant(tenant.id).map(fee => (
                                        <li key={fee.id}>
                                          {FEE_TYPE_LABELS[fee.fee_type]}: €{fee.amount.toFixed(2)}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          {tenant.email && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Mail className="h-3 w-3" />
                                    {hasFinanceAccess ? tenant.email : maskEmail(tenant.email)}
                                    {!hasFinanceAccess && <ShieldCheck className="h-3 w-3 text-primary" />}
                                  </span>
                                </TooltipTrigger>
                                {!hasFinanceAccess && (
                                  <TooltipContent>
                                    <p>E-Mail-Adresse ist geschützt. Finanz-Berechtigung erforderlich.</p>
                                  </TooltipContent>
                                )}
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{(unit as any)?.top_nummer || '-'}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground">{property?.name || '-'}</span>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">
                          €{totalRent.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {hasSonstige ? (
                            <>Miete €{Number(tenant.grundmiete || 0).toFixed(2)} + Nebenkosten €{sonstigeTotal.toFixed(2)}</>
                          ) : (
                            <>(€{tenant.grundmiete} + €{tenant.betriebskosten_vorschuss} BK + €{tenant.heizungskosten_vorschuss} HK)</>
                          )}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {new Date(tenant.mietbeginn).toLocaleDateString('de-AT')}
                    </TableCell>
                    <TableCell>
                      {tenant.sepa_mandat ? (
                        <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                          <CreditCard className="h-3 w-3 mr-1" />
                          Aktiv
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusStyles[tenant.status]}>
                        {statusLabels[tenant.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Import Dialog */}
      {selectedPropertyId !== 'all' && (
        <>
          <TenantImportDialog
            open={importDialogOpen}
            onOpenChange={setImportDialogOpen}
            propertyId={selectedPropertyId}
            units={importUnits}
            onSuccess={() => refetch()}
          />
          <PdfScanDialog
            open={pdfScanDialogOpen}
            onOpenChange={setPdfScanDialogOpen}
            propertyId={selectedPropertyId}
            units={importUnits}
            onSuccess={() => refetch()}
          />
        </>
      )}
    </MainLayout>
  );
}
