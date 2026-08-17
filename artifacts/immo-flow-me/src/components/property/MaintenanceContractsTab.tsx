import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Plus,
  MoreHorizontal,
  Trash2,
  CheckCircle,
  Edit,
  Calendar as CalendarIcon,
  Loader2,
  Wrench,
  AlertTriangle,
} from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { de } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import {
  useMaintenanceContracts,
  useDeleteMaintenanceContract,
  useMarkMaintenanceComplete,
  getContractTypeLabel,
  MaintenanceContract,
} from '@/hooks/useMaintenanceContracts';
import { AddMaintenanceContractDialog } from './AddMaintenanceContractDialog';

interface MaintenanceContractsTabProps {
  propertyId: string;
}

function getStatusBadge(nextDueDate: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(nextDueDate);
  dueDate.setHours(0, 0, 0, 0);
  const daysUntil = differenceInDays(dueDate, today);

  if (daysUntil < 0) {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="h-3 w-3" />
        {Math.abs(daysUntil)} Tage überfällig
      </Badge>
    );
  } else if (daysUntil <= 30) {
    return (
      <Badge variant="outline" className="border-warning text-warning gap-1">
        <AlertTriangle className="h-3 w-3" />
        Fällig in {daysUntil} Tagen
      </Badge>
    );
  } else {
    return (
      <Badge variant="outline" className="border-success text-success">
        OK ({daysUntil} Tage)
      </Badge>
    );
  }
}

export function MaintenanceContractsTab({ propertyId }: MaintenanceContractsTabProps) {
  const { data: contracts, isLoading } = useMaintenanceContracts(propertyId);
  const deleteContract = useDeleteMaintenanceContract();
  const markComplete = useMarkMaintenanceComplete();

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editContract, setEditContract] = useState<MaintenanceContract | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [completeContract, setCompleteContract] = useState<MaintenanceContract | null>(null);
  const [completedDate, setCompletedDate] = useState<Date | undefined>(new Date());

  const handleDelete = async () => {
    if (deleteId) {
      await deleteContract.mutateAsync(deleteId);
      setDeleteId(null);
    }
  };

  const handleMarkComplete = async () => {
    if (completeContract && completedDate) {
      await markComplete.mutateAsync({
        id: completeContract.id,
        completedDate: format(completedDate, 'yyyy-MM-dd'),
      });
      setCompleteContract(null);
      setCompletedDate(new Date());
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-foreground">Wartungsverträge</h3>
          <p className="text-sm text-muted-foreground">
            {contracts?.length || 0} aktive Verträge
          </p>
        </div>
        <Button onClick={() => setAddDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Wartungsvertrag hinzufügen
        </Button>
      </div>

      {contracts && contracts.length > 0 ? (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Typ</TableHead>
                <TableHead>Titel</TableHead>
                <TableHead>Vertragspartner</TableHead>
                <TableHead>Intervall</TableHead>
                <TableHead>Letzte Wartung</TableHead>
                <TableHead>Nächster Termin</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contracts.map((contract) => (
                <TableRow key={contract.id} className="hover:bg-muted/30">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Wrench className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{getContractTypeLabel(contract.contract_type)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{contract.title}</TableCell>
                  <TableCell>
                    {contract.contractor_name ? (
                      <div>
                        <p className="font-medium">{contract.contractor_name}</p>
                        {contract.contractor_contact && (
                          <p className="text-xs text-muted-foreground">{contract.contractor_contact}</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>{contract.interval_months} Monate</TableCell>
                  <TableCell>
                    {contract.last_maintenance_date ? (
                      format(new Date(contract.last_maintenance_date), 'dd.MM.yyyy', { locale: de })
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {format(new Date(contract.next_due_date), 'dd.MM.yyyy', { locale: de })}
                  </TableCell>
                  <TableCell>{getStatusBadge(contract.next_due_date)}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-popover">
                          <DropdownMenuItem onClick={() => setCompleteContract(contract)}>
                            <CheckCircle className="h-4 w-4 mr-2 text-success" />
                            Als erledigt markieren
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setEditContract(contract)}>
                            <Edit className="h-4 w-4 mr-2" />
                            Bearbeiten
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setDeleteId(contract.id)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Löschen
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-12 text-center">
          <Wrench className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="font-semibold text-foreground mb-2">Keine Wartungsverträge</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Legen Sie wiederkehrende Wartungen wie TÜV, Aufzug, Heizung etc. an
          </p>
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Ersten Wartungsvertrag anlegen
          </Button>
        </div>
      )}

      {/* Add Dialog */}
      <AddMaintenanceContractDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        propertyId={propertyId}
      />

      {/* Edit Dialog */}
      {editContract && (
        <AddMaintenanceContractDialog
          open={!!editContract}
          onOpenChange={(open) => !open && setEditContract(null)}
          propertyId={propertyId}
          editContract={editContract}
        />
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Wartungsvertrag löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Diese Aktion kann nicht rückgängig gemacht werden. Der Wartungsvertrag wird dauerhaft
              gelöscht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Löschen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Mark Complete Dialog */}
      <Dialog open={!!completeContract} onOpenChange={() => setCompleteContract(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Wartung als erledigt markieren</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Wählen Sie das Datum, an dem die Wartung durchgeführt wurde. Der nächste
              Fälligkeitstermin wird automatisch basierend auf dem Intervall berechnet.
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium">Wartungsdatum</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !completedDate && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {completedDate ? format(completedDate, 'PPP', { locale: de }) : 'Datum wählen'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-popover" align="start">
                  <Calendar
                    mode="single"
                    selected={completedDate}
                    onSelect={setCompletedDate}
                    locale={de}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            {completeContract && completedDate && (
              <div className="rounded-lg bg-muted p-3 text-sm">
                <p>
                  <strong>Nächster Termin:</strong>{' '}
                  {format(
                    new Date(
                      new Date(completedDate).setMonth(
                        completedDate.getMonth() + completeContract.interval_months
                      )
                    ),
                    'PPP',
                    { locale: de }
                  )}
                </p>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCompleteContract(null)}>
              Abbrechen
            </Button>
            <Button onClick={handleMarkComplete} disabled={!completedDate || markComplete.isPending}>
              {markComplete.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Bestätigen
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
