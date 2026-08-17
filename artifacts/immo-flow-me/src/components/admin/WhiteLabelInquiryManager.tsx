import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import { Loader2, Building2, Clock, CheckCircle, Phone, Mail, MessageSquare, Trash2, Edit, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import { de } from "date-fns/locale";

interface WhiteLabelInquiry {
  id: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string | null;
  propertyCount: number | null;
  unitCount: number | null;
  message: string | null;
  status: string;
  notes: string | null;
  createdAt: string;
}

const statusOptions = [
  { value: "neu", label: "Neu", color: "secondary" },
  { value: "kontaktiert", label: "Kontaktiert", color: "blue" },
  { value: "demo_vereinbart", label: "Demo vereinbart", color: "purple" },
  { value: "verhandlung", label: "In Verhandlung", color: "orange" },
  { value: "abgeschlossen", label: "Abgeschlossen", color: "green" },
  { value: "abgelehnt", label: "Abgelehnt", color: "destructive" },
];

export function WhiteLabelInquiryManager() {
  const [selectedInquiry, setSelectedInquiry] = useState<WhiteLabelInquiry | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editStatus, setEditStatus] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const { data: inquiries, isLoading } = useQuery<WhiteLabelInquiry[]>({
    queryKey: ["/api/admin/white-label/inquiries"],
  });

  const updateInquiry = useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: string; notes: string }) => {
      const response = await apiRequest("PATCH", `/api/admin/white-label/inquiries/${id}`, { status, notes });
      return response.json();
    },
    onSuccess: () => {
      toast.success("Anfrage aktualisiert");
      setShowEditDialog(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/white-label/inquiries"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Fehler beim Aktualisieren");
    },
  });

  const deleteInquiry = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/admin/white-label/inquiries/${id}`);
      return response.json();
    },
    onSuccess: () => {
      toast.success("Anfrage gelöscht");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/white-label/inquiries"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Fehler beim Löschen");
    },
  });

  const handleEdit = (inquiry: WhiteLabelInquiry) => {
    setSelectedInquiry(inquiry);
    setEditStatus(inquiry.status);
    setEditNotes(inquiry.notes || "");
    setShowEditDialog(true);
  };

  const handleSave = () => {
    if (selectedInquiry) {
      updateInquiry.mutate({
        id: selectedInquiry.id,
        status: editStatus,
        notes: editNotes,
      });
    }
  };

  const getStatusBadge = (status: string) => {
    const option = statusOptions.find(o => o.value === status);
    if (!option) return <Badge variant="outline">{status}</Badge>;
    
    switch (option.color) {
      case "green":
        return <Badge variant="default" className="bg-green-500"><CheckCircle className="h-3 w-3 mr-1" />{option.label}</Badge>;
      case "blue":
        return <Badge variant="default" className="bg-blue-500">{option.label}</Badge>;
      case "purple":
        return <Badge variant="default" className="bg-purple-500">{option.label}</Badge>;
      case "orange":
        return <Badge variant="default" className="bg-orange-500">{option.label}</Badge>;
      case "destructive":
        return <Badge variant="destructive">{option.label}</Badge>;
      default:
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />{option.label}</Badge>;
    }
  };

  const toggleRow = (id: string) => {
    setExpandedRow(expandedRow === id ? null : id);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            White-Label Anfragen
          </CardTitle>
          <CardDescription>
            Verwalten Sie eingehende White-Label Anfragen von Hausverwaltungen
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !inquiries?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Noch keine White-Label Anfragen</p>
              <p className="text-sm mt-2">Neue Anfragen erscheinen hier automatisch</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Firma</TableHead>
                  <TableHead>Kontakt</TableHead>
                  <TableHead>Objekte</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Datum</TableHead>
                  <TableHead className="text-right">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inquiries.map((inquiry) => (
                  <>
                    <TableRow key={inquiry.id} className="cursor-pointer" onClick={() => toggleRow(inquiry.id)}>
                      <TableCell>
                        {expandedRow === inquiry.id ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{inquiry.companyName}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="text-sm">{inquiry.contactPerson}</div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Mail className="h-3 w-3" />
                            {inquiry.email}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {inquiry.propertyCount && (
                          <span className="text-sm">{inquiry.propertyCount} Obj.</span>
                        )}
                        {inquiry.unitCount && (
                          <span className="text-sm text-muted-foreground ml-1">/ {inquiry.unitCount} Einh.</span>
                        )}
                      </TableCell>
                      <TableCell>{getStatusBadge(inquiry.status)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(inquiry.createdAt), "dd.MM.yyyy", { locale: de })}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(inquiry)}
                            data-testid={`button-edit-inquiry-${inquiry.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              if (confirm("Anfrage wirklich löschen?")) {
                                deleteInquiry.mutate(inquiry.id);
                              }
                            }}
                            data-testid={`button-delete-inquiry-${inquiry.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {expandedRow === inquiry.id && (
                      <TableRow key={`${inquiry.id}-details`}>
                        <TableCell colSpan={7} className="bg-muted/30">
                          <div className="p-4 space-y-3">
                            <div className="grid sm:grid-cols-2 gap-4">
                              {inquiry.phone && (
                                <div className="flex items-center gap-2">
                                  <Phone className="h-4 w-4 text-muted-foreground" />
                                  <span>{inquiry.phone}</span>
                                </div>
                              )}
                              <div className="flex items-center gap-2">
                                <Mail className="h-4 w-4 text-muted-foreground" />
                                <a href={`mailto:${inquiry.email}`} className="hover:underline text-primary">
                                  {inquiry.email}
                                </a>
                              </div>
                            </div>
                            {inquiry.message && (
                              <div className="mt-2">
                                <div className="flex items-center gap-2 text-sm font-medium mb-1">
                                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                                  Nachricht:
                                </div>
                                <p className="text-sm text-muted-foreground bg-background p-3 rounded-lg">
                                  {inquiry.message}
                                </p>
                              </div>
                            )}
                            {inquiry.notes && (
                              <div className="mt-2">
                                <div className="text-sm font-medium mb-1">Interne Notizen:</div>
                                <p className="text-sm text-muted-foreground bg-background p-3 rounded-lg">
                                  {inquiry.notes}
                                </p>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anfrage bearbeiten</DialogTitle>
            <DialogDescription>
              {selectedInquiry?.companyName} - {selectedInquiry?.contactPerson}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger data-testid="select-status">
                  <SelectValue placeholder="Status wählen" />
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
              <label className="text-sm font-medium">Interne Notizen</label>
              <Textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Notizen für das Team..."
                rows={4}
                data-testid="textarea-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleSave} disabled={updateInquiry.isPending} data-testid="button-save-inquiry">
              {updateInquiry.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
