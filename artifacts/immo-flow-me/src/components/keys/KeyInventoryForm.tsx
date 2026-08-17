import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useProperties } from '@/hooks/useProperties';
import { useUnits } from '@/hooks/useUnits';
import { useCreateKeyInventory, useUpdateKeyInventory, KeyInventoryItem } from '@/hooks/useKeys';
import { useMemo, useEffect } from 'react';

const keyTypes = [
  { value: 'hauptschluessel', label: 'Haupteingang' },
  { value: 'wohnungsschluessel', label: 'Wohnung' },
  { value: 'kellerschluessel', label: 'Keller' },
  { value: 'garagenschluessel', label: 'Garage' },
  { value: 'briefkastenschluessel', label: 'Briefkasten' },
  { value: 'sonstiges', label: 'Sonstiges' },
];

const formSchema = z.object({
  property_id: z.string().min(1, 'Liegenschaft ist erforderlich'),
  unit_id: z.string().optional().nullable(),
  key_type: z.enum(['hauptschluessel', 'wohnungsschluessel', 'kellerschluessel', 'garagenschluessel', 'briefkastenschluessel', 'sonstiges']),
  key_number: z.string().optional(),
  total_count: z.coerce.number().min(1, 'Mindestens 1 Schlüssel'),
  available_count: z.coerce.number().min(0, 'Kann nicht negativ sein'),
  description: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface KeyInventoryFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingKey?: KeyInventoryItem | null;
}

export function KeyInventoryForm({ open, onOpenChange, editingKey }: KeyInventoryFormProps) {
  const { data: properties } = useProperties();
  const { data: allUnits } = useUnits();
  const createKey = useCreateKeyInventory();
  const updateKey = useUpdateKeyInventory();
  
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      property_id: '',
      unit_id: null,
      key_type: 'hauptschluessel',
      key_number: '',
      total_count: 1,
      available_count: 1,
      description: '',
      notes: '',
    },
  });
  
  useEffect(() => {
    if (editingKey) {
      form.reset({
        property_id: editingKey.property_id || '',
        unit_id: editingKey.unit_id || null,
        key_type: (editingKey.key_type as FormValues['key_type']) || 'hauptschluessel',
        key_number: editingKey.key_number || '',
        total_count: editingKey.total_count || 1,
        available_count: editingKey.available_count || 1,
        description: editingKey.description || '',
        notes: editingKey.notes || '',
      });
    } else {
      form.reset({
        property_id: '',
        unit_id: null,
        key_type: 'hauptschluessel',
        key_number: '',
        total_count: 1,
        available_count: 1,
        description: '',
        notes: '',
      });
    }
  }, [editingKey, form]);
  
  const selectedPropertyId = form.watch('property_id');
  
  const filteredUnits = useMemo(() => {
    if (!selectedPropertyId || !allUnits) return [];
    return allUnits.filter(unit => unit.property_id === selectedPropertyId);
  }, [selectedPropertyId, allUnits]);
  
  const onSubmit = async (values: FormValues) => {
    try {
      if (editingKey) {
        await updateKey.mutateAsync({ 
          id: editingKey.id, 
          property_id: values.property_id,
          unit_id: values.unit_id || null,
          key_type: values.key_type,
          key_number: values.key_number || null,
          total_count: values.total_count,
          available_count: values.available_count,
          description: values.description || null,
          notes: values.notes || null,
        });
      } else {
        await createKey.mutateAsync({
          property_id: values.property_id,
          unit_id: values.unit_id || null,
          key_type: values.key_type,
          key_number: values.key_number || null,
          total_count: values.total_count,
          available_count: values.available_count,
          description: values.description || null,
          notes: values.notes || null,
        });
      }
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
            {editingKey ? 'Schlüssel bearbeiten' : 'Neuer Schlüssel'}
          </DialogTitle>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="property_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Liegenschaft *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-property">
                        <SelectValue placeholder="Liegenschaft wählen" />
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
              name="unit_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Einheit (optional)</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || ''}>
                    <FormControl>
                      <SelectTrigger data-testid="select-unit">
                        <SelectValue placeholder="Keine spezifische Einheit" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="">Keine spezifische Einheit</SelectItem>
                      {filteredUnits.map((unit) => (
                        <SelectItem key={unit.id} value={unit.id}>
                          Top {unit.top_nummer}
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
              name="key_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Schlüsseltyp *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-key-type">
                        <SelectValue placeholder="Typ wählen" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {keyTypes.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
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
              name="key_number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Schlüsselnummer</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="z.B. HS-001" 
                      {...field} 
                      data-testid="input-key-number"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="total_count"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Gesamtanzahl *</FormLabel>
                    <FormControl>
                      <Input 
                        type="number" 
                        min={1} 
                        {...field} 
                        data-testid="input-total-count"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="available_count"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Verfügbar</FormLabel>
                    <FormControl>
                      <Input 
                        type="number" 
                        min={0} 
                        {...field} 
                        data-testid="input-available-count"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Beschreibung</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Optionale Beschreibung..." 
                      {...field} 
                      data-testid="textarea-description"
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
                disabled={createKey.isPending || updateKey.isPending}
                data-testid="button-save"
              >
                {createKey.isPending || updateKey.isPending ? 'Speichern...' : 'Speichern'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
