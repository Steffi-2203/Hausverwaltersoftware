import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, FileWarning, Link2Off, Receipt } from "lucide-react";
import { useExpenses } from "@/hooks/useExpenses";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function DataQualityWidget() {
  const currentYear = new Date().getFullYear();
  const { data: expenses, isLoading } = useExpenses(undefined, currentYear);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileWarning className="h-5 w-5" />
            Datenqualität
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  const expensesList = expenses || [];
  const totalExpenses = expensesList.length;
  
  // Ausgaben ohne Beleg
  const expensesWithoutReceipt = expensesList.filter(e => !e.beleg_url && !e.beleg_nummer);
  const withoutReceiptCount = expensesWithoutReceipt.length;
  
  // Ausgaben ohne Transaktions-Verknüpfung
  const expensesWithoutTransaction = expensesList.filter(e => !e.transaction_id);
  const withoutTransactionCount = expensesWithoutTransaction.length;

  // Berechne Summen
  const expensesSum = expensesList.reduce((sum, e) => sum + Number(e.betrag), 0);
  
  // Alles in Ordnung?
  const allGood = withoutReceiptCount === 0 && withoutTransactionCount === 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileWarning className="h-5 w-5" />
            Datenqualität {currentYear}
          </CardTitle>
          {allGood ? (
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Vollständig
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Prüfung empfohlen
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {allGood ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <span>Alle {totalExpenses} Ausgaben haben Belege und sind mit Transaktionen verknüpft.</span>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Ohne Beleg */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-3">
                <Receipt className="h-4 w-4 text-amber-600" />
                <div>
                  <p className="text-sm font-medium">Ohne Beleg</p>
                  <p className="text-xs text-muted-foreground">
                    {withoutReceiptCount} von {totalExpenses} Ausgaben
                  </p>
                </div>
              </div>
              {withoutReceiptCount > 0 ? (
                <Badge variant="outline" className="bg-amber-50 text-amber-700">
                  {withoutReceiptCount}
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-green-50 text-green-700">
                  <CheckCircle2 className="h-3 w-3" />
                </Badge>
              )}
            </div>

            {/* Ohne Transaktion */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-3">
                <Link2Off className="h-4 w-4 text-amber-600" />
                <div>
                  <p className="text-sm font-medium">Ohne Transaktions-Verknüpfung</p>
                  <p className="text-xs text-muted-foreground">
                    {withoutTransactionCount} von {totalExpenses} Ausgaben
                  </p>
                </div>
              </div>
              {withoutTransactionCount > 0 ? (
                <Badge variant="outline" className="bg-amber-50 text-amber-700">
                  {withoutTransactionCount}
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-green-50 text-green-700">
                  <CheckCircle2 className="h-3 w-3" />
                </Badge>
              )}
            </div>

            {/* Summe */}
            <div className="pt-2 border-t">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Gesamtausgaben {currentYear}</span>
                <span className="font-medium">
                  {expensesSum.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                </span>
              </div>
            </div>

            {/* Link zu Ausgaben */}
            {(withoutReceiptCount > 0 || withoutTransactionCount > 0) && (
              <Button variant="outline" size="sm" className="w-full mt-2" asChild>
                <Link to="/buchhaltung">Ausgaben prüfen</Link>
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
