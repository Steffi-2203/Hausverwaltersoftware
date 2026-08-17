import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp } from 'lucide-react';

interface RentIndexCardProps {
  tenantId: string;
  currentGrundmiete: number;
  tenantName: string;
}

export function RentIndexCard({ tenantId, currentGrundmiete, tenantName }: RentIndexCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Wertsicherung / Mietindex
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Aktuelle Grundmiete</p>
            <p className="font-medium" data-testid={`text-grundmiete-${tenantId}`}>
              € {currentGrundmiete.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Indexierung</p>
            <p className="text-muted-foreground text-sm">Keine Indexierung konfiguriert</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
