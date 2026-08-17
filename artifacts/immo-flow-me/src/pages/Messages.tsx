import { useState, useMemo } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  MessageSquare,
  Plus,
  Loader2,
  Send,
  Mail,
  Phone,
  User,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Clock,
  Building2,
} from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { useTenants } from '@/hooks/useTenants';
import { useUnits } from '@/hooks/useUnits';
import { useProperties } from '@/hooks/useProperties';
import { useMessages, useSentMessages, useCreateMessage } from '@/hooks/useMessages';
import { useMaintenanceTasks } from '@/hooks/useMaintenanceTasks';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

export default function MessagesPage() {
  const permissions = usePermissions();
  const { data: allMessages, isLoading: allLoading } = useMessages();
  const { data: sentMessages, isLoading: sentLoading } = useSentMessages();
  const { data: tenants } = useTenants();
  const { data: units } = useUnits();
  const { data: properties } = useProperties();
  const { data: maintenanceTasks } = useMaintenanceTasks();
  const createMessage = useCreateMessage();

  const [showNewMessage, setShowNewMessage] = useState(false);
  const [activeTab, setActiveTab] = useState('all');

  const [newMessage, setNewMessage] = useState({
    property_id: '',
    recipient_type: 'tenant' as 'tenant' | 'contractor' | 'internal',
    tenant_id: '',
    contractor_id: '',
    recipient_name: '',
    recipient_email: '',
    recipient_phone: '',
    subject: '',
    message_body: '',
    message_type: 'email' as 'email' | 'sms' | 'both',
  });

  if (!permissions.canSendMessages && !permissions.isAdmin) {
    return (
      <MainLayout title="Keine Berechtigung" subtitle="">
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">
            Sie haben keine Berechtigung für diese Seite.
          </p>
        </div>
      </MainLayout>
    );
  }

  const activeTenants = tenants?.filter((t) => t.status === 'aktiv') || [];

  // Filter tenants based on selected property
  const filteredTenants = useMemo(() => {
    if (!newMessage.property_id) return [];
    const propertyUnits = units?.filter(u => u.property_id === newMessage.property_id) || [];
    const unitIds = propertyUnits.map(u => u.id);
    return activeTenants.filter(t => unitIds.includes(t.unit_id));
  }, [newMessage.property_id, units, activeTenants]);

  // Extract unique contractors from maintenance tasks for selected property
  const filteredContractors = useMemo(() => {
    if (!newMessage.property_id) return [];
    const contractorMap = new Map<string, { name: string; contact: string | null }>();
    
    maintenanceTasks
      ?.filter(t => t.property_id === newMessage.property_id && t.contractor_name)
      .forEach(task => {
        if (task.contractor_name && !contractorMap.has(task.contractor_name)) {
          contractorMap.set(task.contractor_name, {
            name: task.contractor_name,
            contact: task.contractor_contact
          });
        }
      });
    
    return Array.from(contractorMap.values());
  }, [newMessage.property_id, maintenanceTasks]);

  const handlePropertyChange = (propertyId: string) => {
    setNewMessage(m => ({
      ...m,
      property_id: propertyId,
      tenant_id: '',
      contractor_id: '',
      recipient_name: '',
      recipient_email: '',
      recipient_phone: ''
    }));
  };

  const handleContractorSelect = (contractorName: string) => {
    const contractor = filteredContractors.find(c => c.name === contractorName);
    if (contractor) {
      setNewMessage(m => ({
        ...m,
        contractor_id: contractorName,
        recipient_name: contractor.name,
        recipient_email: contractor.contact?.includes('@') ? contractor.contact : '',
        recipient_phone: contractor.contact && !contractor.contact.includes('@') ? contractor.contact : ''
      }));
    }
  };

  const handleTenantSelect = (tenantId: string) => {
    const tenant = tenants?.find((t) => t.id === tenantId);
    if (tenant) {
      setNewMessage((m) => ({
        ...m,
        tenant_id: tenantId,
        recipient_name: `${tenant.first_name} ${tenant.last_name}`,
        recipient_email: tenant.email || '',
        recipient_phone: tenant.phone || '',
      }));
    }
  };

  const handleSendMessage = async (asDraft: boolean = false) => {
    if (!newMessage.message_body.trim()) return;

    const tenant = tenants?.find((t) => t.id === newMessage.tenant_id);
    const unit = tenant ? units?.find((u) => u.id === tenant.unit_id) : null;

    await createMessage.mutateAsync({
      recipient_type: newMessage.recipient_type,
      recipient_name: newMessage.recipient_name || undefined,
      recipient_email: newMessage.recipient_email || undefined,
      recipient_phone: newMessage.recipient_phone || undefined,
      subject: newMessage.subject || undefined,
      message_body: newMessage.message_body,
      message_type: newMessage.message_type,
      tenant_id: newMessage.tenant_id || undefined,
      unit_id: unit?.id,
      status: asDraft ? 'draft' : 'sent',
    });

    setShowNewMessage(false);
    resetNewMessage();
  };

  const resetNewMessage = () => {
    setNewMessage({
      property_id: '',
      recipient_type: 'tenant',
      tenant_id: '',
      contractor_id: '',
      recipient_name: '',
      recipient_email: '',
      recipient_phone: '',
      subject: '',
      message_body: '',
      message_type: 'email',
    });
  };

  const getUnitInfo = (unitId: string | null) => {
    if (!unitId) return null;
    const unit = units?.find((u) => u.id === unitId);
    if (!unit) return null;
    const property = properties?.find((p) => p.id === unit.property_id);
    return { unit, property };
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'sent':
        return (
          <Badge className="bg-green-100 text-green-800">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Gesendet
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive">
            <AlertCircle className="h-3 w-3 mr-1" />
            Fehlgeschlagen
          </Badge>
        );
      default:
        return (
          <Badge variant="outline">
            <Clock className="h-3 w-3 mr-1" />
            Entwurf
          </Badge>
        );
    }
  };

  const displayMessages = activeTab === 'sent' ? sentMessages : allMessages;
  const isLoading = activeTab === 'sent' ? sentLoading : allLoading;

  // Statistics
  const stats = {
    total: allMessages?.length || 0,
    sent: allMessages?.filter((m) => m.status === 'sent').length || 0,
    draft: allMessages?.filter((m) => m.status === 'draft').length || 0,
    failed: allMessages?.filter((m) => m.status === 'failed').length || 0,
  };

  return (
    <MainLayout
      title="Nachrichten"
      subtitle="Kommunikation mit Mietern und Handwerkern"
    >
      {/* Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <MessageSquare className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Gesamt</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                <Send className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Gesendet</p>
                <p className="text-2xl font-bold">{stats.sent}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800">
                <Clock className="h-5 w-5 text-gray-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Entwürfe</p>
                <p className="text-2xl font-bold">{stats.draft}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                <AlertCircle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Fehlgeschlagen</p>
                <p className="text-2xl font-bold">{stats.failed}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs and Actions */}
      <div className="flex items-center justify-between mb-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="all">Alle</TabsTrigger>
            <TabsTrigger value="sent">Gesendet</TabsTrigger>
          </TabsList>
        </Tabs>

        <Button onClick={() => setShowNewMessage(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Neue Nachricht
        </Button>
      </div>

      {/* Messages List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !displayMessages || displayMessages.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">Keine Nachrichten</p>
            <p className="text-muted-foreground text-sm mt-1">
              Noch keine Nachrichten gesendet.
            </p>
            <Button className="mt-4" onClick={() => setShowNewMessage(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Erste Nachricht erstellen
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {displayMessages.map((message) => {
            const unitInfo = getUnitInfo(message.unit_id);

            return (
              <Card key={message.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <User className="h-5 w-5 text-muted-foreground" />
                      <span className="font-medium">
                        {message.recipient_name || 'Unbekannter Empfänger'}
                      </span>
                      {message.tenants && (
                        <span className="text-muted-foreground">
                          ({message.tenants.first_name} {message.tenants.last_name})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusBadge(message.status)}
                      <Badge variant="outline">
                        {message.message_type === 'email' ? (
                          <>
                            <Mail className="h-3 w-3 mr-1" />
                            E-Mail
                          </>
                        ) : message.message_type === 'sms' ? (
                          <>
                            <Phone className="h-3 w-3 mr-1" />
                            SMS
                          </>
                        ) : (
                          'E-Mail & SMS'
                        )}
                      </Badge>
                    </div>
                  </div>

                  {message.subject && (
                    <p className="font-medium mb-1">{message.subject}</p>
                  )}

                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                    {message.message_body}
                  </p>

                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <div className="flex items-center gap-4">
                      {unitInfo && (
                        <span>
                          {unitInfo.property?.name} – Top {unitInfo.unit.top_nummer}
                        </span>
                      )}
                      {message.recipient_email && (
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {message.recipient_email}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {message.sent_at
                        ? format(new Date(message.sent_at), 'dd.MM.yyyy HH:mm', { locale: de })
                        : format(new Date(message.created_at), 'dd.MM.yyyy HH:mm', { locale: de })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* New Message Dialog */}
      <Dialog open={showNewMessage} onOpenChange={setShowNewMessage}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Neue Nachricht</DialogTitle>
            <DialogDescription>
              Senden Sie eine E-Mail oder SMS an Mieter oder Handwerker.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Empfängertyp</Label>
              <RadioGroup
                value={newMessage.recipient_type}
                onValueChange={(value: 'tenant' | 'contractor' | 'internal') =>
                  setNewMessage((m) => ({ ...m, recipient_type: value }))
                }
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="tenant" id="tenant" />
                  <Label htmlFor="tenant" className="font-normal">
                    Mieter
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="contractor" id="contractor" />
                  <Label htmlFor="contractor" className="font-normal">
                    Handwerker
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="internal" id="internal" />
                  <Label htmlFor="internal" className="font-normal">
                    Intern
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Property dropdown - shown for tenant and contractor */}
            {(newMessage.recipient_type === 'tenant' || newMessage.recipient_type === 'contractor') && (
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Liegenschaft auswählen
                </Label>
                <Select
                  value={newMessage.property_id}
                  onValueChange={handlePropertyChange}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Liegenschaft auswählen..." />
                  </SelectTrigger>
                  <SelectContent className="bg-background z-50">
                    {properties?.map(property => (
                      <SelectItem key={property.id} value={property.id}>
                        {property.name} – {property.address}, {property.postal_code} {property.city}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Tenant dropdown - filtered by property */}
            {newMessage.recipient_type === 'tenant' && (
              <div className="space-y-2">
                <Label>Mieter auswählen</Label>
                <Select
                  value={newMessage.tenant_id}
                  onValueChange={handleTenantSelect}
                  disabled={!newMessage.property_id}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={
                      !newMessage.property_id 
                        ? "Erst Liegenschaft auswählen..." 
                        : filteredTenants.length === 0 
                          ? "Keine aktiven Mieter" 
                          : "Mieter auswählen..."
                    } />
                  </SelectTrigger>
                  <SelectContent className="bg-background z-50">
                    {filteredTenants.map((tenant) => {
                      const unit = units?.find((u) => u.id === tenant.unit_id);
                      return (
                        <SelectItem key={tenant.id} value={tenant.id}>
                          {tenant.first_name} {tenant.last_name}
                          {unit && ` – Top ${unit.top_nummer}`}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Contractor dropdown - filtered by property */}
            {newMessage.recipient_type === 'contractor' && (
              <div className="space-y-2">
                <Label>Handwerker auswählen</Label>
                <Select
                  value={newMessage.contractor_id}
                  onValueChange={handleContractorSelect}
                  disabled={!newMessage.property_id}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={
                      !newMessage.property_id 
                        ? "Erst Liegenschaft auswählen..." 
                        : filteredContractors.length === 0 
                          ? "Keine Handwerker gefunden – manuell eingeben" 
                          : "Handwerker auswählen..."
                    } />
                  </SelectTrigger>
                  <SelectContent className="bg-background z-50">
                    {filteredContractors.map((contractor) => (
                      <SelectItem key={contractor.name} value={contractor.name}>
                        {contractor.name}
                        {contractor.contact && ` (${contractor.contact})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                {/* Manual input if no contractors found or for new contractors */}
                {newMessage.property_id && (
                  <div className="grid grid-cols-2 gap-4 pt-2">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Oder manuell eingeben:</Label>
                      <Input
                        value={newMessage.recipient_name}
                        onChange={(e) =>
                          setNewMessage((m) => ({ ...m, recipient_name: e.target.value, contractor_id: '' }))
                        }
                        placeholder="Name des Handwerkers..."
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">E-Mail/Telefon:</Label>
                      <Input
                        value={newMessage.recipient_email || newMessage.recipient_phone}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val.includes('@')) {
                            setNewMessage((m) => ({ ...m, recipient_email: val, recipient_phone: '' }));
                          } else {
                            setNewMessage((m) => ({ ...m, recipient_phone: val, recipient_email: '' }));
                          }
                        }}
                        placeholder="E-Mail oder Telefon..."
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Internal recipient - manual input */}
            {newMessage.recipient_type === 'internal' && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={newMessage.recipient_name}
                    onChange={(e) =>
                      setNewMessage((m) => ({ ...m, recipient_name: e.target.value }))
                    }
                    placeholder="Name des Empfängers..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>E-Mail</Label>
                  <Input
                    type="email"
                    value={newMessage.recipient_email}
                    onChange={(e) =>
                      setNewMessage((m) => ({ ...m, recipient_email: e.target.value }))
                    }
                    placeholder="email@beispiel.at"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Nachrichtentyp</Label>
              <RadioGroup
                value={newMessage.message_type}
                onValueChange={(value: 'email' | 'sms' | 'both') =>
                  setNewMessage((m) => ({ ...m, message_type: value }))
                }
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="email" id="email" />
                  <Label htmlFor="email" className="font-normal flex items-center gap-1">
                    <Mail className="h-4 w-4" />
                    E-Mail
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="sms" id="sms" />
                  <Label htmlFor="sms" className="font-normal flex items-center gap-1">
                    <Phone className="h-4 w-4" />
                    SMS
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="both" id="both" />
                  <Label htmlFor="both" className="font-normal">
                    Beide
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {newMessage.message_type !== 'sms' && (
              <div className="space-y-2">
                <Label>Betreff</Label>
                <Input
                  value={newMessage.subject}
                  onChange={(e) => setNewMessage((m) => ({ ...m, subject: e.target.value }))}
                  placeholder="Betreff der Nachricht..."
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>Nachricht *</Label>
              <Textarea
                value={newMessage.message_body}
                onChange={(e) => setNewMessage((m) => ({ ...m, message_body: e.target.value }))}
                placeholder="Ihre Nachricht..."
                rows={5}
              />
              {newMessage.message_type === 'sms' && (
                <p className="text-xs text-muted-foreground">
                  SMS: {newMessage.message_body.length}/160 Zeichen
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowNewMessage(false)}>
              Abbrechen
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleSendMessage(true)}
              disabled={!newMessage.message_body.trim() || createMessage.isPending}
            >
              Als Entwurf speichern
            </Button>
            <Button
              onClick={() => handleSendMessage(false)}
              disabled={!newMessage.message_body.trim() || createMessage.isPending}
            >
              {createMessage.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Senden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
