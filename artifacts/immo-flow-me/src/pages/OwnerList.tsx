import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Search, User } from 'lucide-react';
import { useOwners, useDeleteOwner, Owner } from '@/hooks/useOwners';
import { useProperties } from '@/hooks/useProperties';
import { OwnerCard } from '@/components/owners/OwnerCard';
import { OwnerForm } from '@/components/owners/OwnerForm';
import { OwnerPayoutSection } from '@/components/owners/OwnerPayoutSection';

export default function OwnerList() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterProperty, setFilterProperty] = useState<string>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editingOwner, setEditingOwner] = useState<Owner | null>(null);
  const [deletingOwner, setDeletingOwner] = useState<Owner | null>(null);
  
  const { data: owners, isLoading } = useOwners();
  const { data: properties } = useProperties();
  const deleteOwner = useDeleteOwner();
  
  const filteredOwners = owners?.filter((owner) => {
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch = !searchQuery || 
      owner.name.toLowerCase().includes(searchLower) ||
      owner.email?.toLowerCase().includes(searchLower) ||
      owner.city?.toLowerCase().includes(searchLower) ||
      owner.properties?.name?.toLowerCase().includes(searchLower);
    
    const matchesProperty = filterProperty === 'all' || 
      owner.property_id === filterProperty;
    
    return matchesSearch && matchesProperty;
  }) || [];
  
  const handleEdit = (owner: Owner) => {
    setEditingOwner(owner);
    setFormOpen(true);
  };
  
  const handleDelete = async () => {
    if (deletingOwner) {
      await deleteOwner.mutateAsync(deletingOwner.id);
      setDeletingOwner(null);
    }
  };
  
  const handleFormClose = () => {
    setFormOpen(false);
    setEditingOwner(null);
  };
  
  return (
    <MainLayout title="Eigentümer" subtitle="Verwaltung Ihrer Liegenschaftseigentümer">
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold">Eigentümer</h1>
            <p className="text-muted-foreground">
              Verwalten Sie die Eigentümer Ihrer Liegenschaften
            </p>
          </div>
          <Button onClick={() => setFormOpen(true)} data-testid="button-add-owner">
            <Plus className="h-4 w-4 mr-2" />
            Neuer Eigentümer
          </Button>
        </div>

        <Tabs defaultValue="owners">
          <TabsList>
            <TabsTrigger value="owners">Eigentümer</TabsTrigger>
            <TabsTrigger value="payouts">Auszahlungen</TabsTrigger>
          </TabsList>

          <TabsContent value="owners" className="space-y-6">
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
              <Select value={filterProperty} onValueChange={setFilterProperty}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Alle Liegenschaften" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Liegenschaften</SelectItem>
                  {properties?.map((property) => (
                    <SelectItem key={property.id} value={property.id}>
                      {property.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-48 bg-muted animate-pulse rounded-lg" />
                ))}
              </div>
            ) : filteredOwners.length === 0 ? (
              <div className="text-center py-16">
                <User className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                <h3 className="text-lg font-medium mb-2">Keine Eigentümer gefunden</h3>
                <p className="text-muted-foreground mb-4">
                  {searchQuery || filterProperty !== 'all'
                    ? 'Versuchen Sie andere Filteroptionen'
                    : 'Legen Sie Ihren ersten Eigentümer an'}
                </p>
                {!searchQuery && filterProperty === 'all' && (
                  <Button onClick={() => setFormOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Eigentümer anlegen
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredOwners.map((owner) => (
                  <OwnerCard
                    key={owner.id}
                    owner={owner}
                    onEdit={handleEdit}
                    onDelete={setDeletingOwner}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="payouts">
            <OwnerPayoutSection />
          </TabsContent>
        </Tabs>
      </div>
      
      <OwnerForm
        open={formOpen}
        onOpenChange={handleFormClose}
        owner={editingOwner}
      />
      
      <AlertDialog open={!!deletingOwner} onOpenChange={() => setDeletingOwner(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eigentümer löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Möchten Sie den Eigentümer "{deletingOwner?.name}" wirklich löschen?
              Diese Aktion kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-owner">Abbrechen</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete}
              data-testid="button-confirm-delete-owner"
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
