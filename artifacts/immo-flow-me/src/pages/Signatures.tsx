import { useState, useRef, useEffect, useCallback } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FileText,
  Plus,
  X,
  Loader2,
  PenTool,
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
  Shield,
  Type,
} from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface SignatureData {
  id: string;
  requestId: string;
  signerId: string | null;
  signerName: string;
  signerEmail: string;
  signedAt: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  signatureHash: string | null;
  signatureData: string | null;
  verificationCode: string | null;
  createdAt: string;
}

interface SignatureRequestData {
  id: string;
  organizationId: string;
  documentId: string;
  documentName: string;
  requestedBy: string | null;
  status: string;
  signatureType: string;
  createdAt: string;
  expiresAt: string | null;
  signatures: SignatureData[];
  requestedByName: string | null;
}

interface AuditEvent {
  timestamp: string | null;
  action: string;
  actor: string;
  details: Record<string, any>;
}

interface AuditTrailData {
  request: any;
  signatures: SignatureData[];
  events: AuditEvent[];
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300 dark:border-yellow-800" data-testid="status-pending">
          <Clock className="w-3 h-3 mr-1" /> Ausstehend
        </Badge>
      );
    case "signed":
      return (
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800" data-testid="status-signed">
          <CheckCircle2 className="w-3 h-3 mr-1" /> Unterschrieben
        </Badge>
      );
    case "declined":
      return (
        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800" data-testid="status-declined">
          <XCircle className="w-3 h-3 mr-1" /> Abgelehnt
        </Badge>
      );
    case "expired":
      return (
        <Badge variant="secondary" data-testid="status-expired">
          Abgelaufen
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function SignaturePad({
  onSave,
  width = 400,
  height = 200,
}: {
  onSave: (data: string) => void;
  width?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  const getPos = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      if ("touches" in e) {
        return {
          x: e.touches[0].clientX - rect.left,
          y: e.touches[0].clientY - rect.top,
        };
      }
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    []
  );

  const startDrawing = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!ctx) return;
      const { x, y } = getPos(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
      setIsDrawing(true);
      setHasDrawn(true);
    },
    [getPos]
  );

  const draw = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      if (!isDrawing) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!ctx) return;
      const { x, y } = getPos(e);
      ctx.lineTo(x, y);
      ctx.strokeStyle = "hsl(var(--foreground))";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    },
    [isDrawing, getPos]
  );

  const stopDrawing = useCallback(() => {
    setIsDrawing(false);
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }, []);

  const saveSignature = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const data = canvas.toDataURL("image/png");
    onSave(data);
  }, [onSave]);

  return (
    <div className="space-y-2">
      <div className="border rounded-md overflow-hidden" data-testid="signature-pad-container">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="w-full cursor-crosshair bg-background touch-none"
          style={{ maxWidth: width }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          data-testid="signature-canvas"
        />
      </div>
      <div className="flex gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={clearCanvas} data-testid="button-clear-signature">
          Löschen
        </Button>
        <Button size="sm" onClick={saveSignature} disabled={!hasDrawn} data-testid="button-save-drawn-signature">
          Zeichnung übernehmen
        </Button>
      </div>
    </div>
  );
}

