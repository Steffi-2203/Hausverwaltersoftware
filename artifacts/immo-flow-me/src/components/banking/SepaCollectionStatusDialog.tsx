import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  CheckCircle2, 
  XCircle, 
  Clock, 
  AlertTriangle, 
  CheckCheck,
  Info,
  Loader2
} from 'lucide-react';
import { toast } from 'sonner';
import { 
  useSepaCollectionById, 
  useUpdateSepaCollectionItemStatus, 
  useMarkAllItemsSuccessful,
  useUpdateSepaCollectionStatus,
  SepaCollectionItem 
} from '@/hooks/useSepaCollections';
import { useCreateTenantFee, DEFAULT_RETURN_FEE } from '@/hooks/useTenantFees';
import { apiRequest } from '@/lib/queryClient';
import { useQueryClient } from '@tanstack/react-query';

interface SepaCollectionStatusDialogProps {
  collectionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const RETURN_REASONS = [
  { value: 'insufficient_funds', label: 'Konto nicht gedeckt (AM04)' },
  { value: 'closed_account', label: 'Konto geschlossen (AC04)' },
  { value: 'no_mandate', label: 'Kein gültiges Mandat (MD01)' },
  { value: 'mandate_cancelled', label: 'Mandat widerrufen (MD06)' },
  { value: 'refund_request', label: 'Widerspruch des Kontoinhabers (MS02)' },
  { value: 'technical_error', label: 'Technischer Fehler (AM05)' },
  { value: 'other', label: 'Sonstiger Grund' },
];

const itemStatusConfig = {
  pending: { label: 'Ausstehend', icon: Clock, variant: 'outline' as const, color: 'text-muted-foreground' },
  successful: { label: 'Erfolgreich', icon: CheckCircle2, variant: 'default' as const, color: 'text-green-600' },
  returned: { label: 'Rücklastschrift', icon: XCircle, variant: 'destructive' as const, color: 'text-destructive' },
  rejected: { label: 'Abgelehnt', icon: AlertTriangle, variant: 'secondary' as const, color: 'text-amber-600' },
};

export function SepaCollectionStatusDialog({
  collectionId,
  open,
  onOpenChange,
}: SepaCollectionStatusDialogProps) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useSepaCollectionById(collectionId);
  const updateItemStatus = useUpdateSepaCollectionItemStatus();
  const markAllSuccessful = useMarkAllItemsSuccessful();
  const updateCollectionStatus = useUpdateSepaCollectionStatus();
  const createTenantFee = useCreateTenantFee();

  const [itemStatuses, setItemStatuses] = useState<Record<string, {
    status: 'pending' | 'successful' | 'returned' | 'rejected';
    returnReason?: string;
    notes?: string;
  }>>({});
  const [isSaving, setIsSaving] = useState(false);

  const collection = data?.collection;
  const items = data?.items || [];

  // Calculate summary
  const summary = useMemo(() => {
    const merged = items.map(item => ({
      ...item,
      ...itemStatuses[item.id],
    }));
    
    return {
      pending: merged.filter(i => (itemStatuses[i.id]?.status || i.status) === 'pending').length,
      successful: merged.filter(i => (itemStatuses[i.id]?.status || i.status) === 'successful').length,
      returned: merged.filter(i => (itemStatuses[i.id]?.status || i.status) === 'returned').length,
      rejected: merged.filter(i => (itemStatuses[i.id]?.status || i.status) === 'rejected').length,
    };
  }, [items, itemStatuses]);

