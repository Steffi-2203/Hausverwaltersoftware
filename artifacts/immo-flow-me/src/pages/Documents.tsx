import { useState, useRef } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  FileText, 
  Search, 
  Building2,
  Home,
  Users,
  Tags,
  History,
  Upload,
  Plus,
  X,
  Pencil,
  Trash2,
  Loader2,
  File,
  Clock,
} from 'lucide-react';
import { useProperties } from '@/hooks/useProperties';
import { 
  usePropertyDocuments, 
  useUploadPropertyDocument, 
  useDeletePropertyDocument,
  PROPERTY_DOCUMENT_TYPES,
  PropertyDocument
} from '@/hooks/usePropertyDocuments';
import { useUnits } from '@/hooks/useUnits';
import { 
  useUnitDocuments, 
  useUploadUnitDocument, 
  useDeleteUnitDocument,
  UNIT_DOCUMENT_TYPES,
  UnitDocument
} from '@/hooks/useUnitDocuments';
import { 
  useAllTenantDocuments, 
  useDeleteTenantDocument,
  TENANT_DOCUMENT_TYPES,
  TenantDocumentWithTenant
} from '@/hooks/useTenantDocuments';
import { DocumentList } from '@/components/documents/DocumentList';
import { DocumentUploadDialog } from '@/components/documents/DocumentUploadDialog';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import type { DocumentTag, DocumentVersion } from '@shared/schema';

const TAG_PALETTE = [
  { color: '#3b82f6', label: 'Blau' },
  { color: '#10b981', label: 'Grün' },
  { color: '#f59e0b', label: 'Gelb' },
  { color: '#ef4444', label: 'Rot' },
  { color: '#8b5cf6', label: 'Lila' },
  { color: '#ec4899', label: 'Pink' },
  { color: '#06b6d4', label: 'Cyan' },
  { color: '#f97316', label: 'Orange' },
];