export default function Signatures() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("requests");
  const [showNewRequest, setShowNewRequest] = useState(false);
  const [showSignDialog, setShowSignDialog] = useState(false);
  const [showAuditDialog, setShowAuditDialog] = useState(false);
  const [showVerifyDialog, setShowVerifyDialog] = useState(false);
  const [selectedRequest, setSelectedRequest] =
    useState<SignatureRequestData | null>(null);
  const [signatureMode, setSignatureMode] = useState<"draw" | "text">("draw");
  const [textSignature, setTextSignature] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [signerNameInput, setSignerNameInput] = useState("");
  const [drawnSignatureData, setDrawnSignatureData] = useState<string | null>(null);

  const [newDocumentId, setNewDocumentId] = useState("");
  const [newDocumentName, setNewDocumentName] = useState("");
  const [newSignerEmails, setNewSignerEmails] = useState("");
  const [newSignatureType, setNewSignatureType] = useState("simple");

  const { data: requests = [], isLoading } = useQuery<SignatureRequestData[]>({
    queryKey: ["/api/signatures/requests"],
  });

  const { data: profile } = useQuery<any>({
    queryKey: ["/api/profile"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/signatures/requests", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signatures/requests"] });
      setShowNewRequest(false);
      setNewDocumentId("");
      setNewDocumentName("");
      setNewSignerEmails("");
      setNewSignatureType("simple");
      toast({
        title: "Signaturanfrage erstellt",
        description: "Die Unterzeichner wurden benachrichtigt.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Fehler", description: err.message, variant: "destructive" });
    },
  });

  const signMutation = useMutation({
    mutationFn: async ({
      requestId,
      data,
    }: {
      requestId: string;
      data: any;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/signatures/sign/${requestId}`,
        data
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signatures/requests"] });
      setShowSignDialog(false);
      setSelectedRequest(null);
      setConfirmed(false);
      setDrawnSignatureData(null);
      setTextSignature("");
      setSignerNameInput("");
      toast({
        title: "Dokument unterschrieben",
        description: "Ihre Unterschrift wurde gespeichert.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Fehler", description: err.message, variant: "destructive" });
    },
  });

  const declineMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/signatures/decline/${requestId}`,
        { signerEmail: profile?.email }
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signatures/requests"] });
      setShowSignDialog(false);
      setSelectedRequest(null);
      toast({ title: "Unterschrift abgelehnt" });
    },
    onError: (err: Error) => {
      toast({ title: "Fehler", description: err.message, variant: "destructive" });
    },
  });

  const { data: auditData, isLoading: auditLoading } =
    useQuery<AuditTrailData>({
      queryKey: ["/api/signatures/audit", selectedRequest?.id],
      enabled: showAuditDialog && !!selectedRequest?.id,
    });

  const pendingForMe = requests.filter((r) =>
    r.status === "pending" &&
    r.signatures?.some(
      (s) => s.signerEmail === profile?.email && !s.signedAt
    )
  );

  const handleCreateRequest = () => {
    const emails = newSignerEmails
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    if (!newDocumentId || !newDocumentName || emails.length === 0) {
      toast({
        title: "Fehler",
        description: "Bitte alle Felder ausfüllen",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate({
      documentId: newDocumentId,
      documentName: newDocumentName,
      signerEmails: emails,
      signatureType: newSignatureType,
    });
  };

  const handleSign = () => {
    if (!selectedRequest || !confirmed) return;
    const signatureData =
      signatureMode === "draw" ? drawnSignatureData : textSignature;
    if (!signatureData) {
      toast({
        title: "Fehler",
        description: "Bitte unterschreiben Sie zuerst",
        variant: "destructive",
      });
      return;
    }
    signMutation.mutate({
      requestId: selectedRequest.id,
      data: {
        signerName: signerNameInput || profile?.fullName || profile?.email,
        signerEmail: profile?.email,
        signatureData:
          signatureMode === "text"
            ? btoa(unescape(encodeURIComponent(textSignature)))
            : signatureData,
      },
    });
  };

  return (
    <MainLayout title="">
      <div className="p-4 md:p-6 space-y-4" data-testid="signatures-page">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">
              Elektronische Signaturen
            </h1>
            <p className="text-sm text-muted-foreground">
              eIDAS-konforme elektronische Unterschriften
            </p>
          </div>
          <Button
            onClick={() => setShowNewRequest(true)}
            data-testid="button-new-request"
          >
            <Plus className="w-4 h-4 mr-1" /> Neue Signaturanfrage
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList data-testid="tabs-list">
            <TabsTrigger value="requests" data-testid="tab-requests">
              Signaturanfragen
            </TabsTrigger>
            <TabsTrigger value="sign" data-testid="tab-sign">
              Signieren
              {pendingForMe.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {pendingForMe.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="requests" className="space-y-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : requests.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground" data-testid="text-no-requests">
                    Keine Signaturanfragen vorhanden
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table data-testid="table-requests">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Dokument</TableHead>
                        <TableHead>Angefordert von</TableHead>
                        <TableHead>Datum</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Unterschriften</TableHead>
                        <TableHead>Aktionen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {requests.map((req) => (
                        <TableRow key={req.id} data-testid={`row-request-${req.id}`}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <FileText className="w-4 h-4 text-muted-foreground" />
                              <span className="font-medium" data-testid={`text-document-name-${req.id}`}>
                                {req.documentName}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell data-testid={`text-requested-by-${req.id}`}>
                            {req.requestedByName || "-"}
                          </TableCell>
                          <TableCell data-testid={`text-date-${req.id}`}>
                            {new Date(req.createdAt).toLocaleDateString("de-DE")}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={req.status} />
                          </TableCell>
                          <TableCell data-testid={`text-signatures-count-${req.id}`}>
                            {req.signatures?.filter((s) => s.signedAt).length || 0}/
                            {req.signatures?.length || 0}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1 flex-wrap">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setSelectedRequest(req);
                                  setShowAuditDialog(true);
                                }}
                                data-testid={`button-audit-${req.id}`}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              {req.signatures?.some(
                                (s) => s.verificationCode && s.signedAt
                              ) && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => {
                                    setSelectedRequest(req);
                                    setShowVerifyDialog(true);
                                  }}
                                  data-testid={`button-verify-${req.id}`}
                                >
                                  <Shield className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="sign" className="space-y-4">
            {pendingForMe.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <PenTool className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground" data-testid="text-no-pending">
                    Keine ausstehenden Dokumente zum Unterschreiben
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {pendingForMe.map((req) => (
                  <Card key={req.id} className="hover-elevate" data-testid={`card-pending-${req.id}`}>
                    <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium truncate" data-testid={`text-pending-doc-${req.id}`}>
                            {req.documentName}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Angefordert von {req.requestedByName || "Unbekannt"} am{" "}
                            {new Date(req.createdAt).toLocaleDateString("de-DE")}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Badge variant="outline" className="no-default-active-elevate">
                          {req.signatureType === "simple"
                            ? "Einfach"
                            : req.signatureType === "advanced"
                            ? "Fortgeschritten"
                            : "Qualifiziert"}
                        </Badge>
                        <Button
                          size="sm"
                          onClick={() => {
                            setSelectedRequest(req);
                            setShowSignDialog(true);
                            setSignerNameInput(
                              profile?.fullName || profile?.email || ""
                            );
                          }}
                          data-testid={`button-sign-${req.id}`}
                        >
                          <PenTool className="w-4 h-4 mr-1" /> Unterschreiben
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <Dialog open={showNewRequest} onOpenChange={setShowNewRequest}>
          <DialogContent className="max-w-lg" data-testid="dialog-new-request">
            <DialogHeader>
              <DialogTitle>Neue Signaturanfrage</DialogTitle>
              <DialogDescription>
                Erstellen Sie eine neue Signaturanfrage für ein Dokument
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Dokument-ID</Label>
                <Input
                  value={newDocumentId}
                  onChange={(e) => setNewDocumentId(e.target.value)}
                  placeholder="z.B. doc-mietvertrag-001"
                  data-testid="input-document-id"
                />
              </div>
              <div className="space-y-2">
                <Label>Dokumentname</Label>
                <Input
                  value={newDocumentName}
                  onChange={(e) => setNewDocumentName(e.target.value)}
                  placeholder="z.B. Mietvertrag Wohnung 3A"
                  data-testid="input-document-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Unterzeichner E-Mails (kommagetrennt)</Label>
                <Input
                  value={newSignerEmails}
                  onChange={(e) => setNewSignerEmails(e.target.value)}
                  placeholder="mieter@example.com, verwalter@example.com"
                  data-testid="input-signer-emails"
                />
              </div>
              <div className="space-y-2">
                <Label>Signaturtyp</Label>
                <Select
                  value={newSignatureType}
                  onValueChange={setNewSignatureType}
                >
                  <SelectTrigger data-testid="select-signature-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="simple">
                      Einfach (Simple Electronic Signature)
                    </SelectItem>
                    <SelectItem value="advanced">
                      Fortgeschritten (Advanced Electronic Signature)
                    </SelectItem>
                    <SelectItem value="qualified">
                      Qualifiziert (Qualified Electronic Signature)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowNewRequest(false)} data-testid="button-cancel-new-request">
                Abbrechen
              </Button>
              <Button
                onClick={handleCreateRequest}
                disabled={createMutation.isPending}
                data-testid="button-submit-new-request"
              >
                {createMutation.isPending && (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                )}
                Anfrage senden
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={showSignDialog}
          onOpenChange={(open) => {
            setShowSignDialog(open);
            if (!open) {
              setConfirmed(false);
              setDrawnSignatureData(null);
              setTextSignature("");
            }
          }}
        >
          <DialogContent className="max-w-xl" data-testid="dialog-sign">
            <DialogHeader>
              <DialogTitle>Dokument unterschreiben</DialogTitle>
              <DialogDescription>
                {selectedRequest?.documentName}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Ihr Name</Label>
                <Input
                  value={signerNameInput}
                  onChange={(e) => setSignerNameInput(e.target.value)}
                  data-testid="input-signer-name"
                />
              </div>

              <div className="space-y-2">
                <Label>Unterschrift</Label>
                <div className="flex gap-2 mb-2">
                  <Button
                    variant={signatureMode === "draw" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSignatureMode("draw")}
                    data-testid="button-mode-draw"
                  >
                    <PenTool className="w-4 h-4 mr-1" /> Zeichnen
                  </Button>
                  <Button
                    variant={signatureMode === "text" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSignatureMode("text")}
                    data-testid="button-mode-text"
                  >
                    <Type className="w-4 h-4 mr-1" /> Tippen
                  </Button>
                </div>

                {signatureMode === "draw" ? (
                  <SignaturePad
                    onSave={(data) => setDrawnSignatureData(data)}
                  />
                ) : (
                  <div className="space-y-2">
                    <Input
                      value={textSignature}
                      onChange={(e) => setTextSignature(e.target.value)}
                      placeholder="Ihren Namen eingeben"
                      data-testid="input-text-signature"
                    />
                    {textSignature && (
                      <div
                        className="border rounded-md p-4 text-center bg-background"
                        data-testid="text-signature-preview"
                      >
                        <span
                          style={{
                            fontFamily: "'Brush Script MT', 'Segoe Script', cursive",
                            fontSize: "2rem",
                          }}
                        >
                          {textSignature}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-start space-x-2">
                <Checkbox
                  id="confirm"
                  checked={confirmed}
                  onCheckedChange={(v) => setConfirmed(v === true)}
                  data-testid="checkbox-confirm"
                />
                <label htmlFor="confirm" className="text-sm leading-none cursor-pointer">
                  Ich bestätige die Richtigkeit dieses Dokuments
                </label>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button
                variant="destructive"
                onClick={() => {
                  if (selectedRequest) {
                    declineMutation.mutate(selectedRequest.id);
                  }
                }}
                disabled={declineMutation.isPending}
                data-testid="button-decline"
              >
                {declineMutation.isPending && (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                )}
                Ablehnen
              </Button>
              <Button
                onClick={handleSign}
                disabled={
                  !confirmed ||
                  signMutation.isPending ||
                  (signatureMode === "draw" && !drawnSignatureData) ||
                  (signatureMode === "text" && !textSignature)
                }
                data-testid="button-submit-sign"
              >
                {signMutation.isPending && (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                )}
                Unterschreiben
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showAuditDialog} onOpenChange={setShowAuditDialog}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" data-testid="dialog-audit">
            <DialogHeader>
              <DialogTitle>Audit-Trail</DialogTitle>
              <DialogDescription>
                {selectedRequest?.documentName}
              </DialogDescription>
            </DialogHeader>
            {auditLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : auditData?.events ? (
              <div className="space-y-4">
                {auditData.events.map((event, i) => (
                  <div
                    key={i}
                    className="flex gap-3"
                    data-testid={`audit-event-${i}`}
                  >
                    <div className="flex flex-col items-center">
                      <div className="w-2 h-2 rounded-full bg-primary mt-2" />
                      {i < auditData.events.length - 1 && (
                        <div className="w-px flex-1 bg-border" />
                      )}
                    </div>
                    <div className="pb-4 min-w-0">
                      <p className="font-medium text-sm">{event.action}</p>
                      <p className="text-xs text-muted-foreground">
                        {event.actor} &middot;{" "}
                        {event.timestamp
                          ? new Date(event.timestamp).toLocaleString("de-DE")
                          : "-"}
                      </p>
                      {event.details && Object.keys(event.details).length > 0 && (
                        <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
                          {Object.entries(event.details).map(([k, v]) =>
                            v ? (
                              <div key={k} className="truncate">
                                <span className="font-medium">{k}:</span>{" "}
                                {String(v)}
                              </div>
                            ) : null
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground py-4">
                Keine Audit-Daten verfügbar
              </p>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={showVerifyDialog} onOpenChange={setShowVerifyDialog}>
          <DialogContent data-testid="dialog-verify">
            <DialogHeader>
              <DialogTitle>Verifizierungscodes</DialogTitle>
              <DialogDescription>
                {selectedRequest?.documentName}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {selectedRequest?.signatures
                ?.filter((s) => s.signedAt && s.verificationCode)
                .map((s) => (
                  <Card key={s.id}>
                    <CardContent className="p-3 space-y-1">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-medium text-sm" data-testid={`text-verify-signer-${s.id}`}>
                          {s.signerName}
                        </span>
                        <Badge variant="outline" className="no-default-active-elevate">
                          <Shield className="w-3 h-3 mr-1" /> Verifiziert
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {s.signerEmail}
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <code
                          className="text-xs bg-muted px-2 py-1 rounded-md font-mono"
                          data-testid={`text-verification-code-${s.id}`}
                        >
                          {s.verificationCode}
                        </code>
                      </div>
                    </CardContent>
                  </Card>
                ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
