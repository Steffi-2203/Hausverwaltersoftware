import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useKeyHandovers, KeyInventoryItem, KEY_TYPE_LABELS, KEY_STATUS_LABELS } from '@/hooks/useKeys';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { Key, History } from 'lucide-react';

interface KeyHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keyItem: KeyInventoryItem | null;
}

export function KeyHistoryDialog({ open, onOpenChange, keyItem }: KeyHistoryDialogProps) {
  const { data: handovers, isLoading } = useKeyHandovers(keyItem?.id);
  
  if (!keyItem) return null;
  
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ausgegeben':
        return <Badge variant="destructive" data-testid={`badge-status-${status}`}>Ausgegeben</Badge>;
      case 'vorhanden':
        return <Badge className="bg-green-500 text-white" data-testid={`badge-status-${status}`}>Zurückgegeben</Badge>;
      case 'verloren':
        return <Badge variant="secondary" className="bg-orange-500 text-white" data-testid={`badge-status-${status}`}>Verloren</Badge>;
      case 'gesperrt':
        return <Badge variant="secondary" data-testid={`badge-status-${status}`}>Gesperrt</Badge>;
      default:
        return <Badge variant="outline" data-testid={`badge-status-${status}`}>{status}</Badge>;
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Schlüsselhistorie
          </DialogTitle>
        </DialogHeader>
        
        <div className="bg-muted/50 p-4 rounded-lg mb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Typ:</span>
              <p className="font-medium">{KEY_TYPE_LABELS[keyItem.key_type] || keyItem.key_type}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Nummer:</span>
              <p className="font-medium">{keyItem.key_number || '-'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Gesamt:</span>
              <p className="font-medium">{keyItem.total_count}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Verfügbar:</span>
              <p className="font-medium">{keyItem.available_count}</p>
            </div>
          </div>
        </div>
        
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : handovers && handovers.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Datum</TableHead>
                  <TableHead>Empfänger</TableHead>
                  <TableHead>Anzahl</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notizen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {handovers.map((handover) => (
                  <TableRow key={handover.id} data-testid={`row-handover-${handover.id}`}>
                    <TableCell>
                      {handover.handover_date 
                        ? format(new Date(handover.handover_date), 'dd.MM.yyyy', { locale: de })
                        : '-'}
                    </TableCell>
                    <TableCell>
                      {handover.tenants 
                        ? `${handover.tenants.first_name} ${handover.tenants.last_name}`
                        : handover.recipient_name || '-'}
                    </TableCell>
                    <TableCell>{handover.quantity}</TableCell>
                    <TableCell>{getStatusBadge(handover.status || 'ausgegeben')}</TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {handover.notes || '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Keine Übergaben für diesen Schlüssel erfasst</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
