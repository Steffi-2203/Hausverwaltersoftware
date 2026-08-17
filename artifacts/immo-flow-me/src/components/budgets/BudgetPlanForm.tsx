import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useProperties } from '@/hooks/useProperties';
import { useCreateBudget, useUpdateBudget, PropertyBudget } from '@/hooks/useBudgets';
import { Loader2 } from 'lucide-react';

const formSchema = z.object({
  property_id: z.string().min(1, 'Bitte Liegenschaft auswählen'),
  year: z.number().min(2020).max(2100),
  position_1_name: z.string().optional(),
  position_1_amount: z.number().min(0).optional(),
  position_2_name: z.string().optional(),
  position_2_amount: z.number().min(0).optional(),
  position_3_name: z.string().optional(),
  position_3_amount: z.number().min(0).optional(),
  position_4_name: z.string().optional(),
  position_4_amount: z.number().min(0).optional(),
  position_5_name: z.string().optional(),
  position_5_amount: z.number().min(0).optional(),
  notes: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

interface BudgetPlanFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  budget?: PropertyBudget | null;
}

export function BudgetPlanForm({ open, onOpenChange, budget }: BudgetPlanFormProps) {
  const { data: properties, isLoading: propertiesLoading } = useProperties();
  const createBudget = useCreateBudget();
  const updateBudget = useUpdateBudget();

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear + i);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      property_id: budget?.property_id || '',
      year: budget?.year || currentYear + 1,
      position_1_name: budget?.position_1_name || '',
      position_1_amount: budget?.position_1_amount || 0,
      position_2_name: budget?.position_2_name || '',
      position_2_amount: budget?.position_2_amount || 0,
      position_3_name: budget?.position_3_name || '',
      position_3_amount: budget?.position_3_amount || 0,
      position_4_name: budget?.position_4_name || '',
      position_4_amount: budget?.position_4_amount || 0,
      position_5_name: budget?.position_5_name || '',
      position_5_amount: budget?.position_5_amount || 0,
      notes: budget?.notes || '',
    },
  });

  const onSubmit = async (data: FormData) => {
    try {
      if (budget) {
        await updateBudget.mutateAsync({ id: budget.id, data });
      } else {
        await createBudget.mutateAsync({
          property_id: data.property_id,
          year: data.year,
          ...data,
        });
      }
      onOpenChange(false);
      form.reset();
    } catch (error) {
      console.error('Error saving budget:', error);
    }
  };

  const isLoading = createBudget.isPending || updateBudget.isPending;
  const isEditing = !!budget;

  // Calculate total budget
  const watchedValues = form.watch();
  const totalBudget = 
    (watchedValues.position_1_amount || 0) +
    (watchedValues.position_2_amount || 0) +
    (watchedValues.position_3_amount || 0) +
    (watchedValues.position_4_amount || 0) +
    (watchedValues.position_5_amount || 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Budgetplan bearbeiten' : 'Neuen Budgetplan erstellen'}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="property_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Liegenschaft</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={isEditing || propertiesLoading}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Liegenschaft auswählen" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {properties?.map((property) => (
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
                name="year"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Jahr</FormLabel>
                    <Select
                      value={field.value?.toString()}
                      onValueChange={(v) => field.onChange(parseInt(v))}
                      disabled={isEditing}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Jahr auswählen" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {years.map((year) => (
                          <SelectItem key={year} value={year.toString()}>
                            {year}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-4">
              <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
                Budgetpositionen
              </h3>

              {[1, 2, 3, 4, 5].map((num) => (
                <div key={num} className="grid grid-cols-[1fr_150px] gap-3 items-end">
                  <FormField
                    control={form.control}
                    name={`position_${num}_name` as keyof FormData}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Position {num}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={`z.B. ${['Dachsanierung', 'Fassadenrenovierung', 'Heizungstausch', 'Fensteraustausch', 'Liftmodernisierung'][num - 1]}`}
                            {...field}
                            value={field.value?.toString() || ''}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`position_${num}_amount` as keyof FormData}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Betrag (€)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            step={100}
                            placeholder="0"
                            {...field}
                            value={field.value || ''}
                            onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              ))}

              <div className="flex justify-end pt-2 border-t">
                <div className="text-lg font-semibold">
                  Gesamtbudget: {totalBudget.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                </div>
              </div>
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notizen</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Optionale Anmerkungen zum Budgetplan..."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Abbrechen
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEditing ? 'Speichern' : 'Erstellen'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
