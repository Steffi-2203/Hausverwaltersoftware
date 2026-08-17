import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Euro, Edit, Plus, CheckCircle2, AlertCircle, Loader2, TrendingUp, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  useCurrentRentExpectation,
  useCreateRentExpectation,
  useUpdateRentExpectation,
} from '@/hooks/useRentExpectations';
import { useTransactionsByUnit } from '@/hooks/useTransactions';
import { useOrganization } from '@/hooks/useOrganization';
import { toast } from 'sonner';

interface RentExpectationCardProps {
  unitId: string;
}

export function RentExpectationCard({ unitId }: RentExpectationCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [monthlyRent, setMonthlyRent] = useState('');
  const [dueDay, setDueDay] = useState('1');
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data: organization } = useOrganization();
  const { data: currentExpectation, isLoading: isLoadingExpectation } = useCurrentRentExpectation(unitId);
  const { data: transactions, isLoading: isLoadingTransactions } = useTransactionsByUnit(unitId);
  const createExpectation = useCreateRentExpectation();
  const updateExpectation = useUpdateRentExpectation();

  // Calculate payment status for current month
  const getPaymentStatus = () => {
    if (!currentExpectation) return null;

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const dueDayNum = (currentExpectation as any).dueDay || 1;

    // Find transactions for this month
    const monthTransactions = transactions?.filter((t) => {
      const transDate = new Date(t.transaction_date);
      return transDate.getMonth() === currentMonth && transDate.getFullYear() === currentYear && Number(t.amount) > 0;
    }) || [];

    const totalReceived = monthTransactions.reduce((sum, t) => sum + Number(t.amount), 0);
    const expectedRent = Number((currentExpectation as any).monthlyRent);
    const dueDate = new Date(currentYear, currentMonth, dueDayNum);
    const isPastDue = now > dueDate;

    if (totalReceived >= expectedRent) {
      return { status: 'paid', amount: totalReceived, label: 'Bezahlt', icon: CheckCircle2 };
    } else if (totalReceived > 0 && totalReceived < expectedRent) {
      return {
        status: 'partial',
        amount: totalReceived,
        missing: expectedRent - totalReceived,
        label: 'Teilbezahlt',
        icon: AlertCircle,
      };
    } else if (isPastDue) {
      return { status: 'overdue', amount: 0, label: 'Überfällig', icon: AlertCircle };
    } else {
      return { status: 'pending', amount: 0, label: 'Ausstehend', icon: Calendar };
    }
  };

  const paymentStatus = getPaymentStatus();

  const handleOpenDialog = () => {
    if (currentExpectation) {
      setMonthlyRent((currentExpectation as any).monthlyRent.toString());
      setDueDay(((currentExpectation as any).dueDay || 1).toString());
      setStartDate((currentExpectation as any).start_date);
    } else {
      setMonthlyRent('');
      setDueDay('1');
      setStartDate(format(new Date(), 'yyyy-MM-dd'));
    }
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!monthlyRent || !organization?.id) {
      toast.error('Bitte Betrag eingeben');
      return;
    }

    try {
      if (currentExpectation) {
        await updateExpectation.mutateAsync({
          id: currentExpectation.id,
          monthlyRent: parseFloat(monthlyRent),
          dueDay: parseInt(dueDay),
        } as any);
      } else {
        await createExpectation.mutateAsync({
          unitId: unitId,
          organizationId: organization.id,
          monthlyRent: parseFloat(monthlyRent),
          dueDay: parseInt(dueDay),
          startDate: startDate,
        } as any);
      }
      setDialogOpen(false);
    } catch (error) {
      console.error('Save rent expectation error:', error);
    }
  };

  if (isLoadingExpectation) {
    return (
      <Card>
        <CardContent className="p-4 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const statusStyles: Record<string, string> = {
    paid: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    partial: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    overdue: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    pending: 'bg-muted text-muted-foreground',
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          Soll-Miete
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {currentExpectation ? (
          <>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-foreground">
                  € {Number((currentExpectation as any).monthlyRent).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                </p>
                <p className="text-sm text-muted-foreground">
                  Fällig am {(currentExpectation as any).dueDay || 1}. des Monats
                </p>
              </div>
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" onClick={handleOpenDialog}>
                    <Edit className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Soll-Miete bearbeiten</DialogTitle>
                    <DialogDescription>
                      Definieren Sie die erwartete monatliche Miete für diese Einheit.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="monthlyRent">Monatliche Miete (€)</Label>
                      <Input
                        id="monthlyRent"
                        type="number"
                        step="0.01"
                        value={monthlyRent}
                        onChange={(e) => setMonthlyRent(e.target.value)}
                        placeholder="z.B. 850.00"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dueDay">Fälligkeitstag</Label>
                      <Input
                        id="dueDay"
                        type="number"
                        min="1"
                        max="28"
                        value={dueDay}
                        onChange={(e) => setDueDay(e.target.value)}
                        placeholder="1"
                      />
                      <p className="text-xs text-muted-foreground">
                        Tag im Monat, an dem die Miete fällig ist (1-28)
                      </p>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDialogOpen(false)}>
                      Abbrechen
                    </Button>
                    <Button
                      onClick={handleSave}
                      disabled={createExpectation.isPending || updateExpectation.isPending}
                    >
                      {(createExpectation.isPending || updateExpectation.isPending) && (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      )}
                      Speichern
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            {/* Payment Status */}
            {paymentStatus && (
              <div className="pt-2 border-t">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Status aktueller Monat:</span>
                  <Badge className={statusStyles[paymentStatus.status]}>
                    <paymentStatus.icon className="h-3 w-3 mr-1" />
                    {paymentStatus.label}
                  </Badge>
                </div>
                {paymentStatus.status === 'partial' && paymentStatus.missing && (
                  <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-1">
                    Noch € {paymentStatus.missing.toLocaleString('de-AT', { minimumFractionDigits: 2 })} offen
                  </p>
                )}
                {paymentStatus.amount > 0 && paymentStatus.status !== 'paid' && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Eingegangen: € {paymentStatus.amount.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-4">
            <Euro className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground mb-3">
              Keine Soll-Miete definiert
            </p>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" onClick={handleOpenDialog}>
                  <Plus className="h-4 w-4 mr-2" />
                  Soll-Miete definieren
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Soll-Miete definieren</DialogTitle>
                  <DialogDescription>
                    Definieren Sie die erwartete monatliche Miete für diese Einheit.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="monthlyRent">Monatliche Miete (€)</Label>
                    <Input
                      id="monthlyRent"
                      type="number"
                      step="0.01"
                      value={monthlyRent}
                      onChange={(e) => setMonthlyRent(e.target.value)}
                      placeholder="z.B. 850.00"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dueDay">Fälligkeitstag</Label>
                    <Input
                      id="dueDay"
                      type="number"
                      min="1"
                      max="28"
                      value={dueDay}
                      onChange={(e) => setDueDay(e.target.value)}
                      placeholder="1"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="startDate">Gültig ab</Label>
                    <Input
                      id="startDate"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>
                    Abbrechen
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={createExpectation.isPending}
                  >
                    {createExpectation.isPending && (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    )}
                    Speichern
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
