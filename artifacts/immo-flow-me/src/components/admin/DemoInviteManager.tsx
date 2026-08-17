import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Send, Mail, Clock, CheckCircle, XCircle, AlertTriangle, Copy, ExternalLink, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import { de } from "date-fns/locale";

interface DemoInvite {
  id: string;
  email: string;
  status: string;
  expiresAt: string;
  activatedAt: string | null;
  demoEndsAt: string | null;
  createdAt: string;
}

export function DemoInviteManager() {
  const [email, setEmail] = useState("");
  const [lastActivationUrl, setLastActivationUrl] = useState("");

  const { data: invites, isLoading } = useQuery<DemoInvite[]>({
    queryKey: ["/api/admin/demo/invites"],
  });

  const sendInvite = useMutation({
    mutationFn: async (email: string) => {
      const response = await apiRequest("POST", "/api/admin/demo/invite", { email });
      return response.json();
    },
    onSuccess: (data) => {
      toast.success(data.message || "Demo-Einladung gesendet");
      setEmail("");
      if (data.activationUrl) {
        setLastActivationUrl(data.activationUrl);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/demo/invites"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Fehler beim Versenden");
    },
  });

  const copyToClipboard = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success("Link in Zwischenablage kopiert");
  };

  const deleteInvite = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/admin/demo/invites/${id}`);
      return response.json();
    },
    onSuccess: () => {
      toast.success("Einladung gelöscht");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/demo/invites"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Fehler beim Löschen");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email && email.includes("@")) {
      sendInvite.mutate(email);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Ausstehend</Badge>;
      case "activated":
        return <Badge variant="default" className="bg-green-500"><CheckCircle className="h-3 w-3 mr-1" />Aktiviert</Badge>;
      case "expired":
        return <Badge variant="outline" className="text-muted-foreground"><AlertTriangle className="h-3 w-3 mr-1" />Abgelaufen</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Demo-Einladung versenden
          </CardTitle>
          <CardDescription>
            Laden Sie Interessenten direkt per E-Mail zur 30-Minuten Demo ein
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="demo-email" className="sr-only">E-Mail-Adresse</Label>
              <Input
                id="demo-email"
                type="email"
                placeholder="interessent@firma.at"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="input-admin-demo-email"
              />
            </div>
            <Button type="submit" disabled={sendInvite.isPending} data-testid="button-send-demo-invite">
              {sendInvite.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Mail className="h-4 w-4 mr-2" />
                  Einladung senden
                </>
              )}
            </Button>
          </form>
          
          {lastActivationUrl && (
            <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
              <p className="text-sm font-medium text-green-800 dark:text-green-200 mb-2">
                Aktivierungslink (zum Teilen kopieren):
              </p>
              <div className="flex gap-2">
                <Input 
                  value={lastActivationUrl} 
                  readOnly 
                  className="flex-1 text-xs bg-white dark:bg-gray-800"
                  data-testid="input-admin-activation-url"
                />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => copyToClipboard(lastActivationUrl)}
                  data-testid="button-copy-admin-link"
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => window.open(lastActivationUrl, '_blank')}
                  data-testid="button-open-admin-link"
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Senden Sie diesen Link direkt an den Interessenten (z.B. per WhatsApp, Slack, etc.)
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Demo-Einladungen</CardTitle>
          <CardDescription>
            Übersicht aller versendeten Demo-Einladungen
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : invites && invites.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>E-Mail</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Erstellt</TableHead>
                  <TableHead>Aktiviert um</TableHead>
                  <TableHead>Link gültig bis</TableHead>
                  <TableHead>Demo endet</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.map((invite) => (
                  <TableRow key={invite.id}>
                    <TableCell className="font-medium">{invite.email}</TableCell>
                    <TableCell>{getStatusBadge(invite.status)}</TableCell>
                    <TableCell>
                      {format(new Date(invite.createdAt), "dd.MM.yyyy HH:mm", { locale: de })}
                    </TableCell>
                    <TableCell>
                      {invite.activatedAt 
                        ? format(new Date(invite.activatedAt), "dd.MM.yyyy HH:mm", { locale: de })
                        : <span className="text-muted-foreground">-</span>
                      }
                    </TableCell>
                    <TableCell>
                      {format(new Date(invite.expiresAt), "dd.MM.yyyy HH:mm", { locale: de })}
                    </TableCell>
                    <TableCell>
                      {invite.demoEndsAt 
                        ? format(new Date(invite.demoEndsAt), "dd.MM.yyyy HH:mm", { locale: de })
                        : "-"
                      }
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteInvite.mutate(invite.id)}
                        disabled={deleteInvite.isPending}
                        data-testid={`button-delete-invite-${invite.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              Noch keine Demo-Einladungen versendet
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
