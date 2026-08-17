import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Star } from 'lucide-react';
import { Contractor, ContractorInsert, SPECIALIZATIONS, useCreateContractor, useUpdateContractor } from '@/hooks/useContractors';

interface ContractorFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractor?: Contractor | null;
}

export function ContractorForm({ open, onOpenChange, contractor }: ContractorFormProps) {
  const createContractor = useCreateContractor();
  const updateContractor = useUpdateContractor();
  
  const [formData, setFormData] = useState<Partial<ContractorInsert>>({
    company_name: '',
    contact_person: '',
    email: '',
    phone: '',
    mobile: '',
    address: '',
    postal_code: '',
    city: '',
    specializations: [],
    rating: null,
    notes: '',
    is_active: true,
    iban: '',
    bic: '',
  });
  
  useEffect(() => {
    if (contractor) {
      setFormData({
        company_name: contractor.company_name,
        contact_person: contractor.contact_person || '',
        email: contractor.email || '',
        phone: contractor.phone || '',
        mobile: contractor.mobile || '',
        address: contractor.address || '',
        postal_code: contractor.postal_code || '',
        city: contractor.city || '',
        specializations: contractor.specializations || [],
        rating: contractor.rating,
        notes: contractor.notes || '',
        is_active: contractor.is_active,
        iban: contractor.iban || '',
        bic: contractor.bic || '',
      });
    } else {
      setFormData({
        company_name: '',
        contact_person: '',
        email: '',
        phone: '',
        mobile: '',
        address: '',
        postal_code: '',
        city: '',
        specializations: [],
        rating: null,
        notes: '',
        is_active: true,
        iban: '',
        bic: '',
      });
    }
  }, [contractor, open]);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.company_name) return;
    
    try {
      if (contractor) {
        await updateContractor.mutateAsync({
          id: contractor.id,
          ...formData,
        } as any);
      } else {
        await createContractor.mutateAsync(formData as ContractorInsert);
      }
      onOpenChange(false);
    } catch (error) {
      // Error handled by mutation
    }
  };
  
  const toggleSpecialization = (value: string) => {
    const current = formData.specializations || [];
    if (current.includes(value)) {
      setFormData({ ...formData, specializations: current.filter(s => s !== value) });
    } else {
      setFormData({ ...formData, specializations: [...current, value] });
    }
  };
  
  const setRating = (rating: number) => {
    setFormData({ ...formData, rating: formData.rating === rating ? null : rating });
  };
  
  const isLoading = createContractor.isPending || updateContractor.isPending;
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {contractor ? 'Handwerker bearbeiten' : 'Neuen Handwerker anlegen'}
          </DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Stammdaten */}
          <div className="space-y-4">
            <h3 className="font-medium text-sm text-muted-foreground">Stammdaten</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="company_name">Firmenname *</Label>
                <Input
                  id="company_name"
                  value={formData.company_name}
                  onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="contact_person">Ansprechpartner</Label>
                <Input
                  id="contact_person"
                  value={formData.contact_person}
                  onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
                />
              </div>
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-Mail</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="phone">Telefon</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="mobile">Mobil</Label>
                <Input
                  id="mobile"
                  value={formData.mobile}
                  onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                />
              </div>
            </div>
          </div>
          
          {/* Adresse */}
          <div className="space-y-4">
            <h3 className="font-medium text-sm text-muted-foreground">Adresse</h3>
            
            <div className="space-y-2">
              <Label htmlFor="address">Straße & Hausnummer</Label>
              <Input
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              />
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="postal_code">PLZ</Label>
                <Input
                  id="postal_code"
                  value={formData.postal_code}
                  onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
                />
              </div>
              
              <div className="col-span-2 space-y-2">
                <Label htmlFor="city">Stadt</Label>
                <Input
                  id="city"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                />
              </div>
            </div>
          </div>
          
          {/* Spezialisierungen */}
          <div className="space-y-4">
            <h3 className="font-medium text-sm text-muted-foreground">Gewerke / Spezialisierungen</h3>
            
            <div className="grid grid-cols-3 gap-2">
              {SPECIALIZATIONS.map((spec) => (
                <div key={spec.value} className="flex items-center space-x-2">
                  <Checkbox
                    id={spec.value}
                    checked={formData.specializations?.includes(spec.value)}
                    onCheckedChange={() => toggleSpecialization(spec.value)}
                  />
                  <Label htmlFor={spec.value} className="text-sm cursor-pointer">
                    {spec.label}
                  </Label>
                </div>
              ))}
            </div>
          </div>
          
          {/* Bewertung */}
          <div className="space-y-4">
            <h3 className="font-medium text-sm text-muted-foreground">Bewertung</h3>
            
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  className="p-1 hover:scale-110 transition-transform"
                >
                  <Star
                    className={`h-6 w-6 ${
                      formData.rating && star <= formData.rating
                        ? 'fill-yellow-400 text-yellow-400'
                        : 'text-muted-foreground'
                    }`}
                  />
                </button>
              ))}
              {formData.rating && (
                <span className="ml-2 text-sm text-muted-foreground">
                  {formData.rating} von 5 Sternen
                </span>
              )}
            </div>
          </div>
          
          {/* Bankdaten */}
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
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="bic">BIC</Label>
                <Input
                  id="bic"
                  value={formData.bic}
                  onChange={(e) => setFormData({ ...formData, bic: e.target.value })}
                />
              </div>
            </div>
          </div>
          
          {/* Notizen */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notizen</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
            />
          </div>
          
          {/* Status */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Aktiv</Label>
              <p className="text-sm text-muted-foreground">
                Inaktive Handwerker werden in Listen ausgeblendet
              </p>
            </div>
            <Switch
              checked={formData.is_active}
              onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
            />
          </div>
          
          {/* Buttons */}
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Speichern...' : contractor ? 'Speichern' : 'Anlegen'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
