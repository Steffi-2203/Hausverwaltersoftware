import { Link, useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Search, Filter, Home, Building2, Car, Loader2, Users, AlertTriangle, Clock, Scale, Upload } from 'lucide-react';
import { useUnits } from '@/hooks/useUnits';
import { useProperties } from '@/hooks/useProperties';
import { useTenants } from '@/hooks/useTenants';
import { useInvoices } from '@/hooks/useInvoices';
import { useState } from 'react';
import { differenceInDays, format, addMonths } from 'date-fns';
import { de } from 'date-fns/locale';
import { useQueryClient } from '@tanstack/react-query';
import { UnitImportDialog } from '@/components/units/UnitImportDialog';

const unitTypeLabels: Record<string, string> = {
  wohnung: 'Wohnung',
  geschaeft: 'Geschäft',
  garage: 'Garage',
  stellplatz: 'Stellplatz',
  lager: 'Lager',
  sonstiges: 'Sonstiges',
};

const unitTypeIcons: Record<string, React.ElementType> = {
  wohnung: Home,
  geschaeft: Building2,
  garage: Car,
  stellplatz: Car,
  lager: Building2,
  sonstiges: Building2,
};

const statusLabels: Record<string, string> = {
  aktiv: 'Vermietet',
  leerstand: 'Leerstand',
  beendet: 'Beendet',
};

const statusStyles: Record<string, string> = {
  aktiv: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  leerstand: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  beendet: 'bg-muted text-muted-foreground',
};

const mrgScopeLabels: Record<string, string> = {
  vollanwendung: 'Voll-MRG',
  teilanwendung: 'Teil-MRG',
  ausgenommen: 'Kein MRG',
};

const mrgScopeStyles: Record<string, string> = {
  vollanwendung: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  teilanwendung: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  ausgenommen: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
};

