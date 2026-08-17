import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, FileKey, Plus, CheckCircle, AlertTriangle, PauseCircle, XCircle, Edit, Globe, Users, Euro } from "lucide-react";
import { toast } from "sonner";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import { de } from "date-fns/locale";

interface Organization {
  id: string;
  name: string;
  brandName: string | null;
}

interface WhiteLabelLicense {
  license: {
    id: string;
    organizationId: string;
    licenseName: string;
    monthlyPrice: string | null;
    setupFee: string | null;
    contractStart: string;
    contractEnd: string | null;
    status: string;
    customDomain: string | null;
    maxUsers: number | null;
    notes: string | null;
    createdAt: string;
  };
  organization: Organization | null;
}

const statusOptions = [
  { value: "aktiv", label: "Aktiv", icon: CheckCircle, color: "green" },
  { value: "gekuendigt", label: "Gekündigt", icon: XCircle, color: "red" },
  { value: "pausiert", label: "Pausiert", icon: PauseCircle, color: "orange" },
  { value: "abgelaufen", label: "Abgelaufen", icon: AlertTriangle, color: "gray" },
];

export function WhiteLabelLicenseManager() {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedLicense, setSelectedLicense] = useState<WhiteLabelLicense | null>(null);
  const [formData, setFormData] = useState({
    organizationId: "",
    licenseName: "",
    monthlyPrice: "",
    setupFee: "",
    contractStart: new Date().toISOString().split("T")[0],
    contractEnd: "",
    customDomain: "",
    maxUsers: "",
    notes: "",
    status: "aktiv",
  });

  const { data: licenses, isLoading } = useQuery<WhiteLabelLicense[]>({
    queryKey: ["/api/admin/white-label/licenses"],
  });

  const { data: organizations } = useQuery<Organization[]>({
    queryKey: ["/api/admin/organizations"],
  });

  const createLicense = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await apiRequest("POST", "/api/admin/white-label/licenses", data);
      return response.json();
    },
    onSuccess: () => {
      toast.success("Lizenz erstellt");
      setShowCreateDialog(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/white-label/licenses"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Fehler beim Erstellen");
    },
  });

  const updateLicense = useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<typeof formData>) => {
      const response = await apiRequest("PATCH", `/api/admin/white-label/licenses/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      toast.success("Lizenz aktualisiert");
      setShowEditDialog(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/white-label/licenses"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Fehler beim Aktualisieren");
    },
  });

  const resetForm = () => {
    setFormData({
      organizationId: "",
      licenseName: "",
      monthlyPrice: "",
      setupFee: "",
      contractStart: new Date().toISOString().split("T")[0],
      contractEnd: "",
      customDomain: "",
      maxUsers: "",
      notes: "",
      status: "aktiv",
    });
  };

  const handleEdit = (item: WhiteLabelLicense) => {
    setSelectedLicense(item);
    setFormData({
      organizationId: item.license.organizationId,
      licenseName: item.license.licenseName,
      monthlyPrice: item.license.monthlyPrice || "",
      setupFee: item.license.setupFee || "",
      contractStart: item.license.contractStart,
      contractEnd: item.license.contractEnd || "",
      customDomain: item.license.customDomain || "",
      maxUsers: item.license.maxUsers?.toString() || "",
      notes: item.license.notes || "",
      status: item.license.status,
    });
    setShowEditDialog(true);
  };

  const handleCreate = () => {
    createLicense.mutate(formData);
  };

  const handleUpdate = () => {
    if (selectedLicense) {
      updateLicense.mutate({
        id: selectedLicense.license.id,
        status: formData.status,
        monthlyPrice: formData.monthlyPrice,
        contractEnd: formData.contractEnd || null,
        customDomain: formData.customDomain,
        maxUsers: formData.maxUsers,
        notes: formData.notes,
      });
    }
  };

  const getStatusBadge = (status: string) => {
    const option = statusOptions.find((o) => o.value === status);
    if (!option) return <Badge variant="outline">{status}</Badge>;

    const Icon = option.icon;
    switch (option.color) {
      case "green":
        return <Badge variant="default" className="bg-green-500"><Icon className="h-3 w-3 mr-1" />{option.label}</Badge>;
      case "red":
        return <Badge variant="destructive"><Icon className="h-3 w-3 mr-1" />{option.label}</Badge>;
      case "orange":
        return <Badge variant="default" className="bg-orange-500"><Icon className="h-3 w-3 mr-1" />{option.label}</Badge>;
      default:
        return <Badge variant="outline"><Icon className="h-3 w-3 mr-1" />{option.label}</Badge>;
    }
  };

  const totalMRR = licenses?.reduce((sum, item) => {
    if (item.license.status === "aktiv" && item.license.monthlyPrice) {
      return sum + parseFloat(item.license.monthlyPrice);
    }
    return sum;
  }, 0) || 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Aktive Lizenzen</CardDescription>
            <CardTitle className="text-2xl flex items-center gap-2">
              <FileKey className="h-5 w-5 text-green-500" />
              {licenses?.filter((l) => l.license.status === "aktiv").length || 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>White-Label MRR</CardDescription>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Euro className="h-5 w-5 text-primary" />
              {totalMRR.toLocaleString("de-AT")} EUR
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Custom Domains</CardDescription>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Globe className="h-5 w-5 text-indigo-500" />
              {licenses?.filter((l) => l.license.customDomain).length || 0}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileKey className="h-5 w-5" />
                White-Label Lizenzen
              </CardTitle>
              <CardDescription>Verwalten Sie aktive White-Label Kunden</CardDescription>
            </div>
            <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-license">
              <Plus className="h-4 w-4 mr-2" />
              Neue Lizenz
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !licenses?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileKey className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Noch keine White-Label Lizenzen</p>
              <p className="text-sm mt-2">Erstellen Sie eine neue Lizenz für einen Kunden</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organisation</TableHead>
                  <TableHead>Lizenz</TableHead>
                  <TableHead>Preis/Monat</TableHead>
                  <TableHead>Domain</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Vertragsbeginn</TableHead>
                  <TableHead className="text-right">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {licenses.map((item) => (
                  <TableRow key={item.license.id}>
                    <TableCell className="font-medium">
                      {item.organization?.brandName || item.organization?.name || "Unbekannt"}
                    </TableCell>
                    <TableCell>{item.license.licenseName}</TableCell>
                    <TableCell>
                      {item.license.monthlyPrice ? `${parseFloat(item.license.monthlyPrice).toLocaleString("de-AT")} EUR` : "-"}
                    </TableCell>
                    <TableCell>
                      {item.license.customDomain ? (
                        <span className="text-sm text-primary">{item.license.customDomain}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>{getStatusBadge(item.license.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(item.license.contractStart), "dd.MM.yyyy", { locale: de })}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(item)} data-testid={`button-edit-license-${item.license.id}`}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Neue White-Label Lizenz</DialogTitle>
            <DialogDescription>Erstellen Sie eine neue Lizenz für eine Organisation</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Organisation *</Label>
              <Select value={formData.organizationId} onValueChange={(v) => setFormData({ ...formData, organizationId: v })}>
                <SelectTrigger data-testid="select-organization">
                  <SelectValue placeholder="Organisation wählen" />
                </SelectTrigger>
                <SelectContent>
                  {organizations?.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.brandName || org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Lizenzname *</Label>
              <Input
                value={formData.licenseName}
                onChange={(e) => setFormData({ ...formData, licenseName: e.target.value })}
                placeholder="z.B. White Label Standard"
                data-testid="input-license-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Monatspreis (EUR)</Label>
                <Input
                  type="number"
                  value={formData.monthlyPrice}
                  onChange={(e) => setFormData({ ...formData, monthlyPrice: e.target.value })}
                  placeholder="299"
                  data-testid="input-monthly-price"
                />
              </div>
              <div className="space-y-2">
                <Label>Setup-Gebühr (EUR)</Label>
                <Input
                  type="number"
                  value={formData.setupFee}
                  onChange={(e) => setFormData({ ...formData, setupFee: e.target.value })}
                  placeholder="500"
                  data-testid="input-setup-fee"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Vertragsbeginn *</Label>
                <Input
                  type="date"
                  value={formData.contractStart}
                  onChange={(e) => setFormData({ ...formData, contractStart: e.target.value })}
                  data-testid="input-contract-start"
                />
              </div>
              <div className="space-y-2">
                <Label>Vertragsende</Label>
                <Input
                  type="date"
                  value={formData.contractEnd}
                  onChange={(e) => setFormData({ ...formData, contractEnd: e.target.value })}
                  data-testid="input-contract-end"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Custom Domain</Label>
              <Input
                value={formData.customDomain}
                onChange={(e) => setFormData({ ...formData, customDomain: e.target.value })}
                placeholder="portal.kunde.at"
                data-testid="input-custom-domain"
              />
            </div>
            <div className="space-y-2">
              <Label>Max. Benutzer</Label>
              <Input
                type="number"
                value={formData.maxUsers}
                onChange={(e) => setFormData({ ...formData, maxUsers: e.target.value })}
                placeholder="Unbegrenzt"
                data-testid="input-max-users"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Abbrechen
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!formData.organizationId || !formData.licenseName || createLicense.isPending}
              data-testid="button-save-license"
            >
              {createLicense.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Erstellen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Lizenz bearbeiten</DialogTitle>
            <DialogDescription>
              {selectedLicense?.organization?.brandName || selectedLicense?.organization?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                <SelectTrigger data-testid="select-license-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Monatspreis (EUR)</Label>
              <Input
                type="number"
                value={formData.monthlyPrice}
                onChange={(e) => setFormData({ ...formData, monthlyPrice: e.target.value })}
                data-testid="input-edit-monthly-price"
              />
            </div>
            <div className="space-y-2">
              <Label>Vertragsende</Label>
              <Input
                type="date"
                value={formData.contractEnd}
                onChange={(e) => setFormData({ ...formData, contractEnd: e.target.value })}
                data-testid="input-edit-contract-end"
              />
            </div>
            <div className="space-y-2">
              <Label>Custom Domain</Label>
              <Input
                value={formData.customDomain}
                onChange={(e) => setFormData({ ...formData, customDomain: e.target.value })}
                data-testid="input-edit-custom-domain"
              />
            </div>
            <div className="space-y-2">
              <Label>Max. Benutzer</Label>
              <Input
                type="number"
                value={formData.maxUsers}
                onChange={(e) => setFormData({ ...formData, maxUsers: e.target.value })}
                data-testid="input-edit-max-users"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleUpdate} disabled={updateLicense.isPending} data-testid="button-update-license">
              {updateLicense.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
