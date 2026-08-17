import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Search, Building2 } from 'lucide-react';
import { useContractors, useDeleteContractor, Contractor, SPECIALIZATIONS } from '@/hooks/useContractors';
import { ContractorCard } from '@/components/contractors/ContractorCard';
import { ContractorForm } from '@/components/contractors/ContractorForm';

export default function Contractors() {
  const [showInactive, setShowInactive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSpec, setFilterSpec] = useState<string>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editingContractor, setEditingContractor] = useState<Contractor | null>(null);
  const [deletingContractor, setDeletingContractor] = useState<Contractor | null>(null);
  
  const { data: contractors, isLoading } = useContractors(!showInactive);
  const deleteContractor = useDeleteContractor();
  
  const filteredContractors = contractors?.filter((contractor) => {
    // Search filter
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch = !searchQuery || 
      contractor.company_name.toLowerCase().includes(searchLower) ||
      contractor.contact_person?.toLowerCase().includes(searchLower) ||
      contractor.email?.toLowerCase().includes(searchLower) ||
      contractor.city?.toLowerCase().includes(searchLower);
    
    // Specialization filter
    const matchesSpec = filterSpec === 'all' || 
      contractor.specializations?.includes(filterSpec);
    
    return matchesSearch && matchesSpec;
  }) || [];
  
  const handleEdit = (contractor: Contractor) => {
    setEditingContractor(contractor);
    setFormOpen(true);
  };
  
  const handleDelete = async () => {
    if (deletingContractor) {
      await deleteContractor.mutateAsync(deletingContractor.id);
      setDeletingContractor(null);
    }
  };
  
  const handleFormClose = () => {
    setFormOpen(false);
    setEditingContractor(null);
  };
  
  return (
    <MainLayout title="Handwerker" subtitle="Verwaltung Ihrer Handwerker und Dienstleister">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Handwerker</h1>
            <p className="text-muted-foreground">
              Verwalten Sie Ihre Handwerker und Dienstleister
            </p>
          </div>
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Neuer Handwerker
          </Button>
        </div>
        
        {/* Filters */}
        <div className="flex flex-wrap gap-4 items-center">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Suchen..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          
          <Select value={filterSpec} onValueChange={setFilterSpec}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Alle Gewerke" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Gewerke</SelectItem>
              {SPECIALIZATIONS.map((spec) => (
                <SelectItem key={spec.value} value={spec.value}>
                  {spec.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <div className="flex items-center gap-2">
            <Switch
              id="show-inactive"
              checked={showInactive}
              onCheckedChange={setShowInactive}
            />
            <Label htmlFor="show-inactive" className="text-sm">
              Inaktive anzeigen
            </Label>
          </div>
        </div>
        
        {/* Content */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-48 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        ) : filteredContractors.length === 0 ? (
          <div className="text-center py-12">
            <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">Keine Handwerker gefunden</h3>
            <p className="text-muted-foreground mt-1">
              {searchQuery || filterSpec !== 'all'
                ? 'Versuchen Sie andere Suchkriterien'
                : 'Legen Sie Ihren ersten Handwerker an'}
            </p>
            {!searchQuery && filterSpec === 'all' && (
              <Button onClick={() => setFormOpen(true)} className="mt-4">
                <Plus className="h-4 w-4 mr-2" />
                Handwerker anlegen
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredContractors.map((contractor) => (
              <ContractorCard
                key={contractor.id}
                contractor={contractor}
                onEdit={handleEdit}
                onDelete={setDeletingContractor}
              />
            ))}
          </div>
        )}
      </div>
      
      {/* Form Dialog */}
      <ContractorForm
        open={formOpen}
        onOpenChange={handleFormClose}
        contractor={editingContractor}
      />
      
      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingContractor} onOpenChange={() => setDeletingContractor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Handwerker löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Möchten Sie "{deletingContractor?.company_name}" wirklich löschen? 
              Diese Aktion kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
