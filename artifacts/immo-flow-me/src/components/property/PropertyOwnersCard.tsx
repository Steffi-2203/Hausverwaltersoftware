import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  Plus, 
  Pencil, 
  Trash2, 
  User, 
  AlertTriangle, 
  Loader2,
  Star,
  Building2,
  ShieldCheck
} from 'lucide-react';
import { toast } from 'sonner';
import {
  usePropertyOwners,
  useCreatePropertyOwner,
  useUpdatePropertyOwner,
  useDeletePropertyOwner,
  PropertyOwner,
  PropertyOwnerInsert,
} from '@/hooks/usePropertyOwners';
import { useHasFinanceAccess } from '@/hooks/useUserRole';
import { maskIban, maskEmail, isMasked } from '@/lib/dataMasking';

interface PropertyOwnersCardProps {
  propertyId: string;
}

interface OwnerFormData {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postal_code: string;
  iban: string;
  bic: string;
  ownership_share: string;
  is_primary: boolean;
}

const emptyFormData: OwnerFormData = {
  name: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  postal_code: '',
  iban: '',
  bic: '',
  ownership_share: '100',
  is_primary: false,
};

export function PropertyOwnersCard({ propertyId }: PropertyOwnersCardProps) {
  const { data: owners, isLoading } = usePropertyOwners(propertyId);
  const createOwner = useCreatePropertyOwner();
  const updateOwner = useUpdatePropertyOwner();
  const deleteOwner = useDeletePropertyOwner();
  const { hasAccess: hasFinanceAccess } = useHasFinanceAccess();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingOwner, setEditingOwner] = useState<PropertyOwner | null>(null);
  const [ownerToDelete, setOwnerToDelete] = useState<PropertyOwner | null>(null);
  const [formData, setFormData] = useState<OwnerFormData>(emptyFormData);

  // Calculate total ownership share
  const totalShare = owners?.reduce((sum, o) => {
    if (editingOwner && o.id === editingOwner.id) {
      return sum; // Exclude current editing owner from total
    }
    return sum + o.ownership_share;
  }, 0) || 0;

  const handleOpenCreate = () => {
    setEditingOwner(null);
    // Set default share to remaining percentage
    const remainingShare = Math.max(0, 100 - totalShare);
    setFormData({ ...emptyFormData, ownership_share: remainingShare.toString() });
    setDialogOpen(true);
  };

  const handleOpenEdit = (owner: PropertyOwner) => {
    setEditingOwner(owner);
    setFormData({
      name: owner.name,
      email: owner.email || '',
      phone: owner.phone || '',
      address: owner.address || '',
      city: owner.city || '',
      postal_code: owner.postal_code || '',
      iban: owner.iban || '',
      bic: owner.bic || '',
      ownership_share: owner.ownership_share.toString(),
      is_primary: owner.is_primary,
    });
    setDialogOpen(true);
  };

  const handleOpenDelete = (owner: PropertyOwner) => {
    setOwnerToDelete(owner);
    setDeleteDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('Name ist erforderlich');
      return;
    }

    const share = parseFloat(formData.ownership_share) || 0;
    if (share <= 0 || share > 100) {
      toast.error('Anteil muss zwischen 0 und 100% liegen');
      return;
    }

    // Check if total would exceed 100%
    const newTotal = totalShare + share;
    if (newTotal > 100) {
      toast.error(`Gesamtanteil würde ${newTotal}% überschreiten (max. 100%)`);
      return;
    }

    try {
      if (editingOwner) {
        await updateOwner.mutateAsync({
          id: editingOwner.id,
          name: formData.name.trim(),
          email: formData.email || null,
          phone: formData.phone || null,
          address: formData.address || null,
          city: formData.city || null,
          postal_code: formData.postal_code || null,
          iban: formData.iban || null,
          bic: formData.bic || null,
          ownership_share: share,
          is_primary: formData.is_primary,
        });
        toast.success('Eigentümer aktualisiert');
      } else {
        await createOwner.mutateAsync({
          property_id: propertyId,
          name: formData.name.trim(),
          email: formData.email || null,
          phone: formData.phone || null,
          address: formData.address || null,
          city: formData.city || null,
          postal_code: formData.postal_code || null,
          iban: formData.iban || null,
          bic: formData.bic || null,
          ownership_share: share,
          is_primary: formData.is_primary,
        });
        toast.success('Eigentümer hinzugefügt');
      }
      setDialogOpen(false);
    } catch (error) {
      toast.error('Fehler beim Speichern');
    }
  };

  const handleDelete = async () => {
    if (!ownerToDelete) return;

    try {
      await deleteOwner.mutateAsync({
        id: ownerToDelete.id,
        propertyId: propertyId,
      });
      toast.success('Eigentümer gelöscht');
      setDeleteDialogOpen(false);
      setOwnerToDelete(null);
    } catch (error) {
      toast.error('Fehler beim Löschen');
    }
  };

  const currentTotalShare = owners?.reduce((sum, o) => sum + o.ownership_share, 0) || 0;
  const isShareComplete = Math.abs(currentTotalShare - 100) < 0.01;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Eigentümer
          </CardTitle>
          <Button size="sm" onClick={handleOpenCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Eigentümer hinzufügen
          </Button>
        </CardHeader>
        <CardContent>
          {/* Warning if shares don't add up to 100% */}
          {owners && owners.length > 0 && !isShareComplete && (
            <Alert className="mb-4" variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Eigentumsanteile ergeben {currentTotalShare.toFixed(1)}% (sollte 100% sein)
              </AlertDescription>
            </Alert>
          )}

          {!owners || owners.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <User className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>Noch keine Eigentümer erfasst</p>
              <p className="text-sm">Fügen Sie Eigentümer hinzu, um Leerstandskosten zuzuordnen.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Kontakt</TableHead>
                  <TableHead>Anteil</TableHead>
                  <TableHead>IBAN</TableHead>
                  <TableHead className="w-[100px]">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {owners.map((owner) => (
                  <TableRow key={owner.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {owner.name}
                        {owner.is_primary && (
                          <Badge variant="secondary" className="gap-1">
                            <Star className="h-3 w-3" />
                            Haupt
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {owner.email && <div>{hasFinanceAccess ? owner.email : maskEmail(owner.email)}</div>}
                        {owner.phone && <div className="text-muted-foreground">{owner.phone}</div>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{owner.ownership_share}%</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex items-center gap-1">
                              {owner.iban ? (hasFinanceAccess ? owner.iban : maskIban(owner.iban)) : '-'}
                              {owner.iban && !hasFinanceAccess && <ShieldCheck className="h-3 w-3 text-primary" />}
                            </span>
                          </TooltipTrigger>
                          {owner.iban && !hasFinanceAccess && (
                            <TooltipContent>
                              <p>IBAN ist geschützt. Finanz-Berechtigung erforderlich.</p>
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenEdit(owner)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenDelete(owner)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingOwner ? 'Eigentümer bearbeiten' : 'Neuer Eigentümer'}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Max Mustermann"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ownership_share">Anteil (%)</Label>
              <Input
                id="ownership_share"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={formData.ownership_share}
                onChange={(e) => setFormData({ ...formData, ownership_share: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-Mail</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="email@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Telefon</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="+43 1 234 5678"
              />
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="address">Adresse</Label>
              <Input
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="Musterstraße 1"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="postal_code">PLZ</Label>
              <Input
                id="postal_code"
                value={formData.postal_code}
                onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
                placeholder="1010"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">Ort</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                placeholder="Wien"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="iban">IBAN</Label>
              <Input
                id="iban"
                value={formData.iban}
                onChange={(e) => setFormData({ ...formData, iban: e.target.value })}
                placeholder="AT00 0000 0000 0000 0000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bic">BIC</Label>
              <Input
                id="bic"
                value={formData.bic}
                onChange={(e) => setFormData({ ...formData, bic: e.target.value })}
                placeholder="ABCDEFGH"
              />
            </div>
            <div className="col-span-2 flex items-center space-x-2">
              <Switch
                id="is_primary"
                checked={formData.is_primary}
                onCheckedChange={(checked) => setFormData({ ...formData, is_primary: checked })}
              />
              <Label htmlFor="is_primary">Hauptansprechpartner</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Abbrechen
            </Button>
            <Button 
              onClick={handleSave}
              disabled={createOwner.isPending || updateOwner.isPending}
            >
              {(createOwner.isPending || updateOwner.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eigentümer löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Möchten Sie den Eigentümer "{ownerToDelete?.name}" wirklich löschen?
              Diese Aktion kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
