import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Calculator, TrendingUp, Info, AlertTriangle, Scale } from 'lucide-react';
import { useTenants } from '@/hooks/useTenants';
import { useCreateVpiAdjustment, useUpdateVpiAdjustment, VpiAdjustment } from '@/hooks/useVpiAdjustments';
import { format } from 'date-fns';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';

type RentType = 'kategoriemiete' | 'richtwertmiete' | 'freier_markt';

interface MieWegResult {
  allowedIncreasePercent: number;
  newRent: number;
  increaseAmount: number;
  explanation: string;
  nextIndexationDate: string;
  isApplicable: boolean;
  notApplicableReason?: string;
}

interface VpiCalculatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingAdjustment?: VpiAdjustment | null;
}

export function VpiCalculator({ open, onOpenChange, editingAdjustment }: VpiCalculatorProps) {
  const { data: tenants } = useTenants();
  const createMutation = useCreateVpiAdjustment();
  const updateMutation = useUpdateVpiAdjustment();
  
  const [tenantId, setTenantId] = useState<string>('');
  const [vpiOld, setVpiOld] = useState<string>('');
  const [vpiNew, setVpiNew] = useState<string>('');
  const [adjustmentDate, setAdjustmentDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [notes, setNotes] = useState<string>('');
  const [useMieWeg, setUseMieWeg] = useState<boolean>(true);
  const [rentType, setRentType] = useState<RentType>('freier_markt');
  const [mieWegResult, setMieWegResult] = useState<MieWegResult | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  
  const activeTenants = useMemo(() => {
    return tenants?.filter(t => t.status === 'aktiv') || [];
  }, [tenants]);
  
  const selectedTenant = useMemo(() => {
    return activeTenants.find(t => t.id === tenantId);
  }, [activeTenants, tenantId]);
  
  const currentRent = useMemo(() => {
    return selectedTenant?.grundmiete ? Number(selectedTenant.grundmiete) : 0;
  }, [selectedTenant]);
  
  const inflationRate = useMemo(() => {
    const oldVal = parseFloat(vpiOld);
    const newVal = parseFloat(vpiNew);
    if (!oldVal || !newVal || oldVal <= 0) return 0;
    return ((newVal - oldVal) / oldVal) * 100;
  }, [vpiOld, vpiNew]);
  
  useEffect(() => {
    if (useMieWeg && currentRent > 0 && inflationRate > 0) {
      const calculateMieWeg = async () => {
        setIsCalculating(true);
        setMieWegResult(null);
        try {
          const response = await fetch('/api/mieweg-calculate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              currentRent,
              inflationRate,
              rentType,
              indexationYear: new Date(adjustmentDate).getFullYear(),
              lastIndexationDate: adjustmentDate,
              isEinZweifamilienhaus: false,
            }),
          });
          if (response.ok) {
            const result = await response.json();
            setMieWegResult(result);
          } else {
            const errorData = await response.json().catch(() => ({}));
            console.error('MieWeG API error:', errorData);
            setMieWegResult({
              isApplicable: false,
              notApplicableReason: errorData.error || 'Berechnung fehlgeschlagen',
              allowedIncreasePercent: 0,
              newRent: currentRent,
              increaseAmount: 0,
              explanation: '',
              nextIndexationDate: '',
            });
          }
        } catch (error) {
          console.error('MieWeG calculation error:', error);
          setMieWegResult(null);
        } finally {
          setIsCalculating(false);
        }
      };
      calculateMieWeg();
    } else {
      setMieWegResult(null);
    }
  }, [useMieWeg, currentRent, inflationRate, rentType, adjustmentDate]);
  
  const calculation = useMemo(() => {
    const oldVal = parseFloat(vpiOld);
    const newVal = parseFloat(vpiNew);
    
    if (!oldVal || !newVal || oldVal <= 0 || !currentRent) {
      return { percentageChange: 0, newRent: currentRent };
    }
    
    if (useMieWeg && mieWegResult?.isApplicable) {
      return {
        percentageChange: mieWegResult.allowedIncreasePercent,
        newRent: mieWegResult.newRent,
      };
    }
    
    const percentageChange = ((newVal - oldVal) / oldVal) * 100;
    const newRent = currentRent * (newVal / oldVal);
    
    return {
      percentageChange: Math.round(percentageChange * 100) / 100,
      newRent: Math.round(newRent * 100) / 100,
    };
  }, [vpiOld, vpiNew, currentRent, useMieWeg, mieWegResult]);
  
  useEffect(() => {
    if (editingAdjustment) {
      setTenantId(editingAdjustment.tenant_id);
      setVpiOld(editingAdjustment.vpi_old?.toString() || '');
      setVpiNew(editingAdjustment.vpi_new?.toString() || '');
      setAdjustmentDate(editingAdjustment.adjustment_date);
      setNotes(editingAdjustment.notes || '');
    } else {
      setTenantId('');
      setVpiOld('');
      setVpiNew('');
      setAdjustmentDate(format(new Date(), 'yyyy-MM-dd'));
      setNotes('');
    }
  }, [editingAdjustment, open]);
  
  const handleSubmit = async () => {
    if (!tenantId || !vpiOld || !vpiNew || !adjustmentDate) {
      return;
    }
    
    const data = {
      tenant_id: tenantId,
      previous_rent: currentRent,
      new_rent: calculation.newRent,
      vpi_old: parseFloat(vpiOld),
      vpi_new: parseFloat(vpiNew),
      percentage_change: calculation.percentageChange,
      adjustment_date: adjustmentDate,
      notes: notes || null,
    };
    
    if (editingAdjustment) {
      await updateMutation.mutateAsync({ id: editingAdjustment.id, ...data });
    } else {
      await createMutation.mutateAsync(data);
    }
    
    onOpenChange(false);
  };
  
  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const isValid = tenantId && vpiOld && vpiNew && parseFloat(vpiOld) > 0 && parseFloat(vpiNew) > 0 && adjustmentDate;
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            {editingAdjustment ? 'VPI-Anpassung bearbeiten' : 'Neue VPI-Anpassung berechnen'}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tenant">Mieter *</Label>
            <Select 
              value={tenantId} 
              onValueChange={setTenantId}
              disabled={!!editingAdjustment}
            >
              <SelectTrigger id="tenant" data-testid="select-tenant">
                <SelectValue placeholder="Mieter auswählen..." />
              </SelectTrigger>
              <SelectContent>
                {activeTenants.map((tenant) => (
                  <SelectItem key={tenant.id} value={tenant.id}>
                    {tenant.first_name} {tenant.last_name}
                    {tenant.units && ` - Top ${tenant.units.top_nummer}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {selectedTenant && (
            <Card className="bg-muted/50">
              <CardContent className="pt-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Aktuelle Grundmiete:</span>
                  <span className="font-semibold" data-testid="text-current-rent">
                    € {currentRent.toFixed(2)}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="vpi-old">VPI Basiswert (alt) *</Label>
              <Input
                id="vpi-old"
                type="number"
                step="0.01"
                placeholder="z.B. 118.50"
                value={vpiOld}
                onChange={(e) => setVpiOld(e.target.value)}
                data-testid="input-vpi-old"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vpi-new">VPI Neuer Wert *</Label>
              <Input
                id="vpi-new"
                type="number"
                step="0.01"
                placeholder="z.B. 123.70"
                value={vpiNew}
                onChange={(e) => setVpiNew(e.target.value)}
                data-testid="input-vpi-new"
              />
            </div>
          </div>
          
          <Card className="border-orange-500/20 bg-orange-50 dark:bg-orange-950/20">
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Scale className="h-4 w-4 text-orange-600" />
                  <Label htmlFor="use-mieweg" className="font-medium">MieWeG 2026 anwenden</Label>
                </div>
                <Switch 
                  id="use-mieweg" 
                  checked={useMieWeg} 
                  onCheckedChange={setUseMieWeg}
                  data-testid="switch-mieweg"
                />
              </div>
              
              {useMieWeg && (
                <div className="space-y-2">
                  <Label htmlFor="rent-type" className="text-sm">Mietart</Label>
                  <Select value={rentType} onValueChange={(v) => setRentType(v as RentType)}>
                    <SelectTrigger id="rent-type" data-testid="select-rent-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="freier_markt">Freier Markt</SelectItem>
                      <SelectItem value="richtwertmiete">Richtwertmiete</SelectItem>
                      <SelectItem value="kategoriemiete">Kategoriemiete</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Gem. Mieten-Wertsicherungsgesetz (MieWeG) 2026: Hälfteregelung bei Inflation &gt; 3%
                  </p>
                </div>
              )}
              
              {useMieWeg && mieWegResult?.explanation && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    {mieWegResult.explanation}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
          
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Info className="h-4 w-4" />
                <span>{useMieWeg ? 'MieWeG-konforme Berechnung' : 'Formel: Neue Miete = Alte Miete × (VPI Neu / VPI Alt)'}</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-muted-foreground">Prozentuale Änderung:</span>
                  <div className="flex items-center gap-1 font-semibold text-lg" data-testid="text-percentage-change">
                    <TrendingUp className={`h-4 w-4 ${calculation.percentageChange > 0 ? 'text-green-500' : 'text-red-500'}`} />
                    {calculation.percentageChange > 0 ? '+' : ''}{calculation.percentageChange.toFixed(2)}%
                  </div>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">Neue Miete:</span>
                  <div className="font-semibold text-lg text-primary" data-testid="text-new-rent">
                    € {calculation.newRent.toFixed(2)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <div className="space-y-2">
            <Label htmlFor="adjustment-date">Anpassungsdatum *</Label>
            <Input
              id="adjustment-date"
              type="date"
              value={adjustmentDate}
              onChange={(e) => setAdjustmentDate(e.target.value)}
              data-testid="input-adjustment-date"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="notes">Anmerkungen</Label>
            <Textarea
              id="notes"
              placeholder="Optionale Anmerkungen zur VPI-Anpassung..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              data-testid="input-notes"
            />
          </div>
        </div>
        
        <DialogFooter>
          <Button 
            variant="outline" 
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel"
          >
            Abbrechen
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={!isValid || isSubmitting}
            data-testid="button-submit"
          >
            {isSubmitting ? 'Speichern...' : editingAdjustment ? 'Aktualisieren' : 'Erstellen'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
