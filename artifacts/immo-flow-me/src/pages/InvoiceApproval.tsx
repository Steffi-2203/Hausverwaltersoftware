import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  FileCheck,
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Calendar,
  Building2,
  Clock,
  CreditCard,
  Ban,
  UserCheck,
  Eye,
  AlertTriangle,
} from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/hooks/useAuth';
import {
  useMaintenanceInvoices,
  usePendingInvoices,
  usePreApprovedInvoices,
  usePreApproveInvoice,
  useApproveInvoice,
  useRejectInvoice,
  MaintenanceInvoice,
} from '@/hooks/useMaintenanceInvoices';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

const STATUS_CONFIG = {
  pending: {
    label: 'Ausstehend',
    badge: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    icon: Clock,
  },
  pre_approved: {
    label: 'Zur Prüfung',
    badge: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
    icon: UserCheck,
  },
  approved: {
    label: 'Freigegeben',
    badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    icon: CheckCircle2,
  },
  paid: {
    label: 'Bezahlt',
    badge: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    icon: CreditCard,
  },
  rejected: {
    label: 'Abgelehnt',
    badge: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    icon: Ban,
  },
};

export default function InvoiceApprovalPage() {
  const permissions = usePermissions();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('pending');
  
  const { data: allInvoices, isLoading: loadingAll } = useMaintenanceInvoices();
  const { data: pendingInvoices, isLoading: loadingPending } = usePendingInvoices();
  const { data: preApprovedInvoices, isLoading: loadingPreApproved } = usePreApprovedInvoices();
  
  const preApproveInvoice = usePreApproveInvoice();
  const approveInvoice = useApproveInvoice();
  const rejectInvoice = useRejectInvoice();

  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  if (!permissions.canApproveInvoices && !permissions.isAdmin) {
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

  // Vorfreigabe (1. Auge)
  const handlePreApprove = async (invoiceId: string) => {
    await preApproveInvoice.mutateAsync(invoiceId);
  };

  // Finale Freigabe (2. Auge)
  const handleApprove = async (invoiceId: string) => {
    await approveInvoice.mutateAsync(invoiceId);
  };

  const handleRejectClick = (invoiceId: string) => {
    setSelectedInvoiceId(invoiceId);
    setRejectionReason('');
    setShowRejectDialog(true);
  };

  const handleRejectConfirm = async () => {
    if (!selectedInvoiceId || !rejectionReason.trim()) return;

    await rejectInvoice.mutateAsync({
      invoiceId: selectedInvoiceId,
      reason: rejectionReason,
    });

    setShowRejectDialog(false);
    setSelectedInvoiceId(null);
    setRejectionReason('');
  };

  // Gruppiere Rechnungen nach Status
  const invoicesByStatus = {
    pending: allInvoices?.filter((i) => i.status === 'pending') || [],
    pre_approved: allInvoices?.filter((i) => i.status === 'pre_approved') || [],
    approved: allInvoices?.filter((i) => i.status === 'approved') || [],
    paid: allInvoices?.filter((i) => i.status === 'paid') || [],
    rejected: allInvoices?.filter((i) => i.status === 'rejected') || [],
  };

  const isLoading = loadingAll || loadingPending || loadingPreApproved;

  // Prüfen ob der aktuelle Benutzer die Vorfreigabe erteilt hat
  const canFinalApprove = (invoice: MaintenanceInvoice) => {
    return invoice.pre_approved_by !== user?.id;
  };

  const renderApprovalHistory = (invoice: MaintenanceInvoice) => {
    if (!invoice.pre_approved_at && !invoice.final_approved_at) return null;

    return (
      <div className="mt-4 p-3 bg-muted/50 rounded-lg space-y-2">
        <p className="text-sm font-medium flex items-center gap-2">
          <Eye className="h-4 w-4" />
          Freigabe-Historie (Vier-Augen-Prinzip)
        </p>
        {invoice.pre_approved_at && (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-orange-500" />
            <span>Vorfreigabe: {format(new Date(invoice.pre_approved_at), 'dd.MM.yyyy HH:mm', { locale: de })}</span>
          </div>
        )}
        {invoice.final_approved_at && (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span>Finale Freigabe: {format(new Date(invoice.final_approved_at), 'dd.MM.yyyy HH:mm', { locale: de })}</span>
          </div>
        )}
      </div>
    );
  };

  const renderInvoiceList = (
    invoices: MaintenanceInvoice[] | undefined,
    actionType: 'pre_approve' | 'final_approve' | 'none' = 'none'
  ) => {
    if (!invoices || invoices.length === 0) {
      return (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileCheck className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">Keine Rechnungen</p>
            <p className="text-muted-foreground text-sm mt-1">
              In dieser Kategorie gibt es keine Rechnungen.
            </p>
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-4">
        {invoices.map((invoice) => {
          const statusConfig = STATUS_CONFIG[invoice.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.pending;
          const StatusIcon = statusConfig.icon;
          const canApprove = canFinalApprove(invoice);

          return (
            <Card key={invoice.id}>
              <CardContent className="p-6">
                <div className="flex flex-col lg:flex-row lg:items-start gap-6">
                  {/* Invoice Details */}
                  <div className="flex-1 space-y-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-lg">
                            {invoice.invoice_number
                              ? `Rechnung ${invoice.invoice_number}`
                              : 'Rechnung (ohne Nummer)'}
                          </h3>
                          <Badge variant="outline" className={statusConfig.badge}>
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {statusConfig.label}
                          </Badge>
                        </div>
                        {invoice.maintenance_tasks && (
                          <p className="text-sm text-muted-foreground mt-1">
                            <Building2 className="h-4 w-4 inline mr-1" />
                            {invoice.maintenance_tasks.title}
                            {invoice.maintenance_tasks.properties && (
                              <> – {invoice.maintenance_tasks.properties.name}</>
                            )}
                          </p>
                        )}
                      </div>

                      <div className="text-right">
                        <p className="text-2xl font-bold text-primary">
                          € {Number(invoice.amount).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                        </p>
                        <p className="text-sm text-muted-foreground flex items-center justify-end gap-1">
                          <Calendar className="h-4 w-4" />
                          {format(new Date(invoice.invoice_date), 'dd.MM.yyyy', { locale: de })}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Handwerker / Firma</p>
                        <p className="font-medium">{invoice.contractor_name}</p>
                      </div>

                      {invoice.notes && (
                        <div>
                          <p className="text-muted-foreground">Notizen</p>
                          <p>{invoice.notes}</p>
                        </div>
                      )}
                    </div>

                    {invoice.rejection_reason && (
                      <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                        <p className="text-sm font-medium text-red-800 dark:text-red-400">Ablehnungsgrund:</p>
                        <p className="text-sm text-red-700 dark:text-red-300">{invoice.rejection_reason}</p>
                      </div>
                    )}

                    {invoice.document_url && (
                      <a
                        href={invoice.document_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Rechnung ansehen
                      </a>
                    )}

                    {/* Freigabe-Historie */}
                    {renderApprovalHistory(invoice)}
                  </div>

                  {/* Actions */}
                  {actionType === 'pre_approve' && invoice.status === 'pending' && (
                    <div className="flex lg:flex-col gap-3">
                      <Button
                        className="flex-1 lg:flex-none"
                        onClick={() => handlePreApprove(invoice.id)}
                        disabled={preApproveInvoice.isPending}
                      >
                        {preApproveInvoice.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <UserCheck className="h-4 w-4 mr-2" />
                        )}
                        Vorfreigeben
                      </Button>

                      <Button
                        variant="destructive"
                        className="flex-1 lg:flex-none"
                        onClick={() => handleRejectClick(invoice.id)}
                        disabled={rejectInvoice.isPending}
                      >
                        <XCircle className="h-4 w-4 mr-2" />
                        Ablehnen
                      </Button>
                    </div>
                  )}

                  {actionType === 'final_approve' && invoice.status === 'pre_approved' && (
                    <div className="flex lg:flex-col gap-3">
                      {canApprove ? (
                        <Button
                          className="flex-1 lg:flex-none"
                          onClick={() => handleApprove(invoice.id)}
                          disabled={approveInvoice.isPending}
                        >
                          {approveInvoice.isPending ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4 mr-2" />
                          )}
                          Final Freigeben
                        </Button>
                      ) : (
                        <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-sm">
                          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-400 font-medium">
                            <AlertTriangle className="h-4 w-4" />
                            Vier-Augen-Prinzip
                          </div>
                          <p className="text-amber-700 dark:text-amber-300 mt-1">
                            Sie haben diese Rechnung bereits vorfreigegeben. Eine andere Person muss die finale Freigabe erteilen.
                          </p>
                        </div>
                      )}

                      <Button
                        variant="destructive"
                        className="flex-1 lg:flex-none"
                        onClick={() => handleRejectClick(invoice.id)}
                        disabled={rejectInvoice.isPending}
                      >
                        <XCircle className="h-4 w-4 mr-2" />
                        Ablehnen
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  };

  return (
    <MainLayout
      title="Rechnungsfreigabe"
      subtitle="Wartungsrechnungen mit Vier-Augen-Prinzip prüfen und verwalten"
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="pending" className="gap-2">
              <Clock className="h-4 w-4" />
              Ausstehend
              {invoicesByStatus.pending.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {invoicesByStatus.pending.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="pre_approved" className="gap-2">
              <UserCheck className="h-4 w-4" />
              Zur Prüfung
              {invoicesByStatus.pre_approved.length > 0 && (
                <Badge variant="destructive" className="ml-1">
                  {invoicesByStatus.pre_approved.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="approved" className="gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Freigegeben
              {invoicesByStatus.approved.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {invoicesByStatus.approved.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="paid" className="gap-2">
              <CreditCard className="h-4 w-4" />
              Bezahlt
              {invoicesByStatus.paid.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {invoicesByStatus.paid.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="rejected" className="gap-2">
              <Ban className="h-4 w-4" />
              Abgelehnt
              {invoicesByStatus.rejected.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {invoicesByStatus.rejected.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending">
            <div className="mb-4 p-4 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground">
                <strong>Schritt 1:</strong> Prüfen Sie die Rechnung und erteilen Sie die Vorfreigabe. Eine zweite Person muss dann die finale Freigabe erteilen.
              </p>
            </div>
            {renderInvoiceList(invoicesByStatus.pending, 'pre_approve')}
          </TabsContent>

          <TabsContent value="pre_approved">
            <div className="mb-4 p-4 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground">
                <strong>Schritt 2:</strong> Diese Rechnungen wurden bereits vorgeprüft. Erteilen Sie die finale Freigabe (Buchung wird erstellt).
              </p>
            </div>
            {renderInvoiceList(invoicesByStatus.pre_approved, 'final_approve')}
          </TabsContent>

          <TabsContent value="approved">
            {renderInvoiceList(invoicesByStatus.approved, 'none')}
          </TabsContent>

          <TabsContent value="paid">
            {renderInvoiceList(invoicesByStatus.paid, 'none')}
          </TabsContent>

          <TabsContent value="rejected">
            {renderInvoiceList(invoicesByStatus.rejected, 'none')}
          </TabsContent>
        </Tabs>
      )}

      {/* Reject Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rechnung ablehnen</DialogTitle>
            <DialogDescription>
              Bitte geben Sie einen Grund für die Ablehnung an.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Ablehnungsgrund *</Label>
              <Textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="z.B. Betrag zu hoch, Leistung nicht erbracht..."
                rows={4}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectConfirm}
              disabled={!rejectionReason.trim() || rejectInvoice.isPending}
            >
              {rejectInvoice.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Ablehnen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
