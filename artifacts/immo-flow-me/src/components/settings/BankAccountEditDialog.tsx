import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { 
  useCreateBankAccount, 
  useUpdateBankAccount, 
  BankAccount 
} from '@/hooks/useBankAccounts';

interface Property {
  id: string;
  name: string;
}

const bankAccountSchema = z.object({
  property_id: z.string().min(1, 'Bitte wählen Sie eine Liegenschaft'),
  account_name: z.string().min(1, 'Kontoname ist erforderlich'),
  bank_name: z.string().optional(),
  iban: z.string()
    .regex(/^[A-Z]{2}[0-9]{2}[A-Z0-9]{4,}$/, 'Ungültiges IBAN-Format (z.B. AT123456789012345678)')
    .or(z.literal('')),
  bic: z.string()
    .regex(/^[A-Z]{6}[A-Z0-9]{2,5}$/, 'Ungültiges BIC-Format (z.B. BKAUATWW)')
    .or(z.literal(''))
    .optional(),
});

type BankAccountFormData = z.infer<typeof bankAccountSchema>;

interface BankAccountEditDialogProps {
  account: BankAccount | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableProperties: Property[];
}

export function BankAccountEditDialog({
  account,
  open,
  onOpenChange,
  availableProperties,
}: BankAccountEditDialogProps) {
  const createBankAccount = useCreateBankAccount();
  const updateBankAccount = useUpdateBankAccount();
  const isEditing = !!account;

  const form = useForm<BankAccountFormData>({
    resolver: zodResolver(bankAccountSchema),
    defaultValues: {
      property_id: '',
      account_name: '',
      bank_name: '',
      iban: '',
      bic: '',
    },
  });

  useEffect(() => {
    if (account) {
      form.reset({
        property_id: (account as any).propertyId || '',
        account_name: (account as any).accountName || (account as any).account_name || '',
        bank_name: (account as any).bankName || (account as any).bank_name || '',
        iban: account.iban?.replace(/\s/g, '') || '',
        bic: account.bic || '',
      });
    } else {
      form.reset({
        property_id: availableProperties[0]?.id || '',
        account_name: '',
        bank_name: '',
        iban: '',
        bic: '',
      });
    }
  }, [account, availableProperties, form]);

  const onSubmit = async (data: BankAccountFormData) => {
    try {
      if (isEditing && account) {
        await updateBankAccount.mutateAsync({
          id: account.id,
          propertyId: data.property_id,
          accountName: data.account_name,
          bankName: data.bank_name || null,
          iban: data.iban || null,
          bic: data.bic || null,
        } as any);
      } else {
        await createBankAccount.mutateAsync({
          propertyId: data.property_id,
          accountName: data.account_name,
          bankName: data.bank_name || null,
          iban: data.iban || null,
          bic: data.bic || null,
        } as any);
      }
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving bank account:', error);
    }
  };

  const isSubmitting = createBankAccount.isPending || updateBankAccount.isPending;

  // Find the property for the current account to show in select
  const allPropertiesForSelect = isEditing && (account as any)?.propertyId
    ? [...availableProperties.filter(p => p.id !== (account as any).propertyId), 
       availableProperties.find(p => p.id === (account as any).propertyId) || { id: (account as any).propertyId, name: 'Aktuelle Liegenschaft' }].filter(Boolean)
    : availableProperties;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Bankkonto bearbeiten' : 'Neues Bankkonto'}
          </DialogTitle>
          <DialogDescription>
            {isEditing 
              ? 'Bearbeiten Sie die Bankdaten für diese Liegenschaft.'
              : 'Fügen Sie ein Treuhandkonto für eine Liegenschaft hinzu.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="property_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Liegenschaft *</FormLabel>
                  <Select 
                    onValueChange={field.onChange} 
                    value={field.value}
                    disabled={isEditing}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Liegenschaft auswählen" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {availableProperties.map((property) => (
                        <SelectItem key={property.id} value={property.id}>
                          {property.name}
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
              name="account_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Kontoname *</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="z.B. Treuhandkonto Bahnhofstraße" 
                      {...field} 
                    />
                  </FormControl>
                  <FormDescription>
                    Bezeichnung für das Konto
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="bank_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bank</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="z.B. Erste Bank" 
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="iban"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>IBAN</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="AT12 3456 7890 1234 5678" 
                      {...field}
                      onChange={(e) => {
                        // Remove spaces and convert to uppercase
                        const value = e.target.value.replace(/\s/g, '').toUpperCase();
                        field.onChange(value);
                      }}
                      className="font-mono"
                    />
                  </FormControl>
                  <FormDescription>
                    Internationale Bankkontonummer
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="bic"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>BIC/SWIFT</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="BKAUATWW" 
                      {...field}
                      onChange={(e) => {
                        // Convert to uppercase
                        field.onChange(e.target.value.toUpperCase());
                      }}
                      className="font-mono"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Abbrechen
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEditing ? 'Speichern' : 'Anlegen'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