function useDocumentTags() {
  return useQuery<DocumentTag[]>({
    queryKey: ['/api/documents/tags'],
    queryFn: async () => {
      const res = await fetch('/api/documents/tags', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch tags');
      return res.json();
    },
  });
}

function useDocumentTagsForDocument(documentId: string | null) {
  return useQuery<DocumentTag[]>({
    queryKey: ['/api/documents', documentId, 'tags'],
    queryFn: async () => {
      if (!documentId) return [];
      const res = await fetch(`/api/documents/${encodeURIComponent(documentId)}/tags`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch document tags');
      return res.json();
    },
    enabled: !!documentId,
  });
}

function useDocumentVersions(documentId: string | null) {
  return useQuery<(DocumentVersion & { uploaderName: string | null })[]>({
    queryKey: ['/api/documents/versions', documentId],
    queryFn: async () => {
      if (!documentId) return [];
      const res = await fetch(`/api/documents/versions/${encodeURIComponent(documentId)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch versions');
      return res.json();
    },
    enabled: !!documentId,
  });
}

function TagFilterBar({ 
  tags, 
  selectedTagId, 
  onSelectTag, 
  onManageTags 
}: { 
  tags: DocumentTag[];
  selectedTagId: string | null;
  onSelectTag: (id: string | null) => void;
  onManageTags: () => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="tag-filter-bar">
      <Tags className="h-4 w-4 text-muted-foreground" />
      <Badge
        variant={selectedTagId === null ? "default" : "outline"}
        className="cursor-pointer"
        onClick={() => onSelectTag(null)}
        data-testid="tag-filter-all"
      >
        Alle
      </Badge>
      {tags.map(tag => (
        <Badge
          key={tag.id}
          variant={selectedTagId === tag.id ? "default" : "outline"}
          className="cursor-pointer"
          style={selectedTagId === tag.id 
            ? { backgroundColor: tag.color || undefined, borderColor: tag.color || undefined } 
            : { borderColor: tag.color || undefined, color: tag.color || undefined }}
          onClick={() => onSelectTag(selectedTagId === tag.id ? null : tag.id)}
          data-testid={`tag-filter-${tag.id}`}
        >
          {tag.name}
        </Badge>
      ))}
      <Button variant="ghost" size="sm" onClick={onManageTags} data-testid="button-manage-tags">
        <Plus className="h-3 w-3 mr-1" />
        Tags verwalten
      </Button>
    </div>
  );
}

function TagManageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: tags = [] } = useDocumentTags();
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState(TAG_PALETTE[0].color);
  const [editingTag, setEditingTag] = useState<DocumentTag | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  const createTag = useMutation({
    mutationFn: async () => {
      await apiRequest('POST', '/api/documents/tags', { name: newTagName, color: newTagColor });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents/tags'] });
      setNewTagName('');
      toast({ title: 'Tag erstellt' });
    },
    onError: () => toast({ title: 'Fehler', description: 'Tag konnte nicht erstellt werden.', variant: 'destructive' }),
  });

  const updateTag = useMutation({
    mutationFn: async () => {
      if (!editingTag) return;
      await apiRequest('PATCH', `/api/documents/tags/${editingTag.id}`, { name: editName, color: editColor });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents/tags'] });
      setEditingTag(null);
      toast({ title: 'Tag aktualisiert' });
    },
    onError: () => toast({ title: 'Fehler', description: 'Tag konnte nicht aktualisiert werden.', variant: 'destructive' }),
  });

  const deleteTag = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/documents/tags/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents/tags'] });
      toast({ title: 'Tag gelöscht' });
    },
    onError: () => toast({ title: 'Fehler', description: 'Tag konnte nicht gelöscht werden.', variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-manage-tags">
        <DialogHeader>
          <DialogTitle>Tags verwalten</DialogTitle>
          <DialogDescription>Erstellen, bearbeiten oder löschen Sie Dokument-Tags.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label>Neuer Tag</Label>
              <Input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="Tag-Name"
                data-testid="input-new-tag-name"
              />
            </div>
            <div className="flex gap-1">
              {TAG_PALETTE.map(p => (
                <button
                  key={p.color}
                  className="w-6 h-6 rounded-full border-2 transition-all"
                  style={{
                    backgroundColor: p.color,
                    borderColor: newTagColor === p.color ? 'var(--foreground)' : 'transparent',
                  }}
                  onClick={() => setNewTagColor(p.color)}
                  title={p.label}
                  data-testid={`color-pick-new-${p.color}`}
                />
              ))}
            </div>
            <Button
              size="sm"
              onClick={() => createTag.mutate()}
              disabled={!newTagName.trim() || createTag.isPending}
              data-testid="button-create-tag"
            >
              {createTag.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto">
            {tags.map(tag => (
              <div key={tag.id} className="flex items-center gap-2 p-2 rounded-md border">
                {editingTag?.id === tag.id ? (
                  <>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1"
                      data-testid={`input-edit-tag-${tag.id}`}
                    />
                    <div className="flex gap-1">
                      {TAG_PALETTE.map(p => (
                        <button
                          key={p.color}
                          className="w-5 h-5 rounded-full border-2 transition-all"
                          style={{
                            backgroundColor: p.color,
                            borderColor: editColor === p.color ? 'var(--foreground)' : 'transparent',
                          }}
                          onClick={() => setEditColor(p.color)}
                          data-testid={`color-pick-edit-${p.color}`}
                        />
                      ))}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => updateTag.mutate()} disabled={updateTag.isPending} data-testid={`button-save-tag-${tag.id}`}>
                      {updateTag.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'OK'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingTag(null)} data-testid={`button-cancel-edit-${tag.id}`}>
                      <X className="h-3 w-3" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span
                      className="w-4 h-4 rounded-full flex-shrink-0"
                      style={{ backgroundColor: tag.color || '#888' }}
                    />
                    <span className="flex-1 text-sm">{tag.name}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        setEditingTag(tag);
                        setEditName(tag.name);
                        setEditColor(tag.color || TAG_PALETTE[0].color);
                      }}
                      data-testid={`button-edit-tag-${tag.id}`}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteTag.mutate(tag.id)}
                      disabled={deleteTag.isPending}
                      data-testid={`button-delete-tag-${tag.id}`}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </>
                )}
              </div>
            ))}
            {tags.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Keine Tags vorhanden</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-tags-dialog">
            Schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentTagBadges({
  documentId,
  allTags,
  selectedTagId,
  onTagClick,
}: {
  documentId: string;
  allTags: DocumentTag[];
  selectedTagId: string | null;
  onTagClick: (tagId: string) => void;
}) {
  const { data: docTags = [] } = useDocumentTagsForDocument(documentId);

  if (docTags.length === 0) return null;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {docTags.map(tag => (
        <Badge
          key={tag.id}
          variant="outline"
          className="cursor-pointer text-xs"
          style={{ borderColor: tag.color || undefined, color: tag.color || undefined }}
          onClick={(e) => {
            e.stopPropagation();
            onTagClick(tag.id);
          }}
          data-testid={`badge-doc-tag-${tag.id}`}
        >
          {tag.name}
        </Badge>
      ))}
    </div>
  );
}

function AssignTagsDialog({
  open,
  onOpenChange,
  documentId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: allTags = [] } = useDocumentTags();
  const { data: docTags = [] } = useDocumentTagsForDocument(documentId);

  const assignedTagIds = new Set(docTags.map(t => t.id));

  const assignTag = useMutation({
    mutationFn: async (tagId: string) => {
      if (!documentId) return;
      await apiRequest('POST', `/api/documents/${encodeURIComponent(documentId)}/tags`, { tagIds: [tagId] });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents', documentId, 'tags'] });
    },
    onError: () => toast({ title: 'Fehler', variant: 'destructive' }),
  });

  const removeTag = useMutation({
    mutationFn: async (tagId: string) => {
      if (!documentId) return;
      await apiRequest('DELETE', `/api/documents/${encodeURIComponent(documentId)}/tags/${tagId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents', documentId, 'tags'] });
    },
    onError: () => toast({ title: 'Fehler', variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" data-testid="dialog-assign-tags">
        <DialogHeader>
          <DialogTitle>Tags zuweisen</DialogTitle>
          <DialogDescription>Wählen Sie Tags für dieses Dokument.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-4 max-h-60 overflow-y-auto">
          {allTags.map(tag => {
            const isAssigned = assignedTagIds.has(tag.id);
            return (
              <div key={tag.id} className="flex items-center gap-2 p-2 rounded-md border">
                <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color || '#888' }} />
                <span className="flex-1 text-sm">{tag.name}</span>
                {isAssigned ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => removeTag.mutate(tag.id)}
                    disabled={removeTag.isPending}
                    data-testid={`button-remove-assign-${tag.id}`}
                  >
                    <X className="h-3 w-3 mr-1" />
                    Entfernen
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => assignTag.mutate(tag.id)}
                    disabled={assignTag.isPending}
                    data-testid={`button-assign-tag-${tag.id}`}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Zuweisen
                  </Button>
                )}
              </div>
            );
          })}
          {allTags.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Erstellen Sie zuerst Tags über &quot;Tags verwalten&quot;.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-assign-tags">
            Schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VersionHistoryDialog({
  open,
  onOpenChange,
  documentId,
  documentName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string | null;
  documentName: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: versions = [], isLoading } = useDocumentVersions(documentId);
  const [uploadMode, setUploadMode] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [changeNote, setChangeNote] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadVersion = useMutation({
    mutationFn: async () => {
      if (!documentId || !selectedFile) return;
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('documentId', documentId);
      formData.append('changeNote', changeNote);

      const csrfMatch = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
      const headers: Record<string, string> = {};
      if (csrfMatch) headers['x-csrf-token'] = decodeURIComponent(csrfMatch[1]);

      const res = await fetch('/api/documents/versions', {
        method: 'POST',
        body: formData,
        credentials: 'include',
        headers,
      });
      if (!res.ok) throw new Error('Upload failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents/versions', documentId] });
      setUploadMode(false);
      setSelectedFile(null);
      setChangeNote('');
      toast({ title: 'Neue Version hochgeladen' });
    },
    onError: () => toast({ title: 'Fehler beim Hochladen', variant: 'destructive' }),
  });

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setUploadMode(false);
      setSelectedFile(null);
      setChangeNote('');
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl" data-testid="dialog-version-history">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Versionsverlauf
          </DialogTitle>
          <DialogDescription>{documentName}</DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {!uploadMode && (
            <Button onClick={() => setUploadMode(true)} data-testid="button-upload-new-version">
              <Upload className="h-4 w-4 mr-2" />
              Neue Version hochladen
            </Button>
          )}

          {uploadMode && (
            <Card>
              <CardContent className="pt-4 space-y-3">
                <div className="space-y-1">
                  <Label>Datei</Label>
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setSelectedFile(f);
                    }}
                  />
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="button-select-version-file"
                  >
                    {selectedFile ? (
                      <>
                        <File className="h-4 w-4 mr-2" />
                        {selectedFile.name}
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Datei auswählen
                      </>
                    )}
                  </Button>
                </div>
                <div className="space-y-1">
                  <Label>Änderungsnotiz</Label>
                  <Input
                    value={changeNote}
                    onChange={(e) => setChangeNote(e.target.value)}
                    placeholder="Was wurde geändert?"
                    data-testid="input-change-note"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => uploadVersion.mutate()}
                    disabled={!selectedFile || uploadVersion.isPending}
                    data-testid="button-submit-version"
                  >
                    {uploadVersion.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                    Hochladen
                  </Button>
                  <Button variant="outline" onClick={() => { setUploadMode(false); setSelectedFile(null); setChangeNote(''); }} data-testid="button-cancel-version-upload">
                    Abbrechen
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : versions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="h-8 w-8 mx-auto mb-2" />
              <p>Keine Versionen vorhanden</p>
              <p className="text-sm">Laden Sie die erste Version hoch.</p>
            </div>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Versionsnummer</TableHead>
                    <TableHead>Dateiname</TableHead>
                    <TableHead>Hochgeladen von</TableHead>
                    <TableHead>Datum</TableHead>
                    <TableHead>Änderungsnotiz</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {versions.map(v => (
                    <TableRow key={v.id} data-testid={`version-row-${v.id}`}>
                      <TableCell>
                        <Badge variant="outline">v{v.versionNumber}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{v.fileName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{v.uploaderName || '–'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {v.createdAt ? format(new Date(v.createdAt), 'dd.MM.yyyy HH:mm', { locale: de }) : '–'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{v.changeNote || '–'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} data-testid="button-close-versions">
            Schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PropertyDocumentsSection({ 
  propertyId, 
  propertyName, 
  propertyAddress,
  searchQuery,
  onUploadClick,
  allTags,
  selectedTagId,
  onTagClick,
  onAssignTags,
  onShowVersions,
}: { 
  propertyId: string;
  propertyName: string;
  propertyAddress: string;
  searchQuery: string;
  onUploadClick: () => void;
  allTags: DocumentTag[];
  selectedTagId: string | null;
  onTagClick: (tagId: string) => void;
  onAssignTags: (docId: string) => void;
  onShowVersions: (docId: string, docName: string) => void;
}) {
  const { data: documents = [] } = usePropertyDocuments(propertyId);
  const deleteDocument = useDeletePropertyDocument();

  const filteredDocs = documents.filter(doc => {
    if (!searchQuery) return true;
    return doc.name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const handleDelete = (doc: PropertyDocument) => {
    deleteDocument.mutate({ id: doc.id, propertyId: doc.property_id, fileUrl: doc.file_url });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Building2 className="h-5 w-5 text-primary" />
          <div>
            <CardTitle className="text-lg">{propertyName}</CardTitle>
            <p className="text-sm text-muted-foreground">{propertyAddress}</p>
          </div>
        </div>
        <Button onClick={onUploadClick} data-testid={`button-upload-property-${propertyId}`}>
          <FileText className="h-4 w-4 mr-2" />
          Dokument hochladen
        </Button>
      </CardHeader>
      <CardContent>
        <EnhancedDocumentList
          documents={filteredDocs}
          documentTypes={PROPERTY_DOCUMENT_TYPES}
          onDelete={handleDelete}
          isDeleting={deleteDocument.isPending}
          emptyMessage="Keine Dokumente"
          emptyDescription="Laden Sie Dokumente für diese Liegenschaft hoch."
          allTags={allTags}
          selectedTagId={selectedTagId}
          onTagClick={onTagClick}
          onAssignTags={onAssignTags}
          onShowVersions={onShowVersions}
        />
      </CardContent>
    </Card>
  );
}

function UnitDocumentsSection({ 
  unitId, 
  unitName,
  propertyName,
  unitDetails,
  searchQuery,
  onUploadClick,
  allTags,
  selectedTagId,
  onTagClick,
  onAssignTags,
  onShowVersions,
}: { 
  unitId: string;
  unitName: string;
  propertyName: string;
  unitDetails: string;
  searchQuery: string;
  onUploadClick: () => void;
  allTags: DocumentTag[];
  selectedTagId: string | null;
  onTagClick: (tagId: string) => void;
  onAssignTags: (docId: string) => void;
  onShowVersions: (docId: string, docName: string) => void;
}) {
  const { data: documents = [] } = useUnitDocuments(unitId);
  const deleteDocument = useDeleteUnitDocument();

  const filteredDocs = documents.filter(doc => {
    if (!searchQuery) return true;
    return doc.name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const handleDelete = (doc: UnitDocument) => {
    deleteDocument.mutate({ id: doc.id, unitId: doc.unit_id, fileUrl: doc.file_url });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Home className="h-5 w-5 text-primary" />
          <div>
            <CardTitle className="text-lg">Top {unitName}</CardTitle>
            <p className="text-sm text-muted-foreground">{propertyName} • {unitDetails}</p>
          </div>
        </div>
        <Button onClick={onUploadClick} data-testid={`button-upload-unit-${unitId}`}>
          <FileText className="h-4 w-4 mr-2" />
          Dokument hochladen
        </Button>
      </CardHeader>
      <CardContent>
        <EnhancedDocumentList
          documents={filteredDocs}
          documentTypes={UNIT_DOCUMENT_TYPES}
          onDelete={handleDelete}
          isDeleting={deleteDocument.isPending}
          emptyMessage="Keine Dokumente"
          emptyDescription="Laden Sie Dokumente für diese Einheit hoch."
          allTags={allTags}
          selectedTagId={selectedTagId}
          onTagClick={onTagClick}
          onAssignTags={onAssignTags}
          onShowVersions={onShowVersions}
        />
      </CardContent>
    </Card>
  );
}

function TenantDocumentsSection({
  documents,
  searchQuery,
  selectedProperty,
  allTags,
  selectedTagId,
  onTagClick,
  onAssignTags,
  onShowVersions,
}: {
  documents: TenantDocumentWithTenant[];
  searchQuery: string;
  selectedProperty: string;
  allTags: DocumentTag[];
  selectedTagId: string | null;
  onTagClick: (tagId: string) => void;
  onAssignTags: (docId: string) => void;
  onShowVersions: (docId: string, docName: string) => void;
}) {
  const deleteDocument = useDeleteTenantDocument();

  const filteredDocs = documents.filter(doc => {
    const matchesSearch = !searchQuery || 
      doc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.tenant_name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesProperty = selectedProperty === 'all' || doc.property_id === selectedProperty;
    return matchesSearch && matchesProperty;
  });

  const handleDelete = (doc: TenantDocumentWithTenant) => {
    deleteDocument.mutate({ id: doc.id, tenantId: doc.tenant_id, fileUrl: doc.file_url });
  };

  if (filteredDocs.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-12 text-center">
        <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground">Keine Mieter-Dokumente vorhanden</p>
        <p className="text-sm text-muted-foreground mt-1">Dokumente werden automatisch bei Vorschreibungen erstellt oder können auf der Einheiten-Detailseite hochgeladen werden.</p>
      </div>
    );
  }

  const groupedByTenant = filteredDocs.reduce((acc, doc) => {
    if (!acc[doc.tenant_id]) {
      acc[doc.tenant_id] = {
        tenant_name: doc.tenant_name,
        documents: [],
      };
    }
    acc[doc.tenant_id].documents.push(doc);
    return acc;
  }, {} as Record<string, { tenant_name: string; documents: TenantDocumentWithTenant[] }>);

  return (
    <div className="space-y-6">
      {Object.entries(groupedByTenant).map(([tenantId, { tenant_name, documents: tenantDocs }]) => (
        <Card key={tenantId}>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-lg">{tenant_name}</CardTitle>
                <p className="text-sm text-muted-foreground">{tenantDocs.length} Dokument{tenantDocs.length !== 1 ? 'e' : ''}</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <EnhancedDocumentList
              documents={tenantDocs}
              documentTypes={TENANT_DOCUMENT_TYPES}
              onDelete={handleDelete}
              isDeleting={deleteDocument.isPending}
              emptyMessage="Keine Dokumente"
              emptyDescription="Laden Sie Dokumente für diesen Mieter hoch."
              allTags={allTags}
              selectedTagId={selectedTagId}
              onTagClick={onTagClick}
              onAssignTags={onAssignTags}
              onShowVersions={onShowVersions}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

interface EnhancedDocument {
  id: string;
  name: string;
  type: string;
  file_url: string;
  uploaded_at: string;
}

interface DocumentType {
  value: string;
  label: string;
}

function EnhancedDocumentList({
  documents,
  documentTypes,
  onDelete,
  isDeleting,
  emptyMessage,
  emptyDescription,
  allTags,
  selectedTagId,
  onTagClick,
  onAssignTags,
  onShowVersions,
}: {
  documents: EnhancedDocument[];
  documentTypes: DocumentType[];
  onDelete: (doc: any) => void;
  isDeleting: boolean;
  emptyMessage: string;
  emptyDescription: string;
  allTags: DocumentTag[];
  selectedTagId: string | null;
  onTagClick: (tagId: string) => void;
  onAssignTags: (docId: string) => void;
  onShowVersions: (docId: string, docName: string) => void;
}) {
  const getTypeLabel = (type: string) => {
    return documentTypes.find((t) => t.value === type)?.label || type;
  };

  const getTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      mietvertrag: 'bg-primary/10 text-primary',
      uebergabeprotokoll: 'bg-success/10 text-success',
      ruecknahmeprotokoll: 'bg-warning/10 text-warning',
      emailverkehr: 'bg-accent/10 text-accent-foreground',
      energieausweis: 'bg-success/10 text-success',
      wohnungsplaene: 'bg-primary/10 text-primary',
      gebaeudeplan: 'bg-primary/10 text-primary',
      grundbuchauszug: 'bg-warning/10 text-warning',
      lageplan: 'bg-accent/10 text-accent-foreground',
      versicherungspolizze: 'bg-destructive/10 text-destructive',
      nutzungsvertrag: 'bg-success/10 text-success',
      hausverwaltung: 'bg-primary/10 text-primary',
      protokolle: 'bg-accent/10 text-accent-foreground',
      benutzerdefiniert: 'bg-secondary text-secondary-foreground',
    };
    return colors[type] || 'bg-muted text-muted-foreground';
  };

  if (documents.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-12 text-center">
        <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground">{emptyMessage}</p>
        <p className="text-sm text-muted-foreground mt-1">{emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-visible">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead>Name</TableHead>
            <TableHead>Typ</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead>Hochgeladen am</TableHead>
            <TableHead className="text-right">Aktionen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((doc) => (
            <TableRow key={doc.id} className="hover:bg-muted/30" data-testid={`doc-row-${doc.id}`}>
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span
                    className="cursor-pointer hover:underline"
                    onClick={() => onShowVersions(doc.id, doc.name)}
                    data-testid={`link-versions-${doc.id}`}
                  >
                    {doc.name}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <Badge className={getTypeColor(doc.type)}>{getTypeLabel(doc.type)}</Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1 flex-wrap">
                  <DocumentTagBadges
                    documentId={doc.id}
                    allTags={allTags}
                    selectedTagId={selectedTagId}
                    onTagClick={onTagClick}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => onAssignTags(doc.id)}
                    data-testid={`button-assign-tags-${doc.id}`}
                  >
                    <Tags className="h-3 w-3" />
                  </Button>
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {format(new Date(doc.uploaded_at), 'dd.MM.yyyy HH:mm', { locale: de })}
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onShowVersions(doc.id, doc.name)}
                    data-testid={`button-versions-${doc.id}`}
                  >
                    <History className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" asChild>
                    <a href={doc.file_url} target="_blank" rel="noreferrer" data-testid={`link-view-${doc.id}`}>
                      <FileText className="h-4 w-4" />
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDelete(doc)}
                    disabled={isDeleting}
                    data-testid={`button-delete-doc-${doc.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function Documents() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProperty, setSelectedProperty] = useState<string>('all');
  const [activeTab, setActiveTab] = useState('property');
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<{ type: 'property' | 'unit'; id: string } | null>(null);
  const [tagManageOpen, setTagManageOpen] = useState(false);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [assignTagsDocId, setAssignTagsDocId] = useState<string | null>(null);
  const [assignTagsOpen, setAssignTagsOpen] = useState(false);
  const [versionDocId, setVersionDocId] = useState<string | null>(null);
  const [versionDocName, setVersionDocName] = useState('');
  const [versionDialogOpen, setVersionDialogOpen] = useState(false);

  const { data: properties } = useProperties();
  const { data: allUnits } = useUnits();
  const { data: tenantDocuments = [] } = useAllTenantDocuments();
  const { data: allTags = [] } = useDocumentTags();
  
  const uploadPropertyDoc = useUploadPropertyDocument();
  const uploadUnitDoc = useUploadUnitDocument();

  const filteredProperties = properties?.filter(p => 
    selectedProperty === 'all' || p.id === selectedProperty
  ) || [];

  const filteredUnits = allUnits?.filter(u =>
    selectedProperty === 'all' || u.propertyId === selectedProperty
  ) || [];

  const filteredTenantDocs = tenantDocuments.filter(doc =>
    selectedProperty === 'all' || doc.property_id === selectedProperty
  );

  const handleUploadClick = (type: 'property' | 'unit', id: string) => {
    setUploadTarget({ type, id });
    setUploadDialogOpen(true);
  };

  const handleUpload = async (file: File, type: string, name: string) => {
    if (!uploadTarget) return;
    
    if (uploadTarget.type === 'property') {
      await uploadPropertyDoc.mutateAsync({
        propertyId: uploadTarget.id,
        file,
        documentType: type,
        documentName: name,
      });
    } else {
      await uploadUnitDoc.mutateAsync({
        unitId: uploadTarget.id,
        file,
        documentType: type,
        documentName: name,
      });
    }
    setUploadDialogOpen(false);
    setUploadTarget(null);
  };

  const handleTagClick = (tagId: string) => {
    setSelectedTagId(prev => prev === tagId ? null : tagId);
  };

  const handleAssignTags = (docId: string) => {
    setAssignTagsDocId(docId);
    setAssignTagsOpen(true);
  };

  const handleShowVersions = (docId: string, docName: string) => {
    setVersionDocId(docId);
    setVersionDocName(docName);
    setVersionDialogOpen(true);
  };

  const currentDocumentTypes = uploadTarget?.type === 'property' 
    ? PROPERTY_DOCUMENT_TYPES 
    : UNIT_DOCUMENT_TYPES;

  const isUploading = uploadPropertyDoc.isPending || uploadUnitDoc.isPending;

  return (
    <MainLayout
      title="Dokumente"
      subtitle="Dokumentenmanagement für Liegenschaften und Einheiten"
    >
      <div className="flex flex-col sm:flex-row gap-4 mb-4">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input 
            type="search" 
            placeholder="Dokument suchen..." 
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="input-search-documents"
          />
        </div>

        <Select value={selectedProperty} onValueChange={setSelectedProperty}>
          <SelectTrigger className="w-48" data-testid="select-property-filter">
            <SelectValue placeholder="Alle Liegenschaften" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Liegenschaften</SelectItem>
            {properties?.map(p => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mb-6 p-3 rounded-md border bg-card">
        <TagFilterBar
          tags={allTags}
          selectedTagId={selectedTagId}
          onSelectTag={setSelectedTagId}
          onManageTags={() => setTagManageOpen(true)}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Liegenschaften</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-property-count">{filteredProperties.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Einheiten</CardTitle>
            <Home className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-unit-count">{filteredUnits.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Mieter-Dokumente</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-tenant-doc-count">{filteredTenantDocs.length}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="property" data-testid="tab-property">
            <Building2 className="h-4 w-4 mr-2" />
            Liegenschaften
          </TabsTrigger>
          <TabsTrigger value="unit" data-testid="tab-unit">
            <Home className="h-4 w-4 mr-2" />
            Einheiten
          </TabsTrigger>
          <TabsTrigger value="tenant" data-testid="tab-tenant">
            <Users className="h-4 w-4 mr-2" />
            Mieter
          </TabsTrigger>
        </TabsList>

        <TabsContent value="property" className="space-y-6">
          {filteredProperties.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-12 text-center">
              <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Keine Liegenschaften vorhanden</p>
              <p className="text-sm text-muted-foreground mt-1">Erstellen Sie zuerst eine Liegenschaft.</p>
            </div>
          ) : (
            filteredProperties.map((property) => (
              <PropertyDocumentsSection
                key={property.id}
                propertyId={property.id}
                propertyName={property.name}
                propertyAddress={`${property.address}, ${(property as any).postal_code || (property as any).postalCode} ${property.city}`}
                searchQuery={searchQuery}
                onUploadClick={() => handleUploadClick('property', property.id)}
                allTags={allTags}
                selectedTagId={selectedTagId}
                onTagClick={handleTagClick}
                onAssignTags={handleAssignTags}
                onShowVersions={handleShowVersions}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="unit" className="space-y-6">
          {filteredUnits.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-12 text-center">
              <Home className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Keine Einheiten vorhanden</p>
              <p className="text-sm text-muted-foreground mt-1">Erstellen Sie zuerst Einheiten in einer Liegenschaft.</p>
            </div>
          ) : (
            filteredUnits.map((unit) => {
              const property = properties?.find(p => p.id === unit.propertyId);
              return (
                <UnitDocumentsSection
                  key={unit.id}
                  unitId={unit.id}
                  unitName={unit.topNummer}
                  propertyName={property?.name || ''}
                  unitDetails={`${unit.qm} m² • ${unit.type}`}
                  searchQuery={searchQuery}
                  onUploadClick={() => handleUploadClick('unit', unit.id)}
                  allTags={allTags}
                  selectedTagId={selectedTagId}
                  onTagClick={handleTagClick}
                  onAssignTags={handleAssignTags}
                  onShowVersions={handleShowVersions}
                />
              );
            })
          )}
        </TabsContent>

        <TabsContent value="tenant" className="space-y-6">
          <TenantDocumentsSection
            documents={tenantDocuments}
            searchQuery={searchQuery}
            selectedProperty={selectedProperty}
            allTags={allTags}
            selectedTagId={selectedTagId}
            onTagClick={handleTagClick}
            onAssignTags={handleAssignTags}
            onShowVersions={handleShowVersions}
          />
        </TabsContent>
      </Tabs>

      <DocumentUploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        documentTypes={currentDocumentTypes}
        onUpload={handleUpload}
        isUploading={isUploading}
      />

      <TagManageDialog
        open={tagManageOpen}
        onOpenChange={setTagManageOpen}
      />

      <AssignTagsDialog
        open={assignTagsOpen}
        onOpenChange={setAssignTagsOpen}
        documentId={assignTagsDocId}
      />

      <VersionHistoryDialog
        open={versionDialogOpen}
        onOpenChange={setVersionDialogOpen}
        documentId={versionDocId}
        documentName={versionDocName}
      />
    </MainLayout>
  );
}
