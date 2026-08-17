import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { BudgetPlanForm } from '@/components/budgets/BudgetPlanForm';
import { BudgetComparisonCard } from '@/components/budgets/BudgetComparisonCard';
import { useProperties } from '@/hooks/useProperties';
import {
  useBudgets,
  useUpdateBudgetStatus,
  useDeleteBudget,
  PropertyBudget,
} from '@/hooks/useBudgets';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Plus,
  MoreVertical,
  Edit,
  Trash2,
  Send,
  CheckCircle,
  XCircle,
  RotateCcw,
  PiggyBank,
  TrendingUp,
  TrendingDown,
  Wallet,
} from 'lucide-react';

export default function Budgets() {
  const [formOpen, setFormOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<PropertyBudget | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [budgetToDelete, setBudgetToDelete] = useState<string | null>(null);
  const [approvalDialogOpen, setApprovalDialogOpen] = useState(false);
  const [approvalData, setApprovalData] = useState<{ id: string; status: 'genehmigt' | 'abgelehnt' } | null>(null);
  const [approverName, setApproverName] = useState('');

  const [selectedProperty, setSelectedProperty] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<string>('all');

  const { data: properties } = useProperties();
  const { data: budgets, isLoading } = useBudgets(
    selectedProperty !== 'all' ? selectedProperty : undefined,
    selectedYear !== 'all' ? parseInt(selectedYear) : undefined
  );
  const updateStatus = useUpdateBudgetStatus();
  const deleteBudget = useDeleteBudget();
  const { isAdmin, isPropertyManager, canEditFinances } = usePermissions();

  const canEdit = isAdmin || isPropertyManager || canEditFinances;

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => currentYear - 2 + i);

  // Statistics
  const stats = {
    total: budgets?.length || 0,
    approved: budgets?.filter(b => b.status === 'genehmigt').length || 0,
    pending: budgets?.filter(b => b.status === 'eingereicht').length || 0,
    draft: budgets?.filter(b => b.status === 'entwurf').length || 0,
  };

  const totalBudgetApproved = budgets
    ?.filter(b => b.status === 'genehmigt')
    .reduce((sum, b) => {
      return sum + 
        b.position_1_amount + 
        b.position_2_amount + 
        b.position_3_amount + 
        b.position_4_amount + 
        b.position_5_amount;
    }, 0) || 0;

  const handleEdit = (budget: PropertyBudget) => {
    setEditingBudget(budget);
    setFormOpen(true);
  };

  const handleDelete = async () => {
    if (budgetToDelete) {
      await deleteBudget.mutateAsync(budgetToDelete);
      setDeleteDialogOpen(false);
      setBudgetToDelete(null);
    }
  };

  const handleSubmit = (id: string) => {
    updateStatus.mutate({ id, status: 'eingereicht' });
  };

  const handleApprovalClick = (id: string, status: 'genehmigt' | 'abgelehnt') => {
    setApprovalData({ id, status });
    setApproverName('');
    setApprovalDialogOpen(true);
  };

  const handleApprovalConfirm = () => {
    if (approvalData) {
      updateStatus.mutate({
        id: approvalData.id,
        status: approvalData.status,
        approved_by: approvalData.status === 'genehmigt' ? approverName : undefined,
      });
      setApprovalDialogOpen(false);
      setApprovalData(null);
    }
  };

  const handleResetToDraft = (id: string) => {
    updateStatus.mutate({ id, status: 'entwurf' });
  };

  return (
    <MainLayout title="Budgetplanung">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">Budgetplanung</h1>
            <p className="text-muted-foreground">
              Jährliche Budgetpläne für Instandhaltungen verwalten
            </p>
          </div>
          {canEdit && (
            <Button onClick={() => { setEditingBudget(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" />
              Neuer Budgetplan
            </Button>
          )}
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Budgetpläne gesamt
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <PiggyBank className="h-5 w-5 text-primary" />
                <span className="text-2xl font-bold">{stats.total}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Genehmigt
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <span className="text-2xl font-bold">{stats.approved}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Zur Genehmigung
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-blue-600" />
                <span className="text-2xl font-bold">{stats.pending}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Genehm. Budget
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-primary" />
                <span className="text-2xl font-bold">
                  {totalBudgetApproved.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4">
          <Select value={selectedProperty} onValueChange={setSelectedProperty}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Alle Liegenschaften" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Liegenschaften</SelectItem>
              {properties?.map((property) => (
                <SelectItem key={property.id} value={property.id}>
                  {property.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Alle Jahre" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Jahre</SelectItem>
              {years.map((year) => (
                <SelectItem key={year} value={year.toString()}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Budget Cards */}
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : budgets?.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <PiggyBank className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">Keine Budgetpläne vorhanden</h3>
              <p className="text-muted-foreground text-center mb-4">
                Erstellen Sie einen neuen Budgetplan für Instandhaltungen.
              </p>
              {canEdit && (
                <Button onClick={() => { setEditingBudget(null); setFormOpen(true); }}>
                  <Plus className="h-4 w-4 mr-2" />
                  Budgetplan erstellen
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {budgets?.map((budget) => (
              <div key={budget.id} className="relative">
                <BudgetComparisonCard budget={budget} />
                
                {canEdit && (
                  <div className="absolute top-4 right-12">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {budget.status === 'entwurf' && (
                          <>
                            <DropdownMenuItem onClick={() => handleEdit(budget)}>
                              <Edit className="h-4 w-4 mr-2" />
                              Bearbeiten
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleSubmit(budget.id)}>
                              <Send className="h-4 w-4 mr-2" />
                              Zur Genehmigung einreichen
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                          </>
                        )}
                        
                        {budget.status === 'eingereicht' && (
                          <>
                            <DropdownMenuItem onClick={() => handleApprovalClick(budget.id, 'genehmigt')}>
                              <CheckCircle className="h-4 w-4 mr-2 text-green-600" />
                              Genehmigen
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleApprovalClick(budget.id, 'abgelehnt')}>
                              <XCircle className="h-4 w-4 mr-2 text-red-600" />
                              Ablehnen
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                          </>
                        )}

                        {(budget.status === 'genehmigt' || budget.status === 'abgelehnt') && (
                          <DropdownMenuItem onClick={() => handleResetToDraft(budget.id)}>
                            <RotateCcw className="h-4 w-4 mr-2" />
                            Auf Entwurf zurücksetzen
                          </DropdownMenuItem>
                        )}

                        <DropdownMenuItem
                          className="text-red-600"
                          onClick={() => {
                            setBudgetToDelete(budget.id);
                            setDeleteDialogOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Löschen
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Budget Plan Form Dialog */}
        <BudgetPlanForm
          open={formOpen}
          onOpenChange={(open) => {
            setFormOpen(open);
            if (!open) setEditingBudget(null);
          }}
          budget={editingBudget}
        />

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Budgetplan löschen?</AlertDialogTitle>
              <AlertDialogDescription>
                Dieser Vorgang kann nicht rückgängig gemacht werden. Der Budgetplan
                wird dauerhaft gelöscht.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-red-600 hover:bg-red-700"
              >
                Löschen
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Approval Dialog */}
        <AlertDialog open={approvalDialogOpen} onOpenChange={setApprovalDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {approvalData?.status === 'genehmigt' ? 'Budgetplan genehmigen' : 'Budgetplan ablehnen'}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {approvalData?.status === 'genehmigt' ? (
                  <div className="space-y-4 mt-4">
                    <p>Bitte geben Sie den Namen des Genehmigenden ein:</p>
                    <Input
                      placeholder="Name des Eigentümers"
                      value={approverName}
                      onChange={(e) => setApproverName(e.target.value)}
                    />
                  </div>
                ) : (
                  'Möchten Sie diesen Budgetplan wirklich ablehnen?'
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleApprovalConfirm}
                disabled={approvalData?.status === 'genehmigt' && !approverName.trim()}
                className={approvalData?.status === 'abgelehnt' ? 'bg-red-600 hover:bg-red-700' : ''}
              >
                {approvalData?.status === 'genehmigt' ? 'Genehmigen' : 'Ablehnen'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </MainLayout>
  );
}
