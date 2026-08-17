import { useState, useMemo } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Search, Gauge } from 'lucide-react';
import { useMeters, useDeleteMeter, useLatestMeterReadings, Meter } from '@/hooks/useMeters';
import { useProperties } from '@/hooks/useProperties';
import { useUnits } from '@/hooks/useUnits';
import { MeterCard } from '@/components/meters/MeterCard';
import { MeterForm } from '@/components/meters/MeterForm';
import { MeterReadingForm } from '@/components/meters/MeterReadingForm';
import { MeterHistoryDialog } from '@/components/meters/MeterHistoryDialog';

export default function MeterReadings() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterProperty, setFilterProperty] = useState<string>('all');
  const [filterUnit, setFilterUnit] = useState<string>('all');
  const [meterFormOpen, setMeterFormOpen] = useState(false);
  const [editingMeter, setEditingMeter] = useState<Meter | null>(null);
  const [deletingMeter, setDeletingMeter] = useState<Meter | null>(null);
  const [readingFormMeter, setReadingFormMeter] = useState<Meter | null>(null);
  const [historyMeter, setHistoryMeter] = useState<Meter | null>(null);
  
  const { data: meters, isLoading } = useMeters();
  const { data: properties } = useProperties();
  const { data: allUnits } = useUnits();
  const deleteMeter = useDeleteMeter();
  
  const meterIds = useMemo(() => meters?.map(m => m.id) || [], [meters]);
  const { data: latestReadings } = useLatestMeterReadings(meterIds);
  
  const filteredUnits = useMemo(() => {
    if (filterProperty === 'all') return allUnits;
    return allUnits?.filter(unit => unit.property_id === filterProperty);
  }, [allUnits, filterProperty]);
  
  const filteredMeters = useMemo(() => {
    return meters?.filter((meter) => {
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch = !searchQuery || 
        meter.meter_number.toLowerCase().includes(searchLower) ||
        meter.meter_type.toLowerCase().includes(searchLower) ||
        meter.location?.toLowerCase().includes(searchLower) ||
        meter.units?.top_nummer?.toLowerCase().includes(searchLower);
      
      const matchesProperty = filterProperty === 'all' || 
        meter.units?.property_id === filterProperty;
      
      const matchesUnit = filterUnit === 'all' || 
        meter.unit_id === filterUnit;
      
      return matchesSearch && matchesProperty && matchesUnit;
    }) || [];
  }, [meters, searchQuery, filterProperty, filterUnit]);
  
  const handleEdit = (meter: Meter) => {
    setEditingMeter(meter);
    setMeterFormOpen(true);
  };
  
  const handleDelete = async () => {
    if (deletingMeter) {
      await deleteMeter.mutateAsync(deletingMeter.id);
      setDeletingMeter(null);
    }
  };
  
  const handleFormClose = () => {
    setMeterFormOpen(false);
    setEditingMeter(null);
  };
  
  const handlePropertyFilterChange = (value: string) => {
    setFilterProperty(value);
    setFilterUnit('all');
  };
  
  return (
    <MainLayout title="Zählerstände" subtitle="Verwaltung Ihrer Verbrauchszähler">
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold">Zählerstände</h1>
            <p className="text-muted-foreground">
              Erfassen und verwalten Sie Ihre Verbrauchszähler
            </p>
          </div>
          <Button onClick={() => setMeterFormOpen(true)} data-testid="button-add-meter">
            <Plus className="h-4 w-4 mr-2" />
            Neuer Zähler
          </Button>
        </div>
        
        <div className="flex flex-wrap gap-4 items-center">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Suchen..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search-meters"
            />
          </div>
          
          <Select value={filterProperty} onValueChange={handlePropertyFilterChange}>
            <SelectTrigger className="w-[200px]" data-testid="select-filter-property">
              <SelectValue placeholder="Alle Liegenschaften" />
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
          
          <Select value={filterUnit} onValueChange={setFilterUnit}>
            <SelectTrigger className="w-[180px]" data-testid="select-filter-unit">
              <SelectValue placeholder="Alle Einheiten" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Einheiten</SelectItem>
              {filteredUnits?.map((unit) => (
                <SelectItem key={unit.id} value={unit.id}>
                  Top {unit.top_nummer}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-64 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        ) : filteredMeters.length === 0 ? (
          <div className="text-center py-16">
            <Gauge className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="text-lg font-medium mb-2">Keine Zähler gefunden</h3>
            <p className="text-muted-foreground mb-4">
              {searchQuery || filterProperty !== 'all' || filterUnit !== 'all'
                ? 'Versuchen Sie andere Filteroptionen'
                : 'Legen Sie Ihren ersten Zähler an'}
            </p>
            {!searchQuery && filterProperty === 'all' && filterUnit === 'all' && (
              <Button onClick={() => setMeterFormOpen(true)} data-testid="button-add-meter-empty">
                <Plus className="h-4 w-4 mr-2" />
                Zähler anlegen
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredMeters.map((meter) => (
              <MeterCard
                key={meter.id}
                meter={meter}
                latestReadings={latestReadings?.[meter.id]}
                onEdit={handleEdit}
                onDelete={setDeletingMeter}
                onAddReading={setReadingFormMeter}
                onViewHistory={setHistoryMeter}
              />
            ))}
          </div>
        )}
      </div>
      
      <MeterForm
        open={meterFormOpen}
        onOpenChange={handleFormClose}
        meter={editingMeter}
      />
      
      <MeterReadingForm
        open={!!readingFormMeter}
        onOpenChange={(open) => !open && setReadingFormMeter(null)}
        meter={readingFormMeter}
      />
      
      <MeterHistoryDialog
        open={!!historyMeter}
        onOpenChange={(open) => !open && setHistoryMeter(null)}
        meter={historyMeter}
      />
      
      <AlertDialog open={!!deletingMeter} onOpenChange={() => setDeletingMeter(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Zähler löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Möchten Sie den Zähler "{deletingMeter?.meter_number}" wirklich löschen?
              Alle zugehörigen Ablesungen werden ebenfalls gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-meter">Abbrechen</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete}
              data-testid="button-confirm-delete-meter"
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
