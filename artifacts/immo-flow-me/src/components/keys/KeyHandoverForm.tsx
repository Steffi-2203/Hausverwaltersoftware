import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTenants } from '@/hooks/useTenants';
import { useCreateKeyHandover, KeyInventoryItem } from '@/hooks/useKeys';
import { format } from 'date-fns';

const formSchema = z.object({
  tenant_id: z.string().optional().nullable(),
  recipient_name: z.string().optional(),
  handover_date: z.string().min(1, 'Datum ist erforderlich'),
  return_date: z.string().optional().nullable(),
  quantity: z.coerce.number().min(1, 'Mindestens 1 Schlüssel'),
  status: z.enum(['vorhanden', 'ausgegeben', 'verloren', 'gesperrt']),
  handover_protocol: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface KeyHandoverFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keyItem: KeyInventoryItem;
  isReturn?: boolean;
}

export function KeyHandoverForm({ open, onOpenChange, keyItem, isReturn = false }: KeyHandoverFormProps) {
  const { data: tenants } = useTenants();
  const createHandover = useCreateKeyHandover();
  
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      tenant_id: null,
      recipient_name: '',
      handover_date: format(new Date(), 'yyyy-MM-dd'),
      return_date: isReturn ? format(new Date(), 'yyyy-MM-dd') : null,
      quantity: 1,
      status: isReturn ? 'vorhanden' : 'ausgegeben',
      handover_protocol: '',
      notes: '',
    },
  });
  
  const onSubmit = async (values: FormValues) => {
    try {
      await createHandover.mutateAsync({
        key_inventory_id: keyItem.id,
        tenant_id: values.tenant_id || null,
        recipient_name: values.recipient_name || null,
        handover_date: values.handover_date,
        return_date: values.return_date || null,
        quantity: values.quantity,
        status: values.status,
        handover_protocol: values.handover_protocol || null,
        notes: values.notes || null,
      });
      onOpenChange(false);
      form.reset();
    } catch (error) {
      console.error('Form submission error:', error);
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isReturn ? 'Schlüsselrückgabe' : 'Schlüsselübergabe'}
          </DialogTitle>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="tenant_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mieter</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || ''}>
                    <FormControl>
                      <SelectTrigger data-testid="select-tenant">
                        <SelectValue placeholder="Mieter wählen (optional)" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="">Kein Mieter</SelectItem>
                      {tenants?.map((tenant) => (
                        <SelectItem key={tenant.id} value={tenant.id}>
                          {tenant.first_name} {tenant.last_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="recipient_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Empfänger (falls kein Mieter)</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="Name des Empfängers" 
                      {...field} 
                      data-testid="input-recipient-name"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="handover_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{isReturn ? 'Rückgabedatum' : 'Übergabedatum'} *</FormLabel>
                    <FormControl>
                      <Input 
                        type="date" 
                        {...field} 
                        data-testid="input-handover-date"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Anzahl *</FormLabel>
                    <FormControl>
                      <Input 
                        type="number" 
                        min={1} 
                        max={keyItem.available_count || keyItem.total_count || 1}
                        {...field} 
                        data-testid="input-quantity"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-status">
                        <SelectValue placeholder="Status wählen" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="ausgegeben">Ausgegeben</SelectItem>
                      <SelectItem value="vorhanden">Vorhanden (Rückgabe)</SelectItem>
                      <SelectItem value="verloren">Verloren</SelectItem>
                      <SelectItem value="gesperrt">Gesperrt</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="handover_protocol"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Übergabeprotokoll</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="Protokollnummer oder -referenz" 
                      {...field} 
                      data-testid="input-protocol"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notizen</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Optionale Notizen..." 
                      {...field} 
                      data-testid="textarea-notes"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                data-testid="button-cancel"
              >
                Abbrechen
              </Button>
              <Button 
                type="submit" 
                disabled={createHandover.isPending}
                data-testid="button-save"
              >
                {createHandover.isPending ? 'Speichern...' : 'Speichern'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
