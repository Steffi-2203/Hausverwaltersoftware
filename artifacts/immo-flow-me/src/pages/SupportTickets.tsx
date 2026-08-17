import { useState, useMemo } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Ticket,
  Plus,
  MessageSquare,
  Clock,
  CheckCircle,
  AlertCircle,
  User,
  Building2,
  Filter,
  Search,
  Loader2,
  Send,
  ArrowLeft,
  XCircle,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { toast } from 'sonner';
import { useProperties } from '@/hooks/useProperties';
import { useUnits } from '@/hooks/useUnits';
import { useTenants } from '@/hooks/useTenants';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

const statusLabels: Record<string, string> = {
  offen: 'Offen',
  in_bearbeitung: 'In Bearbeitung',
  wartend: 'Wartend',
  geloest: 'Geloest',
  geschlossen: 'Geschlossen',
};

const statusStyles: Record<string, string> = {
  offen: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  in_bearbeitung: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  wartend: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  geloest: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  geschlossen: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const categoryLabels: Record<string, string> = {
  schadensmeldung: 'Schadensmeldung',
  anfrage: 'Anfrage',
  beschwerde: 'Beschwerde',
  wartung: 'Wartung',
  vertragsanfrage: 'Vertragsanfrage',
  sonstiges: 'Sonstiges',
};

const categoryStyles: Record<string, string> = {
  schadensmeldung: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  anfrage: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  beschwerde: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  wartung: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  vertragsanfrage: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
  sonstiges: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

const priorityLabels: Record<string, string> = {
  hoch: 'Hoch',
  normal: 'Normal',
  niedrig: 'Niedrig',
};

const priorityStyles: Record<string, string> = {
  hoch: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  normal: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  niedrig: 'bg-gray-50 text-gray-500 dark:bg-gray-900 dark:text-gray-500',
};

interface TicketData {
  id: string;
  ticketNumber: string;
  ticket_number?: string;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  tenantId: string | null;
  tenant_id?: string | null;
  unitId: string | null;
  unit_id?: string | null;
  propertyId: string | null;
  property_id?: string | null;
  assignedToId: string | null;
  assigned_to_id?: string | null;
  createdById: string | null;
  created_by_id?: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  resolved_at?: string | null;
  dueDate: string | null;
  due_date?: string | null;
  createdAt: string;
  created_at?: string;
  updatedAt: string;
  updated_at?: string;
  comments?: CommentData[];
}

interface CommentData {
  id: string;
  ticketId: string;
  ticket_id?: string;
  authorId: string | null;
  author_id?: string | null;
  content: string;
  isInternal: boolean;
  is_internal?: boolean;
  createdAt: string;
  created_at?: string;
}

function getField<T>(obj: any, camel: string, snake: string): T {
  return obj[camel] !== undefined ? obj[camel] : obj[snake];
}

export default function SupportTicketsPage() {
  const qc = useQueryClient();
  const { data: properties } = useProperties();
  const { data: units } = useUnits();
  const { data: tenants } = useTenants();

  const [statusFilter, setStatusFilter] = useState('alle');
  const [categoryFilter, setCategoryFilter] = useState('alle');
  const [priorityFilter, setPriorityFilter] = useState('alle');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [newComment, setNewComment] = useState('');

  const [newTicket, setNewTicket] = useState({
    subject: '',
    category: '',
    priority: 'normal',
    propertyId: '',
    unitId: '',
    tenantId: '',
    description: '',
  });

  const buildQueryParams = () => {
    const params = new URLSearchParams();
    if (statusFilter !== 'alle') params.set('status', statusFilter);
    if (categoryFilter !== 'alle') params.set('category', categoryFilter);
    return params.toString();
  };

  const { data: tickets, isLoading: ticketsLoading } = useQuery<TicketData[]>({
    queryKey: ['/api/tickets', statusFilter, categoryFilter],
    queryFn: async () => {
      const qs = buildQueryParams();
      const url = `/api/tickets${qs ? `?${qs}` : ''}`;
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch tickets');
      return response.json();
    },
  });

  const { data: ticketDetail, isLoading: detailLoading } = useQuery<TicketData>({
    queryKey: ['/api/tickets', selectedTicketId],
    queryFn: async () => {
      const response = await fetch(`/api/tickets/${selectedTicketId}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch ticket');
      return response.json();
    },
    enabled: !!selectedTicketId,
  });

  const createTicketMutation = useMutation({
    mutationFn: async (data: typeof newTicket) => {
      const response = await apiRequest('POST', '/api/tickets', {
        subject: data.subject,
        category: data.category,
        priority: data.priority,
        propertyId: data.propertyId || undefined,
        unitId: data.unitId || undefined,
        tenantId: data.tenantId || undefined,
        description: data.description,
      });
      return response.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/tickets'] });
      toast.success('Ticket erfolgreich erstellt');
      setShowCreateDialog(false);
      resetNewTicket();
    },
    onError: (error: Error) => {
      toast.error(`Fehler beim Erstellen: ${error.message}`);
    },
  });

  const updateTicketMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; status?: string; priority?: string }) => {
      const response = await apiRequest('PUT', `/api/tickets/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/tickets'] });
      toast.success('Ticket aktualisiert');
    },
    onError: (error: Error) => {
      toast.error(`Fehler: ${error.message}`);
    },
  });

  const addCommentMutation = useMutation({
    mutationFn: async ({ ticketId, content }: { ticketId: string; content: string }) => {
      const response = await apiRequest('POST', `/api/tickets/${ticketId}/comments`, { content });
      return response.json();
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['/api/tickets', variables.ticketId] });
      toast.success('Kommentar hinzugefuegt');
      setNewComment('');
    },
    onError: (error: Error) => {
      toast.error(`Fehler: ${error.message}`);
    },
  });

  const resetNewTicket = () => {
    setNewTicket({
      subject: '',
      category: '',
      priority: 'normal',
      propertyId: '',
      unitId: '',
      tenantId: '',
      description: '',
    });
  };

  const filteredTickets = useMemo(() => {
    let result = tickets || [];

    if (priorityFilter !== 'alle') {
      result = result.filter(t => t.priority === priorityFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(t =>
        t.subject.toLowerCase().includes(q) ||
        (getField<string>(t, 'ticketNumber', 'ticket_number') || '').toLowerCase().includes(q)
      );
    }

    return result;
  }, [tickets, priorityFilter, searchQuery]);

  const filteredUnits = useMemo(() => {
    if (!newTicket.propertyId) return [];
    return (units || []).filter(u =>
      (u.property_id || u.propertyId) === newTicket.propertyId
    );
  }, [newTicket.propertyId, units]);

  const filteredTenants = useMemo(() => {
    if (!newTicket.unitId) return [];
    return (tenants || []).filter(t =>
      (t.unit_id || t.unitId) === newTicket.unitId && t.status === 'aktiv'
    );
  }, [newTicket.unitId, tenants]);

  const stats = useMemo(() => {
    const all = tickets || [];
    return {
      total: all.length,
      offen: all.filter(t => t.status === 'offen').length,
      in_bearbeitung: all.filter(t => t.status === 'in_bearbeitung').length,
      geloest: all.filter(t => t.status === 'geloest').length,
      geschlossen: all.filter(t => t.status === 'geschlossen').length,
    };
  }, [tickets]);

  const getPropertyName = (propertyId: string | null | undefined) => {
    if (!propertyId) return null;
    const p = properties?.find(pr => pr.id === propertyId);
    return p?.name || null;
  };

  const getUnitLabel = (unitId: string | null | undefined) => {
    if (!unitId) return null;
    const u = units?.find(un => un.id === unitId);
    return u ? `Top ${u.top_nummer || u.topNummer}` : null;
  };

  const getTenantName = (tenantId: string | null | undefined) => {
    if (!tenantId) return null;
    const t = tenants?.find(tn => tn.id === tenantId);
    return t ? `${t.first_name || t.firstName} ${t.last_name || t.lastName}` : null;
  };

  const handleCreateTicket = () => {
    if (!newTicket.subject.trim() || !newTicket.category || !newTicket.description.trim()) {
      toast.error('Bitte fuellen Sie alle Pflichtfelder aus');
      return;
    }
    createTicketMutation.mutate(newTicket);
  };

  const handleAddComment = () => {
    if (!newComment.trim() || !selectedTicketId) return;
    addCommentMutation.mutate({ ticketId: selectedTicketId, content: newComment });
  };

  const handleStatusChange = (ticketId: string, newStatus: string) => {
    updateTicketMutation.mutate({ id: ticketId, status: newStatus });
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '-';
    try {
      return format(new Date(dateStr), 'dd.MM.yyyy HH:mm', { locale: de });
    } catch {
      return '-';
    }
  };

  const formatDateShort = (dateStr: string | null | undefined) => {
    if (!dateStr) return '-';
    try {
      return format(new Date(dateStr), 'dd.MM.yyyy', { locale: de });
    } catch {
      return '-';
    }
  };

  if (selectedTicketId && ticketDetail) {
    const detail = ticketDetail;
    const detailTicketNumber = getField<string>(detail, 'ticketNumber', 'ticket_number') || '';
    const detailPropertyId = getField<string | null>(detail, 'propertyId', 'property_id');
    const detailUnitId = getField<string | null>(detail, 'unitId', 'unit_id');
    const detailTenantId = getField<string | null>(detail, 'tenantId', 'tenant_id');
    const detailCreatedAt = getField<string>(detail, 'createdAt', 'created_at');
    const detailUpdatedAt = getField<string>(detail, 'updatedAt', 'updated_at');
    const detailResolvedAt = getField<string | null>(detail, 'resolvedAt', 'resolved_at');

    return (
      <MainLayout title="Ticket-Details" subtitle={detailTicketNumber}>
        <div className="mb-4">
          <Button
            variant="ghost"
            onClick={() => setSelectedTicketId(null)}
            data-testid="button-back-to-list"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Zurueck zur Liste
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
                  <div>
                    <p className="text-sm text-muted-foreground">{detailTicketNumber}</p>
                    <h2 className="text-xl font-semibold" data-testid="text-ticket-subject">{detail.subject}</h2>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className={categoryStyles[detail.category] || ''}>
                      {categoryLabels[detail.category] || detail.category}
                    </Badge>
                    <Badge className={priorityStyles[detail.priority] || ''}>
                      {priorityLabels[detail.priority] || detail.priority}
                    </Badge>
                    <Badge className={statusStyles[detail.status] || ''}>
                      {statusLabels[detail.status] || detail.status}
                    </Badge>
                  </div>
                </div>

                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <p className="whitespace-pre-wrap" data-testid="text-ticket-description">{detail.description}</p>
                </div>

                {detail.resolution && (
                  <div className="mt-4 p-4 rounded-md bg-green-50 dark:bg-green-900/20">
                    <p className="text-sm font-medium text-green-800 dark:text-green-300 mb-1">Loesung</p>
                    <p className="text-sm text-green-700 dark:text-green-400">{detail.resolution}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <MessageSquare className="h-5 w-5" />
                  Kommentare ({detail.comments?.length || 0})
                </h3>

                {detail.comments && detail.comments.length > 0 ? (
                  <div className="space-y-4 mb-6">
                    {[...detail.comments].reverse().map((comment) => {
                      const commentCreatedAt = getField<string>(comment, 'createdAt', 'created_at');
                      return (
                        <div
                          key={comment.id}
                          className="border rounded-md p-4"
                          data-testid={`comment-${comment.id}`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm font-medium">Benutzer</span>
                              {(comment.isInternal || comment.is_internal) && (
                                <Badge variant="outline" className="text-xs">Intern</Badge>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {formatDate(commentCreatedAt)}
                            </span>
                          </div>
                          <p className="text-sm whitespace-pre-wrap">{comment.content}</p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground mb-6">Noch keine Kommentare.</p>
                )}

                <div className="space-y-3">
                  <Label>Neuer Kommentar</Label>
                  <Textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Kommentar schreiben..."
                    data-testid="input-new-comment"
                  />
                  <Button
                    onClick={handleAddComment}
                    disabled={!newComment.trim() || addCommentMutation.isPending}
                    data-testid="button-add-comment"
                  >
                    {addCommentMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    Kommentar senden
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardContent className="p-6 space-y-4">
                <h3 className="font-semibold">Details</h3>

                <div className="space-y-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Status</span>
                    <Select
                      value={detail.status}
                      onValueChange={(val) => handleStatusChange(detail.id, val)}
                      data-testid="select-status-change"
                    >
                      <SelectTrigger className="w-[160px]" data-testid="select-trigger-status-change">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="offen">Offen</SelectItem>
                        <SelectItem value="in_bearbeitung">In Bearbeitung</SelectItem>
                        <SelectItem value="wartend">Wartend</SelectItem>
                        <SelectItem value="geloest">Geloest</SelectItem>
                        <SelectItem value="geschlossen">Geschlossen</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Prioritaet</span>
                    <Badge className={priorityStyles[detail.priority] || ''}>
                      {priorityLabels[detail.priority] || detail.priority}
                    </Badge>
                  </div>

                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Kategorie</span>
                    <Badge className={categoryStyles[detail.category] || ''}>
                      {categoryLabels[detail.category] || detail.category}
                    </Badge>
                  </div>

                  {detailPropertyId && (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Liegenschaft</span>
                      <span>{getPropertyName(detailPropertyId) || '-'}</span>
                    </div>
                  )}

                  {detailUnitId && (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Einheit</span>
                      <span>{getUnitLabel(detailUnitId) || '-'}</span>
                    </div>
                  )}

                  {detailTenantId && (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Mieter</span>
                      <span>{getTenantName(detailTenantId) || '-'}</span>
                    </div>
                  )}

                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Erstellt am</span>
                    <span>{formatDate(detailCreatedAt)}</span>
                  </div>

                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Aktualisiert</span>
                    <span>{formatDate(detailUpdatedAt)}</span>
                  </div>

                  {detailResolvedAt && (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Geloest am</span>
                      <span>{formatDate(detailResolvedAt)}</span>
                    </div>
                  )}

                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Zugewiesen an</span>
                    <span className="text-muted-foreground">Nicht zugewiesen</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </MainLayout>
    );
  }

  if (selectedTicketId && detailLoading) {
    return (
      <MainLayout title="Ticket-Details" subtitle="Laden...">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout
      title="Support-Tickets"
      subtitle="Mieteranfragen, Schadensmeldungen und Support verwalten"
    >
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Ticket className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Gesamt</p>
                <p className="text-2xl font-bold" data-testid="text-stat-total">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
                <AlertCircle className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Offen</p>
                <p className="text-2xl font-bold" data-testid="text-stat-offen">{stats.offen}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Clock className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">In Bearbeitung</p>
                <p className="text-2xl font-bold" data-testid="text-stat-in-bearbeitung">{stats.in_bearbeitung}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Geloest</p>
                <p className="text-2xl font-bold" data-testid="text-stat-geloest">{stats.geloest}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800">
                <XCircle className="h-5 w-5 text-gray-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Geschlossen</p>
                <p className="text-2xl font-bold" data-testid="text-stat-geschlossen">{stats.geschlossen}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]" data-testid="select-trigger-status-filter">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alle">Alle Status</SelectItem>
              <SelectItem value="offen">Offen</SelectItem>
              <SelectItem value="in_bearbeitung">In Bearbeitung</SelectItem>
              <SelectItem value="wartend">Wartend</SelectItem>
              <SelectItem value="geloest">Geloest</SelectItem>
              <SelectItem value="geschlossen">Geschlossen</SelectItem>
            </SelectContent>
          </Select>

          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-trigger-category-filter">
              <SelectValue placeholder="Kategorie" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alle">Alle Kategorien</SelectItem>
              <SelectItem value="schadensmeldung">Schadensmeldung</SelectItem>
              <SelectItem value="anfrage">Anfrage</SelectItem>
              <SelectItem value="beschwerde">Beschwerde</SelectItem>
              <SelectItem value="wartung">Wartung</SelectItem>
              <SelectItem value="vertragsanfrage">Vertragsanfrage</SelectItem>
              <SelectItem value="sonstiges">Sonstiges</SelectItem>
            </SelectContent>
          </Select>

          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-[150px]" data-testid="select-trigger-priority-filter">
              <SelectValue placeholder="Prioritaet" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alle">Alle Prioritaeten</SelectItem>
              <SelectItem value="hoch">Hoch</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="niedrig">Niedrig</SelectItem>
            </SelectContent>
          </Select>

          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Suchen..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-[200px]"
              data-testid="input-search"
            />
          </div>
        </div>

        <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-ticket">
          <Plus className="h-4 w-4 mr-2" />
          Neues Ticket
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {ticketsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !filteredTickets || filteredTickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Ticket className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">Keine Tickets</p>
              <p className="text-muted-foreground text-sm mt-1">
                Es sind keine Support-Tickets vorhanden.
              </p>
              <Button className="mt-4" onClick={() => setShowCreateDialog(true)} data-testid="button-create-first-ticket">
                <Plus className="h-4 w-4 mr-2" />
                Erstes Ticket erstellen
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket-Nr.</TableHead>
                  <TableHead>Betreff</TableHead>
                  <TableHead>Kategorie</TableHead>
                  <TableHead>Prioritaet</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Erstellt am</TableHead>
                  <TableHead>Zugewiesen an</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTickets.map((ticket) => {
                  const ticketNumber = getField<string>(ticket, 'ticketNumber', 'ticket_number') || '';
                  const createdAt = getField<string>(ticket, 'createdAt', 'created_at');

                  return (
                    <TableRow
                      key={ticket.id}
                      className="cursor-pointer hover-elevate"
                      onClick={() => setSelectedTicketId(ticket.id)}
                      data-testid={`row-ticket-${ticket.id}`}
                    >
                      <TableCell className="font-mono text-sm" data-testid={`text-ticket-number-${ticket.id}`}>
                        {ticketNumber}
                      </TableCell>
                      <TableCell className="font-medium max-w-[300px] truncate" data-testid={`text-ticket-subject-${ticket.id}`}>
                        {ticket.subject}
                      </TableCell>
                      <TableCell>
                        <Badge className={categoryStyles[ticket.category] || ''} data-testid={`badge-category-${ticket.id}`}>
                          {categoryLabels[ticket.category] || ticket.category}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={priorityStyles[ticket.priority] || ''} data-testid={`badge-priority-${ticket.id}`}>
                          {priorityLabels[ticket.priority] || ticket.priority}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={statusStyles[ticket.status] || ''} data-testid={`badge-status-${ticket.id}`}>
                          {statusLabels[ticket.status] || ticket.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDateShort(createdAt)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        Nicht zugewiesen
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Neues Ticket erstellen</DialogTitle>
            <DialogDescription>
              Erstellen Sie ein neues Support-Ticket fuer eine Anfrage oder Schadensmeldung.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Betreff *</Label>
              <Input
                value={newTicket.subject}
                onChange={(e) => setNewTicket(t => ({ ...t, subject: e.target.value }))}
                placeholder="Kurze Beschreibung des Anliegens..."
                data-testid="input-ticket-subject"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Kategorie *</Label>
                <Select
                  value={newTicket.category}
                  onValueChange={(val) => setNewTicket(t => ({ ...t, category: val }))}
                >
                  <SelectTrigger data-testid="select-trigger-category">
                    <SelectValue placeholder="Kategorie waehlen..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="schadensmeldung">Schadensmeldung</SelectItem>
                    <SelectItem value="anfrage">Anfrage</SelectItem>
                    <SelectItem value="beschwerde">Beschwerde</SelectItem>
                    <SelectItem value="wartung">Wartung</SelectItem>
                    <SelectItem value="vertragsanfrage">Vertragsanfrage</SelectItem>
                    <SelectItem value="sonstiges">Sonstiges</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Prioritaet</Label>
                <Select
                  value={newTicket.priority}
                  onValueChange={(val) => setNewTicket(t => ({ ...t, priority: val }))}
                >
                  <SelectTrigger data-testid="select-trigger-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hoch">Hoch</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="niedrig">Niedrig</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Liegenschaft
              </Label>
              <Select
                value={newTicket.propertyId}
                onValueChange={(val) => setNewTicket(t => ({ ...t, propertyId: val, unitId: '', tenantId: '' }))}
              >
                <SelectTrigger data-testid="select-trigger-property">
                  <SelectValue placeholder="Liegenschaft auswaehlen..." />
                </SelectTrigger>
                <SelectContent>
                  {properties?.map(property => (
                    <SelectItem key={property.id} value={property.id}>
                      {property.name} - {property.address}, {property.postal_code} {property.city}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {newTicket.propertyId && (
              <div className="space-y-2">
                <Label>Einheit</Label>
                <Select
                  value={newTicket.unitId}
                  onValueChange={(val) => setNewTicket(t => ({ ...t, unitId: val, tenantId: '' }))}
                  disabled={filteredUnits.length === 0}
                >
                  <SelectTrigger data-testid="select-trigger-unit">
                    <SelectValue placeholder={filteredUnits.length === 0 ? 'Keine Einheiten' : 'Einheit auswaehlen...'} />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredUnits.map(unit => (
                      <SelectItem key={unit.id} value={unit.id}>
                        Top {unit.top_nummer || unit.topNummer} ({unit.type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {newTicket.unitId && (
              <div className="space-y-2">
                <Label>Mieter (optional)</Label>
                <Select
                  value={newTicket.tenantId}
                  onValueChange={(val) => setNewTicket(t => ({ ...t, tenantId: val }))}
                >
                  <SelectTrigger data-testid="select-trigger-tenant">
                    <SelectValue placeholder={filteredTenants.length === 0 ? 'Keine aktiven Mieter' : 'Mieter auswaehlen...'} />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredTenants.map(tenant => (
                      <SelectItem key={tenant.id} value={tenant.id}>
                        {tenant.first_name || tenant.firstName} {tenant.last_name || tenant.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>Beschreibung *</Label>
              <Textarea
                value={newTicket.description}
                onChange={(e) => setNewTicket(t => ({ ...t, description: e.target.value }))}
                placeholder="Detaillierte Beschreibung des Anliegens..."
                rows={5}
                data-testid="input-ticket-description"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setShowCreateDialog(false); resetNewTicket(); }}
              data-testid="button-cancel-create"
            >
              Abbrechen
            </Button>
            <Button
              onClick={handleCreateTicket}
              disabled={createTicketMutation.isPending}
              data-testid="button-submit-ticket"
            >
              {createTicketMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Ticket erstellen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
