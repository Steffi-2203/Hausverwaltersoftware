import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CreditCard } from 'lucide-react';

interface DepositManagementCardProps {
  tenantId: string;
  tenantName: string;
  existingKaution: number | null | undefined;
  existingKautionBezahlt: boolean | null | undefined;
}

export function DepositManagementCard({ tenantId, tenantName, existingKaution, existingKautionBezahlt }: DepositManagementCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Kautionsverwaltung
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Kaution</p>
            <p className="font-medium" data-testid={`text-kaution-${tenantId}`}>
              € {(existingKaution || 0).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Status</p>
            <Badge variant={existingKautionBezahlt ? 'default' : 'destructive'}>
              {existingKautionBezahlt ? 'Bezahlt' : 'Ausstehend'}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
