import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Landmark, Building2, ArrowRight, CreditCard } from 'lucide-react';
import { useBankAccounts } from '@/hooks/useBankAccounts';
import { useProperties } from '@/hooks/useProperties';
import { useUserRole } from '@/hooks/useUserRole';

// Mask IBAN for display
function maskIban(iban: string | null): string {
  if (!iban) return '—';
  const cleanIban = iban.replace(/\s/g, '');
  if (cleanIban.length <= 8) return iban;
  return `${cleanIban.slice(0, 4)} •••• ${cleanIban.slice(-4)}`;
}

export function BankAccountsWidget() {
  const { data: bankAccounts, isLoading: accountsLoading } = useBankAccounts();
  const { data: properties, isLoading: propertiesLoading } = useProperties();
  const { data: userRole } = useUserRole();

  const canViewFinancials = userRole === 'admin' || userRole === 'finance';
  const isLoading = accountsLoading || propertiesLoading;

  // Create a map of property ID to property for quick lookup
  const propertyMap = new Map(properties?.map(p => [p.id, p]) || []);

  if (!canViewFinancials) {
    return null;
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-48 mt-1" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  const accountCount = bankAccounts?.length || 0;
  const propertyCount = properties?.length || 0;
  const propertiesWithoutAccount = properties?.filter(
    p => !bankAccounts?.some(ba => ba.property_id === p.id)
  ).length || 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Landmark className="h-4 w-4" />
              Treuhandkonten
            </CardTitle>
            <CardDescription>
              {accountCount} Konto{accountCount !== 1 ? 'en' : ''} für {propertyCount} Liegenschaft{propertyCount !== 1 ? 'en' : ''}
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/einstellungen?tab=banking">
              Verwalten
              <ArrowRight className="h-4 w-4 ml-1" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {accountCount === 0 ? (
          <div className="text-center py-4 text-muted-foreground">
            <CreditCard className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Noch keine Bankkonten angelegt</p>
            <Button variant="link" size="sm" asChild className="mt-1">
              <Link to="/einstellungen?tab=banking">Jetzt anlegen</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {bankAccounts?.slice(0, 4).map((account) => {
              const property = account.property_id 
                ? propertyMap.get(account.property_id) 
                : null;
              
              return (
                <div 
                  key={account.id} 
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Building2 className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">
                        {(property as any)?.name || account.account_name}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {maskIban(account.iban)}
                      </p>
                    </div>
                  </div>
                  {account.bank_name && (
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {account.bank_name}
                    </Badge>
                  )}
                </div>
              );
            })}
            
            {accountCount > 4 && (
              <p className="text-xs text-center text-muted-foreground pt-1">
                + {accountCount - 4} weitere Konten
              </p>
            )}

            {propertiesWithoutAccount > 0 && (
              <div className="pt-2 border-t">
                <p className="text-xs text-amber-600">
                  ⚠️ {propertiesWithoutAccount} Liegenschaft{propertiesWithoutAccount !== 1 ? 'en' : ''} ohne Bankkonto
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
