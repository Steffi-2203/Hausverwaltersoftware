import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { Owner, OwnerInsert, useCreateOwner, useUpdateOwner } from '@/hooks/useOwners';
import { useProperties } from '@/hooks/useProperties';

interface OwnerFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  owner?: Owner | null;
}

interface FormData {
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
  property_id: string;
}

const emptyFormData: FormData = {
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
  property_id: '',
};

export function OwnerForm({ open, onOpenChange, owner }: OwnerFormProps) {
  const createOwner = useCreateOwner();
  const updateOwner = useUpdateOwner();
  const { data: properties } = useProperties();
  
  const [formData, setFormData] = useState<FormData>(emptyFormData);
  
  useEffect(() => {
    if (owner) {
      setFormData({
        name: owner.name || '',
        email: owner.email || '',
        phone: owner.phone || '',
        address: owner.address || '',
        city: owner.city || '',
        postal_code: owner.postal_code || '',
        iban: owner.iban || '',
        bic: owner.bic || '',
        ownership_share: owner.ownership_share?.toString() || '100',
        is_primary: owner.is_primary || false,
        property_id: owner.property_id || '',
      });
    } else {
      setFormData(emptyFormData);
    }
  }, [owner, open]);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim()) return;
    if (!formData.property_id) return;
    
    const share = parseFloat(formData.ownership_share) || 0;
    
    try {
      if (owner) {
        await updateOwner.mutateAsync({
          id: owner.id,
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
          property_id: formData.property_id,
        });
      } else {
        await createOwner.mutateAsync({
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
          property_id: formData.property_id,
        } as OwnerInsert);
      }
      onOpenChange(false);
    } catch (error) {
      // Error handled by mutation
    }
  };
  
  const isLoading = createOwner.isPending || updateOwner.isPending;
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {owner ? 'Eigentümer bearbeiten' : 'Neuen Eigentümer anlegen'}
          </DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <h3 className="font-medium text-sm text-muted-foreground">Stammdaten</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Max Mustermann"
                  required
                  data-testid="input-owner-name"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="property_id">Liegenschaft *</Label>
                <Select
                  value={formData.property_id}
                  onValueChange={(value) => setFormData({ ...formData, property_id: value })}
                >
                  <SelectTrigger data-testid="select-owner-property">
                    <SelectValue placeholder="Liegenschaft wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {properties?.map((property) => (
                      <SelectItem key={property.id} value={property.id}>
                        {property.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
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
                  data-testid="input-owner-share"
                />
              </div>
              
              <div className="flex items-center space-x-2 pt-6">
                <Switch
                  id="is_primary"
                  checked={formData.is_primary}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_primary: checked })}
                  data-testid="switch-owner-primary"
                />
                <Label htmlFor="is_primary">Hauptansprechpartner</Label>
              </div>
            </div>
          </div>
          
          <div className="space-y-4">
            <h3 className="font-medium text-sm text-muted-foreground">Kontaktdaten</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-Mail</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="email@example.com"
                  data-testid="input-owner-email"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="phone">Telefon</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="+43 1 234 5678"
                  data-testid="input-owner-phone"
                />
              </div>
            </div>
          </div>
          
          <div className="space-y-4">
            <h3 className="font-medium text-sm text-muted-foreground">Adresse</h3>
            
            <div className="space-y-2">
              <Label htmlFor="address">Straße und Hausnummer</Label>
              <Input
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="Musterstraße 1"
                data-testid="input-owner-address"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="postal_code">PLZ</Label>
                <Input
                  id="postal_code"
                  value={formData.postal_code}
                  onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
                  placeholder="1010"
                  data-testid="input-owner-postal-code"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="city">Ort</Label>
                <Input
                  id="city"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  placeholder="Wien"
                  data-testid="input-owner-city"
                />
              </div>
            </div>
          </div>
          
          <div className="space-y-4">
            <h3 className="font-medium text-sm text-muted-foreground">Bankdaten</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="iban">IBAN</Label>
                <Input
                  id="iban"
                  value={formData.iban}
                  onChange={(e) => setFormData({ ...formData, iban: e.target.value })}
                  placeholder="AT00 0000 0000 0000 0000"
                  data-testid="input-owner-iban"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="bic">BIC</Label>
                <Input
                  id="bic"
                  value={formData.bic}
                  onChange={(e) => setFormData({ ...formData, bic: e.target.value })}
                  placeholder="ABCDEFGH"
                  data-testid="input-owner-bic"
                />
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-owner"
            >
              Abbrechen
            </Button>
            <Button 
              type="submit" 
              disabled={isLoading || !formData.name || !formData.property_id}
              data-testid="button-save-owner"
            >
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
