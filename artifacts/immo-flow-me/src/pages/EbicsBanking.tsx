import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Landmark,
  Plus,
  Key,
  CheckCircle,
  Download,
  Send,
  Clock,
  Trash2,
  RefreshCw,
  Shield,
  AlertTriangle,
} from 'lucide-react';
import {
  useEbicsConnections,
  useEbicsOrders,
  useEbicsPaymentBatches,
  useCreateEbicsConnection,
  useDeleteEbicsConnection,
  useInitEbicsKeys,
  useActivateEbicsConnection,
  useFetchEbicsStatements,
  useSubmitEbicsPaymentBatch,
} from '@/hooks/useEbics';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

function formatEur(value: number): string {
  return value.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' });
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Ausstehend', variant: 'secondary' },
  key_sent: { label: 'Schlüssel gesendet', variant: 'outline' },
  active: { label: 'Aktiv', variant: 'default' },
  inactive: { label: 'Inaktiv', variant: 'destructive' },
  error: { label: 'Fehler', variant: 'destructive' },
};

function ConnectionsTab() {
  const { data: connections, isLoading } = useEbicsConnections();
  const createMutation = useCreateEbicsConnection();
  const deleteMutation = useDeleteEbicsConnection();
  const initKeysMutation = useInitEbicsKeys();
  const activateMutation = useActivateEbicsConnection();
  const { toast } = useToast();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [form, setForm] = useState({ bankName: '', hostId: '', hostUrl: '', partnerId: '', userId: '', iban: '', bic: '' });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const handleCreate = async () => {
    try {
      await createMutation.mutateAsync(form);
      toast({ title: 'Verbindung erstellt', description: 'Die EBICS-Verbindung wurde angelegt.' });
      setShowAddDialog(false);
      setForm({ bankName: '', hostId: '', hostUrl: '', partnerId: '', userId: '', iban: '', bic: '' });
    } catch (e: any) {
      toast({ title: 'Fehler', description: e.message, variant: 'destructive' });
    }
  };

  const handleInitKeys = async (id: string) => {
    try {
      const result = await initKeysMutation.mutateAsync(id);
      toast({ title: 'Schlüssel initialisiert', description: 'INI- und HIA-Briefe wurden erstellt. Bitte an die Bank senden.' });
    } catch (e: any) {
      toast({ title: 'Fehler bei Schlüsselinitialisierung', description: e.message, variant: 'destructive' });
    }
  };

  const handleActivate = async (id: string) => {
    try {
      await activateMutation.mutateAsync(id);
      toast({ title: 'Verbindung aktiviert', description: 'HPB erfolgreich. Die Verbindung ist jetzt aktiv.' });
    } catch (e: any) {
      toast({ title: 'Aktivierung fehlgeschlagen', description: e.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id);
      toast({ title: 'Verbindung gelöscht' });
    } catch (e: any) {
      toast({ title: 'Fehler', description: e.message, variant: 'destructive' });
    }
  };

  const conns = (connections as any[]) || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">Bankverbindungen ({conns.length})</h3>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-ebics"><Plus className="h-4 w-4 mr-2" />Neue Verbindung</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>EBICS-Verbindung hinzufügen</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Bankname</Label><Input value={form.bankName} onChange={e => setForm({...form, bankName: e.target.value})} data-testid="input-ebics-bank" /></div>
              <div><Label>Host-ID</Label><Input value={form.hostId} onChange={e => setForm({...form, hostId: e.target.value})} data-testid="input-ebics-host-id" /></div>
              <div><Label>Host-URL</Label><Input value={form.hostUrl} onChange={e => setForm({...form, hostUrl: e.target.value})} placeholder="https://..." data-testid="input-ebics-host-url" /></div>
              <div><Label>Partner-ID</Label><Input value={form.partnerId} onChange={e => setForm({...form, partnerId: e.target.value})} data-testid="input-ebics-partner" /></div>
              <div><Label>User-ID</Label><Input value={form.userId} onChange={e => setForm({...form, userId: e.target.value})} data-testid="input-ebics-user" /></div>
              <div><Label>IBAN</Label><Input value={form.iban} onChange={e => setForm({...form, iban: e.target.value})} data-testid="input-ebics-iban" /></div>
              <div><Label>BIC (optional)</Label><Input value={form.bic} onChange={e => setForm({...form, bic: e.target.value})} data-testid="input-ebics-bic" /></div>
              <Button onClick={handleCreate} disabled={createMutation.isPending || !form.bankName || !form.iban} className="w-full" data-testid="button-save-ebics">
                {createMutation.isPending ? 'Wird erstellt...' : 'Verbindung erstellen'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {conns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Landmark className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-2">Noch keine EBICS-Verbindungen</p>
            <p className="text-sm text-muted-foreground">Erstellen Sie eine Verbindung zu Ihrer Bank</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {conns.map((conn: any) => {
            const status = statusConfig[conn.status] || statusConfig.pending;
            return (
              <Card key={conn.id} data-testid={`card-ebics-${conn.id}`}>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Landmark className="h-5 w-5 text-muted-foreground" />
                        <h4 className="font-semibold" data-testid={`text-ebics-bank-${conn.id}`}>{conn.bankName}</h4>
                        <Badge variant={status.variant} data-testid={`badge-ebics-status-${conn.id}`}>{status.label}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground font-mono" data-testid={`text-ebics-iban-${conn.id}`}>{conn.iban}</p>
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                        <span>Host: {conn.hostId}</span>
                        <span>Partner: {conn.partnerId}</span>
                        <span>User: {conn.userId}</span>
                      </div>
                      {conn.lastSyncAt && <p className="text-xs text-muted-foreground">Letzte Sync: {format(new Date(conn.lastSyncAt), 'dd.MM.yyyy HH:mm', { locale: de })}</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {conn.status === 'pending' && (
                        <Button variant="outline" onClick={() => handleInitKeys(conn.id)} disabled={initKeysMutation.isPending} data-testid={`button-init-keys-${conn.id}`}>
                          <Key className="h-4 w-4 mr-2" />Schlüssel senden
                        </Button>
                      )}
                      {conn.status === 'key_sent' && (
                        <Button variant="outline" onClick={() => handleActivate(conn.id)} disabled={activateMutation.isPending} data-testid={`button-activate-${conn.id}`}>
                          <CheckCircle className="h-4 w-4 mr-2" />Aktivieren (HPB)
                        </Button>
                      )}
                      {conn.status === 'active' && (
                        <Badge variant="default" className="gap-1"><Shield className="h-3 w-3" />Bereit</Badge>
                      )}
                      <Button size="icon" variant="ghost" onClick={() => handleDelete(conn.id)} data-testid={`button-delete-ebics-${conn.id}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OrdersTab() {
  const { data: orders, isLoading } = useEbicsOrders();

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const orderList = (orders as any[]) || [];

  const orderTypeLabels: Record<string, string> = {
    INI: 'Initialisierung', HIA: 'Auth-Schlüssel', HPB: 'Bank-Schlüssel',
    C53: 'Kontoauszüge', C52: 'Tagesauszug', CCT: 'Überweisung', CDD: 'Lastschrift',
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" />EBICS-Aufträge ({orderList.length})</CardTitle></CardHeader>
      <CardContent className="p-0">
        {orderList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Clock className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Noch keine Aufträge</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Typ</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Transaktionen</TableHead>
                <TableHead className="text-right">Betrag</TableHead>
                <TableHead>Erstellt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orderList.map((order: any) => (
                <TableRow key={order.id} data-testid={`row-order-${order.id}`}>
                  <TableCell><Badge variant="outline">{orderTypeLabels[order.orderType] || order.orderType}</Badge></TableCell>
                  <TableCell><Badge variant={order.orderStatus === 'completed' ? 'default' : 'secondary'}>{order.orderStatus}</Badge></TableCell>
                  <TableCell className="text-sm">{order.transactionCount || 0}</TableCell>
                  <TableCell className="text-right text-sm font-medium">{order.totalAmount ? formatEur(Number(order.totalAmount)) : '-'}</TableCell>
                  <TableCell className="text-sm">{order.createdAt ? format(new Date(order.createdAt), 'dd.MM.yyyy HH:mm', { locale: de }) : '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function PaymentBatchesTab() {
  const { data: batches, isLoading } = useEbicsPaymentBatches();
  const submitMutation = useSubmitEbicsPaymentBatch();
  const { toast } = useToast();

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const batchList = (batches as any[]) || [];

  const handleSubmit = async (id: string) => {
    try {
      await submitMutation.mutateAsync(id);
      toast({ title: 'Zahlungsstapel eingereicht', description: 'Der Stapel wurde an die Bank übermittelt.' });
    } catch (e: any) {
      toast({ title: 'Übermittlung fehlgeschlagen', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Send className="h-4 w-4" />Zahlungsstapel ({batchList.length})</CardTitle></CardHeader>
      <CardContent className="p-0">
        {batchList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Send className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Noch keine Zahlungsstapel</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Typ</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Zahlungen</TableHead>
                <TableHead className="text-right">Gesamtbetrag</TableHead>
                <TableHead>Erstellt</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batchList.map((batch: any) => (
                <TableRow key={batch.id} data-testid={`row-batch-${batch.id}`}>
                  <TableCell><Badge variant="outline">{batch.batchType === 'credit' ? 'Überweisung' : 'Lastschrift'}</Badge></TableCell>
                  <TableCell><Badge variant={batch.status === 'completed' ? 'default' : batch.status === 'submitted' ? 'secondary' : 'outline'}>{batch.status}</Badge></TableCell>
                  <TableCell className="text-sm">{batch.paymentCount}</TableCell>
                  <TableCell className="text-right text-sm font-medium">{formatEur(Number(batch.totalAmount))}</TableCell>
                  <TableCell className="text-sm">{batch.createdAt ? format(new Date(batch.createdAt), 'dd.MM.yyyy HH:mm', { locale: de }) : '-'}</TableCell>
                  <TableCell>
                    {batch.status === 'draft' && (
                      <Button size="sm" variant="outline" onClick={() => handleSubmit(batch.id)} disabled={submitMutation.isPending} data-testid={`button-submit-batch-${batch.id}`}>
                        <Send className="h-3 w-3 mr-1" />Senden
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function EbicsBanking() {
  const [activeTab, setActiveTab] = useState('connections');
  const { data: availability } = useQuery<{ enabled: boolean; message: string }>({
    queryKey: ['/api/ebics/availability'],
  });
  const ebicsEnabled = availability?.enabled === true;

  return (
    <MainLayout title="EBICS Banking" subtitle="Elektronisches Banking & Zahlungsverkehr">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-ebics-title">EBICS Live-Banking</h1>
          <p className="text-muted-foreground" data-testid="text-ebics-subtitle">Bankverbindungen, Kontoauszüge und Zahlungsverkehr</p>
        </div>

        {!ebicsEnabled && (
          <div className="p-3 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30" data-testid="banner-ebics-unavailable">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">EBICS noch nicht verfügbar — keine echte Bankverbindung</p>
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Die EBICS-Anbindung ist in dieser Installation nicht aktiv: Es werden keine Aufträge an eine Bank
                  übertragen, und hier angelegte Verbindungen dienen nur der Vorbereitung (INI/HIA-Briefe).
                  Der unterstützte Zahlungsweg ist der Dateiweg: <strong>SEPA-XML exportieren</strong>, im
                  Banking-Portal Ihrer Bank einreichen und den Kontoauszug als <strong>CAMT.053 importieren</strong>.
                  Bitte keine echten Zahlungsläufe über diese Seite einplanen.
                </p>
              </div>
            </div>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList data-testid="tabs-ebics">
            <TabsTrigger value="connections" data-testid="tab-ebics-connections"><Landmark className="h-4 w-4 mr-1" />Verbindungen</TabsTrigger>
            <TabsTrigger value="orders" data-testid="tab-ebics-orders"><Clock className="h-4 w-4 mr-1" />Aufträge</TabsTrigger>
            <TabsTrigger value="batches" data-testid="tab-ebics-batches"><Send className="h-4 w-4 mr-1" />Zahlungsstapel</TabsTrigger>
          </TabsList>
          <TabsContent value="connections"><ConnectionsTab /></TabsContent>
          <TabsContent value="orders"><OrdersTab /></TabsContent>
          <TabsContent value="batches"><PaymentBatchesTab /></TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
