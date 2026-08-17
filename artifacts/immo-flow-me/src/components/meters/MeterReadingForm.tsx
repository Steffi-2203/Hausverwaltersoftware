import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Gauge } from 'lucide-react';
import { Meter, MeterReadingInsert, useCreateMeterReading, useMeterReadings } from '@/hooks/useMeters';
import { format } from 'date-fns';

interface MeterReadingFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meter: Meter | null;
}

interface FormData {
  reading_date: string;
  reading_value: string;
  is_estimated: boolean;
  read_by: string;
  notes: string;
}

const getEmptyFormData = (): FormData => ({
  reading_date: format(new Date(), 'yyyy-MM-dd'),
  reading_value: '',
  is_estimated: false,
  read_by: '',
  notes: '',
});

const METER_TYPE_LABELS: Record<string, string> = {
  strom: 'Strom',
  gas: 'Gas',
  wasser: 'Wasser',
  heizung: 'Heizung',
  warmwasser: 'Warmwasser',
  sonstiges: 'Sonstiges',
};

export function MeterReadingForm({ open, onOpenChange, meter }: MeterReadingFormProps) {
  const createMeterReading = useCreateMeterReading();
  const { data: existingReadings } = useMeterReadings(meter?.id);
  
  const [formData, setFormData] = useState<FormData>(getEmptyFormData());
  
  const latestReading = existingReadings?.[0];
  
  useEffect(() => {
    if (open) {
      setFormData(getEmptyFormData());
    }
  }, [open]);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!meter) return;
    if (!formData.reading_date) return;
    if (!formData.reading_value) return;
    
    const readingValue = parseFloat(formData.reading_value.replace(',', '.'));
    if (isNaN(readingValue)) return;
    
    try {
      await createMeterReading.mutateAsync({
        meter_id: meter.id,
        reading_date: formData.reading_date,
        reading_value: readingValue,
        is_estimated: formData.is_estimated,
        read_by: formData.read_by || null,
        notes: formData.notes || null,
      } as MeterReadingInsert);
      onOpenChange(false);
    } catch (error) {
      // Error handled by mutation
    }
  };
  
  const isLoading = createMeterReading.isPending;
  
  const currentValue = parseFloat(formData.reading_value.replace(',', '.'));
  const consumption = !isNaN(currentValue) && latestReading
    ? currentValue - Number(latestReading.reading_value)
    : null;
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5" />
            Zählerstand erfassen
          </DialogTitle>
        </DialogHeader>
        
        {meter && (
          <div className="bg-muted/50 rounded-lg p-3 space-y-1">
            <div className="font-medium">{meter.meter_number}</div>
            <div className="text-sm text-muted-foreground">
              {METER_TYPE_LABELS[meter.meter_type]} - Top {meter.units?.top_nummer}
            </div>
            {latestReading && (
              <div className="text-sm text-muted-foreground">
                Letzter Stand: {Number(latestReading.reading_value).toLocaleString('de-AT')} 
                {' '}({format(new Date(latestReading.reading_date), 'dd.MM.yyyy')})
              </div>
            )}
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="reading_date">Ablesedatum *</Label>
              <Input
                id="reading_date"
                type="date"
                value={formData.reading_date}
                onChange={(e) => setFormData({ ...formData, reading_date: e.target.value })}
                required
                data-testid="input-reading-date"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="reading_value">Zählerstand *</Label>
              <Input
                id="reading_value"
                type="text"
                inputMode="decimal"
                value={formData.reading_value}
                onChange={(e) => setFormData({ ...formData, reading_value: e.target.value })}
                placeholder="12345,678"
                required
                data-testid="input-reading-value"
              />
            </div>
          </div>
          
          {consumption !== null && (
            <div className="bg-muted/50 rounded-lg p-3">
              <div className="text-sm text-muted-foreground">Verbrauch seit letzter Ablesung:</div>
              <div className={`text-lg font-semibold ${consumption < 0 ? 'text-destructive' : ''}`}>
                {consumption >= 0 ? '+' : ''}{consumption.toLocaleString('de-AT', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
              </div>
              {consumption < 0 && (
                <div className="text-xs text-destructive">
                  Achtung: Der neue Wert ist niedriger als der vorherige!
                </div>
              )}
            </div>
          )}
          
          <div className="flex items-center space-x-2">
            <Checkbox
              id="is_estimated"
              checked={formData.is_estimated}
              onCheckedChange={(checked) => setFormData({ ...formData, is_estimated: checked === true })}
              data-testid="checkbox-reading-estimated"
            />
            <Label htmlFor="is_estimated" className="font-normal">
              Schätzwert (nicht abgelesen)
            </Label>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="read_by">Abgelesen von</Label>
            <Input
              id="read_by"
              value={formData.read_by}
              onChange={(e) => setFormData({ ...formData, read_by: e.target.value })}
              placeholder="Name des Ablesers"
              data-testid="input-reading-read-by"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="notes">Notizen</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Zusätzliche Informationen..."
              rows={2}
              data-testid="textarea-reading-notes"
            />
          </div>
          
          <DialogFooter>
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-reading"
            >
              Abbrechen
            </Button>
            <Button 
              type="submit" 
              disabled={isLoading || !formData.reading_date || !formData.reading_value}
              data-testid="button-save-reading"
            >
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
