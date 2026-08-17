import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Building2, CreditCard, Plus, Pencil, Trash2, Landmark } from 'lucide-react';
import { useBankAccounts, useDeleteBankAccount, BankAccount } from '@/hooks/useBankAccounts';
import { useProperties } from '@/hooks/useProperties';
import { BankAccountEditDialog } from './BankAccountEditDialog';
import { useUserRole } from '@/hooks/useUserRole';
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

// Mask IBAN for display
function maskIban(iban: string | null): string {
  if (!iban) return '—';
  // Remove spaces for processing
  const cleanIban = iban.replace(/\s/g, '');
  if (cleanIban.length <= 8) return iban;
  return `${cleanIban.slice(0, 4)} **** **** ${cleanIban.slice(-4)}`;
}

export function BankAccountsSection() {
  const { data: bankAccounts, isLoading: accountsLoading } = useBankAccounts();
  const { data: properties, isLoading: propertiesLoading } = useProperties();
  const deleteBankAccount = useDeleteBankAccount();
  const { data: userRole } = useUserRole();
  
  const [editAccount, setEditAccount] = useState<BankAccount | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const canEdit = userRole === 'admin' || userRole === 'finance';
  const isLoading = accountsLoading || propertiesLoading;

  // Create a map of property ID to property for quick lookup
  const propertyMap = new Map(properties?.map(p => [p.id, p]) || []);

  // Get properties that don't have a bank account yet
  const propertiesWithoutAccount = properties?.filter(
    p => !bankAccounts?.some(ba => ba.property_id === p.id)
  ) || [];

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Landmark className="h-5 w-5" />
              Treuhandkonten
            </CardTitle>
            <CardDescription>
              Bankkonten für Ihre verwalteten Liegenschaften
            </CardDescription>
          </div>
          {canEdit && propertiesWithoutAccount.length > 0 && (
            <Button onClick={() => setShowNewDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Konto hinzufügen
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {!bankAccounts || bankAccounts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Landmark className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Noch keine Bankkonten angelegt.</p>
              {canEdit && propertiesWithoutAccount.length > 0 && (
                <Button 
                  variant="outline" 
                  className="mt-4"
                  onClick={() => setShowNewDialog(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Erstes Konto anlegen
                </Button>
              )}
              {propertiesWithoutAccount.length === 0 && properties?.length === 0 && (
                <p className="text-sm mt-2">
                  Erstellen Sie zuerst eine Liegenschaft, um ein Bankkonto zuzuordnen.
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Liegenschaft</TableHead>
                    <TableHead>Kontoname</TableHead>
                    <TableHead>Bank</TableHead>
                    <TableHead>IBAN</TableHead>
                    <TableHead>BIC</TableHead>
                    {canEdit && <TableHead className="w-[100px]">Aktionen</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bankAccounts.map((account) => {
                    const property = account.property_id 
                      ? propertyMap.get(account.property_id) 
                      : null;
                    
                    return (
                      <TableRow key={account.id}>
                        <TableCell>
                          {property ? (
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">{(property as any).name}</span>
                            </div>
                          ) : (
                            <Badge variant="secondary">Nicht zugeordnet</Badge>
                          )}
                        </TableCell>
                        <TableCell>{account.account_name}</TableCell>
                        <TableCell>{account.bank_name || '—'}</TableCell>
                        <TableCell className="font-mono text-sm">
                          {maskIban(account.iban)}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {account.bic || '—'}
                        </TableCell>
                        {canEdit && (
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setEditAccount(account)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDeleteConfirm(account.id)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Info about properties without accounts */}
          {propertiesWithoutAccount.length > 0 && bankAccounts && bankAccounts.length > 0 && (
            <div className="mt-4 p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">
                <strong>{propertiesWithoutAccount.length}</strong> Liegenschaft(en) ohne Bankkonto:{' '}
                {propertiesWithoutAccount.map(p => p.name).join(', ')}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit/Create Dialog */}
      <BankAccountEditDialog
        account={editAccount}
        open={showNewDialog || !!editAccount}
        onOpenChange={(open) => {
          if (!open) {
            setEditAccount(null);
            setShowNewDialog(false);
          }
        }}
        availableProperties={editAccount ? properties || [] : propertiesWithoutAccount}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bankkonto löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Möchten Sie dieses Bankkonto wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteConfirm) {
                  deleteBankAccount.mutate(deleteConfirm);
                  setDeleteConfirm(null);
                }
              }}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