  const handleStatusChange = (itemId: string, status: 'successful' | 'returned' | 'rejected') => {
    setItemStatuses(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        status,
        returnReason: status === 'returned' ? prev[itemId]?.returnReason : undefined,
      },
    }));
  };

  const handleReturnReasonChange = (itemId: string, reason: string) => {
    setItemStatuses(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        returnReason: reason,
      },
    }));
  };

  const handleMarkAllSuccessful = async () => {
    if (!collectionId) return;
    
    // Set all pending items to successful locally
    const newStatuses: typeof itemStatuses = {};
    items.forEach(item => {
      if (item.status === 'pending') {
        newStatuses[item.id] = { status: 'successful' };
      }
    });
    setItemStatuses(prev => ({ ...prev, ...newStatuses }));
  };

  const handleSave = async () => {
    if (!collectionId) return;
    
    setIsSaving(true);
    
    try {
      // Process each item that has a changed status
      for (const [itemId, statusData] of Object.entries(itemStatuses)) {
        const item = items.find(i => i.id === itemId);
        if (!item) continue;
        
        // Skip if status hasn't changed
        if (item.status === statusData.status) continue;
        
        if (statusData.status === 'successful') {
          // Create payment for successful items
          try {
            const paymentResponse = await apiRequest('POST', '/api/payments', {
              tenant_id: item.tenant_id!,
              betrag: item.amount,
              buchungs_datum: collection!.collection_date,
              eingangs_datum: collection!.collection_date,
              zahlungsart: 'sepa',
              referenz: `SEPA-Lastschrift ${format(new Date(collection!.collection_date), 'MM/yyyy')}`,
            });
            const payment = await paymentResponse.json();
            
            // Update item with payment reference
            await updateItemStatus.mutateAsync({
              itemId,
              status: 'successful',
              paymentId: payment.id,
            });
          } catch (paymentError) {
            console.error('Error creating payment:', paymentError);
            toast.error(`Fehler beim Erstellen der Zahlung für ${item.tenant_name}`);
            continue;
          }
        } else if (statusData.status === 'returned' || statusData.status === 'rejected') {
          // Update item as returned/rejected
          await updateItemStatus.mutateAsync({
            itemId,
            status: statusData.status,
            returnReason: statusData.returnReason,
            returnDate: new Date().toISOString().split('T')[0],
          });
          
          // Create return fee for the tenant
          if (item.tenant_id) {
            const returnReasonLabel = RETURN_REASONS.find(r => r.value === statusData.returnReason)?.label || 'Rücklastschrift';
            await createTenantFee.mutateAsync({
              tenant_id: item.tenant_id,
              fee_type: 'ruecklastschrift',
              amount: DEFAULT_RETURN_FEE,
              description: `Rücklastschrift-Gebühr vom ${format(new Date(collection!.collection_date), 'dd.MM.yyyy', { locale: de })} - ${returnReasonLabel}`,
              sepa_item_id: item.id,
            });
            toast.info(`Rücklastschrift-Gebühr (€${DEFAULT_RETURN_FEE.toFixed(2)}) für ${item.tenant_name} erstellt`);
          }
        }
      }
      
      // Calculate new collection status
      const allItems = items.map(item => ({
        ...item,
        status: itemStatuses[item.id]?.status || item.status,
      }));
      
      const hasReturned = allItems.some(i => i.status === 'returned' || i.status === 'rejected');
      const allCompleted = allItems.every(i => i.status !== 'pending');
      
      let newCollectionStatus: 'exported' | 'partially_completed' | 'completed' = 'exported';
      if (allCompleted) {
        newCollectionStatus = hasReturned ? 'partially_completed' : 'completed';
      }
      
      await updateCollectionStatus.mutateAsync({
        collectionId,
        status: newCollectionStatus,
      });
      
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['combined-payments'] });
      
      toast.success('Status erfolgreich gespeichert');
      setItemStatuses({});
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving statuses:', error);
      toast.error('Fehler beim Speichern');
    } finally {
      setIsSaving(false);
    }
  };

  const hasChanges = Object.keys(itemStatuses).length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            SEPA-Einzug vom {collection && format(new Date(collection.collection_date), 'dd.MM.yyyy', { locale: de })}
          </DialogTitle>
          <DialogDescription>
            Setzen Sie den Status für jeden Lastschrifteinzug nach der Bankverarbeitung.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4 py-4">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="flex gap-4 py-2 border-b">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{summary.pending} ausstehend</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-sm">{summary.successful} erfolgreich</span>
              </div>
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4 text-destructive" />
                <span className="text-sm">{summary.returned} Rückläufer</span>
              </div>
            </div>

            {/* Info Alert */}
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                <strong>Erfolgreiche Einzüge</strong> werden automatisch als Zahlung erfasst. <br />
                <strong>Rücklastschriften</strong> bleiben als offene Posten bestehen und es wird automatisch eine Gebühr von <strong>€{DEFAULT_RETURN_FEE.toFixed(2)}</strong> erstellt.
              </AlertDescription>
            </Alert>

            {/* Items Table */}
            <ScrollArea className="flex-1 max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mieter</TableHead>
                    <TableHead className="text-right">Betrag</TableHead>
                    <TableHead>Aktueller Status</TableHead>
                    <TableHead>Neuer Status</TableHead>
                    <TableHead>Grund (bei Rücklastschrift)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const currentStatus = itemStatuses[item.id]?.status || item.status;
                    const config = itemStatusConfig[item.status];
                    const StatusIcon = config.icon;
                    
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          {item.tenant_name}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          € {Number(item.amount).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>
                          <Badge variant={config.variant} className="gap-1">
                            <StatusIcon className={`h-3 w-3 ${config.color}`} />
                            {config.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {item.status === 'pending' ? (
                            <div className="flex gap-1">
                              <Button
                                variant={currentStatus === 'successful' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => handleStatusChange(item.id, 'successful')}
                                className="gap-1"
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                Erfolgreich
                              </Button>
                              <Button
                                variant={currentStatus === 'returned' ? 'destructive' : 'outline'}
                                size="sm"
                                onClick={() => handleStatusChange(item.id, 'returned')}
                                className="gap-1"
                              >
                                <XCircle className="h-3 w-3" />
                                Rückläufer
                              </Button>
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {(itemStatuses[item.id]?.status === 'returned' || item.status === 'returned') && (
                            <Select
                              value={itemStatuses[item.id]?.returnReason || item.return_reason || ''}
                              onValueChange={(value) => handleReturnReasonChange(item.id, value)}
                              disabled={item.status !== 'pending'}
                            >
                              <SelectTrigger className="w-[200px]">
                                <SelectValue placeholder="Grund wählen..." />
                              </SelectTrigger>
                              <SelectContent>
                                {RETURN_REASONS.map((reason) => (
                                  <SelectItem key={reason.value} value={reason.value}>
                                    {reason.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                          {item.status === 'returned' && item.return_reason && (
                            <span className="text-sm text-muted-foreground">
                              {RETURN_REASONS.find(r => r.value === item.return_reason)?.label || item.return_reason}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          </>
        )}

        <DialogFooter className="pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          {summary.pending > 0 && (
            <Button
              variant="secondary"
              onClick={handleMarkAllSuccessful}
            >
              <CheckCheck className="h-4 w-4 mr-2" />
              Alle als erfolgreich
            </Button>
          )}
          <Button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
          >
            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
