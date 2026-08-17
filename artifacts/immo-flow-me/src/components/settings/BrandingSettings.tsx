import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Palette, Image, Mail, Building2, Loader2, Check, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import { useOrganization, useUpdateOrganization } from '@/hooks/useOrganization';
import { useToast } from '@/hooks/use-toast';

const brandingSchema = z.object({
  brandName: z.string().optional(),
  logoUrl: z.string().url('Ungültige URL').or(z.literal('')).optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Ungültiges Farbformat (z.B. #1e40af)').or(z.literal('')).optional(),
  supportEmail: z.string().email('Ungültige E-Mail-Adresse').or(z.literal('')).optional(),
});

type BrandingFormData = z.infer<typeof brandingSchema>;

export function BrandingSettings() {
  const { data: organization, isLoading } = useOrganization();
  const updateOrganization = useUpdateOrganization();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewColor, setPreviewColor] = useState('#1e40af');

  const form = useForm<BrandingFormData>({
    resolver: zodResolver(brandingSchema),
    defaultValues: {
      brandName: '',
      logoUrl: '',
      primaryColor: '',
      supportEmail: '',
    },
  });

  useEffect(() => {
    if (organization) {
      form.reset({
        brandName: (organization as any).brandName || (organization as any).brand_name || '',
        logoUrl: (organization as any).logoUrl || (organization as any).logo_url || '',
        primaryColor: (organization as any).primaryColor || (organization as any).primary_color || '',
        supportEmail: (organization as any).supportEmail || (organization as any).support_email || '',
      });
      const color = (organization as any).primaryColor || (organization as any).primary_color;
      if (color) {
        setPreviewColor(color);
      }
    }
  }, [organization, form]);

  const onSubmit = async (data: BrandingFormData) => {
    if (!organization) return;

    setIsSubmitting(true);
    try {
      await updateOrganization.mutateAsync({
        id: organization.id,
        brand_name: data.brandName || null,
        logo_url: data.logoUrl || null,
        primary_color: data.primaryColor || null,
        support_email: data.supportEmail || null,
      } as any);
      toast({
        title: 'Branding gespeichert',
        description: 'Ihre Branding-Einstellungen wurden aktualisiert.',
      });
    } catch (error) {
      toast({
        title: 'Fehler',
        description: 'Branding konnte nicht gespeichert werden.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-48">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            White-Label Branding
          </CardTitle>
          <CardDescription>
            Passen Sie das Erscheinungsbild der Software für Ihre Kunden an
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="brandName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Building2 className="h-4 w-4" />
                      Markenname
                    </FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Meine Hausverwaltung" 
                        {...field} 
                        data-testid="input-brand-name"
                      />
                    </FormControl>
                    <FormDescription>
                      Dieser Name wird anstelle von "ImmoFlowMe" angezeigt
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="logoUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Image className="h-4 w-4" />
                      Logo-URL
                    </FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="https://example.com/logo.png" 
                        {...field}
                        data-testid="input-logo-url"
                      />
                    </FormControl>
                    <FormDescription>
                      URL zu Ihrem Firmenlogo (PNG oder SVG empfohlen, max. 200x60px)
                    </FormDescription>
                    <FormMessage />
                    {field.value && (
                      <div className="mt-2 p-4 border rounded-lg bg-muted/50">
                        <p className="text-sm text-muted-foreground mb-2">Vorschau:</p>
                        <img 
                          src={field.value} 
                          alt="Logo Vorschau" 
                          className="h-12 max-w-[200px] object-contain"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                    )}
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="primaryColor"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Palette className="h-4 w-4" />
                      Primärfarbe
                    </FormLabel>
                    <div className="flex gap-2">
                      <FormControl>
                        <Input 
                          placeholder="#1e40af" 
                          {...field}
                          onChange={(e) => {
                            field.onChange(e);
                            if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
                              setPreviewColor(e.target.value);
                            }
                          }}
                          data-testid="input-primary-color"
                        />
                      </FormControl>
                      <div 
                        className="w-10 h-10 rounded-md border flex-shrink-0"
                        style={{ backgroundColor: previewColor }}
                      />
                    </div>
                    <FormDescription>
                      Hex-Farbcode für Buttons und Akzente (z.B. #1e40af für Blau)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="supportEmail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      Support-E-Mail
                    </FormLabel>
                    <FormControl>
                      <Input 
                        type="email"
                        placeholder="support@meinefirma.at" 
                        {...field}
                        data-testid="input-support-email"
                      />
                    </FormControl>
                    <FormDescription>
                      Wird für Support-Anfragen und in E-Mails angezeigt
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex gap-3 pt-4">
                <Button type="submit" disabled={isSubmitting} data-testid="button-save-branding">
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4 mr-2" />
                  )}
                  Speichern
                </Button>
                <Button 
                  type="button" 
                  variant="outline"
                  onClick={() => form.reset()}
                  disabled={isSubmitting}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Zurücksetzen
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vorschau</CardTitle>
          <CardDescription>So sehen Ihre Kunden die Software</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg p-4 bg-muted/30">
            <div className="flex items-center gap-3 mb-4">
              {form.watch('logoUrl') ? (
                <img 
                  src={form.watch('logoUrl')} 
                  alt="Logo" 
                  className="h-8 max-w-[150px] object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : (
                <div 
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-white font-bold"
                  style={{ backgroundColor: previewColor }}
                >
                  {(form.watch('brandName') || 'I')[0].toUpperCase()}
                </div>
              )}
              <span className="font-semibold text-lg">
                {form.watch('brandName') || 'ImmoFlowMe'}
              </span>
            </div>
            <div className="flex gap-2">
              <Button 
                size="sm"
                style={{ backgroundColor: previewColor }}
                className="text-white"
              >
                Beispiel-Button
              </Button>
              <Button size="sm" variant="outline">
                Sekundär
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
