import { useState } from 'react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Clock, CheckCircle2, AlertTriangle, XCircle, Eye, Trash2, CreditCard } from 'lucide-react';
import { useSepaCollections, useDeleteSepaCollection, SepaCollection } from '@/hooks/useSepaCollections';
import { SepaCollectionStatusDialog } from './SepaCollectionStatusDialog';

const statusConfig = {
  pending: { label: 'Ausstehend', icon: Clock, variant: 'outline' as const, color: 'text-muted-foreground' },
  exported: { label: 'Exportiert', icon: Clock, variant: 'secondary' as const, color: 'text-blue-600' },
  partially_completed: { label: 'Teilweise abgeschlossen', icon: AlertTriangle, variant: 'destructive' as const, color: 'text-amber-600' },
  completed: { label: 'Abgeschlossen', icon: CheckCircle2, variant: 'default' as const, color: 'text-green-600' },
};

export function SepaCollectionHistory() {
  const { data: collections, isLoading } = useSepaCollections();
  const deleteCollection = useDeleteSepaCollection();
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            SEPA-Lastschriften
          </CardTitle>
          <CardDescription>Übersicht über alle SEPA-Einzüge</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!collections || collections.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            SEPA-Lastschriften
          </CardTitle>
          <CardDescription>Übersicht über alle SEPA-Einzüge</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <CreditCard className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Noch keine SEPA-Einzüge erstellt.</p>
            <p className="text-sm mt-2">
              Exportieren Sie einen SEPA-Einzug, um ihn hier zu sehen.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const handleDelete = async (id: string) => {
    await deleteCollection.mutateAsync(id);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            SEPA-Lastschriften
          </CardTitle>
          <CardDescription>
            Übersicht und Statusverfolgung aller SEPA-Einzüge
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fälligkeitsdatum</TableHead>
                <TableHead>Anzahl</TableHead>
                <TableHead className="text-right">Gesamtbetrag</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {collections.map((collection) => {
                const config = statusConfig[collection.status];
                const StatusIcon = config.icon;
                
                return (
                  <TableRow key={collection.id}>
                    <TableCell className="font-medium">
                      {format(new Date(collection.collection_date), 'dd.MM.yyyy', { locale: de })}
                    </TableCell>
                    <TableCell>
                      {collection.item_count} Lastschrift{collection.item_count !== 1 ? 'en' : ''}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      € {Number(collection.total_amount).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell>
                      <Badge variant={config.variant} className="gap-1">
                        <StatusIcon className={`h-3 w-3 ${config.color}`} />
                        {config.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedCollectionId(collection.id)}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          {collection.status === 'exported' ? 'Status setzen' : 'Details'}
                        </Button>
                        
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>SEPA-Einzug löschen?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Diese Aktion kann nicht rückgängig gemacht werden. 
                                Der SEPA-Einzug vom {format(new Date(collection.collection_date), 'dd.MM.yyyy')} wird gelöscht.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDelete(collection.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Löschen
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <SepaCollectionStatusDialog
        collectionId={selectedCollectionId}
        open={!!selectedCollectionId}
        onOpenChange={(open) => !open && setSelectedCollectionId(null)}
      />
    </>
  );
}
