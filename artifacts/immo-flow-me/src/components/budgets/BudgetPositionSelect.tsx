import { useMemo } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useBudgets, useBudgetExpensesFromAll } from '@/hooks/useBudgets';
import { cn } from '@/lib/utils';

interface BudgetPositionSelectProps {
  propertyId: string;
  year: number;
  value: number | null;
  onChange: (position: number | null) => void;
  disabled?: boolean;
}

interface BudgetPosition {
  position: number;
  name: string;
  planned: number;
  used: number;
  available: number;
}

export function BudgetPositionSelect({
  propertyId,
  year,
  value,
  onChange,
  disabled = false,
}: BudgetPositionSelectProps) {
  // Get approved or draft budget for this property/year
  const { data: budgets = [], isLoading: budgetsLoading } = useBudgets(propertyId, year);
  const activeBudget = budgets.find(b => b.status === 'genehmigt' || b.status === 'entwurf');
  const isDraft = activeBudget?.status === 'entwurf';
  
  // Get combined expenses from both expenses and transactions tables
  const { data: usedAmounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, isLoading: expensesLoading } = 
    useBudgetExpensesFromAll(propertyId, year);

  const positions: BudgetPosition[] = useMemo(() => {
    if (!activeBudget) return [];

    const result: BudgetPosition[] = [];
    
    for (let i = 1; i <= 5; i++) {
      const nameKey = `position_${i}_name` as keyof typeof activeBudget;
      const amountKey = `position_${i}_amount` as keyof typeof activeBudget;
      const name = activeBudget[nameKey] as string | null;
      const planned = (activeBudget[amountKey] as number) || 0;
      
      if (name && planned > 0) {
        const used = usedAmounts[i] || 0;
        result.push({
          position: i,
          name,
          planned,
          used,
          available: planned - used,
        });
      }
    }

    return result;
  }, [activeBudget, usedAmounts]);

  const isLoading = budgetsLoading || expensesLoading;

  // No active budget available
  if (!isLoading && !activeBudget) {
    return null;
  }

  // No positions defined
  if (!isLoading && positions.length === 0) {
    return null;
  }

  const formatCurrency = (amount: number) => 
    new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(amount);

  const selectedPosition = positions.find(p => p.position === value);

  return (
    <div className="space-y-2">
      <Label htmlFor="budget-position">Budgetposition</Label>
      
      {/* Warning for draft budgets */}
      {isDraft && (
        <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>Budgetplan noch nicht genehmigt (Entwurf)</span>
        </div>
      )}
      
      <Select
        value={value?.toString() || 'none'}
        onValueChange={(v) => onChange(v === 'none' ? null : parseInt(v, 10))}
        disabled={disabled || isLoading}
      >
        <SelectTrigger id="budget-position" className="w-full">
          <SelectValue placeholder={isLoading ? 'Lade Budgetpositionen...' : 'Budgetposition auswählen'} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">
            <span className="text-muted-foreground">Keine Zuordnung</span>
          </SelectItem>
          {positions.map((pos) => {
            const isOverBudget = pos.available < 0;
            const isLowBudget = pos.available >= 0 && pos.available < pos.planned * 0.2;
            
            return (
              <SelectItem key={pos.position} value={pos.position.toString()}>
                <div className="flex items-center gap-2 w-full">
                  <span className="font-medium">{pos.name}</span>
                  <span className={cn(
                    "text-xs ml-auto",
                    isOverBudget && "text-destructive",
                    isLowBudget && !isOverBudget && "text-warning",
                    !isOverBudget && !isLowBudget && "text-muted-foreground"
                  )}>
                    ({formatCurrency(pos.available)} verfügbar)
                  </span>
                  {isOverBudget && <AlertCircle className="h-3 w-3 text-destructive" />}
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      
      {/* Show selected position details */}
      {selectedPosition && (
        <div className="flex items-center gap-2 text-sm">
          {selectedPosition.available >= 0 ? (
            <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {formatCurrency(selectedPosition.available)} verfügbar
            </Badge>
          ) : (
            <Badge variant="destructive">
              <AlertCircle className="h-3 w-3 mr-1" />
              Budget überschritten um {formatCurrency(Math.abs(selectedPosition.available))}
            </Badge>
          )}
          <span className="text-muted-foreground">
            (Geplant: {formatCurrency(selectedPosition.planned)} | Verwendet: {formatCurrency(selectedPosition.used)})
          </span>
        </div>
      )}
    </div>
  );
}
