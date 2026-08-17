import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useAuditLogs, useAuditLogStats, AuditLog } from '@/hooks/useAuditLogs';
import { useSubscriptionLimits } from '@/hooks/useSubscriptionLimits';
import { useIsAdmin } from '@/hooks/useAdmin';
import { Navigate } from 'react-router-dom';
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
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  FileText, 
  Plus, 
  Pencil, 
  Trash2,
  Eye,
  Activity,
  Database,
  ArrowLeft
} from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { Link } from 'react-router-dom';

const TABLE_OPTIONS = [
  { value: '', label: 'Alle Tabellen' },
  { value: 'tenants', label: 'Mieter' },
  { value: 'payments', label: 'Zahlungen' },
  { value: 'bank_accounts', label: 'Bankkonten' },
  { value: 'transactions', label: 'Transaktionen' },
  { value: 'property_owners', label: 'Eigentümer' },
];

const ACTION_OPTIONS = [
  { value: '', label: 'Alle Aktionen' },
  { value: 'create', label: 'Erstellt' },
  { value: 'update', label: 'Aktualisiert' },
  { value: 'delete', label: 'Gelöscht' },
];

export default function AdminAuditLogs() {
  const [tableFilter, setTableFilter] = useState<string>('');
  const [actionFilter, setActionFilter] = useState<string>('');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  
  const { limits, isLoading: limitsLoading } = useSubscriptionLimits();
  const isAdmin = useIsAdmin();
  
  // Permission check: require canManageTeam or admin role
  const hasAccess = isAdmin || limits.canManageTeam;
  
  if (!limitsLoading && !hasAccess) {
    return <Navigate to="/dashboard" replace />;
  }

  const { data: logs, isLoading } = useAuditLogs({
    tableName: tableFilter || undefined,
    action: actionFilter || undefined,
    limit: 200,
  });

  const stats = useAuditLogStats();

  const getActionBadge = (action: string) => {
    switch (action) {
      case 'create':
        return <Badge className="bg-success text-success-foreground"><Plus className="h-3 w-3 mr-1" />Erstellt</Badge>;
      case 'update':
        return <Badge className="bg-primary text-primary-foreground"><Pencil className="h-3 w-3 mr-1" />Aktualisiert</Badge>;
      case 'delete':
        return <Badge variant="destructive"><Trash2 className="h-3 w-3 mr-1" />Gelöscht</Badge>;
      default:
        return <Badge variant="outline">{action}</Badge>;
    }
  };

  const getTableLabel = (tableName: string) => {
    const labels: Record<string, string> = {
      tenants: 'Mieter',
      payments: 'Zahlungen',
      bank_accounts: 'Bankkonten',
      transactions: 'Transaktionen',
      property_owners: 'Eigentümer',
    };
    return labels[tableName] || tableName;
  };

  const formatJson = (data: unknown) => {
    if (!data) return 'null';
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  };

  if (isLoading) {
    return (
      <MainLayout title="Audit-Logs" subtitle="Protokollierung aller Datenänderungen">
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-96" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout title="Audit-Logs" subtitle="Protokollierung aller Datenänderungen (DSGVO-konform)">
      <div className="space-y-6">
        {/* Back Button */}
        <Button variant="outline" asChild>
          <Link to="/admin">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Zurück zum Admin-Dashboard
          </Link>
        </Button>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Gesamt Einträge</CardDescription>
              <CardTitle className="text-2xl flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                {stats.totalLogs}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Erstellt</CardDescription>
              <CardTitle className="text-2xl flex items-center gap-2">
                <Plus className="h-5 w-5 text-success" />
                {stats.createCount}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Aktualisiert</CardDescription>
              <CardTitle className="text-2xl flex items-center gap-2">
                <Pencil className="h-5 w-5 text-primary" />
                {stats.updateCount}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Gelöscht</CardDescription>
              <CardTitle className="text-2xl flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-destructive" />
                {stats.deleteCount}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Filters & Table */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5" />
                  Audit-Protokoll
                </CardTitle>
                <CardDescription>
                  Alle Änderungen an sensiblen Daten werden hier protokolliert
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Select value={tableFilter} onValueChange={setTableFilter}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="Tabelle" />
                  </SelectTrigger>
                  <SelectContent>
                    {TABLE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={actionFilter} onValueChange={setActionFilter}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Aktion" />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTION_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Zeitpunkt</TableHead>
                    <TableHead>Aktion</TableHead>
                    <TableHead>Tabelle</TableHead>
                    <TableHead>Datensatz-ID</TableHead>
                    <TableHead>Benutzer-ID</TableHead>
                    <TableHead className="text-right">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!logs || logs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        Keine Audit-Logs gefunden
                      </TableCell>
                    </TableRow>
                  ) : (
                    logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="whitespace-nowrap">
                          {format(new Date(log.created_at), 'dd.MM.yyyy HH:mm:ss', { locale: de })}
                        </TableCell>
                        <TableCell>{getActionBadge(log.action)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{getTableLabel(log.table_name)}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {log.record_id ? log.record_id.slice(0, 8) + '...' : '-'}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {log.user_id ? log.user_id.slice(0, 8) + '...' : 'System'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setSelectedLog(log);
                              setShowDetailsDialog(true);
                            }}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Details Dialog */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Audit-Log Details
            </DialogTitle>
            <DialogDescription>
              Vollständige Protokollinformationen
            </DialogDescription>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Zeitpunkt</p>
                  <p className="font-medium">
                    {format(new Date(selectedLog.created_at), 'dd.MM.yyyy HH:mm:ss', { locale: de })}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Aktion</p>
                  {getActionBadge(selectedLog.action)}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Tabelle</p>
                  <p className="font-medium">{getTableLabel(selectedLog.table_name)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Datensatz-ID</p>
                  <p className="font-mono text-sm">{selectedLog.record_id || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Benutzer-ID</p>
                  <p className="font-mono text-sm">{selectedLog.user_id || 'System'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">IP-Adresse</p>
                  <p className="font-mono text-sm">{String(selectedLog.ip_address) || '-'}</p>
                </div>
              </div>

              {selectedLog.user_agent && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">User-Agent</p>
                  <p className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto">
                    {selectedLog.user_agent}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Alte Daten</p>
                  <pre className="text-xs font-mono bg-destructive/10 p-3 rounded overflow-x-auto max-h-60">
                    {formatJson(selectedLog.old_data)}
                  </pre>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Neue Daten</p>
                  <pre className="text-xs font-mono bg-success/10 p-3 rounded overflow-x-auto max-h-60">
                    {formatJson(selectedLog.new_data)}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
