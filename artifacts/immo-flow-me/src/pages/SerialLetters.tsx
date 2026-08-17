import { useState, useMemo } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useProperties } from '@/hooks/useProperties';
import { useUnits } from '@/hooks/useUnits';
import { useTenants } from '@/hooks/useTenants';
import { useOrganization } from '@/hooks/useOrganization';
import { useLetterTemplates, useCreateLetterTemplate, useDeleteLetterTemplate, useSerialLetters, useCreateSerialLetter } from '@/hooks/useLetterTemplates';
import { generateSerialLetterPdf } from '@/utils/serialLetterPdfExport';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  Mail, FileText, Plus, Send, Download, Trash2, Loader2, Copy, Users
} from 'lucide-react';

const DEFAULT_TEMPLATES = [
  {
    name: 'Indexanpassung',
    category: 'miete',
    subject: 'Mitteilung über Mietanpassung gemäß Indexklausel',
    body: `Sehr geehrte/r {{name}},

wir teilen Ihnen mit, dass aufgrund der Veränderung des Verbraucherpreisindex (VPI) eine Anpassung Ihrer monatlichen Miete gemäß den Bestimmungen Ihres Mietvertrages erforderlich wird.

Die neue monatliche Vorschreibung gilt ab dem nächsten Zinstermin.

Für Rückfragen stehen wir Ihnen gerne zur Verfügung.

Mit freundlichen Grüßen`,
  },
  {
    name: 'Hausordnung',
    category: 'allgemein',
    subject: 'Aktualisierte Hausordnung',
    body: `Sehr geehrte/r {{name}},

anbei übermitteln wir Ihnen die aktualisierte Hausordnung für das Objekt {{einheit}}.

Bitte beachten Sie die Änderungen und halten Sie die Bestimmungen ein.

Bei Fragen wenden Sie sich bitte an die Hausverwaltung.

Mit freundlichen Grüßen`,
  },
  {
    name: 'Wartungsankündigung',
    category: 'wartung',
    subject: 'Ankündigung: Wartungsarbeiten',
    body: `Sehr geehrte/r {{name}},

wir möchten Sie darüber informieren, dass in Ihrer Liegenschaft Wartungsarbeiten durchgeführt werden.

Bitte stellen Sie sicher, dass der Zugang zu den betroffenen Bereichen gewährleistet ist.

Für Rückfragen stehen wir Ihnen gerne zur Verfügung.

Mit freundlichen Grüßen`,
  },
];

