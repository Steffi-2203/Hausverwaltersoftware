import { useState } from 'react';
import { MessageSquarePlus, Lock, Sparkles, Loader2, Send, Mail, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useKiAutopilot } from '@/hooks/useKiAutopilot';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Link } from 'react-router-dom';

const templates = [
  { id: 'mieterhoehung', label: 'Mieterhöhung' },
  { id: 'kuendigung', label: 'Kündigung' },
  { id: 'bk_info', label: 'BK-Information' },
  { id: 'mahnung', label: 'Mahnung' },
  { id: 'wartung', label: 'Wartungsankündigung' },
  { id: 'allgemein', label: 'Allgemeine Mitteilung' },
];

export default function KiKommunikation() {
  const { isActive, isLoading: kiLoading } = useKiAutopilot();
  const { toast } = useToast();
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [selectedTenant, setSelectedTenant] = useState('');
  const [selectedProperty, setSelectedProperty] = useState('');
  const [notes, setNotes] = useState('');
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');

  const { data: tenants } = useQuery<any[]>({
    queryKey: ['/api/tenants'],
    enabled: isActive,
  });

  const { data: properties } = useQuery<any[]>({
    queryKey: ['/api/properties'],
    enabled: isActive,
  });

  if (kiLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isActive) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Lock className="h-8 w-8 text-muted-foreground" />
            </div>
            <CardTitle>KI-Autopilot erforderlich</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-muted-foreground">
              Der KI-Kommunikationsassistent ist Teil des KI-Autopilot Add-ons.
            </p>
            <Link to="/checkout?plan=ki-autopilot">
              <Button data-testid="button-upgrade-ki">
                <Sparkles className="mr-2 h-4 w-4" />
                KI-Autopilot aktivieren
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleGenerate = async () => {
    if (!selectedTemplate) {
      toast({ title: 'Vorlage wählen', description: 'Bitte wählen Sie eine E-Mail-Vorlage.', variant: 'destructive' });
      return;
    }

    setGenerating(true);
    try {
      const csrfMatch = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
      const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : null;

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (csrfToken) headers['x-csrf-token'] = csrfToken;

      const response = await fetch('/api/ki/generate-email', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          template: selectedTemplate,
          tenantId: selectedTenant || undefined,
          propertyId: selectedProperty || undefined,
          notes: notes || undefined,
        }),
      });

      if (!response.ok) throw new Error('Generierung fehlgeschlagen');

      const data = await response.json();
      setEmailSubject(data.subject || '');
      setEmailBody(data.body || '');

      if (selectedTenant && tenants) {
        const tenant = tenants.find((t: any) => t.id === selectedTenant);
        if (tenant?.email) setRecipientEmail(tenant.email);
      }
    } catch {
      toast({ title: 'Fehler', description: 'E-Mail konnte nicht generiert werden.', variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  const handleSend = async () => {
    if (!recipientEmail || !emailSubject || !emailBody) {
      toast({ title: 'Unvollständig', description: 'Bitte füllen Sie alle Felder aus.', variant: 'destructive' });
      return;
    }

    setSending(true);
    try {
      const csrfMatch = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
      const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : null;

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (csrfToken) headers['x-csrf-token'] = csrfToken;

      const response = await fetch('/api/ki/send-email', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          to: recipientEmail,
          subject: emailSubject,
          body: emailBody,
          tenantId: selectedTenant || undefined,
        }),
      });

      if (!response.ok) throw new Error('Senden fehlgeschlagen');

      toast({ title: 'Gesendet', description: 'Die E-Mail wurde erfolgreich versendet.' });
      setEmailSubject('');
      setEmailBody('');
      setRecipientEmail('');
      setNotes('');
    } catch {
      toast({ title: 'Fehler', description: 'E-Mail konnte nicht gesendet werden.', variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <MessageSquarePlus className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold" data-testid="text-ki-kommunikation-title">KI-Kommunikationsassistent</h1>
        <Badge variant="secondary">KI-Autopilot</Badge>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              E-Mail konfigurieren
            </CardTitle>
            <CardDescription>Wählen Sie eine Vorlage und passen Sie die Parameter an</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">Vorlage</label>
              <select
                value={selectedTemplate}
                onChange={e => setSelectedTemplate(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                data-testid="select-template"
              >
                <option value="">Vorlage wählen...</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium">Mieter</label>
              <select
                value={selectedTenant}
                onChange={e => setSelectedTenant(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                data-testid="select-tenant"
              >
                <option value="">Mieter wählen (optional)...</option>
                {tenants?.map((t: any) => (
                  <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium">Liegenschaft</label>
              <select
                value={selectedProperty}
                onChange={e => setSelectedProperty(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                data-testid="select-property"
              >
                <option value="">Liegenschaft wählen (optional)...</option>
                {properties?.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.address}, {p.city}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium">Zusätzliche Hinweise</label>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Optionale Details für die E-Mail..."
                data-testid="input-notes"
              />
            </div>

            <Button
              onClick={handleGenerate}
              disabled={generating || !selectedTemplate}
              className="w-full"
              data-testid="button-generate-email"
            >
              {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              E-Mail generieren
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Vorschau & Senden
            </CardTitle>
            <CardDescription>Überprüfen und bearbeiten Sie die generierte E-Mail</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">Empfänger E-Mail</label>
              <Input
                type="email"
                value={recipientEmail}
                onChange={e => setRecipientEmail(e.target.value)}
                placeholder="empfaenger@beispiel.at"
                data-testid="input-recipient-email"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Betreff</label>
              <Input
                value={emailSubject}
                onChange={e => setEmailSubject(e.target.value)}
                placeholder="Betreff wird automatisch generiert..."
                data-testid="input-email-subject"
              />
            </div>

            <div>
              <label className="text-sm font-medium">E-Mail-Text</label>
              <Textarea
                value={emailBody}
                onChange={e => setEmailBody(e.target.value)}
                placeholder="E-Mail-Text wird automatisch generiert..."
                className="min-h-[200px]"
                data-testid="textarea-email-body"
              />
            </div>

            <Button
              onClick={handleSend}
              disabled={sending || !emailSubject || !emailBody || !recipientEmail}
              className="w-full"
              data-testid="button-send-email"
            >
              {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              E-Mail senden
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
