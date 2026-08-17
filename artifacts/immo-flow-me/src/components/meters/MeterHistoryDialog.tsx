import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Gauge, Calendar } from 'lucide-react';
import { Meter, useMeterReadings } from '@/hooks/useMeters';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { Skeleton } from '@/components/ui/skeleton';

interface MeterHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meter: Meter | null;
}

const METER_TYPE_LABELS: Record<string, string> = {
  strom: 'Strom',
  gas: 'Gas',
  wasser: 'Wasser',
  heizung: 'Heizung',
  warmwasser: 'Warmwasser',
  sonstiges: 'Sonstiges',
};

export function MeterHistoryDialog({ open, onOpenChange, meter }: MeterHistoryDialogProps) {
  const { data: readings, isLoading } = useMeterReadings(meter?.id);
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5" />
            Zählerstandverlauf
          </DialogTitle>
        </DialogHeader>
        
        {meter && (
          <div className="bg-muted/50 rounded-lg p-3 space-y-1">
            <div className="font-medium">{meter.meter_number}</div>
            <div className="text-sm text-muted-foreground">
              {METER_TYPE_LABELS[meter.meter_type]} - Top {meter.units?.top_nummer}
              {meter.units?.properties && ` (${meter.units.properties.name})`}
            </div>
          </div>
        )}
        
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : readings && readings.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Datum</TableHead>
                  <TableHead className="text-right">Zählerstand</TableHead>
                  <TableHead className="text-right">Verbrauch</TableHead>
                  <TableHead>Abgelesen von</TableHead>
                  <TableHead>Notizen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {readings.map((reading, index) => {
                  const previousReading = readings[index + 1];
                  const consumption = previousReading
                    ? Number(reading.reading_value) - Number(previousReading.reading_value)
                    : null;
                  
                  return (
                    <TableRow key={reading.id} data-testid={`row-reading-${reading.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          {format(new Date(reading.reading_date), 'dd.MM.yyyy', { locale: de })}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {Number(reading.reading_value).toLocaleString('de-AT', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
                        {reading.is_estimated && (
                          <Badge variant="outline" className="ml-2 text-xs">Geschätzt</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {consumption !== null ? (
                          <Badge variant={consumption >= 0 ? 'secondary' : 'destructive'}>
                            {consumption >= 0 ? '+' : ''}{consumption.toLocaleString('de-AT', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {reading.read_by || '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-[200px] truncate">
                        {reading.notes || '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Gauge className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Noch keine Ablesungen vorhanden</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
