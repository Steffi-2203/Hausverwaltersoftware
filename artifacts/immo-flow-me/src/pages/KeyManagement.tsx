import { useState, useMemo } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Plus, Search, Key, MoreHorizontal, Pencil, Trash2, History, ArrowRightLeft } from 'lucide-react';
import { useKeyInventory, useDeleteKeyInventory, KeyInventoryItem, KEY_TYPE_LABELS } from '@/hooks/useKeys';
import { useProperties } from '@/hooks/useProperties';
import { KeyInventoryForm } from '@/components/keys/KeyInventoryForm';
import { KeyHandoverForm } from '@/components/keys/KeyHandoverForm';
import { KeyHistoryDialog } from '@/components/keys/KeyHistoryDialog';

export default function KeyManagement() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterProperty, setFilterProperty] = useState<string>('all');
  const [keyFormOpen, setKeyFormOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<KeyInventoryItem | null>(null);
  const [deletingKey, setDeletingKey] = useState<KeyInventoryItem | null>(null);
  const [handoverKey, setHandoverKey] = useState<KeyInventoryItem | null>(null);
  const [handoverIsReturn, setHandoverIsReturn] = useState(false);
  const [historyKey, setHistoryKey] = useState<KeyInventoryItem | null>(null);
  
  const propertyFilter = filterProperty === 'all' ? undefined : filterProperty;
  const { data: keys, isLoading } = useKeyInventory(propertyFilter);
  const { data: properties } = useProperties();
  const deleteKey = useDeleteKeyInventory();
  
  const filteredKeys = useMemo(() => {
    return keys?.filter((key) => {
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch = !searchQuery || 
        key.key_number?.toLowerCase().includes(searchLower) ||
        (KEY_TYPE_LABELS[key.key_type] || key.key_type).toLowerCase().includes(searchLower) ||
        key.description?.toLowerCase().includes(searchLower) ||
        key.properties?.name.toLowerCase().includes(searchLower) ||
        key.units?.top_nummer?.toLowerCase().includes(searchLower);
      
      return matchesSearch;
    }) || [];
  }, [keys, searchQuery]);
  
  const stats = useMemo(() => {
    if (!filteredKeys) return { total: 0, available: 0, handedOut: 0 };
    return filteredKeys.reduce((acc, key) => ({
      total: acc.total + (key.total_count || 0),
      available: acc.available + (key.available_count || 0),
      handedOut: acc.handedOut + ((key.total_count || 0) - (key.available_count || 0)),
    }), { total: 0, available: 0, handedOut: 0 });
  }, [filteredKeys]);
  
  const handleEdit = (key: KeyInventoryItem) => {
    setEditingKey(key);
    setKeyFormOpen(true);
  };
  
  const handleDelete = async () => {
    if (deletingKey) {
      await deleteKey.mutateAsync(deletingKey.id);
      setDeletingKey(null);
    }
  };
  
  const handleHandover = (key: KeyInventoryItem, isReturn: boolean = false) => {
    setHandoverKey(key);
    setHandoverIsReturn(isReturn);
  };
  
  const handleFormClose = () => {
    setKeyFormOpen(false);
    setEditingKey(null);
  };
  
  return (
    <MainLayout title="Schlüsselverwaltung" subtitle="Verwaltung Ihrer Schlüssel">
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold">Schlüsselverwaltung</h1>
            <p className="text-muted-foreground">
              Verwalten Sie Ihre Schlüssel und Übergaben
            </p>
          </div>
          <Button onClick={() => setKeyFormOpen(true)} data-testid="button-add-key">
            <Plus className="h-4 w-4 mr-2" />
            Neuer Schlüssel
          </Button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Gesamt</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="stat-total">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Verfügbar</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600" data-testid="stat-available">{stats.available}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Ausgegeben</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600" data-testid="stat-handed-out">{stats.handedOut}</div>
            </CardContent>
          </Card>
        </div>
        
        <div className="flex flex-wrap gap-4 items-center">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Suchen..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search-keys"
            />
          </div>
          
          <Select value={filterProperty} onValueChange={setFilterProperty}>
            <SelectTrigger className="w-[200px]" data-testid="select-filter-property">
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
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        ) : filteredKeys.length === 0 ? (
          <div className="text-center py-16">
            <Key className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="text-lg font-medium mb-2">Keine Schlüssel gefunden</h3>
            <p className="text-muted-foreground mb-4">
              {searchQuery || filterProperty !== 'all'
                ? 'Versuchen Sie andere Filteroptionen'
                : 'Legen Sie Ihren ersten Schlüssel an'}
            </p>
            {!searchQuery && filterProperty === 'all' && (
              <Button onClick={() => setKeyFormOpen(true)} data-testid="button-add-key-empty">
                <Plus className="h-4 w-4 mr-2" />
                Schlüssel anlegen
              </Button>
            )}
          </div>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Typ</TableHead>
                  <TableHead>Nummer</TableHead>
                  <TableHead>Liegenschaft</TableHead>
                  <TableHead>Einheit</TableHead>
                  <TableHead className="text-center">Gesamt</TableHead>
                  <TableHead className="text-center">Verfügbar</TableHead>
                  <TableHead className="text-center">Ausgegeben</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredKeys.map((key) => (
                  <TableRow key={key.id} data-testid={`row-key-${key.id}`}>
                    <TableCell>
                      <Badge variant="outline" data-testid={`badge-type-${key.id}`}>
                        {KEY_TYPE_LABELS[key.key_type] || key.key_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{key.key_number || '-'}</TableCell>
                    <TableCell>{key.properties?.name || '-'}</TableCell>
                    <TableCell>{key.units?.top_nummer ? `Top ${key.units.top_nummer}` : '-'}</TableCell>
                    <TableCell className="text-center">{key.total_count}</TableCell>
                    <TableCell className="text-center">
                      <Badge 
                        className={key.available_count && key.available_count > 0 ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}
                        data-testid={`badge-available-${key.id}`}
                      >
                        {key.available_count}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge 
                        variant="secondary"
                        data-testid={`badge-handed-out-${key.id}`}
                      >
                        {(key.total_count || 0) - (key.available_count || 0)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" data-testid={`button-actions-${key.id}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem 
                            onClick={() => handleHandover(key, false)}
                            data-testid={`action-handover-${key.id}`}
                          >
                            <ArrowRightLeft className="h-4 w-4 mr-2" />
                            Übergabe
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => handleHandover(key, true)}
                            data-testid={`action-return-${key.id}`}
                          >
                            <ArrowRightLeft className="h-4 w-4 mr-2" />
                            Rückgabe
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => setHistoryKey(key)}
                            data-testid={`action-history-${key.id}`}
                          >
                            <History className="h-4 w-4 mr-2" />
                            Historie
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => handleEdit(key)}
                            data-testid={`action-edit-${key.id}`}
                          >
                            <Pencil className="h-4 w-4 mr-2" />
                            Bearbeiten
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => setDeletingKey(key)}
                            className="text-destructive"
                            data-testid={`action-delete-${key.id}`}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Löschen
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
        
        <KeyInventoryForm 
          open={keyFormOpen} 
          onOpenChange={handleFormClose}
          editingKey={editingKey}
        />
        
        {handoverKey && (
          <KeyHandoverForm
            open={!!handoverKey}
            onOpenChange={(open) => !open && setHandoverKey(null)}
            keyItem={handoverKey}
            isReturn={handoverIsReturn}
          />
        )}
        
        <KeyHistoryDialog
          open={!!historyKey}
          onOpenChange={(open) => !open && setHistoryKey(null)}
          keyItem={historyKey}
        />
        
        <AlertDialog open={!!deletingKey} onOpenChange={() => setDeletingKey(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Schlüssel löschen?</AlertDialogTitle>
              <AlertDialogDescription>
                Möchten Sie diesen Schlüssel wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-delete">Abbrechen</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                data-testid="button-confirm-delete"
              >
                Löschen
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </MainLayout>
  );
}
