import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { Organization, useUpdateOrganization } from '@/hooks/useOrganization';
import { useUserRole } from '@/hooks/useUserRole';

const organizationSchema = z.object({
  name: z.string().min(2, 'Name muss mindestens 2 Zeichen haben'),
  iban: z.string()
    .regex(/^[A-Z]{2}[0-9]{2}[A-Z0-9]{4,30}$/, 'Ungültiges IBAN-Format')
    .or(z.literal(''))
    .optional(),
  bic: z.string()
    .regex(/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/, 'Ungültiges BIC-Format (8-11 Zeichen)')
    .or(z.literal(''))
    .optional(),
  sepa_creditor_id: z.string().optional(),
});

type OrganizationFormData = z.infer<typeof organizationSchema>;

interface OrganizationEditDialogProps {
  organization: Organization | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OrganizationEditDialog({
  organization,
  open,
  onOpenChange,
}: OrganizationEditDialogProps) {
  const { data: userRole } = useUserRole();
  const updateOrganization = useUpdateOrganization();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canEditFinancials = userRole === 'admin' || userRole === 'finance';

  const form = useForm<OrganizationFormData>({
    resolver: zodResolver(organizationSchema),
    defaultValues: {
      name: organization?.name || '',
      iban: organization?.iban || '',
      bic: organization?.bic || '',
      sepa_creditor_id: organization?.sepa_creditor_id || '',
    },
  });

  // Reset form when organization changes
  useEffect(() => {
    if (organization) {
      form.reset({
        name: organization.name || '',
        iban: organization.iban || '',
        bic: organization.bic || '',
        sepa_creditor_id: organization.sepa_creditor_id || '',
      });
    }
  }, [organization, form]);

  const onSubmit = async (data: OrganizationFormData) => {
    if (!organization) return;

    setIsSubmitting(true);
    try {
      await updateOrganization.mutateAsync({
        id: organization.id,
        name: data.name,
        iban: data.iban || null,
        bic: data.bic || null,
        sepa_creditor_id: data.sepa_creditor_id || null,
      });
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Organisation bearbeiten</DialogTitle>
          <DialogDescription>
            Ändern Sie die Daten Ihrer Organisation
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Organisationsname *</FormLabel>
                  <FormControl>
                    <Input placeholder="Meine Hausverwaltung GmbH" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {canEditFinancials && (
              <>
                <FormField
                  control={form.control}
                  name="iban"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>IBAN</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="AT61 1904 3002 3457 3201" 
                          {...field}
                          onChange={(e) => {
                            // Remove spaces and convert to uppercase
                            const value = e.target.value.replace(/\s/g, '').toUpperCase();
                            field.onChange(value);
                          }}
                        />
                      </FormControl>
                      <FormDescription>
                        Für SEPA-Lastschriften und Überweisungen
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
                      <FormLabel>BIC</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="BKAUATWW" 
                          {...field}
                          onChange={(e) => {
                            const value = e.target.value.toUpperCase();
                            field.onChange(value);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="sepa_creditor_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SEPA-Gläubiger-ID</FormLabel>
                      <FormControl>
                        <Input placeholder="AT98ZZZ00000012345" {...field} />
                      </FormControl>
                      <FormDescription>
                        Erforderlich für SEPA-Lastschrifteinzug
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Abbrechen
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Speichern
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
