import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { Meter, MeterInsert, useCreateMeter, useUpdateMeter } from '@/hooks/useMeters';
import { useProperties } from '@/hooks/useProperties';
import { useUnits } from '@/hooks/useUnits';

interface MeterFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meter?: Meter | null;
  defaultUnitId?: string;
}

const METER_TYPES = [
  { value: 'strom', label: 'Strom' },
  { value: 'gas', label: 'Gas' },
  { value: 'wasser', label: 'Wasser' },
  { value: 'heizung', label: 'Heizung' },
  { value: 'warmwasser', label: 'Warmwasser' },
  { value: 'sonstiges', label: 'Sonstiges' },
] as const;

interface FormData {
  meter_number: string;
  meter_type: 'strom' | 'gas' | 'wasser' | 'heizung' | 'warmwasser' | 'sonstiges';
  property_id: string;
  unit_id: string;
  location: string;
  is_active: boolean;
  notes: string;
}

const emptyFormData: FormData = {
  meter_number: '',
  meter_type: 'strom',
  property_id: '',
  unit_id: '',
  location: '',
  is_active: true,
  notes: '',
};

export function MeterForm({ open, onOpenChange, meter, defaultUnitId }: MeterFormProps) {
  const createMeter = useCreateMeter();
  const updateMeter = useUpdateMeter();
  const { data: properties } = useProperties();
  const { data: allUnits } = useUnits();
  
  const [formData, setFormData] = useState<FormData>(emptyFormData);
  
  const filteredUnits = allUnits?.filter(
    (unit) => !formData.property_id || unit.property_id === formData.property_id
  );
  
  const getPropertyName = (propertyId: string | null) => {
    if (!propertyId) return '';
    const property = properties?.find(p => p.id === propertyId);
    return property?.name || '';
  };
  
  useEffect(() => {
    if (meter) {
      setFormData({
        meter_number: meter.meter_number || '',
        meter_type: meter.meter_type || 'strom',
        property_id: meter.units?.property_id || meter.property_id || '',
        unit_id: meter.unit_id || '',
        location: meter.location || '',
        is_active: meter.is_active ?? true,
        notes: meter.notes || '',
      });
    } else if (defaultUnitId) {
      const unit = allUnits?.find(u => u.id === defaultUnitId);
      setFormData({
        ...emptyFormData,
        unit_id: defaultUnitId,
        property_id: unit?.property_id || '',
      });
    } else {
      setFormData(emptyFormData);
    }
  }, [meter, defaultUnitId, open, allUnits]);
  
  const handlePropertyChange = (propertyId: string) => {
    setFormData({
      ...formData,
      property_id: propertyId,
      unit_id: '',
    });
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.meter_number.trim()) return;
    if (!formData.unit_id) return;
    
    try {
      if (meter) {
        await updateMeter.mutateAsync({
          id: meter.id,
          meter_number: formData.meter_number.trim(),
          meter_type: formData.meter_type,
          unit_id: formData.unit_id,
          property_id: formData.property_id || null,
          location: formData.location || null,
          is_active: formData.is_active,
          notes: formData.notes || null,
        });
      } else {
        await createMeter.mutateAsync({
          meter_number: formData.meter_number.trim(),
          meter_type: formData.meter_type,
          unit_id: formData.unit_id,
          property_id: formData.property_id || null,
          location: formData.location || null,
          is_active: formData.is_active,
          notes: formData.notes || null,
        } as MeterInsert);
      }
      onOpenChange(false);
    } catch (error) {
      // Error handled by mutation
    }
  };
  
  const isLoading = createMeter.isPending || updateMeter.isPending;
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {meter ? 'Zähler bearbeiten' : 'Neuen Zähler anlegen'}
          </DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="meter_number">Zählernummer *</Label>
              <Input
                id="meter_number"
                value={formData.meter_number}
                onChange={(e) => setFormData({ ...formData, meter_number: e.target.value })}
                placeholder="12345678"
                required
                data-testid="input-meter-number"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="meter_type">Zählerart *</Label>
              <Select
                value={formData.meter_type}
                onValueChange={(value) => setFormData({ ...formData, meter_type: value as FormData['meter_type'] })}
              >
                <SelectTrigger data-testid="select-meter-type">
                  <SelectValue placeholder="Art wählen" />
                </SelectTrigger>
                <SelectContent>
                  {METER_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="property_id">Liegenschaft</Label>
              <Select
                value={formData.property_id}
                onValueChange={handlePropertyChange}
              >
                <SelectTrigger data-testid="select-meter-property">
                  <SelectValue placeholder="Liegenschaft wählen" />
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
            
            <div className="space-y-2">
              <Label htmlFor="unit_id">Einheit *</Label>
              <Select
                value={formData.unit_id}
                onValueChange={(value) => setFormData({ ...formData, unit_id: value })}
              >
                <SelectTrigger data-testid="select-meter-unit">
                  <SelectValue placeholder="Einheit wählen" />
                </SelectTrigger>
                <SelectContent>
                  {filteredUnits?.map((unit) => {
                    const propertyName = getPropertyName(unit.property_id);
                    return (
                      <SelectItem key={unit.id} value={unit.id}>
                        Top {unit.top_nummer}
                        {propertyName && ` - ${propertyName}`}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="location">Standort</Label>
            <Input
              id="location"
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              placeholder="z.B. Keller, Wohnung, Technikraum"
              data-testid="input-meter-location"
            />
          </div>
          
          <div className="flex items-center space-x-2">
            <Switch
              id="is_active"
              checked={formData.is_active}
              onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              data-testid="switch-meter-active"
            />
            <Label htmlFor="is_active">Zähler aktiv</Label>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="notes">Notizen</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Zusätzliche Informationen..."
              rows={3}
              data-testid="textarea-meter-notes"
            />
          </div>
          
          <DialogFooter>
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-meter"
            >
              Abbrechen
            </Button>
            <Button 
              type="submit" 
              disabled={isLoading || !formData.meter_number || !formData.unit_id}
              data-testid="button-save-meter"
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
