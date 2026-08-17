import { useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Mail, Shield, Building2, Calculator, Eye } from 'lucide-react';
import { 
  useCreateInvite, 
  AppRole, 
  ROLE_LABELS, 
  ROLE_DESCRIPTIONS 
} from '@/hooks/useOrganizationInvites';

const inviteSchema = z.object({
  email: z.string().email('Bitte geben Sie eine gültige E-Mail-Adresse ein'),
  role: z.enum(['admin', 'property_manager', 'finance', 'viewer'] as const),
});

type InviteFormData = z.infer<typeof inviteSchema>;

interface InviteUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ROLE_ICONS: Record<AppRole, typeof Shield> = {
  admin: Shield,
  property_manager: Building2,
  finance: Calculator,
  viewer: Eye,
  tester: Eye,
};

export function InviteUserDialog({ open, onOpenChange }: InviteUserDialogProps) {
  const createInvite = useCreateInvite();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<InviteFormData>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: '',
      role: 'viewer',
    },
  });

  const selectedRole = form.watch('role');
  const RoleIcon = ROLE_ICONS[selectedRole];

  const onSubmit = async (data: InviteFormData) => {
    setIsSubmitting(true);
    try {
      await createInvite.mutateAsync({
        email: data.email,
        role: data.role,
      });
      form.reset();
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Benutzer einladen
          </DialogTitle>
          <DialogDescription>
            Laden Sie einen neuen Benutzer zu Ihrer Organisation ein
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>E-Mail-Adresse *</FormLabel>
                  <FormControl>
                    <Input 
                      type="email"
                      placeholder="buchhalter@firma.at" 
                      {...field} 
                    />
                  </FormControl>
                  <FormDescription>
                    Der Benutzer erhält eine E-Mail mit einem Registrierungslink
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Rolle *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Rolle auswählen" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(Object.keys(ROLE_LABELS) as AppRole[]).map((role) => {
                        const Icon = ROLE_ICONS[role];
                        return (
                          <SelectItem key={role} value={role}>
                            <div className="flex items-center gap-2">
                              <Icon className="h-4 w-4" />
                              {ROLE_LABELS[role]}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Role description card */}
            <div className="rounded-lg border bg-muted/50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <RoleIcon className="h-5 w-5 text-primary" />
                <span className="font-medium">{ROLE_LABELS[selectedRole]}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {ROLE_DESCRIPTIONS[selectedRole]}
              </p>
            </div>

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
                Einladung senden
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