export default function UnitList() {
  const navigate = useNavigate();
  const [propertyFilter, setPropertyFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedPropertyForImport, setSelectedPropertyForImport] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: units, isLoading: isLoadingUnits } = useUnits();
  const { data: properties } = useProperties();
  const { data: tenants } = useTenants();
  const { data: invoices } = useInvoices();

  const getProperty = (propertyId: string) => properties?.find((p: any) => p.id === propertyId);
  const getTenantForUnit = (unitId: string) => tenants?.find((t: any) => t.unit_id === unitId && t.status === 'aktiv');
  const getInvoicesForUnit = (unitId: string) => invoices?.filter((i: any) => i.unit_id === unitId) || [];

  // Check if contract expires within 3 months
  const getContractExpirationInfo = (tenant: any) => {
    if (!tenant?.mietende) return null;
    const endDate = new Date(tenant.mietende);
    const today = new Date();
    const daysUntilExpiry = differenceInDays(endDate, today);
    
    if (daysUntilExpiry < 0) {
      return { status: 'expired', message: 'Mietvertrag abgelaufen', daysUntilExpiry, endDate };
    }
    if (daysUntilExpiry <= 90) {
      return { status: 'warning', message: `Mietvertrag läuft in ${daysUntilExpiry} Tagen ab`, daysUntilExpiry, endDate };
    }
    return null;
  };

  // Count expiring contracts
  const expiringContracts = tenants?.filter(t => {
    if (t.status !== 'aktiv' || !t.mietende) return false;
    const daysUntilExpiry = differenceInDays(new Date(t.mietende), new Date());
    return daysUntilExpiry >= 0 && daysUntilExpiry <= 90;
  }).length || 0;
  // Filter units
  const filteredUnits = units?.filter((unit: any) => {
    if (propertyFilter !== 'all' && unit.property_id !== propertyFilter) return false;
    if (typeFilter !== 'all' && unit.type !== typeFilter) return false;
    if (statusFilter !== 'all' && unit.status !== statusFilter) return false;
    if (searchQuery) {
      const property = getProperty(unit.property_id);
      const tenant = getTenantForUnit(unit.id);
      const searchLower = searchQuery.toLowerCase();
      const matchesTop = unit.top_nummer.toLowerCase().includes(searchLower);
      const matchesProperty = property?.name.toLowerCase().includes(searchLower);
      const matchesTenant = tenant && `${tenant.first_name} ${tenant.last_name}`.toLowerCase().includes(searchLower);
      if (!matchesTop && !matchesProperty && !matchesTenant) return false;
    }
    return true;
  }) || [];

  // Calculate stats
  const stats = {
    total: units?.length || 0,
    wohnungen: units?.filter(u => u.type === 'wohnung').length || 0,
    geschaefte: units?.filter(u => u.type === 'geschaeft').length || 0,
    vermietet: units?.filter(u => u.status === 'aktiv').length || 0,
    leerstand: units?.filter(u => u.status === 'leerstand').length || 0,
  };

  if (isLoadingUnits) {
    return (
      <MainLayout title="Einheiten" subtitle="Alle Mieteinheiten verwalten">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout title="Einheiten" subtitle="Alle Mieteinheiten mit Mietern und Vorschreibungen">
      {/* Actions Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input 
              type="search" 
              placeholder="Einheit, Liegenschaft oder Mieter suchen..." 
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Select value={propertyFilter} onValueChange={setPropertyFilter}>
            <SelectTrigger className="w-52">
              <Building2 className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Liegenschaft" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Liegenschaften</SelectItem>
              {properties?.map((property) => (
                <SelectItem key={property.id} value={property.id}>
                  {property.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-40">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Typ" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Typen</SelectItem>
              <SelectItem value="wohnung">Wohnungen</SelectItem>
              <SelectItem value="geschaeft">Geschäfte</SelectItem>
              <SelectItem value="garage">Garagen</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Status</SelectItem>
              <SelectItem value="aktiv">Vermietet</SelectItem>
              <SelectItem value="leerstand">Leerstand</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Select 
            value={selectedPropertyForImport || ''} 
            onValueChange={(value) => {
              setSelectedPropertyForImport(value);
              setImportDialogOpen(true);
            }}
          >
            <SelectTrigger className="w-auto">
              <Upload className="h-4 w-4 mr-2" />
              <span>CSV Import</span>
            </SelectTrigger>
            <SelectContent>
              {properties?.map((property) => (
                <SelectItem key={property.id} value={property.id}>
                  {property.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Unit Import Dialog */}
      {selectedPropertyForImport && (
        <UnitImportDialog
          open={importDialogOpen}
          onOpenChange={(open) => {
            setImportDialogOpen(open);
            if (!open) setSelectedPropertyForImport(null);
          }}
          propertyId={selectedPropertyForImport}
          existingUnits={units?.filter((u: any) => u.property_id === selectedPropertyForImport) || []}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['units'] });
            setImportDialogOpen(false);
            setSelectedPropertyForImport(null);
          }}
        />
      )}

      {/* Contract Expiration Warning */}
      {expiringContracts > 0 && (
        <Card className="mb-6 border-warning bg-warning/10">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-warning" />
            <div>
              <p className="font-medium text-warning">
                {expiringContracts} {expiringContracts === 1 ? 'Mietvertrag läuft' : 'Mietverträge laufen'} in den nächsten 3 Monaten ab
              </p>
              <p className="text-sm text-muted-foreground">
                Bitte prüfen Sie die betroffenen Einheiten und kontaktieren Sie die Mieter rechtzeitig.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold text-foreground">{stats.total}</p>
            <p className="text-sm text-muted-foreground">Einheiten gesamt</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold text-foreground">{stats.wohnungen}</p>
            <p className="text-sm text-muted-foreground">Wohnungen</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold text-foreground">{stats.geschaefte}</p>
            <p className="text-sm text-muted-foreground">Geschäfte</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold text-green-600">{stats.vermietet}</p>
            <p className="text-sm text-muted-foreground">Vermietet</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold text-yellow-600">{stats.leerstand}</p>
            <p className="text-sm text-muted-foreground">Leerstand</p>
          </CardContent>
        </Card>
      </div>

      {/* Units Table */}
      <Card>
        <CardContent className="p-0">
          {filteredUnits.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Home className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Keine Einheiten gefunden</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Einheit</TableHead>
                  <TableHead>Liegenschaft</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead>Fläche</TableHead>
                  <TableHead>MRG</TableHead>
                  <TableHead>Mieter</TableHead>
                  <TableHead>Mietvertrag</TableHead>
                  <TableHead className="text-right">Vorschreibung/Monat</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUnits.map((unit: any) => {
                  const property = getProperty(unit.property_id);
                  const tenant = getTenantForUnit(unit.id);
                  const expirationInfo = tenant ? getContractExpirationInfo(tenant) : null;
                  const Icon = unitTypeIcons[unit.type] || Building2;
                  
                  const grundmiete = tenant ? Number(tenant.grundmiete) : 0;
                  const bk = tenant ? Number(tenant.betriebskosten_vorschuss) : 0;
                  const hk = tenant ? Number(tenant.heizungskosten_vorschuss) : 0;
                  const totalRent = grundmiete + bk + hk;

                  return (
                    <TableRow 
                      key={unit.id} 
                      className="hover:bg-muted/30 cursor-pointer"
                      onClick={() => navigate(`/einheiten/${unit.property_id}/${unit.id}`)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="rounded-lg bg-muted p-1.5">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <span className="font-medium">{unit.top_nummer}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-muted-foreground">{property?.name}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{unitTypeLabels[unit.type]}</Badge>
                      </TableCell>
                      <TableCell>{Number(unit.qm).toLocaleString('de-AT')} m²</TableCell>
                      <TableCell>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <Badge className={mrgScopeStyles[(unit as any).mrg_scope || 'vollanwendung']}>
                                <Scale className="h-3 w-3 mr-1" />
                                {mrgScopeLabels[(unit as any).mrg_scope || 'vollanwendung']}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p><strong>Kategorie:</strong> {(unit as any).ausstattungskategorie || 'A'}</p>
                              <p><strong>Nutzfläche §17:</strong> {Number((unit as any).nutzflaeche_mrg || unit.qm).toLocaleString('de-AT')} m²</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell>
                        {tenant ? (
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">{tenant.first_name} {tenant.last_name}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <TooltipProvider>
                          {tenant ? (
                            <div className="flex items-center gap-2">
                              {expirationInfo ? (
                                <Tooltip>
                                  <TooltipTrigger>
                                    <div className={`flex items-center gap-1 ${expirationInfo.status === 'expired' ? 'text-destructive' : 'text-warning'}`}>
                                      {expirationInfo.status === 'expired' ? (
                                        <AlertTriangle className="h-4 w-4" />
                                      ) : (
                                        <Clock className="h-4 w-4" />
                                      )}
                                      <span className="text-sm font-medium">
                                        {format(expirationInfo.endDate, 'dd.MM.yyyy', { locale: de })}
                                      </span>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{expirationInfo.message}</p>
                                    <p className="text-xs text-muted-foreground">
                                      Beginn: {format(new Date(tenant.mietbeginn), 'dd.MM.yyyy', { locale: de })}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              ) : tenant.mietende ? (
                                <span className="text-sm text-muted-foreground">
                                  bis {format(new Date(tenant.mietende), 'dd.MM.yyyy', { locale: de })}
                                </span>
                              ) : (
                                <span className="text-sm text-muted-foreground">unbefristet</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TooltipProvider>
                      </TableCell>
                      <TableCell className="text-right">
                        {tenant ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <span className="font-semibold text-foreground cursor-help underline decoration-dotted">
                                  € {totalRent.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="p-3">
                                <div className="space-y-1 text-sm">
                                  <p className="font-semibold border-b pb-1 mb-2">Monatliche Vorschreibung</p>
                                  <div className="flex justify-between gap-4">
                                    <span>Grundmiete:</span>
                                    <span className="font-medium">€ {grundmiete.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span>Betriebskosten:</span>
                                    <span className="font-medium">€ {bk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span>Heizkosten:</span>
                                    <span className="font-medium">€ {hk.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
                                  </div>
                                  <div className="flex justify-between gap-4 border-t pt-1 mt-2 font-semibold">
                                    <span>Gesamt:</span>
                                    <span>€ {totalRent.toLocaleString('de-AT', { minimumFractionDigits: 2 })}</span>
                                  </div>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={statusStyles[unit.status]}>
                          {statusLabels[unit.status]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </MainLayout>
  );
}
