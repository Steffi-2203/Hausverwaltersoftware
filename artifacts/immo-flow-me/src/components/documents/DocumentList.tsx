import { Button } from '@/components/ui/button';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { FileText, Eye, Download, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

interface Document {
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

interface DocumentListProps {
  documents: Document[];
  documentTypes: DocumentType[];
  onDelete: (doc: Document) => void;
  isDeleting: boolean;
  emptyMessage: string;
  emptyDescription: string;
}

export function DocumentList({
  documents,
  documentTypes,
  onDelete,
  isDeleting,
  emptyMessage,
  emptyDescription,
}: DocumentListProps) {
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
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead>Name</TableHead>
            <TableHead>Typ</TableHead>
            <TableHead>Hochgeladen am</TableHead>
            <TableHead className="text-right">Aktionen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((doc) => (
            <TableRow key={doc.id} className="hover:bg-muted/30">
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  {doc.name}
                </div>
              </TableCell>
              <TableCell>
                <Badge className={getTypeColor(doc.type)}>{getTypeLabel(doc.type)}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {format(new Date(doc.uploaded_at), 'dd.MM.yyyy HH:mm', { locale: de })}
              </TableCell>
              <TableCell>
                <TooltipProvider>
                  <div className="flex items-center justify-end gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" asChild>
                          <a href={doc.file_url} target="_blank" rel="noreferrer">
                            <Eye className="h-4 w-4" />
                          </a>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Ansehen</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          asChild
                        >
                          <a href={doc.file_url} download={doc.name}>
                            <Download className="h-4 w-4" />
                          </a>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Herunterladen</TooltipContent>
                    </Tooltip>
                    <AlertDialog>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                        </TooltipTrigger>
                        <TooltipContent>Löschen</TooltipContent>
                      </Tooltip>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Dokument löschen?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Möchten Sie "{doc.name}" wirklich löschen? Diese Aktion kann nicht
                            rückgängig gemacht werden.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => onDelete(doc)}
                            disabled={isDeleting}
                          >
                            Löschen
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TooltipProvider>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
