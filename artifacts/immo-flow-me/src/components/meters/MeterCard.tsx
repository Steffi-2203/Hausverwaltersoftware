import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Gauge, MoreVertical, Pencil, Trash2, Plus, History, Zap, Flame, Droplets, Thermometer, CircleDot, MapPin, Calendar } from 'lucide-react';
import { Meter, MeterReading } from '@/hooks/useMeters';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

const METER_TYPE_LABELS: Record<string, { label: string; icon: typeof Zap; color: string }> = {
  strom: { label: 'Strom', icon: Zap, color: 'bg-yellow-500/10 text-yellow-600' },
  gas: { label: 'Gas', icon: Flame, color: 'bg-orange-500/10 text-orange-600' },
  wasser: { label: 'Wasser', icon: Droplets, color: 'bg-blue-500/10 text-blue-600' },
  heizung: { label: 'Heizung', icon: Thermometer, color: 'bg-red-500/10 text-red-600' },
  warmwasser: { label: 'Warmwasser', icon: Droplets, color: 'bg-cyan-500/10 text-cyan-600' },
  sonstiges: { label: 'Sonstiges', icon: CircleDot, color: 'bg-gray-500/10 text-gray-600' },
};

interface MeterCardProps {
  meter: Meter;
  latestReadings?: MeterReading[];
  onEdit: (meter: Meter) => void;
  onDelete: (meter: Meter) => void;
  onAddReading: (meter: Meter) => void;
  onViewHistory: (meter: Meter) => void;
}

export function MeterCard({ meter, latestReadings, onEdit, onDelete, onAddReading, onViewHistory }: MeterCardProps) {
  const typeInfo = METER_TYPE_LABELS[meter.meter_type] || METER_TYPE_LABELS.sonstiges;
  const TypeIcon = typeInfo.icon;
  
  const currentReading = latestReadings?.[0];
  const previousReading = latestReadings?.[1];
  
  const consumption = currentReading && previousReading
    ? Number(currentReading.reading_value) - Number(previousReading.reading_value)
    : null;

  return (
    <Card data-testid={`card-meter-${meter.id}`} className={!meter.is_active ? 'opacity-60' : ''}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center ${typeInfo.color}`}>
              <TypeIcon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold flex items-center gap-2">
                {meter.meter_number}
                {!meter.is_active && (
                  <Badge variant="secondary">Inaktiv</Badge>
                )}
              </h3>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="outline" className={typeInfo.color}>
                  {typeInfo.label}
                </Badge>
                {meter.units && (
                  <span>Top {meter.units.top_nummer}</span>
                )}
              </div>
            </div>
          </div>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8"
                data-testid={`button-meter-menu-${meter.id}`}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem 
                onClick={() => onAddReading(meter)}
                data-testid={`button-add-reading-${meter.id}`}
              >
                <Plus className="h-4 w-4 mr-2" />
                Ablesung erfassen
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => onViewHistory(meter)}
                data-testid={`button-view-history-${meter.id}`}
              >
                <History className="h-4 w-4 mr-2" />
                Verlauf anzeigen
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => onEdit(meter)}
                data-testid={`button-edit-meter-${meter.id}`}
              >
                <Pencil className="h-4 w-4 mr-2" />
                Bearbeiten
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => onDelete(meter)}
                className="text-destructive"
                data-testid={`button-delete-meter-${meter.id}`}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Löschen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-3">
        {meter.location && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4" />
            {meter.location}
          </div>
        )}
        
        {currentReading ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Letzter Stand:</span>
              <span className="font-semibold text-lg">
                {Number(currentReading.reading_value).toLocaleString('de-AT', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
                {currentReading.is_estimated && (
                  <Badge variant="outline" className="ml-2 text-xs">Geschätzt</Badge>
                )}
              </span>
            </div>
            
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              {format(new Date(currentReading.reading_date), 'dd.MM.yyyy', { locale: de })}
              {currentReading.read_by && (
                <span className="text-xs">({currentReading.read_by})</span>
              )}
            </div>
            
            {consumption !== null && (
              <div className="flex items-center justify-between pt-2 border-t">
                <span className="text-sm text-muted-foreground">Verbrauch:</span>
                <Badge variant={consumption > 0 ? 'default' : 'secondary'}>
                  {consumption >= 0 ? '+' : ''}{consumption.toLocaleString('de-AT', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
                </Badge>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground italic">
            Noch keine Ablesung vorhanden
          </div>
        )}
        
        <Button 
          variant="outline" 
          size="sm" 
          className="w-full"
          onClick={() => onAddReading(meter)}
          data-testid={`button-quick-add-reading-${meter.id}`}
        >
          <Plus className="h-4 w-4 mr-2" />
          Ablesung erfassen
        </Button>
      </CardContent>
    </Card>
  );
}
