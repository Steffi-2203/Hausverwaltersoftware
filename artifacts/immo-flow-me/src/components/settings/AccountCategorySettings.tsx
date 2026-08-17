import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { Loader2, Plus, Pencil, Trash2, FolderOpen } from 'lucide-react';
import { useAccountCategories, useCreateAccountCategory, useUpdateAccountCategory, useDeleteAccountCategory } from '@/hooks/useAccountCategories';
import { useDistributionKeys } from '@/hooks/useDistributionKeys';

const categoryTypeLabels: Record<string, string> = {
  income: 'Einnahmen',
  expense: 'Ausgaben',
  asset: 'Vermögen',
};

export function AccountCategorySettings() {
  const { data: categories = [], isLoading } = useAccountCategories();
  const { data: distributionKeys = [] } = useDistributionKeys();
  const createCategory = useCreateAccountCategory();
  const updateCategory = useUpdateAccountCategory();
  const deleteCategory = useDeleteAccountCategory();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<{
    id: string;
    name: string;
    type: 'income' | 'expense' | 'asset';
    default_distribution_key_id: string | null;
  } | null>(null);

  const [newCategory, setNewCategory] = useState({
    name: '',
    type: 'expense' as 'income' | 'expense' | 'asset',
    default_distribution_key_id: null as string | null,
  });

  const handleCreate = async () => {
    if (!newCategory.name.trim()) return;
    
    await createCategory.mutateAsync({
      name: newCategory.name,
      type: newCategory.type,
      parent_id: null,
      is_system: false,
      organization_id: null,
    } as any);
    
    setNewCategory({ name: '', type: 'expense', default_distribution_key_id: null });
    setDialogOpen(false);
  };

  const handleUpdate = async () => {
    if (!editingCategory) return;
    
    await updateCategory.mutateAsync({
      id: editingCategory.id,
      name: editingCategory.name,
      type: editingCategory.type,
    } as any);
    
    setEditingCategory(null);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Möchten Sie diese Kategorie wirklich löschen?')) {
      await deleteCategory.mutateAsync(id);
    }
  };

  const getDistributionKeyName = (keyId: string | null) => {
    if (!keyId) return '—';
    const key = distributionKeys.find(k => k.id === keyId);
    return key?.name || key?.keyCode || '—';
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            Kostenarten
          </CardTitle>
          <CardDescription>
            Verwalten Sie Ihre Kostenarten und weisen Sie Standard-Verteilerschlüssel zu
          </CardDescription>
        </div>
        <Button onClick={() => setDialogOpen(true)} size="sm" data-testid="button-add-category">
          <Plus className="h-4 w-4 mr-2" />
          Neue Kategorie
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Typ</TableHead>
              <TableHead>Standard-Verteilerschlüssel</TableHead>
              <TableHead className="w-24">Aktionen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  Keine Kostenarten vorhanden
                </TableCell>
              </TableRow>
            ) : (
              categories.map((category) => (
                <TableRow key={category.id} data-testid={`row-category-${category.id}`}>
                  <TableCell className="font-medium">{category.name}</TableCell>
                  <TableCell>{categoryTypeLabels[category.type] || category.type}</TableCell>
                  <TableCell>{getDistributionKeyName((category as any).default_distribution_key_id)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditingCategory({
                          id: category.id,
                          name: category.name,
                          type: category.type,
                          default_distribution_key_id: (category as any).default_distribution_key_id,
                        })}
                        disabled={category.is_system}
                        data-testid={`button-edit-category-${category.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(category.id)}
                        disabled={category.is_system}
                        data-testid={`button-delete-category-${category.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Neue Kostenart erstellen</DialogTitle>
              <DialogDescription>
                Erstellen Sie eine neue Kostenart mit optionalem Standard-Verteilerschlüssel
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="new-name">Name</Label>
                <Input
                  id="new-name"
                  value={newCategory.name}
                  onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                  placeholder="z.B. Versicherung"
                  data-testid="input-category-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-type">Typ</Label>
                <Select
                  value={newCategory.type}
                  onValueChange={(value: 'income' | 'expense' | 'asset') => 
                    setNewCategory({ ...newCategory, type: value })
                  }
                >
                  <SelectTrigger id="new-type" data-testid="select-category-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="expense">Ausgaben</SelectItem>
                    <SelectItem value="income">Einnahmen</SelectItem>
                    <SelectItem value="asset">Vermögen</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-distribution-key">Standard-Verteilerschlüssel</Label>
                <Select
                  value={newCategory.default_distribution_key_id || 'none'}
                  onValueChange={(value) => 
                    setNewCategory({ ...newCategory, default_distribution_key_id: value === 'none' ? null : value })
                  }
                >
                  <SelectTrigger id="new-distribution-key" data-testid="select-distribution-key">
                    <SelectValue placeholder="Kein Standard" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Kein Standard</SelectItem>
                    {distributionKeys.map((key) => (
                      <SelectItem key={key.id} value={key.id}>
                        {key.name || key.keyCode}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Abbrechen
              </Button>
              <Button 
                onClick={handleCreate} 
                disabled={!newCategory.name.trim() || createCategory.isPending}
                data-testid="button-save-category"
              >
                {createCategory.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Erstellen
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!editingCategory} onOpenChange={(open) => !open && setEditingCategory(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Kostenart bearbeiten</DialogTitle>
              <DialogDescription>
                Bearbeiten Sie die Kostenart und den Standard-Verteilerschlüssel
              </DialogDescription>
            </DialogHeader>
            {editingCategory && (
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-name">Name</Label>
                  <Input
                    id="edit-name"
                    value={editingCategory.name}
                    onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                    data-testid="input-edit-category-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-type">Typ</Label>
                  <Select
                    value={editingCategory.type}
                    onValueChange={(value: 'income' | 'expense' | 'asset') => 
                      setEditingCategory({ ...editingCategory, type: value })
                    }
                  >
                    <SelectTrigger id="edit-type" data-testid="select-edit-category-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense">Ausgaben</SelectItem>
                      <SelectItem value="income">Einnahmen</SelectItem>
                      <SelectItem value="asset">Vermögen</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-distribution-key">Standard-Verteilerschlüssel</Label>
                  <Select
                    value={editingCategory.default_distribution_key_id || 'none'}
                    onValueChange={(value) => 
                      setEditingCategory({ ...editingCategory, default_distribution_key_id: value === 'none' ? null : value })
                    }
                  >
                    <SelectTrigger id="edit-distribution-key" data-testid="select-edit-distribution-key">
                      <SelectValue placeholder="Kein Standard" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Kein Standard</SelectItem>
                      {distributionKeys.map((key) => (
                        <SelectItem key={key.id} value={key.id}>
                          {key.name || key.keyCode}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingCategory(null)}>
                Abbrechen
              </Button>
              <Button 
                onClick={handleUpdate} 
                disabled={!editingCategory?.name.trim() || updateCategory.isPending}
                data-testid="button-update-category"
              >
                {updateCategory.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Speichern
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
