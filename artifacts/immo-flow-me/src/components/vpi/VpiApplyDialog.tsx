import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, TrendingUp, User, Calendar, Euro } from 'lucide-react';
import { useApplyVpiAdjustment, VpiAdjustment } from '@/hooks/useVpiAdjustments';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

interface VpiApplyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adjustment: VpiAdjustment | null;
}

export function VpiApplyDialog({ open, onOpenChange, adjustment }: VpiApplyDialogProps) {
  const [sendNotification, setSendNotification] = useState(true);
  const applyMutation = useApplyVpiAdjustment();
  
  if (!adjustment) return null;
  
  const tenant = adjustment.tenants;
  const tenantName = tenant ? `${tenant.first_name} ${tenant.last_name}` : 'Unbekannt';
  const unitInfo = tenant?.units ? `Top ${tenant.units.top_nummer}` : '';
  const propertyName = tenant?.units?.properties?.name || '';
  
  const handleApply = async () => {
    await applyMutation.mutateAsync({
      id: adjustment.id,
      sendNotification,
    });
    onOpenChange(false);
  };
  
  const difference = adjustment.new_rent - adjustment.previous_rent;
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            VPI-Anpassung anwenden
          </DialogTitle>
          <DialogDescription>
            Sind Sie sicher, dass Sie diese Mietanpassung anwenden möchten?
          </DialogDescription>
        </DialogHeader>
        
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium" data-testid="text-tenant-name">{tenantName}</span>
              {unitInfo && (
                <span className="text-sm text-muted-foreground">({unitInfo})</span>
              )}
            </div>
            
            {propertyName && (
              <div className="text-sm text-muted-foreground pl-6">
                {propertyName}
              </div>
            )}
            
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span data-testid="text-adjustment-date">
                Anpassungsdatum: {format(new Date(adjustment.adjustment_date), 'dd. MMMM yyyy', { locale: de })}
              </span>
            </div>
            
            <div className="border-t pt-3 mt-3 space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bisherige Miete:</span>
                <span data-testid="text-previous-rent">€ {adjustment.previous_rent.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Neue Miete:</span>
                <span className="font-semibold text-primary" data-testid="text-new-rent">
                  € {adjustment.new_rent.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Änderung:</span>
                <div className="flex items-center gap-1">
                  <TrendingUp className={`h-4 w-4 ${difference > 0 ? 'text-green-500' : 'text-red-500'}`} />
                  <span className={difference > 0 ? 'text-green-600' : 'text-red-600'} data-testid="text-difference">
                    {difference > 0 ? '+' : ''}€ {difference.toFixed(2)} 
                    ({adjustment.percentage_change?.toFixed(2)}%)
                  </span>
                </div>
              </div>
            </div>
            
            {adjustment.vpi_old && adjustment.vpi_new && (
              <div className="border-t pt-3 mt-3 text-sm text-muted-foreground">
                VPI: {adjustment.vpi_old} → {adjustment.vpi_new}
              </div>
            )}
          </CardContent>
        </Card>
        
        <div className="flex items-center space-x-2">
          <Checkbox
            id="send-notification"
            checked={sendNotification}
            onCheckedChange={(checked) => setSendNotification(checked === true)}
            data-testid="checkbox-send-notification"
          />
          <Label htmlFor="send-notification" className="text-sm">
            Mieter über Mietanpassung benachrichtigen
          </Label>
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
            onClick={handleApply}
            disabled={applyMutation.isPending}
            data-testid="button-apply"
          >
            {applyMutation.isPending ? 'Wird angewendet...' : 'Anwenden'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
