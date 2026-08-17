import { useState } from 'react';
import { Button } from '@/components/ui/button';
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
import { Loader2, Receipt } from 'lucide-react';
import { useCreateMaintenanceInvoice } from '@/hooks/useMaintenanceInvoices';

interface AddInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  taskTitle: string;
  contractorName?: string;
}

export function AddInvoiceDialog({
  open,
  onOpenChange,
  taskId,
  taskTitle,
  contractorName,
}: AddInvoiceDialogProps) {
  const createInvoice = useCreateMaintenanceInvoice();

  const [formData, setFormData] = useState({
    invoice_number: '',
    invoice_date: new Date().toISOString().split('T')[0],
    amount: '',
    contractor_name: contractorName || '',
    notes: '',
    document_url: '',
  });

  const handleSubmit = async () => {
    if (!formData.amount || !formData.contractor_name || !formData.invoice_date) return;

    await createInvoice.mutateAsync({
      maintenance_task_id: taskId,
      invoice_number: formData.invoice_number || undefined,
      invoice_date: formData.invoice_date,
      amount: parseFloat(formData.amount),
      contractor_name: formData.contractor_name,
      notes: formData.notes || undefined,
      document_url: formData.document_url || undefined,
    });

    onOpenChange(false);
    setFormData({
      invoice_number: '',
      invoice_date: new Date().toISOString().split('T')[0],
      amount: '',
      contractor_name: contractorName || '',
      notes: '',
      document_url: '',
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Rechnung hinzufügen
          </DialogTitle>
          <DialogDescription>
            Rechnung für: {taskTitle}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Rechnungsnummer</Label>
              <Input
                value={formData.invoice_number}
                onChange={(e) => setFormData((f) => ({ ...f, invoice_number: e.target.value }))}
                placeholder="z.B. RE-2024-001"
              />
            </div>

            <div className="space-y-2">
              <Label>Rechnungsdatum *</Label>
              <Input
                type="date"
                value={formData.invoice_date}
                onChange={(e) => setFormData((f) => ({ ...f, invoice_date: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Betrag (€) *</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={formData.amount}
              onChange={(e) => setFormData((f) => ({ ...f, amount: e.target.value }))}
              placeholder="z.B. 1250.00"
            />
          </div>

          <div className="space-y-2">
            <Label>Handwerker / Firma *</Label>
            <Input
              value={formData.contractor_name}
              onChange={(e) => setFormData((f) => ({ ...f, contractor_name: e.target.value }))}
              placeholder="Name des Handwerkers oder der Firma"
            />
          </div>

          <div className="space-y-2">
            <Label>Dokument-URL</Label>
            <Input
              value={formData.document_url}
              onChange={(e) => setFormData((f) => ({ ...f, document_url: e.target.value }))}
              placeholder="https://..."
            />
          </div>

          <div className="space-y-2">
            <Label>Notizen</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Zusätzliche Informationen zur Rechnung..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!formData.amount || !formData.contractor_name || createInvoice.isPending}
          >
            {createInvoice.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Rechnung erstellen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