export default function SerialLetters() {
  const { toast } = useToast();
  const { data: properties } = useProperties();
  const { data: units } = useUnits();
  const { data: tenants } = useTenants();
  const { data: organization } = useOrganization();
  const { data: templates, isLoading: templatesLoading } = useLetterTemplates();
  const { data: history } = useSerialLetters();
  const createTemplate = useCreateLetterTemplate();
  const deleteTemplate = useDeleteLetterTemplate();
  const createSerialLetter = useCreateSerialLetter();

  const [showCompose, setShowCompose] = useState(false);
  const [showNewTemplate, setShowNewTemplate] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sendVia, setSendVia] = useState<'pdf' | 'email' | 'both'>('pdf');
  const [isSending, setIsSending] = useState(false);

  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateCategory, setNewTemplateCategory] = useState('allgemein');
  const [newTemplateSubject, setNewTemplateSubject] = useState('');
  const [newTemplateBody, setNewTemplateBody] = useState('');

  const propertyTenants = useMemo(() => {
    if (!selectedPropertyId || !tenants || !units) return [];
    const propertyUnits = units.filter(u => u.property_id === selectedPropertyId);
    const unitIds = propertyUnits.map(u => u.id);
    return tenants
      .filter(t => unitIds.includes(t.unit_id) && t.status === 'aktiv')
      .map(t => {
        const unit = propertyUnits.find(u => u.id === t.unit_id);
        return { ...t, unit };
      });
  }, [selectedPropertyId, tenants, units]);

  const selectedProperty = properties?.find(p => p.id === selectedPropertyId);

  const applyTemplate = (template: { subject: string; body: string }) => {
    setSubject(template.subject);
    setBody(template.body);
  };

  const handleSaveTemplate = async () => {
    if (!organization?.id || !newTemplateName || !newTemplateSubject || !newTemplateBody) return;
    await createTemplate.mutateAsync({
      organization_id: organization.id,
      name: newTemplateName,
      category: newTemplateCategory,
      subject: newTemplateSubject,
      body: newTemplateBody,
    });
    setShowNewTemplate(false);
    setNewTemplateName('');
    setNewTemplateCategory('allgemein');
    setNewTemplateSubject('');
    setNewTemplateBody('');
  };

  const handleSend = async () => {
    if (!selectedPropertyId || !subject || !body || propertyTenants.length === 0) {
      toast({ title: 'Fehler', description: 'Bitte Liegenschaft, Betreff und Text ausfüllen.', variant: 'destructive' });
      return;
    }
    setIsSending(true);
    try {
      const recipients = propertyTenants.map(t => ({
        name: `${t.first_name} ${t.last_name}`,
        address: selectedProperty ? `${selectedProperty.address}, ${selectedProperty.postal_code} ${selectedProperty.city}` : '',
        unit: `Top ${t.unit?.top_nummer || '?'}`,
      }));

      if (sendVia === 'pdf' || sendVia === 'both') {
        const doc = generateSerialLetterPdf(recipients, {
          subject,
          body,
          senderName: organization?.name || 'Hausverwaltung',
          senderAddress: selectedProperty ? `${selectedProperty.address}, ${selectedProperty.postal_code} ${selectedProperty.city}` : '',
          date: new Date().toISOString(),
        });
        doc.save(`Serienbrief_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
      }

      if (sendVia === 'email' || sendVia === 'both') {
        for (const t of propertyTenants) {
          if (t.email) {
            const personalizedBody = body
              .replace(/\{\{name\}\}/g, `${t.first_name} ${t.last_name}`)
              .replace(/\{\{einheit\}\}/g, `Top ${t.unit?.top_nummer || '?'}`)
              .replace(/\{\{datum\}\}/g, format(new Date(), 'dd.MM.yyyy'));
            await apiRequest('POST', '/api/functions/send-message', {
              recipientEmail: t.email,
              subject,
              messageBody: personalizedBody,
            });
          }
        }
      }

      if (organization?.id) {
        await createSerialLetter.mutateAsync({
          organization_id: organization.id,
          property_id: selectedPropertyId,
          subject,
          body,
          recipient_count: propertyTenants.length,
          sent_via: sendVia,
          sent_at: new Date().toISOString(),
        });
      }

      toast({ title: 'Serienbrief versendet', description: `${propertyTenants.length} Empfänger` });
      setShowCompose(false);
      setSubject('');
      setBody('');
    } catch (error) {
      toast({ title: 'Fehler', description: 'Beim Versand ist ein Fehler aufgetreten.', variant: 'destructive' });
    } finally {
      setIsSending(false);
    }
  };

  const allTemplates = [
    ...DEFAULT_TEMPLATES.map(t => ({ ...t, id: `default-${t.name}`, isDefault: true })),
    ...(templates || []).map(t => ({ ...t, isDefault: false })),
  ];

  return (
    <MainLayout title="Serienbriefe" subtitle="Rundschreiben an Mieter versenden">
      <div className="space-y-6">
        <div className="flex justify-end">
          <Button onClick={() => setShowCompose(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Neuer Serienbrief
          </Button>
        </div>

        <Tabs defaultValue="templates">
          <TabsList>
            <TabsTrigger value="templates">Vorlagen</TabsTrigger>
            <TabsTrigger value="history">Verlauf</TabsTrigger>
          </TabsList>

          <TabsContent value="templates">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {allTemplates.map((template) => (
                <Card key={template.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{template.name}</CardTitle>
                      <Badge variant="outline">{template.category}</Badge>
                    </div>
                    <CardDescription className="line-clamp-1">{template.subject}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground line-clamp-3 mb-4">{template.body}</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { applyTemplate(template); setShowCompose(true); }}>
                        <Copy className="h-3 w-3 mr-1" /> Verwenden
                      </Button>
                      {!template.isDefault && (
                        <Button size="sm" variant="ghost" onClick={() => deleteTemplate.mutate(template.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
              <Card className="border-dashed cursor-pointer hover:bg-muted/50" onClick={() => setShowNewTemplate(true)}>
                <CardContent className="flex flex-col items-center justify-center h-full py-12">
                  <Plus className="h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">Neue Vorlage erstellen</p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="history">
            {!history || history.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Mail className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-lg font-medium">Keine Serienbriefe</p>
                  <p className="text-muted-foreground text-sm">Noch keine Rundschreiben versendet.</p>
                </CardContent>
              </Card>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Datum</TableHead>
                    <TableHead>Betreff</TableHead>
                    <TableHead>Empfänger</TableHead>
                    <TableHead>Versand</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map(letter => (
                    <TableRow key={letter.id}>
                      <TableCell>{letter.sent_at ? format(new Date(letter.sent_at), 'dd.MM.yyyy', { locale: de }) : '-'}</TableCell>
                      <TableCell className="font-medium">{letter.subject}</TableCell>
                      <TableCell>{letter.recipient_count}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {letter.sent_via === 'email' ? 'E-Mail' : letter.sent_via === 'both' ? 'PDF + E-Mail' : 'PDF'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Compose Dialog */}
      <Dialog open={showCompose} onOpenChange={setShowCompose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Serienbrief erstellen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Liegenschaft</Label>
              <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId}>
                <SelectTrigger><SelectValue placeholder="Liegenschaft wählen..." /></SelectTrigger>
                <SelectContent>
                  {properties?.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name} – {p.address}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPropertyId && (
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {propertyTenants.length} aktive Mieter als Empfänger
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Betreff</Label>
              <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Betreff des Schreibens" />
            </div>

            <div className="space-y-2">
              <Label>Text</Label>
              <Textarea value={body} onChange={e => setBody(e.target.value)} rows={10} placeholder="Brieftext... Platzhalter: {{name}}, {{einheit}}, {{datum}}" />
              <p className="text-xs text-muted-foreground">
                Verfügbare Platzhalter: {'{{name}}'}, {'{{einheit}}'}, {'{{datum}}'}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Versandart</Label>
              <Select value={sendVia} onValueChange={(v: any) => setSendVia(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pdf">Nur PDF-Download</SelectItem>
                  <SelectItem value="email">Nur E-Mail-Versand</SelectItem>
                  <SelectItem value="both">PDF + E-Mail</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCompose(false)}>Abbrechen</Button>
            <Button onClick={handleSend} disabled={isSending || !selectedPropertyId || !subject || !body}>
              {isSending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              {sendVia === 'pdf' ? 'PDF erstellen' : 'Versenden'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Template Dialog */}
      <Dialog open={showNewTemplate} onOpenChange={setShowNewTemplate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neue Vorlage</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={newTemplateName} onChange={e => setNewTemplateName(e.target.value)} placeholder="Vorlagenname" />
            </div>
            <div className="space-y-2">
              <Label>Kategorie</Label>
              <Select value={newTemplateCategory} onValueChange={setNewTemplateCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="allgemein">Allgemein</SelectItem>
                  <SelectItem value="miete">Miete</SelectItem>
                  <SelectItem value="wartung">Wartung</SelectItem>
                  <SelectItem value="recht">Rechtlich</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Betreff</Label>
              <Input value={newTemplateSubject} onChange={e => setNewTemplateSubject(e.target.value)} placeholder="Betreff" />
            </div>
            <div className="space-y-2">
              <Label>Text</Label>
              <Textarea value={newTemplateBody} onChange={e => setNewTemplateBody(e.target.value)} rows={6} placeholder="Brieftext..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewTemplate(false)}>Abbrechen</Button>
            <Button onClick={handleSaveTemplate} disabled={!newTemplateName || !newTemplateSubject || !newTemplateBody}>
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
