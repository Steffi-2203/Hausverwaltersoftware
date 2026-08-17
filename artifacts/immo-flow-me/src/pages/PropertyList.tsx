import { MainLayout } from '@/components/layout/MainLayout';
import { PropertyCard } from '@/components/dashboard/PropertyCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Search, Filter, Download, Loader2, Building2, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useProperties } from '@/hooks/useProperties';
import { useUnits } from '@/hooks/useUnits';
import { useState } from 'react';
import { PropertyImportDialog } from '@/components/properties/PropertyImportDialog';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export default function PropertyList() {
  const { data: properties, isLoading } = useProperties();
  const { data: allUnits } = useUnits();
  const [searchQuery, setSearchQuery] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('all');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  const filteredProperties = properties?.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.city.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.address.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;

    if (propertyFilter === 'active') {
      const units = allUnits?.filter((u) => u.property_id === p.id) || [];
      return units.some((u) => u.status === 'aktiv');
    }
    if (propertyFilter === 'vacant') {
      const units = allUnits?.filter((u) => u.property_id === p.id) || [];
      return units.some((u) => u.status === 'leerstand');
    }
    return true;
  });

  const handleExportProperties = () => {
    if (!filteredProperties || filteredProperties.length === 0) {
      toast.info('Keine Daten zum Exportieren');
      return;
    }
    const headers = ['Name', 'Adresse', 'Stadt', 'PLZ', 'Baujahr', 'Fläche (m²)', 'MEA'];
    const rows = filteredProperties.map((p) => [
      p.name, p.address, p.city, p.postal_code,
      p.building_year ?? '', Number(p.total_qm) || '', Number(p.total_mea) || '',
    ]);
    const csv = [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'liegenschaften.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Export erfolgreich');
  };

  const getUnitsForProperty = (propertyId: string) => {
    const units = allUnits?.filter((u) => u.property_id === propertyId) || [];
    return {
      total: units.length,
      occupied: units.filter((u) => u.status === 'aktiv').length,
      vacant: units.filter((u) => u.status === 'leerstand').length,
    };
  };

  const totalUnits = allUnits?.length || 0;
  const totalQm = properties?.reduce((sum, p) => sum + (Number(p.total_qm) || 0), 0) || 0;
  const occupiedUnits = allUnits?.filter((u) => u.status === 'aktiv').length || 0;
  const occupancyRate = totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0;

  if (isLoading) {
    return (
      <MainLayout title="Liegenschaften" subtitle="Alle verwalteten Immobilien">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout title="Liegenschaften" subtitle="Alle verwalteten Immobilien">
      {/* Actions Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Liegenschaft suchen..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Select value={propertyFilter} onValueChange={setPropertyFilter}>
            <SelectTrigger className="w-40">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle</SelectItem>
              <SelectItem value="active">Aktiv</SelectItem>
              <SelectItem value="vacant">Mit Leerstand</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Importieren
          </Button>
          <Button variant="outline" onClick={handleExportProperties}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Link to="/liegenschaften/neu">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Neue Liegenschaft
            </Button>
          </Link>
        </div>
      </div>

      <PropertyImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['properties'] })}
      />

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-2xl font-bold text-foreground">
            {properties?.length || 0}
          </p>
          <p className="text-sm text-muted-foreground">Liegenschaften</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-2xl font-bold text-foreground">{totalUnits}</p>
          <p className="text-sm text-muted-foreground">Einheiten gesamt</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-2xl font-bold text-foreground">
            {totalQm.toLocaleString('de-AT')} m²
          </p>
          <p className="text-sm text-muted-foreground">Gesamtfläche</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-2xl font-bold text-success">{occupancyRate}%</p>
          <p className="text-sm text-muted-foreground">Ø Auslastung</p>
        </div>
      </div>

      {/* Properties Grid */}
      {filteredProperties && filteredProperties.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProperties.map((property) => (
            <PropertyCard
              key={property.id}
              property={{
                id: property.id,
                name: property.name,
                address: property.address,
                city: property.city,
                postal_code: property.postal_code,
                total_qm: Number(property.total_qm),
                total_mea: Number(property.total_mea),
                building_year: property.building_year,
              }}
              units={getUnitsForProperty(property.id)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-lg font-medium text-foreground mb-2">
            Keine Liegenschaften vorhanden
          </p>
          <p className="text-sm text-muted-foreground mb-4">
            Erstellen Sie Ihre erste Liegenschaft, um zu beginnen
          </p>
          <Link to="/liegenschaften/neu">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Neue Liegenschaft
            </Button>
          </Link>
        </div>
      )}
    </MainLayout>
  );
}
