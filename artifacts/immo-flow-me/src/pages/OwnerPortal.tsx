import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/useAuth';
import { useOwners } from '@/hooks/useOwners';
import { useOwnerPortalAccess, useCreateOwnerPortalAccess, useToggleOwnerPortalAccess } from '@/hooks/useOwnerPortalAccess';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  Users, Plus, Shield, Mail, Loader2
} from 'lucide-react';

export default function OwnerPortal() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: owners } = useOwners();
  const { data: portalAccess } = useOwnerPortalAccess();
  const createAccess = useCreateOwnerPortalAccess();
  const toggleAccess = useToggleOwnerPortalAccess();

  const [showGrantAccess, setShowGrantAccess] = useState(false);
  const [selectedOwnerId, setSelectedOwnerId] = useState('');
  const [accessEmail, setAccessEmail] = useState('');
  const [sendingInvite, setSendingInvite] = useState<string | null>(null);

  const handleSendInvite = async (accessId: string) => {
    setSendingInvite(accessId);
    try {
      const res = await fetch('/api/owner-portal/send-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ownerPortalAccessId: accessId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast({ title: 'Einladung gesendet', description: 'Die Einladungs-E-Mail wurde erfolgreich versendet.' });
      } else {
        toast({ title: 'Fehler', description: data.error || 'Einladung konnte nicht gesendet werden', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Fehler', description: 'Verbindung zum Server fehlgeschlagen', variant: 'destructive' });
    } finally {
      setSendingInvite(null);
    }
  };

  const handleGrantAccess = async () => {
    if (!selectedOwnerId || !accessEmail) return;
    try {
      await createAccess.mutateAsync({ owner_id: selectedOwnerId, email: accessEmail });
      setShowGrantAccess(false);
      setSelectedOwnerId('');
      setAccessEmail('');
    } catch (error) {
      toast({ title: 'Fehler', description: 'Zugang konnte nicht erstellt werden', variant: 'destructive' });
    }
  };

  const ownersList = owners || [];

  return (
    <MainLayout title="Eigentümerportal" subtitle="Self-Service Zugang für Eigentümer verwalten">
      <div className="space-y-6">
        <div className="flex flex-wrap justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Portal-Zugänge verwalten</h2>
          </div>
          <Button onClick={() => setShowGrantAccess(true)} data-testid="button-owner-grant-access">
            <Plus className="h-4 w-4 mr-2" /> Zugang einrichten
          </Button>
        </div>

        {!portalAccess || portalAccess.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Users className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">Keine Portal-Zugänge</p>
              <p className="text-muted-foreground text-sm">Richten Sie Zugänge ein, damit Eigentümer ihre Daten einsehen können.</p>
              <Button className="mt-4" onClick={() => setShowGrantAccess(true)} data-testid="button-owner-first-access">
                <Plus className="h-4 w-4 mr-2" /> Ersten Zugang einrichten
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Eigentümer</TableHead>
                    <TableHead>E-Mail</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Letzter Login</TableHead>
                    <TableHead>Aktiv</TableHead>
                    <TableHead>Aktion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {portalAccess.map((access: any) => {
                    const owner = ownersList.find((o: any) => o.id === access.owner_id);
                    const hasPassword = access.password_hash != null;
                    return (
                      <TableRow key={access.id} data-testid={`row-owner-access-${access.id}`}>
                        <TableCell className="font-medium">
                          {owner ? `${owner.first_name || owner.firstName} ${owner.last_name || owner.lastName}` : 'Unbekannt'}
                        </TableCell>
                        <TableCell>{access.email}</TableCell>
                        <TableCell>
                          {hasPassword ? (
                            <Badge>Registriert</Badge>
                          ) : (
                            <Badge variant="outline">Ausstehend</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {access.last_login_at
                            ? format(new Date(access.last_login_at), 'dd.MM.yyyy HH:mm', { locale: de })
                            : '-'}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={access.is_active}
                            onCheckedChange={(checked) => toggleAccess.mutate({ id: access.id, is_active: checked })}
                            data-testid={`switch-owner-active-${access.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSendInvite(access.id)}
                            disabled={sendingInvite === access.id || !access.is_active}
                            data-testid={`button-owner-send-invite-${access.id}`}
                          >
                            {sendingInvite === access.id ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-1" />
                            ) : (
                              <Mail className="h-4 w-4 mr-1" />
                            )}
                            Einladung senden
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={showGrantAccess} onOpenChange={setShowGrantAccess}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Portal-Zugang einrichten</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Eigentümer</Label>
              <Select value={selectedOwnerId} onValueChange={(v) => {
                setSelectedOwnerId(v);
                const owner = ownersList.find((o: any) => o.id === v);
                if (owner?.email) setAccessEmail(owner.email);
              }}>
                <SelectTrigger data-testid="select-owner"><SelectValue placeholder="Eigentümer wählen..." /></SelectTrigger>
                <SelectContent>
                  {ownersList.map((o: any) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.first_name || o.firstName} {o.last_name || o.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>E-Mail für Portal-Zugang</Label>
              <Input
                type="email"
                value={accessEmail}
                onChange={e => setAccessEmail(e.target.value)}
                placeholder="eigentuemer@example.com"
                data-testid="input-owner-access-email"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGrantAccess(false)} data-testid="button-owner-cancel-access">Abbrechen</Button>
            <Button onClick={handleGrantAccess} disabled={!selectedOwnerId || !accessEmail} data-testid="button-owner-create-access">Zugang erstellen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
