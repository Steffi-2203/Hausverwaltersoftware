import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Phone, Mail, StickyNote, Users, FileText, Eye, Wrench, Plus, Trash2, ClipboardList, Calendar } from "lucide-react";
import type { Activity } from "@shared/schema";

const ACTIVITY_TYPES = [
  { value: "anruf", label: "Anruf", icon: Phone, color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  { value: "email", label: "E-Mail", icon: Mail, color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  { value: "notiz", label: "Notiz", icon: StickyNote, color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  { value: "meeting", label: "Meeting", icon: Users, color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
  { value: "brief", label: "Brief", icon: FileText, color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
  { value: "besichtigung", label: "Besichtigung", icon: Eye, color: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200" },
  { value: "wartung", label: "Wartung", icon: Wrench, color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
] as const;

function getTypeConfig(type: string) {
  return ACTIVITY_TYPES.find(t => t.value === type) || ACTIVITY_TYPES[2];
}

function relativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "gerade eben";
  if (diffMin < 60) return `vor ${diffMin} Minute${diffMin === 1 ? "" : "n"}`;
  if (diffHours < 24) return `vor ${diffHours} Stunde${diffHours === 1 ? "" : "n"}`;
  if (diffDays === 1) return "gestern";
  if (diffDays < 7) return `vor ${diffDays} Tagen`;
  if (diffDays < 30) return `vor ${Math.floor(diffDays / 7)} Woche${Math.floor(diffDays / 7) === 1 ? "" : "n"}`;
  return date.toLocaleDateString("de-AT");
}

export default function Aktivitaeten() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filterType, setFilterType] = useState<string>("alle");
  const [filterPropertyId, setFilterPropertyId] = useState<string>("alle");

  const [formType, setFormType] = useState("notiz");
  const [formSubject, setFormSubject] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formContactPerson, setFormContactPerson] = useState("");
  const [formPropertyId, setFormPropertyId] = useState<string>("");
  const [formTenantId, setFormTenantId] = useState<string>("");
  const [formDueDate, setFormDueDate] = useState("");

  const queryParams = new URLSearchParams();
  if (filterType !== "alle") queryParams.set("type", filterType);
  if (filterPropertyId !== "alle") queryParams.set("propertyId", filterPropertyId);

  const { data: activitiesData, isLoading } = useQuery<{ data: Activity[]; pagination: any }>({
    queryKey: ["/api/activities", filterType, filterPropertyId],
    queryFn: () => fetch(`/api/activities?${queryParams.toString()}`).then(r => r.json()),
  });

  const { data: stats } = useQuery<{ total: number; openTasks: number; byType: Record<string, number> }>({
    queryKey: ["/api/activities/stats"],
  });

  const { data: properties } = useQuery<{ data: any[] }>({
    queryKey: ["/api/properties"],
  });

  const { data: tenants } = useQuery<{ data: any[] }>({
    queryKey: ["/api/tenants"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/activities", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/activities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activities/stats"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: "Aktivität erstellt", description: "Die Aktivität wurde erfolgreich gespeichert." });
    },
    onError: () => {
      toast({ title: "Fehler", description: "Die Aktivität konnte nicht erstellt werden.", variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, completed }: { id: number; completed: boolean }) => {
      const res = await apiRequest("PATCH", `/api/activities/${id}`, { completed });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/activities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activities/stats"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/activities/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/activities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activities/stats"] });
      toast({ title: "Gelöscht", description: "Die Aktivität wurde entfernt." });
    },
  });

  function resetForm() {
    setFormType("notiz");
    setFormSubject("");
    setFormDescription("");
    setFormContactPerson("");
    setFormPropertyId("");
    setFormTenantId("");
    setFormDueDate("");
  }

  function handleCreate() {
    if (!formSubject.trim()) return;
    const data: any = { type: formType, subject: formSubject };
    if (formDescription) data.description = formDescription;
    if (formContactPerson) data.contactPerson = formContactPerson;
    if (formPropertyId) data.propertyId = formPropertyId;
    if (formTenantId) data.tenantId = formTenantId;
    if (formDueDate) data.dueDate = formDueDate;
    createMutation.mutate(data);
  }

  const activities = activitiesData?.data ?? [];
  const propertyList = properties?.data ?? (Array.isArray(properties) ? properties : []);
  const tenantList = tenants?.data ?? (Array.isArray(tenants) ? tenants : []);

  const filteredTenants = formPropertyId
    ? tenantList.filter((t: any) => {
        return true;
      })
    : tenantList;

  const propertyMap = new Map<string, string>();
  for (const p of propertyList) {
    propertyMap.set(p.id, p.name);
  }

  return (
    <MainLayout title="Aktivitätenprotokoll" subtitle="CRM - Anrufe, E-Mails, Notizen und Termine verwalten">
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card data-testid="stat-total">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Gesamt Aktivitäten</CardTitle>
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-count">{stats?.total ?? 0}</div>
            </CardContent>
          </Card>
          <Card data-testid="stat-anrufe">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Anrufe</CardTitle>
              <Phone className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-anrufe-count">{stats?.byType?.anruf ?? 0}</div>
            </CardContent>
          </Card>
          <Card data-testid="stat-emails">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">E-Mails</CardTitle>
              <Mail className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-emails-count">{stats?.byType?.email ?? 0}</div>
            </CardContent>
          </Card>
          <Card data-testid="stat-open-tasks">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Offene Aufgaben</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-open-count">{stats?.openTasks ?? 0}</div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Select value={filterPropertyId} onValueChange={setFilterPropertyId} data-testid="select-filter-property">
            <SelectTrigger className="w-[200px]" data-testid="trigger-filter-property">
              <SelectValue placeholder="Alle Liegenschaften" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alle" data-testid="option-property-alle">Alle Liegenschaften</SelectItem>
              {propertyList.map((p: any) => (
                <SelectItem key={p.id} value={p.id} data-testid={`option-property-${p.id}`}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterType} onValueChange={setFilterType} data-testid="select-filter-type">
            <SelectTrigger className="w-[180px]" data-testid="trigger-filter-type">
              <SelectValue placeholder="Alle Typen" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alle" data-testid="option-type-alle">Alle Typen</SelectItem>
              {ACTIVITY_TYPES.map(t => (
                <SelectItem key={t.value} value={t.value} data-testid={`option-type-${t.value}`}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="ml-auto">
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-activity">
                  <Plus className="h-4 w-4 mr-2" />
                  Neue Aktivität
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle>Neue Aktivität erstellen</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Typ</label>
                    <Select value={formType} onValueChange={setFormType}>
                      <SelectTrigger data-testid="input-activity-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ACTIVITY_TYPES.map(t => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Betreff</label>
                    <Input
                      value={formSubject}
                      onChange={e => setFormSubject(e.target.value)}
                      placeholder="Betreff eingeben"
                      data-testid="input-activity-subject"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Beschreibung</label>
                    <Textarea
                      value={formDescription}
                      onChange={e => setFormDescription(e.target.value)}
                      placeholder="Optionale Beschreibung"
                      data-testid="input-activity-description"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Kontaktperson</label>
                    <Input
                      value={formContactPerson}
                      onChange={e => setFormContactPerson(e.target.value)}
                      placeholder="Name der Kontaktperson"
                      data-testid="input-activity-contact"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Liegenschaft (optional)</label>
                    <Select value={formPropertyId || "none"} onValueChange={v => setFormPropertyId(v === "none" ? "" : v)}>
                      <SelectTrigger data-testid="input-activity-property">
                        <SelectValue placeholder="Keine Auswahl" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Keine Auswahl</SelectItem>
                        {propertyList.map((p: any) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Mieter (optional)</label>
                    <Select value={formTenantId || "none"} onValueChange={v => setFormTenantId(v === "none" ? "" : v)}>
                      <SelectTrigger data-testid="input-activity-tenant">
                        <SelectValue placeholder="Keine Auswahl" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Keine Auswahl</SelectItem>
                        {filteredTenants.map((t: any) => (
                          <SelectItem key={t.id} value={t.id}>{t.firstName} {t.lastName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Fälligkeitsdatum (optional)</label>
                    <Input
                      type="date"
                      value={formDueDate}
                      onChange={e => setFormDueDate(e.target.value)}
                      data-testid="input-activity-duedate"
                    />
                  </div>
                  <Button
                    onClick={handleCreate}
                    disabled={!formSubject.trim() || createMutation.isPending}
                    className="w-full"
                    data-testid="button-create-activity"
                  >
                    {createMutation.isPending ? "Wird erstellt..." : "Erstellen"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="space-y-3">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))
          ) : activities.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <ClipboardList className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground text-lg">Keine Aktivitäten vorhanden</p>
                <p className="text-muted-foreground text-sm mt-1">Erstellen Sie Ihre erste Aktivität mit dem Button oben.</p>
              </CardContent>
            </Card>
          ) : (
            activities.map((activity: Activity, index: number) => {
              const config = getTypeConfig(activity.type);
              const Icon = config.icon;
              return (
                <Card
                  key={activity.id}
                  className={index % 2 === 1 ? "bg-muted/30" : ""}
                  data-testid={`card-activity-${activity.id}`}
                >
                  <CardContent className="py-4">
                    <div className="flex items-start gap-4">
                      <div className="shrink-0 mt-1 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                        <Icon className="h-5 w-5 text-foreground/70" />
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-sm" data-testid={`text-subject-${activity.id}`}>{activity.subject}</span>
                          <Badge variant="secondary" className={`text-xs ${config.color}`} data-testid={`badge-type-${activity.id}`}>
                            {config.label}
                          </Badge>
                          {activity.completed && (
                            <Badge variant="outline" className="text-xs">Erledigt</Badge>
                          )}
                        </div>
                        {activity.description && (
                          <p className="text-sm text-muted-foreground" data-testid={`text-description-${activity.id}`}>{activity.description}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          {activity.contactPerson && (
                            <span data-testid={`text-contact-${activity.id}`}>Kontakt: {activity.contactPerson}</span>
                          )}
                          {activity.propertyId && propertyMap.has(activity.propertyId) && (
                            <span data-testid={`text-property-${activity.id}`}>Liegenschaft: {propertyMap.get(activity.propertyId)}</span>
                          )}
                          {activity.createdBy && (
                            <span data-testid={`text-createdby-${activity.id}`}>von {activity.createdBy}</span>
                          )}
                          {activity.createdAt && (
                            <span data-testid={`text-time-${activity.id}`}>{relativeTime(activity.createdAt as unknown as string)}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {activity.dueDate && (
                          <Checkbox
                            checked={activity.completed ?? false}
                            onCheckedChange={(checked) =>
                              toggleMutation.mutate({ id: activity.id, completed: !!checked })
                            }
                            data-testid={`checkbox-complete-${activity.id}`}
                          />
                        )}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" data-testid={`button-delete-${activity.id}`}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Aktivität löschen?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Diese Aktion kann nicht rückgängig gemacht werden. Die Aktivität wird dauerhaft gelöscht.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel data-testid={`button-cancel-delete-${activity.id}`}>Abbrechen</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteMutation.mutate(activity.id)}
                                data-testid={`button-confirm-delete-${activity.id}`}
                              >
                                Löschen
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>
    </MainLayout>
  );
}
