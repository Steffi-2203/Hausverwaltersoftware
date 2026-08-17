import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { PropertyBudget, useBudgetExpensesFromAll } from '@/hooks/useBudgets';
import { TrendingUp, TrendingDown, Minus, Building2 } from 'lucide-react';

interface BudgetComparisonCardProps {
  budget: PropertyBudget;
}

interface PositionRowProps {
  name: string | null;
  planned: number;
  actual: number;
  index: number;
}

function PositionRow({ name, planned, actual, index }: PositionRowProps) {
  if (!name && planned === 0) return null;

  const difference = planned - actual;
  const percentage = planned > 0 ? (actual / planned) * 100 : 0;
  const isOverBudget = actual > planned;
  const isNearLimit = percentage >= 80 && percentage < 100;

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <span className="font-medium text-sm">
          {name || `Position ${index}`}
        </span>
        <div className="flex items-center gap-2">
          {difference > 0 ? (
            <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">
              <TrendingDown className="h-3 w-3 mr-1" />
              {difference.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
            </Badge>
          ) : difference < 0 ? (
            <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50">
              <TrendingUp className="h-3 w-3 mr-1" />
              {Math.abs(difference).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              <Minus className="h-3 w-3 mr-1" />
              ±0
            </Badge>
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
        <span>Soll: {planned.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</span>
        <span>Ist: {actual.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</span>
        <span className="text-right">{percentage.toFixed(0)}%</span>
      </div>
      <Progress
        value={Math.min(percentage, 100)}
        className={`h-2 ${isOverBudget ? '[&>div]:bg-red-500' : isNearLimit ? '[&>div]:bg-amber-500' : ''}`}
      />
    </div>
  );
}

export function BudgetComparisonCard({ budget }: BudgetComparisonCardProps) {
  const { data: expenses, isLoading } = useBudgetExpensesFromAll(budget.property_id, budget.year);

  const positions = [
    { name: budget.position_1_name, planned: budget.position_1_amount, actual: expenses?.[1] || 0 },
    { name: budget.position_2_name, planned: budget.position_2_amount, actual: expenses?.[2] || 0 },
    { name: budget.position_3_name, planned: budget.position_3_amount, actual: expenses?.[3] || 0 },
    { name: budget.position_4_name, planned: budget.position_4_amount, actual: expenses?.[4] || 0 },
    { name: budget.position_5_name, planned: budget.position_5_amount, actual: expenses?.[5] || 0 },
  ];

  const totalPlanned = positions.reduce((sum, p) => sum + p.planned, 0);
  const totalActual = positions.reduce((sum, p) => sum + p.actual, 0);
  const totalPercentage = totalPlanned > 0 ? (totalActual / totalPlanned) * 100 : 0;
  const totalDifference = totalPlanned - totalActual;

  const activePositions = positions.filter(p => p.name || p.planned > 0);

  const statusColors: Record<string, string> = {
    entwurf: 'bg-gray-100 text-gray-800',
    eingereicht: 'bg-blue-100 text-blue-800',
    genehmigt: 'bg-green-100 text-green-800',
    abgelehnt: 'bg-red-100 text-red-800',
  };

  const statusLabels: Record<string, string> = {
    entwurf: 'Entwurf',
    eingereicht: 'Eingereicht',
    genehmigt: 'Genehmigt',
    abgelehnt: 'Abgelehnt',
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">
                {budget.properties?.name || 'Liegenschaft'}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Budgetplan {budget.year}
              </p>
            </div>
          </div>
          <Badge className={statusColors[budget.status]}>
            {statusLabels[budget.status]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="h-32 flex items-center justify-center">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : (
          <>
            {activePositions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Keine Budgetpositionen definiert
              </p>
            ) : (
              <div className="space-y-4">
                {positions.map((pos, idx) => (
                  <PositionRow
                    key={idx}
                    name={pos.name}
                    planned={pos.planned}
                    actual={pos.actual}
                    index={idx + 1}
                  />
                ))}
              </div>
            )}

            <div className="pt-4 border-t space-y-2">
              <div className="flex justify-between items-center font-semibold">
                <span>Gesamtbudget</span>
                <span className={totalDifference < 0 ? 'text-red-600' : 'text-green-600'}>
                  {totalDifference >= 0 ? '+' : ''}{totalDifference.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                <span>Soll: {totalPlanned.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</span>
                <span>Ist: {totalActual.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</span>
                <span className="text-right">{totalPercentage.toFixed(0)}%</span>
              </div>
              <Progress
                value={Math.min(totalPercentage, 100)}
                className={`h-3 ${totalPercentage > 100 ? '[&>div]:bg-red-500' : totalPercentage >= 80 ? '[&>div]:bg-amber-500' : ''}`}
              />
            </div>

            {budget.approved_by && (
              <div className="pt-2 text-xs text-muted-foreground">
                Genehmigt von: {budget.approved_by}
                {budget.approved_at && (
                  <span> am {new Date(budget.approved_at).toLocaleDateString('de-DE')}</span>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
