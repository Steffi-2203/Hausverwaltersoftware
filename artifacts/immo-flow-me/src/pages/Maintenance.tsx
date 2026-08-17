import { useState, useMemo } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Wrench,
  Plus,
  Loader2,
  Calendar,
  Building2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  User,
  Receipt,
} from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { useProperties } from '@/hooks/useProperties';
import { useUnits } from '@/hooks/useUnits';
import {
  useMaintenanceTasks,
  useCreateMaintenanceTask,
  useUpdateMaintenanceTask,
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from '@/hooks/useMaintenanceTasks';
import { useTaskInvoices } from '@/hooks/useTaskInvoices';
import { AddInvoiceDialog } from '@/components/maintenance/AddInvoiceDialog';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

export default function MaintenancePage() {
  const permissions = usePermissions();
  const { data: properties } = useProperties();
  const { data: units } = useUnits();
  const [showNewTask, setShowNewTask] = useState(false);
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [selectedTaskForInvoice, setSelectedTaskForInvoice] = useState<{
    id: string;
    title: string;
    contractorName?: string;
  } | null>(null);
  const [filters, setFilters] = useState({
    status: 'all',
    priority: 'all',
    category: 'all',
    propertyId: 'all',
  });

  const { data: tasks, isLoading } = useMaintenanceTasks(filters);
  const createTask = useCreateMaintenanceTask();
  const updateTask = useUpdateMaintenanceTask();

  // Task IDs für Rechnungsabfrage
  const taskIds = useMemo(() => tasks?.map((t) => t.id) || [], [tasks]);
  const { data: taskInvoices } = useTaskInvoices(taskIds);

  const handleAddInvoice = (task: { id: string; title: string; contractor_name?: string | null }) => {
    setSelectedTaskForInvoice({
      id: task.id,
      title: task.title,
      contractorName: task.contractor_name || undefined,
    });
    setShowInvoiceDialog(true);
  };

  const [newTask, setNewTask] = useState({
    property_id: '',
    unit_id: '',
    title: '',
    description: '',
    category: 'repair',
    priority: 'medium',
    contractor_name: '',
    contractor_contact: '',
    due_date: '',
    estimated_cost: '',
  });

  if (!permissions.canManageMaintenance && !permissions.isAdmin) {
    return (
      <MainLayout title="Keine Berechtigung" subtitle="">
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">
            Sie haben keine Berechtigung für diese Seite.
          </p>
        </div>
      </MainLayout>
    );
  }

  const handleCreateTask = async () => {
    if (!newTask.property_id || !newTask.title) return;

    await createTask.mutateAsync({
      property_id: newTask.property_id,
      unit_id: newTask.unit_id || null,
      title: newTask.title,
      description: newTask.description || undefined,
      category: newTask.category,
      priority: newTask.priority,
      contractor_name: newTask.contractor_name || undefined,
      contractor_contact: newTask.contractor_contact || undefined,
      due_date: newTask.due_date || undefined,
      estimated_cost: newTask.estimated_cost ? parseFloat(newTask.estimated_cost) : undefined,
    });

    setShowNewTask(false);
    setNewTask({
      property_id: '',
      unit_id: '',
      title: '',
      description: '',
      category: 'repair',
      priority: 'medium',
      contractor_name: '',
      contractor_contact: '',
      due_date: '',
      estimated_cost: '',
    });
  };

  const handleStatusChange = (taskId: string, newStatus: string) => {
    updateTask.mutate({
      id: taskId,
      status: newStatus as any,
      completed_at: newStatus === 'completed' ? new Date().toISOString() : null,
    });
  };

  const getPriorityInfo = (priority: string) => {
    return TASK_PRIORITIES.find((p) => p.value === priority) || TASK_PRIORITIES[1];
  };

  const getStatusInfo = (status: string) => {
    return TASK_STATUSES.find((s) => s.value === status) || TASK_STATUSES[0];
  };

  const getCategoryLabel = (category: string | null) => {
    return TASK_CATEGORIES.find((c) => c.value === category)?.label || 'Sonstiges';
  };

  const getUnitsForProperty = (propertyId: string) => {
    return units?.filter((u) => u.propertyId === propertyId) || [];
  };

  // Statistics
  const stats = {
    total: tasks?.length || 0,
    open: tasks?.filter((t) => t.status === 'open').length || 0,
    inProgress: tasks?.filter((t) => t.status === 'in_progress').length || 0,
    pendingApproval: tasks?.filter((t) => t.status === 'pending_approval').length || 0,
    completed: tasks?.filter((t) => t.status === 'completed').length || 0,
  };

  return (
    <MainLayout
      title="Wartungen & Aufträge"
      subtitle="Facility Management und Handwerkeraufträge verwalten"
    >
      {/* Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Wrench className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Gesamt</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800">
                <Clock className="h-5 w-5 text-gray-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Offen</p>
                <p className="text-2xl font-bold">{stats.open}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Wrench className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">In Arbeit</p>
                <p className="text-2xl font-bold">{stats.inProgress}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-100 dark:bg-yellow-900/30">
                <AlertTriangle className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Freigabe</p>
                <p className="text-2xl font-bold">{stats.pendingApproval}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Erledigt</p>
                <p className="text-2xl font-bold">{stats.completed}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Actions */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="flex flex-wrap gap-2">
          <Select
            value={filters.status}
            onValueChange={(value) => setFilters((f) => ({ ...f, status: value }))}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Status</SelectItem>
              {TASK_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.priority}
            onValueChange={(value) => setFilters((f) => ({ ...f, priority: value }))}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Priorität" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Prioritäten</SelectItem>
              {TASK_PRIORITIES.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.icon} {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.category}
            onValueChange={(value) => setFilters((f) => ({ ...f, category: value }))}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Kategorie" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Kategorien</SelectItem>
              {TASK_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.propertyId}
            onValueChange={(value) => setFilters((f) => ({ ...f, propertyId: value }))}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Liegenschaft" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Liegenschaften</SelectItem>
              {properties?.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1" />

        <Button onClick={() => setShowNewTask(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Neuer Auftrag
        </Button>
      </div>

      {/* Task List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !tasks || tasks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Wrench className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Keine Wartungsaufträge gefunden</p>
            <Button className="mt-4" onClick={() => setShowNewTask(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Ersten Auftrag erstellen
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {tasks.map((task) => {
            const priorityInfo = getPriorityInfo(task.priority);
            const statusInfo = getStatusInfo(task.status);

            return (
              <Card key={task.id}>
                <CardContent className="p-4">
                  <div className="flex flex-col md:flex-row md:items-start gap-4">
                    <div className="flex-1">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h3 className="font-semibold text-lg">{task.title}</h3>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Building2 className="h-4 w-4" />
                            <span>{task.properties?.name || 'Keine Liegenschaft'}</span>
                            {task.units && (
                              <>
                                <span>•</span>
                                <span>Top {task.units.top_nummer}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Badge variant="outline" className={priorityInfo.color}>
                            {priorityInfo.icon} {priorityInfo.label}
                          </Badge>
                          <Badge className={statusInfo.color}>{statusInfo.label}</Badge>
                        </div>
                      </div>

                      {task.description && (
                        <p className="text-sm text-muted-foreground mb-3">{task.description}</p>
                      )}

                      <div className="flex flex-wrap gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Kategorie: </span>
                          <span className="font-medium">{getCategoryLabel(task.category)}</span>
                        </div>
                        {task.contractor_name && (
                          <div className="flex items-center gap-1">
                            <User className="h-4 w-4 text-muted-foreground" />
                            <span>{task.contractor_name}</span>
                          </div>
                        )}
                        {task.due_date && (
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            <span>
                              Fällig: {format(new Date(task.due_date), 'dd.MM.yyyy', { locale: de })}
                            </span>
                          </div>
                        )}
                        {task.estimated_cost && (
                          <div>
                            <span className="text-muted-foreground">Geschätzt: </span>
                            <span className="font-medium">
                              € {Number(task.estimated_cost).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Rechnungs-Badge */}
                    {taskInvoices?.[task.id] && (
                      <div className="w-full md:w-auto border-t md:border-t-0 md:border-l pt-3 md:pt-0 md:pl-4 mt-3 md:mt-0">
                        <div className="text-sm">
                          <div className="flex items-center gap-2 mb-2">
                            <Receipt className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">
                              {taskInvoices[task.id].count} Rechnung{taskInvoices[task.id].count !== 1 ? 'en' : ''}
                            </span>
                          </div>
                          <p className="text-lg font-semibold">
                            € {taskInvoices[task.id].totalAmount.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                          </p>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {taskInvoices[task.id].pendingCount > 0 && (
                              <Badge variant="outline" className="text-xs bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400">
                                {taskInvoices[task.id].pendingCount} ausstehend
                              </Badge>
                            )}
                            {taskInvoices[task.id].approvedCount > 0 && (
                              <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
                                {taskInvoices[task.id].approvedCount} freigegeben
                              </Badge>
                            )}
                            {taskInvoices[task.id].paidCount > 0 && (
                              <Badge variant="outline" className="text-xs bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                                {taskInvoices[task.id].paidCount} bezahlt
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2 md:flex-col">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAddInvoice(task)}
                      >
                        <Receipt className="h-4 w-4 mr-1" />
                        Rechnung
                      </Button>
                      {task.status === 'open' && (
                        <Button
                          size="sm"
                          onClick={() => handleStatusChange(task.id, 'in_progress')}
                        >
                          In Bearbeitung
                        </Button>
                      )}
                      {task.status === 'in_progress' && (
                        <Button
                          size="sm"
                          onClick={() => handleStatusChange(task.id, 'completed')}
                        >
                          Abschließen
                        </Button>
                      )}
                      {task.status === 'pending_approval' && permissions.canApproveInvoices && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleStatusChange(task.id, 'completed')}
                        >
                          Freigeben
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* New Task Dialog */}
      <Dialog open={showNewTask} onOpenChange={setShowNewTask}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Neuen Wartungsauftrag erstellen</DialogTitle>
            <DialogDescription>
              Erstellen Sie einen neuen Auftrag für Reparaturen, Wartungen oder Inspektionen.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Liegenschaft *</Label>
                <Select
                  value={newTask.property_id}
                  onValueChange={(value) => setNewTask((t) => ({ ...t, property_id: value, unit_id: '' }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Auswählen..." />
                  </SelectTrigger>
                  <SelectContent>
                    {properties?.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Einheit (optional)</Label>
                <Select
                  value={newTask.unit_id}
                  onValueChange={(value) => setNewTask((t) => ({ ...t, unit_id: value }))}
                  disabled={!newTask.property_id}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Auswählen..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Keine Einheit</SelectItem>
                    {getUnitsForProperty(newTask.property_id).map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        Top {u.topNummer}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Titel *</Label>
              <Input
                value={newTask.title}
                onChange={(e) => setNewTask((t) => ({ ...t, title: e.target.value }))}
                placeholder="z.B. Heizungswartung, Rohrbruch reparieren..."
              />
            </div>

            <div className="space-y-2">
              <Label>Beschreibung</Label>
              <Textarea
                value={newTask.description}
                onChange={(e) => setNewTask((t) => ({ ...t, description: e.target.value }))}
                placeholder="Details zum Auftrag..."
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Kategorie</Label>
                <Select
                  value={newTask.category}
                  onValueChange={(value) => setNewTask((t) => ({ ...t, category: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Priorität</Label>
                <Select
                  value={newTask.priority}
                  onValueChange={(value) => setNewTask((t) => ({ ...t, priority: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_PRIORITIES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.icon} {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Handwerker / Firma</Label>
                <Input
                  value={newTask.contractor_name}
                  onChange={(e) => setNewTask((t) => ({ ...t, contractor_name: e.target.value }))}
                  placeholder="Name..."
                />
              </div>

              <div className="space-y-2">
                <Label>Kontakt</Label>
                <Input
                  value={newTask.contractor_contact}
                  onChange={(e) => setNewTask((t) => ({ ...t, contractor_contact: e.target.value }))}
                  placeholder="Telefon / E-Mail..."
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fällig am</Label>
                <Input
                  type="date"
                  value={newTask.due_date}
                  onChange={(e) => setNewTask((t) => ({ ...t, due_date: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label>Geschätzte Kosten (€)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={newTask.estimated_cost}
                  onChange={(e) => setNewTask((t) => ({ ...t, estimated_cost: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewTask(false)}>
              Abbrechen
            </Button>
            <Button
              onClick={handleCreateTask}
              disabled={!newTask.property_id || !newTask.title || createTask.isPending}
            >
              {createTask.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Auftrag erstellen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Invoice Dialog */}
      {selectedTaskForInvoice && (
        <AddInvoiceDialog
          open={showInvoiceDialog}
          onOpenChange={setShowInvoiceDialog}
          taskId={selectedTaskForInvoice.id}
          taskTitle={selectedTaskForInvoice.title}
          contractorName={selectedTaskForInvoice.contractorName}
        />
      )}
    </MainLayout>
  );
}
