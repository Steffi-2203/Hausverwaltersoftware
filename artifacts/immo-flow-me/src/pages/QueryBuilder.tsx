import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { MainLayout } from "@/components/layout/MainLayout";
import { Database, Play, Download, Save, Trash2, Plus, X, Loader2, FileSpreadsheet } from "lucide-react";

interface FieldMeta {
  label: string;
  type: string;
  operators: string[];
  enumValues?: string[];
}

interface EntityInfo {
  label: string;
  fields: string[];
  fieldMetadata: Record<string, FieldMeta>;
}

interface Filter {
  id: string;
  field: string;
  operator: string;
  value: string;
}

interface QueryConfig {
  entity: string;
  selectedFields: string[];
  filters: Array<{ field: string; operator: string; value: string }>;
  groupBy?: string;
  orderBy?: { field: string; direction: "asc" | "desc" };
  limit: number;
}

interface SavedReport {
  id: string;
  name: string;
  description: string | null;
  reportConfig: QueryConfig;
  createdBy: string | null;
  isShared: boolean;
  lastRun: string | null;
  createdAt: string;
}

export default function QueryBuilder() {
  const { toast } = useToast();
  const [selectedEntity, setSelectedEntity] = useState<string>("");
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [groupBy, setGroupBy] = useState<string>("");
  const [orderField, setOrderField] = useState<string>("");
  const [orderDir, setOrderDir] = useState<"asc" | "desc">("asc");
  const [limit, setLimit] = useState<number>(100);
  const [results, setResults] = useState<any[] | null>(null);
  const [resultCount, setResultCount] = useState<number>(0);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDescription, setSaveDescription] = useState("");
  const [saveShared, setSaveShared] = useState(false);

  const { data: entities } = useQuery<Record<string, EntityInfo>>({
    queryKey: ["/api/reports/entities"],
  });

  const { data: savedReports } = useQuery<SavedReport[]>({
    queryKey: ["/api/reports/saved"],
  });

  const currentEntity = entities?.[selectedEntity];

  const previewMutation = useMutation({
    mutationFn: async (config: QueryConfig) => {
      const res = await apiRequest("POST", "/api/reports/preview", config);
      return res.json();
    },
    onSuccess: (data) => {
      setResults(data.rows);
      setResultCount(data.count);
    },
    onError: (error: any) => {
      toast({ title: "Fehler", description: error.message || "Abfrage fehlgeschlagen", variant: "destructive" });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest("POST", "/api/reports/saved", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reports/saved"] });
      setSaveDialogOpen(false);
      setSaveName("");
      setSaveDescription("");
      setSaveShared(false);
      toast({ title: "Gespeichert", description: "Bericht wurde gespeichert" });
    },
    onError: () => {
      toast({ title: "Fehler", description: "Speichern fehlgeschlagen", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/reports/saved/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reports/saved"] });
      toast({ title: "Gelöscht", description: "Bericht wurde gelöscht" });
    },
  });

  const runSavedMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/reports/saved/${id}/run`);
      return res.json();
    },
    onSuccess: (data) => {
      setResults(data.rows);
      setResultCount(data.count);
      queryClient.invalidateQueries({ queryKey: ["/api/reports/saved"] });
    },
    onError: (error: any) => {
      toast({ title: "Fehler", description: error.message || "Ausführung fehlgeschlagen", variant: "destructive" });
    },
  });

  const buildConfig = useCallback((): QueryConfig => {
    return {
      entity: selectedEntity,
      selectedFields,
      filters: filters.map(f => ({ field: f.field, operator: f.operator, value: f.value })),
      groupBy: groupBy || undefined,
      orderBy: orderField ? { field: orderField, direction: orderDir } : undefined,
      limit,
    };
  }, [selectedEntity, selectedFields, filters, groupBy, orderField, orderDir, limit]);

  const handlePreview = () => {
    if (!selectedEntity || selectedFields.length === 0) {
      toast({ title: "Fehler", description: "Bitte wählen Sie eine Entität und mindestens ein Feld", variant: "destructive" });
      return;
    }
    previewMutation.mutate(buildConfig());
  };

  const handleExportCSV = async () => {
    if (!selectedEntity || selectedFields.length === 0) return;
    try {
      const config = buildConfig();
      config.limit = 10000;
      const res = await apiRequest("POST", "/api/reports/export", config);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bericht_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Fehler", description: "Export fehlgeschlagen", variant: "destructive" });
    }
  };

  const handleSave = () => {
    if (!saveName || !selectedEntity || selectedFields.length === 0) return;
    saveMutation.mutate({
      name: saveName,
      description: saveDescription || null,
      reportConfig: buildConfig(),
      isShared: saveShared,
    });
  };

  const loadReport = (report: SavedReport) => {
    const config = report.reportConfig;
    setSelectedEntity(config.entity);
    setSelectedFields(config.selectedFields);
    setFilters(config.filters?.map((f, i) => ({ ...f, id: `f-${i}` })) || []);
    setGroupBy(config.groupBy || "");
    setOrderField(config.orderBy?.field || "");
    setOrderDir(config.orderBy?.direction || "asc");
    setLimit(config.limit || 100);
    setResults(null);
  };

  const handleEntityChange = (entity: string) => {
    setSelectedEntity(entity);
    setSelectedFields([]);
    setFilters([]);
    setGroupBy("");
    setOrderField("");
    setResults(null);
  };

  const toggleField = (field: string) => {
    setSelectedFields(prev =>
      prev.includes(field) ? prev.filter(f => f !== field) : [...prev, field]
    );
  };

  const addFilter = () => {
    setFilters(prev => [...prev, { id: `f-${Date.now()}`, field: "", operator: "=", value: "" }]);
  };

  const updateFilter = (id: string, updates: Partial<Filter>) => {
    setFilters(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const removeFilter = (id: string) => {
    setFilters(prev => prev.filter(f => f.id !== id));
  };

  const fieldEntries = currentEntity
    ? Object.entries(currentEntity.fieldMetadata)
    : [];

  return (
    <MainLayout title="">
      <div className="p-4 space-y-4" data-testid="query-builder-page">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold" data-testid="text-page-title">Abfrage-Builder</h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {savedReports && savedReports.length > 0 && (
              <Select onValueChange={(val) => {
                const report = savedReports.find(r => r.id === val);
                if (report) loadReport(report);
              }}>
                <SelectTrigger className="w-[220px]" data-testid="select-saved-reports">
                  <SelectValue placeholder="Gespeicherte Berichte" />
                </SelectTrigger>
                <SelectContent>
                  {savedReports.map(r => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant="outline"
              onClick={() => setSaveDialogOpen(true)}
              disabled={!selectedEntity || selectedFields.length === 0}
              data-testid="button-save-report"
            >
              <Save className="h-4 w-4 mr-1" />
              Bericht speichern
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Konfiguration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-sm font-medium">Datenquelle</Label>
                <Select value={selectedEntity} onValueChange={handleEntityChange}>
                  <SelectTrigger data-testid="select-entity">
                    <SelectValue placeholder="Datenquelle wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {entities && Object.entries(entities).map(([key, val]) => (
                      <SelectItem key={key} value={key}>{val.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {currentEntity && (
                <>
                  <div>
                    <Label className="text-sm font-medium mb-2 block">Felder</Label>
                    <div className="space-y-1 max-h-[200px] overflow-y-auto">
                      {fieldEntries.map(([key, meta]) => (
                        <div key={key} className="flex items-center gap-2">
                          <Checkbox
                            id={`field-${key}`}
                            checked={selectedFields.includes(key)}
                            onCheckedChange={() => toggleField(key)}
                            data-testid={`checkbox-field-${key}`}
                          />
                          <label htmlFor={`field-${key}`} className="text-sm cursor-pointer">
                            {meta.label}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-sm font-medium">Filter</Label>
                      <Button variant="outline" size="sm" onClick={addFilter} data-testid="button-add-filter">
                        <Plus className="h-3 w-3 mr-1" />
                        Filter hinzufügen
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {filters.map(filter => (
                        <div key={filter.id} className="flex items-center gap-1 flex-wrap" data-testid={`filter-row-${filter.id}`}>
                          <Select value={filter.field} onValueChange={v => updateFilter(filter.id, { field: v })}>
                            <SelectTrigger className="w-[130px]" data-testid={`select-filter-field-${filter.id}`}>
                              <SelectValue placeholder="Feld" />
                            </SelectTrigger>
                            <SelectContent>
                              {fieldEntries.map(([key, meta]) => (
                                <SelectItem key={key} value={key}>{meta.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select value={filter.operator} onValueChange={v => updateFilter(filter.id, { operator: v })}>
                            <SelectTrigger className="w-[100px]" data-testid={`select-filter-op-${filter.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(filter.field && currentEntity.fieldMetadata[filter.field]?.operators || ["=", "!=", ">", "<", "enthält", "ist leer"]).map(op => (
                                <SelectItem key={op} value={op}>{op}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {filter.operator !== "ist leer" && filter.operator !== "ist nicht leer" && (
                            currentEntity.fieldMetadata[filter.field]?.enumValues ? (
                              <Select value={filter.value} onValueChange={v => updateFilter(filter.id, { value: v })}>
                                <SelectTrigger className="w-[120px]" data-testid={`select-filter-value-${filter.id}`}>
                                  <SelectValue placeholder="Wert" />
                                </SelectTrigger>
                                <SelectContent>
                                  {currentEntity.fieldMetadata[filter.field].enumValues!.map(ev => (
                                    <SelectItem key={ev} value={ev}>{ev}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                value={filter.value}
                                onChange={e => updateFilter(filter.id, { value: e.target.value })}
                                placeholder="Wert"
                                className="w-[120px]"
                                data-testid={`input-filter-value-${filter.id}`}
                              />
                            )
                          )}
                          <Button variant="ghost" size="icon" onClick={() => removeFilter(filter.id)} data-testid={`button-remove-filter-${filter.id}`}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm font-medium">Gruppierung</Label>
                    <Select value={groupBy} onValueChange={setGroupBy}>
                      <SelectTrigger data-testid="select-group-by">
                        <SelectValue placeholder="Keine Gruppierung" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Keine Gruppierung</SelectItem>
                        {fieldEntries.map(([key, meta]) => (
                          <SelectItem key={key} value={key}>{meta.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Label className="text-sm font-medium">Sortierung</Label>
                      <Select value={orderField} onValueChange={setOrderField}>
                        <SelectTrigger data-testid="select-order-field">
                          <SelectValue placeholder="Sortierfeld" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Keine Sortierung</SelectItem>
                          {fieldEntries.map(([key, meta]) => (
                            <SelectItem key={key} value={key}>{meta.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Richtung</Label>
                      <Select value={orderDir} onValueChange={v => setOrderDir(v as "asc" | "desc")}>
                        <SelectTrigger className="w-[130px]" data-testid="select-order-dir">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="asc">Aufsteigend</SelectItem>
                          <SelectItem value="desc">Absteigend</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm font-medium">Limit</Label>
                    <Input
                      type="number"
                      value={limit}
                      onChange={e => setLimit(Math.max(1, Math.min(10000, parseInt(e.target.value) || 100)))}
                      data-testid="input-limit"
                    />
                  </div>
                </>
              )}

              <Button
                className="w-full"
                onClick={handlePreview}
                disabled={!selectedEntity || selectedFields.length === 0 || previewMutation.isPending}
                data-testid="button-preview"
              >
                {previewMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
                Vorschau
              </Button>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">Ergebnisse</CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                {results !== null && (
                  <Badge variant="secondary" data-testid="badge-row-count">{resultCount} Zeilen</Badge>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportCSV}
                  disabled={!results || results.length === 0}
                  data-testid="button-export-csv"
                >
                  <Download className="h-3 w-3 mr-1" />
                  CSV Export
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {results === null && (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground" data-testid="text-no-results">
                  <FileSpreadsheet className="h-10 w-10 mb-3" />
                  <p className="text-sm">Wählen Sie eine Datenquelle und Felder, dann klicken Sie auf Vorschau</p>
                </div>
              )}
              {results !== null && results.length === 0 && (
                <div className="text-center py-8 text-muted-foreground" data-testid="text-empty-results">
                  <p>Keine Daten gefunden</p>
                </div>
              )}
              {results !== null && results.length > 0 && (
                <div className="overflow-auto max-h-[500px]">
                  <Table data-testid="table-results">
                    <TableHeader>
                      <TableRow>
                        {Object.keys(results[0]).map(col => {
                          const fieldKey = col.replace('_', '.');
                          const meta = currentEntity?.fieldMetadata[fieldKey] || currentEntity?.fieldMetadata[col];
                          return (
                            <TableHead key={col}>{meta?.label || col}</TableHead>
                          );
                        })}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results.map((row, idx) => (
                        <TableRow key={idx} data-testid={`row-result-${idx}`}>
                          {Object.values(row).map((val: any, ci) => (
                            <TableCell key={ci}>
                              {val === null || val === undefined ? <span className="text-muted-foreground">-</span> : String(val)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {savedReports && savedReports.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Gespeicherte Berichte</CardTitle>
            </CardHeader>
            <CardContent>
              <Table data-testid="table-saved-reports">
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Beschreibung</TableHead>
                    <TableHead>Geteilt</TableHead>
                    <TableHead>Letzte Ausführung</TableHead>
                    <TableHead>Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {savedReports.map(report => (
                    <TableRow key={report.id} data-testid={`row-saved-report-${report.id}`}>
                      <TableCell className="font-medium">{report.name}</TableCell>
                      <TableCell className="text-muted-foreground">{report.description || "-"}</TableCell>
                      <TableCell>
                        {report.isShared ? <Badge variant="secondary">Geteilt</Badge> : <span className="text-muted-foreground">Privat</span>}
                      </TableCell>
                      <TableCell>
                        {report.lastRun
                          ? new Date(report.lastRun).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="outline" size="sm" onClick={() => loadReport(report)} data-testid={`button-load-report-${report.id}`}>
                            Laden
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => runSavedMutation.mutate(report.id)}
                            disabled={runSavedMutation.isPending}
                            data-testid={`button-run-report-${report.id}`}
                          >
                            <Play className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteMutation.mutate(report.id)}
                            data-testid={`button-delete-report-${report.id}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Bericht speichern</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                  placeholder="z.B. Mieterliste aktiv"
                  data-testid="input-save-name"
                />
              </div>
              <div>
                <Label>Beschreibung</Label>
                <Textarea
                  value={saveDescription}
                  onChange={e => setSaveDescription(e.target.value)}
                  placeholder="Optionale Beschreibung"
                  data-testid="input-save-description"
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={saveShared}
                  onCheckedChange={setSaveShared}
                  data-testid="switch-save-shared"
                />
                <Label>Für Team freigeben</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>Abbrechen</Button>
              <Button
                onClick={handleSave}
                disabled={!saveName || saveMutation.isPending}
                data-testid="button-confirm-save"
              >
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                Speichern
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
