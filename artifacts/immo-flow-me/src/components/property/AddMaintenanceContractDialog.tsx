import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import {
  useCreateMaintenanceContract,
  useUpdateMaintenanceContract,
  CONTRACT_TYPES,
  MaintenanceContract,
} from '@/hooks/useMaintenanceContracts';

interface AddMaintenanceContractDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  editContract?: MaintenanceContract;
}

interface FormData {
  contract_type: string;
  title: string;
  description: string;
  contractor_name: string;
  contractor_contact: string;
  contractor_email: string;
  interval_months: number;
  next_due_date: Date | undefined;
  reminder_days: number;
  estimated_cost: string;
  contract_fee: string;
  notes: string;
}

const initialFormData: FormData = {
  contract_type: '',
  title: '',
  description: '',
  contractor_name: '',
  contractor_contact: '',
  contractor_email: '',
  interval_months: 12,
  next_due_date: undefined,
  reminder_days: 30,
  estimated_cost: '',
  contract_fee: '',
  notes: '',
};

export function AddMaintenanceContractDialog({
  open,
  onOpenChange,
  propertyId,
  editContract,
}: AddMaintenanceContractDialogProps) {
  const createContract = useCreateMaintenanceContract();
  const updateContract = useUpdateMaintenanceContract();
  const [formData, setFormData] = useState<FormData>(initialFormData);

  const isEditing = !!editContract;

  useEffect(() => {
    if (editContract) {
      setFormData({
        contract_type: editContract.contract_type,
        title: editContract.title,
        description: editContract.description || '',
        contractor_name: editContract.contractor_name || '',
        contractor_contact: editContract.contractor_contact || '',
        contractor_email: editContract.contractor_email || '',
        interval_months: editContract.interval_months,
        next_due_date: editContract.next_due_date ? new Date(editContract.next_due_date) : undefined,
        reminder_days: editContract.reminder_days,
        estimated_cost: editContract.estimated_cost?.toString() || '',
        contract_fee: editContract.contract_fee?.toString() || '',
        notes: editContract.notes || '',
      });
    } else {
      setFormData(initialFormData);
    }
  }, [editContract, open]);

  const handleTypeChange = (type: string) => {
    const contractType = CONTRACT_TYPES.find((t) => t.value === type);
    setFormData((prev) => ({
      ...prev,
      contract_type: type,
      title: prev.title || contractType?.label || '',
      interval_months: contractType?.defaultInterval || 12,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.contract_type || !formData.title || !formData.next_due_date) {
      return;
    }

    const contractData = {
      property_id: propertyId,
      contract_type: formData.contract_type,
      title: formData.title,
      description: formData.description || undefined,
      contractor_name: formData.contractor_name || undefined,
      contractor_contact: formData.contractor_contact || undefined,
      contractor_email: formData.contractor_email || undefined,
      interval_months: formData.interval_months,
      next_due_date: format(formData.next_due_date, 'yyyy-MM-dd'),
      reminder_days: formData.reminder_days,
      estimated_cost: formData.estimated_cost ? parseFloat(formData.estimated_cost) : undefined,
      contract_fee: formData.contract_fee ? parseFloat(formData.contract_fee) : undefined,
      notes: formData.notes || undefined,
    };

    try {
      if (isEditing) {
        await updateContract.mutateAsync({ id: editContract.id, ...contractData });
      } else {
        await createContract.mutateAsync(contractData);
      }
      onOpenChange(false);
      setFormData(initialFormData);
    } catch (error) {
      // Error handled in hook
    }
  };

  const isPending = createContract.isPending || updateContract.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Wartungsvertrag bearbeiten' : 'Neuen Wartungsvertrag anlegen'}
          </DialogTitle>
          <DialogDescription>
            Legen Sie einen wiederkehrenden Wartungstermin an. Sie werden automatisch vor
            Fälligkeit erinnert.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type & Title */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="contract_type">Wartungstyp *</Label>
              <Select value={formData.contract_type} onValueChange={handleTypeChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Typ auswählen..." />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  {CONTRACT_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">Titel *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="z.B. Jährliche Aufzugsprüfung"
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Beschreibung</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Optionale Beschreibung..."
              rows={2}
            />
          </div>

          {/* Contractor Info */}
          <div className="rounded-lg border border-border p-4 space-y-4">
            <h4 className="font-medium text-sm">Vertragspartner</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="contractor_name">Firma/Name</Label>
                <Input
                  id="contractor_name"
                  value={formData.contractor_name}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, contractor_name: e.target.value }))
                  }
                  placeholder="z.B. Aufzugtechnik Müller"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contractor_contact">Telefon</Label>
                <Input
                  id="contractor_contact"
                  value={formData.contractor_contact}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, contractor_contact: e.target.value }))
                  }
                  placeholder="+43 1 234 5678"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="contractor_email">E-Mail</Label>
              <Input
                id="contractor_email"
                type="email"
                value={formData.contractor_email}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, contractor_email: e.target.value }))
                }
                placeholder="kontakt@firma.at"
              />
            </div>
          </div>

          {/* Interval & Dates */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="interval_months">Intervall (Monate) *</Label>
              <Input
                id="interval_months"
                type="number"
                min="1"
                max="120"
                value={formData.interval_months}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    interval_months: parseInt(e.target.value) || 12,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Nächster Termin *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !formData.next_due_date && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.next_due_date
                      ? format(formData.next_due_date, 'dd.MM.yyyy', { locale: de })
                      : 'Datum wählen'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-popover" align="start">
                  <Calendar
                    mode="single"
                    selected={formData.next_due_date}
                    onSelect={(date) => setFormData((prev) => ({ ...prev, next_due_date: date }))}
                    locale={de}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reminder_days">Erinnerung (Tage vorher)</Label>
              <Input
                id="reminder_days"
                type="number"
                min="1"
                max="365"
                value={formData.reminder_days}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    reminder_days: parseInt(e.target.value) || 30,
                  }))
                }
              />
            </div>
          </div>

          {/* Costs */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="estimated_cost">Geschätzte Kosten (€)</Label>
              <Input
                id="estimated_cost"
                type="number"
                step="0.01"
                min="0"
                value={formData.estimated_cost}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, estimated_cost: e.target.value }))
                }
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contract_fee">Vertragsgebühr (€/Jahr)</Label>
              <Input
                id="contract_fee"
                type="number"
                step="0.01"
                min="0"
                value={formData.contract_fee}
                onChange={(e) => setFormData((prev) => ({ ...prev, contract_fee: e.target.value }))}
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notizen</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Zusätzliche Informationen..."
              rows={2}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button
              type="submit"
              disabled={isPending || !formData.contract_type || !formData.title || !formData.next_due_date}
            >
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEditing ? 'Speichern' : 'Erstellen'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
