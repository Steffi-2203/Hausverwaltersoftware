import { useState, useRef } from 'react';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { 
  Receipt, 
  Plus, 
  Search, 
  Loader2, 
  Euro, 
  Wrench,
  Building2,
  Trash2,
  Pencil,
  FileText,
  Upload,
  ExternalLink,
  Camera,
  Sparkles
} from 'lucide-react';
import { BudgetPositionSelect } from '@/components/budgets/BudgetPositionSelect';
import { 
  useExpenses, 
  useExpensesByCategory,
  useCreateExpense, 
  useUpdateExpense,
  useDeleteExpense,
  expenseCategoryLabels,
  expenseTypeLabels,
  expenseTypesByCategory,
  type ExpenseCategory,
  type ExpenseType,
  type Expense
} from '@/hooks/useExpenses';
import { useProperties } from '@/hooks/useProperties';
import { useDistributionKeys } from '@/hooks/useDistributionKeys';
import { useAccountCategories } from '@/hooks/useAccountCategories';
import { useOCRInvoice, type OCRResult } from '@/hooks/useOCRInvoice';
import { useExpenseTransactionMatch, useAutoMatchExpenses } from '@/hooks/useExpenseTransactionMatch';
import { PdfPageSelector } from '@/components/ocr/PdfPageSelector';
import { InvoiceDropZone, QueuedFile } from '@/components/ocr/InvoiceDropZone';
import { BatchResultsSummary, BatchResultItem, BatchSaveResult } from '@/components/ocr/BatchResultsSummary';
import { runBatchSaveLoop } from '@/lib/batchOcrUtils';
import { OcrReviewDialog, type OcrReviewResult } from '@/components/ocr/OcrReviewDialog';
import { TransactionMatchBadge } from '@/components/expenses/TransactionMatchBadge';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

// Parse euro amounts with German/Austrian format (comma as decimal separator)
function parseEuroAmount(raw: string): number | null {
  if (!raw || raw.trim() === '') return null;
  // Remove thousand separators (dots) and replace comma with dot
  const normalized = raw
    .replace(/\s/g, '')        // remove whitespace
    .replace(/\./g, '')        // remove thousand separators
    .replace(',', '.');        // replace decimal comma with dot
  const num = parseFloat(normalized);
  return isFinite(num) && num >= 0 ? num : null;
}

export default function ExpenseList() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const ocrFileInputRef = useRef<HTMLInputElement>(null);
  const currentYear = new Date().getFullYear();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState(2025); // Default to 2025 for simulation data
  const [selectedProperty, setSelectedProperty] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [ocrDialogOpen, setOcrDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | ExpenseCategory>('all');
  
  const initialExpenseState = {
    property_id: '',
    category: 'betriebskosten_umlagefaehig' as ExpenseCategory,
    expense_type: 'sonstiges' as ExpenseType,
    bezeichnung: '',
    betrag: '',
    datum: format(new Date(), 'yyyy-MM-dd'),
    beleg_nummer: '',
    notizen: '',
    budget_position: null as number | null,
    distribution_key_id: '' as string,
  };

  const { data: distributionKeys = [] } = useDistributionKeys();
  const { data: accountCategories = [] } = useAccountCategories();
  
  const findDefaultDistributionKey = (expenseType: ExpenseType): string => {
    const expenseTypeName = expenseTypeLabels[expenseType]?.toLowerCase() || '';
    const matchingCategory = accountCategories.find(cat => 
      cat.name.toLowerCase() === expenseTypeName ||
      cat.name.toLowerCase().includes(expenseTypeName) ||
      expenseTypeName.includes(cat.name.toLowerCase())
    );
    return (matchingCategory as any)?.default_distribution_key_id || '';
  };

  const handleExpenseTypeChange = (value: ExpenseType) => {
    const defaultKeyId = findDefaultDistributionKey(value);
    setNewExpense(prev => ({
      ...prev,
      expense_type: value,
      distribution_key_id: defaultKeyId || prev.distribution_key_id,
    }));
  };
  
  const [newExpense, setNewExpense] = useState(initialExpenseState);
  const [hasReceipt, setHasReceipt] = useState<boolean | null>(null); // null = not yet selected
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [useCustomAbrechnungsjahr, setUseCustomAbrechnungsjahr] = useState(false);
  const [customAbrechnungsjahr, setCustomAbrechnungsjahr] = useState(currentYear - 1);
  
  // Verbrauchsabhängige Kostenarten, die oft im Folgejahr abgerechnet werden
  const verbrauchsabhaengigeKosten: ExpenseType[] = ['heizung', 'wasser_abwasser'];
  
  // Edit state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<(Expense & { properties?: { name: string }, beleg_url?: string }) | null>(null);
  const [editForm, setEditForm] = useState({
    property_id: '',
    category: 'betriebskosten_umlagefaehig' as ExpenseCategory,
    expense_type: 'sonstiges' as ExpenseType,
    bezeichnung: '',
    betrag: '',
    datum: '',
    beleg_nummer: '',
    notizen: '',
    beleg_url: '',
  });
  const [editSelectedFile, setEditSelectedFile] = useState<File | null>(null);

  // OCR state
  const [ocrFile, setOcrFile] = useState<File | null>(null);
  const [pdfSelectorOpen, setPdfSelectorOpen] = useState(false);
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const ocrInvoice = useOCRInvoice();

  // OCR Review state (öffnet sich wenn needs_review=true)
  const [ocrReviewOpen, setOcrReviewOpen] = useState(false);
  const [ocrReviewData, setOcrReviewData] = useState<OCRResult | null>(null);
  const [ocrReviewFile, setOcrReviewFile] = useState<File | null>(null);
  
  // Batch processing state
  const [batchQueue, setBatchQueue] = useState<QueuedFile[]>([]);
  const [batchIndex, setBatchIndex] = useState(0);
  const [batchResults, setBatchResults] = useState<BatchResultItem[]>([]);
  const [batchCancelled, setBatchCancelled] = useState(false);
  const [batchSummaryOpen, setBatchSummaryOpen] = useState(false);

  const propertyFilter = selectedProperty === 'all' ? undefined : selectedProperty;
  const { data: expenses, isLoading } = useExpenses(propertyFilter, selectedYear);
  const { data: categoryStats } = useExpensesByCategory(propertyFilter, selectedYear);
  const { data: properties } = useProperties();
  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const deleteExpense = useDeleteExpense();
  const autoMatch = useAutoMatchExpenses();
  
  // Expense-Transaction matching
  const expensesWithMatches = useExpenseTransactionMatch(expenses || []);

  // Filter expenses with matches
  const filteredExpenses = expensesWithMatches?.filter(expense => {
    if (activeTab !== 'all' && expense.category !== activeTab) return false;
    if (!searchQuery) return true;
    const searchLower = searchQuery.toLowerCase();
    return (
      expense.bezeichnung.toLowerCase().includes(searchLower) ||
      (expense as any).belegNummer?.toLowerCase().includes(searchLower) ||
      (expense as any).properties?.name?.toLowerCase().includes(searchLower)
    );
  });
  
  // Count unmatched expenses with suggestions for auto-match
  const unmatchedWithSuggestions = expensesWithMatches.filter(
    e => !(e as any).transactionId && e.suggestedMatches.length > 0 && e.suggestedMatches[0].confidence >= 0.7
  );
  
  const handleAutoMatchAll = () => {
    const highConfidenceMatches = unmatchedWithSuggestions.map(e => ({
      expenseId: e.id,
      transactionId: e.suggestedMatches[0].transactionId,
    }));
    autoMatch.mutate(highConfidenceMatches);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, isEdit = false) => {
    const file = e.target.files?.[0];
    if (file) {
      // Allow PDF and images
      if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
        toast({
          title: 'Ungültiges Format',
          description: 'Bitte PDF oder Bilddateien hochladen.',
          variant: 'destructive',
        });
        return;
      }
      if (file.size > 10 * 1024 * 1024) { // 10MB limit
        toast({
          title: 'Datei zu groß',
          description: 'Maximale Dateigröße: 10 MB.',
          variant: 'destructive',
        });
        return;
      }
      if (isEdit) {
        setEditSelectedFile(file);
      } else {
        setSelectedFile(file);
      }
    }
  };

  const uploadFile = async (file: File, propertyId: string): Promise<string | null> => {
    const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const filePath = `${propertyId}/${fileName}`;

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('bucket', 'expense-receipts');
      formData.append('path', filePath);

      const response = await fetch('/api/storage/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Upload error:', errorData);
        toast({
          title: 'Upload fehlgeschlagen',
          description: errorData.error || 'Upload fehlgeschlagen',
          variant: 'destructive',
        });
        return null;
      }

      const data = await response.json();
      return data.publicUrl;
    } catch (error: any) {
      console.error('Upload error:', error);
      toast({
        title: 'Upload fehlgeschlagen',
        description: error.message || 'Upload fehlgeschlagen',
        variant: 'destructive',
      });
      return null;
    }
  };

  // Reset dialog state
  const resetNewExpenseDialog = () => {
    setNewExpense(initialExpenseState);
    setHasReceipt(null);
    setSelectedFile(null);
    setUseCustomAbrechnungsjahr(false);
    setCustomAbrechnungsjahr(currentYear - 1);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      resetNewExpenseDialog();
    }
  };

  const handleCreateExpense = async () => {
    // Validate required fields with clear error messages
    if (!newExpense.property_id) {
      toast({
        title: 'Liegenschaft fehlt',
        description: 'Bitte wählen Sie eine Liegenschaft aus.',
        variant: 'destructive',
      });
      return;
    }

    if (!newExpense.bezeichnung.trim()) {
      toast({
        title: 'Bezeichnung fehlt',
        description: 'Bitte geben Sie eine Bezeichnung ein.',
        variant: 'destructive',
      });
      return;
    }

    const parsedAmount = parseEuroAmount(newExpense.betrag);
    if (parsedAmount === null || parsedAmount <= 0) {
      toast({
        title: 'Ungültiger Betrag',
        description: 'Bitte geben Sie einen gültigen Betrag ein (z.B. 12,50).',
        variant: 'destructive',
      });
      return;
    }

    if (!newExpense.datum) {
      toast({
        title: 'Datum fehlt',
        description: 'Bitte wählen Sie ein Datum aus.',
        variant: 'destructive',
      });
      return;
    }

    // Require user to choose receipt option
    if (hasReceipt === null) {
      toast({
        title: 'Beleg-Option wählen',
        description: 'Bitte wählen Sie „Ja, Beleg vorhanden" oder „Nein, ohne Beleg".',
        variant: 'destructive',
      });
      return;
    }

    // If user said they have a receipt, enforce upload.
    if (hasReceipt === true && !selectedFile) {
      toast({
        title: 'Beleg fehlt',
        description: 'Bitte Beleg hochladen oder „Nein, ohne Beleg" auswählen.',
        variant: 'destructive',
      });
      return;
    }

    setUploading(true);
    let beleg_url: string | undefined;

    try {
      // Upload file if selected
      if (selectedFile) {
        const url = await uploadFile(selectedFile, newExpense.property_id);
        if (url) {
          beleg_url = url;
        } else {
          // Upload failed, don't proceed with insert
          setUploading(false);
          return;
        }
      }

      const date = new Date(newExpense.datum);
      
      // Bei verbrauchsabhängigen Kosten mit custom Abrechnungsjahr: verwende dieses Jahr
      const bookingYear = useCustomAbrechnungsjahr ? customAbrechnungsjahr : date.getFullYear();
      // Für verbrauchsabhängige Kosten buchen wir auf Dezember des Abrechnungsjahres (Jahresabschluss)
      const bookingMonth = useCustomAbrechnungsjahr ? 12 : date.getMonth() + 1;
      
      await createExpense.mutateAsync({
        property_id: newExpense.property_id,
        category: newExpense.category,
        expense_type: newExpense.expense_type,
        bezeichnung: newExpense.bezeichnung.trim(),
        betrag: parsedAmount,
        datum: newExpense.datum,
        beleg_nummer: newExpense.beleg_nummer || undefined,
        notizen: newExpense.notizen || undefined,
        year: bookingYear,
        month: bookingMonth,
        beleg_url,
        distributionKeyId: newExpense.distribution_key_id || undefined,
        budget_position: newExpense.category === 'instandhaltung' ? newExpense.budget_position : undefined,
      } as any);

      setDialogOpen(false);
      resetNewExpenseDialog();

      toast({
        title: 'Kosten erfasst',
        description: beleg_url ? 'Rechnung wurde hochgeladen.' : 'Eintrag wurde erstellt.',
      });
    } catch (error: any) {
      console.error('Create expense error:', error);
      toast({
        title: 'Fehler beim Speichern',
        description: error?.message || 'Die Kosten konnten nicht gespeichert werden.',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  // Open edit dialog
  const openEditDialog = (expense: Expense & { properties?: { name: string }, belegUrl?: string }) => {
    setEditingExpense(expense);
    setEditForm({
      property_id: (expense as any).propertyId,
      category: expense.category,
      expense_type: ((expense as any).expenseType || 'sonstiges') as ExpenseType,
      bezeichnung: expense.bezeichnung,
      betrag: expense.betrag.toString().replace('.', ','),
      datum: expense.datum,
      beleg_nummer: (expense as any).belegNummer || '',
      notizen: expense.notizen || '',
      beleg_url: (expense as any).beleg_url || '',
    });
    setEditSelectedFile(null);
    setEditDialogOpen(true);
  };

  // Handle update expense
  const handleUpdateExpense = async () => {
    if (!editingExpense) return;

    if (!editForm.bezeichnung.trim()) {
      toast({
        title: 'Bezeichnung fehlt',
        description: 'Bitte geben Sie eine Bezeichnung ein.',
        variant: 'destructive',
      });
      return;
    }

    const parsedAmount = parseEuroAmount(editForm.betrag);
    if (parsedAmount === null || parsedAmount <= 0) {
      toast({
        title: 'Ungültiger Betrag',
        description: 'Bitte geben Sie einen gültigen Betrag ein (z.B. 12,50).',
        variant: 'destructive',
      });
      return;
    }

    setUploading(true);
    let beleg_url: string | undefined = editForm.beleg_url || undefined;

    try {
      // Upload new file if selected
      if (editSelectedFile) {
        const url = await uploadFile(editSelectedFile, editForm.property_id);
        if (url) {
          beleg_url = url;
        } else {
          setUploading(false);
          return;
        }
      }

      const date = new Date(editForm.datum);
      
      await updateExpense.mutateAsync({
        id: editingExpense.id,
        category: editForm.category,
        expense_type: editForm.expense_type,
        bezeichnung: editForm.bezeichnung.trim(),
        betrag: parsedAmount,
        datum: editForm.datum,
        beleg_nummer: editForm.beleg_nummer || undefined,
        notizen: editForm.notizen || undefined,
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        beleg_url,
      } as any);

      setEditDialogOpen(false);
      setEditingExpense(null);
      setEditSelectedFile(null);

      toast({
        title: 'Kosten aktualisiert',
        description: editSelectedFile ? 'Rechnung wurde hochgeladen.' : 'Änderungen wurden gespeichert.',
      });
    } catch (error: any) {
      console.error('Update expense error:', error);
      toast({
        title: 'Fehler beim Speichern',
        description: error?.message || 'Die Änderungen konnten nicht gespeichert werden.',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  // Handle OCR file selection
  const handleOcrFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so same file can be selected again
    if (ocrFileInputRef.current) {
      ocrFileInputRef.current.value = '';
    }

    // Accept images and PDFs for OCR
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      toast({
        title: 'Ungültiges Format',
        description: 'Bitte ein Bild (JPG, PNG) oder PDF der Rechnung hochladen.',
        variant: 'destructive',
      });
      return;
    }

    setOcrFile(file);

    // For PDFs, show page selector
    if (file.type === 'application/pdf') {
      setPdfSelectorOpen(true);
      return;
    }

    // For images, process directly
    await processOcrFile(file);
  };

  /** Übernimmt verifizierte OCR-Daten in das Ausgaben-Formular */
  const applyOcrToForm = (result: OCRResult | OcrReviewResult, file: File) => {
    const r = result as any; // OcrReviewResult und OCRResult haben gleiche Kernfelder
    setNewExpense(prev => ({
      ...prev,
      bezeichnung: r.beschreibung || r.lieferant || '',
      betrag: r.betrag?.toString().replace('.', ',') || '',
      datum: r.datum || format(new Date(), 'yyyy-MM-dd'),
      beleg_nummer: r.rechnungsnummer || '',
      category: r.kategorie || 'betriebskosten_umlagefaehig',
      expense_type: (r.expense_type as ExpenseType) || 'sonstiges',
      notizen: r.notizen || (r.iban ? `IBAN: ${r.iban}` : ''),
    }));
    setSelectedFile(file);
    setHasReceipt(true);
  };

  /**
   * Sendet OCR-Korrekturen ins Audit-Log (HMAC-gesichert).
   * Wirft einen Fehler wenn der Server eine 5xx-Antwort zurückgibt —
   * der Aufrufer muss Korrekturen erst anwenden NACHDEM diese Funktion
   * erfolgreich zurückgekehrt ist (audit-before-apply Garantie).
   */
  const logOcrCorrections = async (
    originalData: OCRResult,
    correctedData: OcrReviewResult,
    fileName: string
  ) => {
    if (Object.keys(correctedData.corrections).length === 0) return;
    const res = await fetch('/api/ocr/corrections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        originalData: {
          lieferant: originalData.lieferant,
          betrag: originalData.betrag?.toString().replace('.', ',') ?? '',
          datum: originalData.datum,
          rechnungsnummer: originalData.rechnungsnummer,
          kategorie: originalData.kategorie,
          expense_type: originalData.expense_type,
          beschreibung: originalData.beschreibung,
          confidence_score: originalData.validierung?.confidence_score,
        },
        correctedData,
        source: 'expense_ocr',
        fileName,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`Audit-Protokoll konnte nicht gespeichert werden (${res.status}): ${(body as any).error ?? 'Unbekannter Fehler'}`);
    }
  };

  // Process OCR with image data
  const processOcrFile = async (file: File, imageDataUrl?: string) => {
    setOcrDialogOpen(true);
    setOcrProcessing(true);

    try {
      let result: OCRResult;
      let needsReview = false;
      
      if (imageDataUrl) {
        // Use provided image data (from PDF page selector)
        const base64 = imageDataUrl.split(',')[1];
        const mimeType = 'image/png';
        
        // Call the OCR function with the converted image
        const response = await fetch('/api/functions/ocr-invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ imageBase64: base64, mimeType }),
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'OCR-Analyse fehlgeschlagen');
        }
        
        const ocrResponse = await response.json();
        result = ocrResponse.data as OCRResult;
        needsReview = ocrResponse.needs_review ?? false;
      } else {
        // Use the hook for regular files
        result = await ocrInvoice.mutateAsync(file);
        needsReview = result.needs_review ?? false;
      }
      
      setOcrDialogOpen(false);

      if (needsReview) {
        // Review-Dialog öffnen statt direkt pre-fill
        setOcrReviewData(result);
        setOcrReviewFile(file);
        setOcrReviewOpen(true);
        return; // Formular wird nach Review-Bestätigung befüllt
      }

      // Kein Review nötig: direkt übernehmen
      applyOcrToForm(result, file);
      setDialogOpen(true);
      
      toast({
        title: 'Rechnung analysiert',
        description: 'Die Daten wurden in das Formular übernommen.',
      });
    } catch (error) {
      console.error('OCR failed:', error);
      toast({
        title: 'OCR fehlgeschlagen',
        description: error instanceof Error ? error.message : 'Die Rechnung konnte nicht analysiert werden.',
        variant: 'destructive',
      });
    } finally {
      setOcrDialogOpen(false);
      setOcrProcessing(false);
    }
  };

  /** Wird aufgerufen wenn der Verwalter den Review-Dialog bestätigt */
  const handleOcrReviewConfirm = async (reviewResult: OcrReviewResult) => {
    if (!ocrReviewFile || !ocrReviewData) return;

    // Audit-Log ZUERST schreiben — Korrekturen werden nur übernommen wenn
    // der HMAC-Eintrag erfolgreich committed wurde (audit-before-apply).
    try {
      await logOcrCorrections(ocrReviewData, reviewResult, ocrReviewFile.name);
    } catch (e) {
      toast({
        title: 'Protokollfehler',
        description: e instanceof Error ? e.message : 'Das Audit-Protokoll konnte nicht gespeichert werden.',
        variant: 'destructive',
      });
      return; // Korrekturen werden NICHT übernommen bei Audit-Fehler
    }

    setOcrReviewOpen(false);
    applyOcrToForm(reviewResult, ocrReviewFile);
    setDialogOpen(true);

    const correctionCount = Object.keys(reviewResult.corrections).length;
    toast({
      title: 'Rechnung übernommen',
      description: correctionCount > 0
        ? `${correctionCount} Feld(er) korrigiert und ins Protokoll geschrieben.`
        : 'Daten wurden in das Formular übernommen.',
    });

    setOcrReviewData(null);
    setOcrReviewFile(null);
  };

  const handleOcrReviewCancel = () => {
    setOcrReviewOpen(false);
    setOcrReviewData(null);
    setOcrReviewFile(null);
  };

  // Handle PDF page selection
  const handlePdfPagesSelected = async (selectedPages: number[], imageDataUrl?: string) => {
    setPdfSelectorOpen(false);
    
    if (!ocrFile || !imageDataUrl) {
      toast({
        title: 'Fehler',
        description: 'Keine Seiten ausgewählt.',
        variant: 'destructive',
      });
      return;
    }

    await processOcrFile(ocrFile, imageDataUrl);
  };

  // Handle batch file selection
  const handleBatchSelect = async (files: File[]) => {
    setBatchCancelled(false);
    setBatchResults([]);
    setBatchIndex(0);
    
    // Generate previews for queue display
    const queueItems: QueuedFile[] = await Promise.all(
      files.map(async (file) => {
        let previewUrl: string | null = null;
        
        if (file.type.startsWith('image/')) {
          previewUrl = URL.createObjectURL(file);
        } else if (file.type === 'application/pdf') {
          try {
            const pdfjsLib = await import('pdfjs-dist');
            pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const page = await pdf.getPage(1);
            const scale = 0.3;
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const context = canvas.getContext('2d');
            if (context) {
              await page.render({ canvasContext: context, viewport }).promise;
              previewUrl = canvas.toDataURL('image/png');
            }
          } catch {
            // Preview generation failed, continue without preview
          }
        }
        
        return {
          file,
          previewUrl,
          status: 'pending' as const,
        };
      })
    );
    
    setBatchQueue(queueItems);
    
    // Start processing first file
    processBatchItem(queueItems, 0);
  };

  // Process single batch item
  const processBatchItem = async (queue: QueuedFile[], index: number, accumulatedResults: BatchResultItem[] = []) => {
    if (index >= queue.length || batchCancelled) {
      // Batch complete - show summary dialog
      const finalResults = [...accumulatedResults];
      if (finalResults.length > 0) {
        setBatchResults(finalResults);
        setBatchSummaryOpen(true);
      }
      setBatchQueue([]);
      setBatchIndex(0);
      return;
    }

    const item = queue[index];
    
    // Update status to processing
    setBatchQueue(prev => prev.map((q, i) => 
      i === index ? { ...q, status: 'processing' as const } : q
    ));
    setBatchIndex(index);
    
    try {
      // For PDFs, we need to handle page selection - for now, process first page
      let result;
      
      if (item.file.type === 'application/pdf') {
        // Convert first page to image for OCR
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
        const arrayBuffer = await item.file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1);
        const scale = 2;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');
        if (context) {
          await page.render({ canvasContext: context, viewport }).promise;
          const imageDataUrl = canvas.toDataURL('image/png');
          const base64 = imageDataUrl.split(',')[1];
          
          const response = await fetch('/api/functions/ocr-invoice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ imageBase64: base64, mimeType: 'image/png' }),
          });
          
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'OCR-Analyse fehlgeschlagen');
          }
          
          const ocrResponse = await response.json();
          result = {
            ...ocrResponse.data,
            needs_review: ocrResponse.needs_review ?? false,
          };
        }
      } else {
        result = await ocrInvoice.mutateAsync(item.file);
      }
      
      // Update status to done
      setBatchQueue(prev => prev.map((q, i) => 
        i === index ? { ...q, status: 'done' as const } : q
      ));
      
      // Store result with original file reference and OCR quality signals
      const newResult: BatchResultItem = {
        ...result,
        fileName: item.file.name,
        file: item.file,
        needs_review: (result as any).needs_review ?? false,
        validierung: (result as any).validierung,
      };
      const newAccumulatedResults = [...accumulatedResults, newResult];
      
      // Process next item
      setTimeout(() => processBatchItem(queue, index + 1, newAccumulatedResults), 500);
      
    } catch (error) {
      console.error('Batch item OCR failed:', error);
      
      // Update status to error
      setBatchQueue(prev => prev.map((q, i) => 
        i === index ? { ...q, status: 'error' as const, error: error instanceof Error ? error.message : 'Fehler' } : q
      ));
      
      // Continue with next item
      setTimeout(() => processBatchItem(queue, index + 1, accumulatedResults), 500);
    }
  };

  // Handle saving all batch results
  const handleSaveBatchResults = async (
    items: BatchResultItem[], 
    propertyId: string,
    abrechnungsjahrConfig?: { useCustom: boolean; year: number; verbrauchsTypes: string[] }
  ): Promise<BatchSaveResult> => {
    // Delegate the per-item loop to the pure utility (testable without React).
    // batchItemId is guaranteed by initializeItems; fall back to index as safety net.
    const loopItems = items.map((item, idx) => ({
      ...item,
      batchItemId: item.batchItemId ?? String(idx),
    }));

    const outcomes = await runBatchSaveLoop(loopItems, { propertyId, abrechnungsjahrConfig }, {
      uploadFile: (file, pid) => uploadFile(file as File, pid),
      postAudit: async (payload) => {
        const auditRes = await fetch('/api/ocr/corrections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        if (!auditRes.ok) {
          const body = await auditRes.json().catch(() => ({}));
          throw new Error(`Audit-Protokoll fehlgeschlagen (${auditRes.status}): ${(body as any).error ?? 'Unbekannter Fehler'}`);
        }
      },
      createExpense: (data) => createExpense.mutateAsync(data as any),
    });

    const savedCount = outcomes.filter(o => o.success).length;
    const failedCount = outcomes.filter(o => !o.success).length;

    if (failedCount === 0) {
      toast({
        title: 'Kosten gespeichert',
        description: `${savedCount} Einträge wurden erfolgreich gespeichert.`,
      });
    } else if (savedCount === 0) {
      toast({
        title: 'Speichern fehlgeschlagen',
        description: `Kein Eintrag konnte gespeichert werden. Bitte Fehler prüfen.`,
        variant: 'destructive',
      });
    } else {
      toast({
        title: `${savedCount} von ${savedCount + failedCount} gespeichert`,
        description: `${failedCount} Beleg${failedCount > 1 ? 'e' : ''} konnten nicht gespeichert werden — Details in der Liste.`,
        variant: 'destructive',
      });
    }

    return { outcomes };
  };

  // Cancel batch processing
  const handleCancelBatch = () => {
    setBatchCancelled(true);
    setBatchQueue([]);
    setBatchIndex(0);
    toast({
      title: 'Stapelverarbeitung abgebrochen',
      description: `${batchResults.length} Rechnungen wurden verarbeitet.`,
    });
  };

  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

  return (
    <MainLayout
      title="Buchhaltung"
      subtitle="Kosten erfassen und kategorisieren"
    >
      {/* Batch Results Summary Dialog */}
      <BatchResultsSummary
        open={batchSummaryOpen}
        onOpenChange={setBatchSummaryOpen}
        results={batchResults}
        properties={properties || []}
        onSaveAll={handleSaveBatchResults}
        onClose={() => {
          setBatchSummaryOpen(false);
          setBatchResults([]);
        }}
      />
      {/* OCR Review Dialog — öffnet sich bei needs_review=true */}
      {ocrReviewData && (
        <OcrReviewDialog
          open={ocrReviewOpen}
          onOpenChange={setOcrReviewOpen}
          ocrResult={ocrReviewData}
          onConfirm={handleOcrReviewConfirm}
          onCancel={handleOcrReviewCancel}
          fileName={ocrReviewFile?.name}
        />
      )}

      {/* PDF Page Selector Dialog */}
      <Dialog open={pdfSelectorOpen} onOpenChange={setPdfSelectorOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              PDF-Seiten auswählen
            </DialogTitle>
            <DialogDescription>
              Wählen Sie die Seiten aus, die analysiert werden sollen.
            </DialogDescription>
          </DialogHeader>
          {ocrFile && (
            <PdfPageSelector
              file={ocrFile}
              onPagesSelected={handlePdfPagesSelected}
              onCancel={() => {
                setPdfSelectorOpen(false);
                setOcrFile(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* OCR Processing Dialog */}
      <Dialog open={ocrDialogOpen} onOpenChange={(open) => !ocrProcessing && setOcrDialogOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Rechnung wird analysiert
            </DialogTitle>
            <DialogDescription>
              {ocrFile?.type === 'application/pdf' 
                ? 'Die ausgewählten Seiten werden mit KI analysiert.'
                : 'Die Rechnung wird mit KI analysiert und die Daten automatisch extrahiert.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center py-8">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-sm text-muted-foreground">
              {ocrFile?.name}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              KI analysiert die Rechnungsdaten...
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Drop Zone for Invoice Upload */}
      <InvoiceDropZone 
        onFileSelect={(file) => {
          setOcrFile(file);
          if (file.type === 'application/pdf') {
            setPdfSelectorOpen(true);
          } else {
            processOcrFile(file);
          }
        }}
        onBatchSelect={handleBatchSelect}
        disabled={ocrProcessing || batchQueue.length > 0}
        queue={batchQueue.length > 0 ? batchQueue : undefined}
        currentIndex={batchIndex}
        onCancelQueue={handleCancelBatch}
        className="mb-6"
      />

      {/* Actions Bar */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input 
            type="search" 
            placeholder="Bezeichnung oder Beleg suchen..." 
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <Select value={selectedProperty} onValueChange={setSelectedProperty}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Alle Liegenschaften" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Liegenschaften</SelectItem>
            {properties?.map(p => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map(year => (
              <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Auto-Match Button */}
        {unmatchedWithSuggestions.length > 0 && (
          <Button
            variant="outline"
            onClick={handleAutoMatchAll}
            disabled={autoMatch.isPending}
            className="border-amber-500 text-amber-700 hover:bg-amber-500/10"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            {unmatchedWithSuggestions.length} automatisch verknüpfen
          </Button>
        )}

        <div className="flex-1" />

        {/* OCR Scan Button */}
        <input
          ref={ocrFileInputRef}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          onChange={handleOcrFileChange}
          className="hidden"
        />
        <Button
          variant="outline"
          onClick={() => ocrFileInputRef.current?.click()}
          disabled={ocrInvoice.isPending}
        >
          <Camera className="h-4 w-4 mr-2" />
          Rechnung scannen
        </Button>

        <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Kosten erfassen
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg max-h-[90vh] grid-rows-[auto_1fr_auto] overflow-hidden">
            <DialogHeader>
              <DialogTitle>Neue Kosten erfassen</DialogTitle>
              <DialogDescription>
                Erfassen Sie Betriebskosten oder Instandhaltungskosten.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4 overflow-y-auto pr-2 min-h-0">
              <div className="space-y-2">
                <Label>Liegenschaft</Label>
                <Select
                  value={newExpense.property_id}
                  onValueChange={(value) => setNewExpense(prev => ({ ...prev, property_id: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Liegenschaft wählen..." />
                  </SelectTrigger>
                  <SelectContent>
                    {properties?.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Kategorie</Label>
                  <Select
                    value={newExpense.category}
                    onValueChange={(value: ExpenseCategory) => setNewExpense(prev => ({ 
                      ...prev, 
                      category: value,
                      expense_type: expenseTypesByCategory[value][0] 
                    }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="betriebskosten_umlagefaehig">Betriebskosten (umlagefähig)</SelectItem>
                      <SelectItem value="instandhaltung">Instandhaltung</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Art</Label>
                  <Select
                    value={newExpense.expense_type}
                    onValueChange={handleExpenseTypeChange}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {expenseTypesByCategory[newExpense.category].map(type => (
                        <SelectItem key={type} value={type}>{expenseTypeLabels[type]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {newExpense.category === 'betriebskosten_umlagefaehig' && (
                <div className="space-y-2">
                  <Label>Verteilungsschlüssel</Label>
                  <Select
                    value={newExpense.distribution_key_id}
                    onValueChange={(value) => setNewExpense(prev => ({ ...prev, distribution_key_id: value }))}
                  >
                    <SelectTrigger data-testid="select-distribution-key">
                      <SelectValue placeholder="Schlüssel auswählen..." />
                    </SelectTrigger>
                    <SelectContent>
                      {distributionKeys.map(key => (
                        <SelectItem key={key.id} value={key.id}>
                          {key.name} {key.unit && `(${key.unit})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Bestimmt, wie diese Ausgabe auf die Mieter verteilt wird
                  </p>
                </div>
              )}

              {/* Budget Position Select - only for Instandhaltung with property */}
              {newExpense.category === 'instandhaltung' && newExpense.property_id && (
                <BudgetPositionSelect
                  propertyId={newExpense.property_id}
                  year={new Date().getFullYear()}
                  value={newExpense.budget_position}
                  onChange={(pos) => setNewExpense(prev => ({ ...prev, budget_position: pos }))}
                />
              )}

              <div className="space-y-2">
                <Label>Bezeichnung</Label>
                <Input
                  placeholder="z.B. Gebäudeversicherung 2024"
                  value={newExpense.bezeichnung}
                  onChange={(e) => setNewExpense(prev => ({ ...prev, bezeichnung: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Betrag (€)</Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={newExpense.betrag}
                    onChange={(e) => setNewExpense(prev => ({ ...prev, betrag: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Rechnungsdatum</Label>
                  <Input
                    type="date"
                    value={newExpense.datum}
                    onChange={(e) => setNewExpense(prev => ({ ...prev, datum: e.target.value }))}
                  />
                </div>
              </div>

              {/* Abrechnungsjahr Option für verbrauchsabhängige Kosten */}
              {verbrauchsabhaengigeKosten.includes(newExpense.expense_type) && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label className="text-blue-900 dark:text-blue-100">Abrechnung für Vorjahr?</Label>
                      <p className="text-xs text-blue-700 dark:text-blue-300">
                        Verbrauchsabrechnungen kommen oft erst im Folgejahr
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={useCustomAbrechnungsjahr ? 'default' : 'outline'}
                        onClick={() => setUseCustomAbrechnungsjahr(true)}
                      >
                        Ja
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={!useCustomAbrechnungsjahr ? 'default' : 'outline'}
                        onClick={() => setUseCustomAbrechnungsjahr(false)}
                      >
                        Nein
                      </Button>
                    </div>
                  </div>
                  {useCustomAbrechnungsjahr && (
                    <div className="flex items-center gap-3">
                      <Label className="text-blue-900 dark:text-blue-100">Abrechnungsjahr:</Label>
                      <Select
                        value={customAbrechnungsjahr.toString()}
                        onValueChange={(v) => setCustomAbrechnungsjahr(parseInt(v))}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {years.map(year => (
                            <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-xs text-blue-700 dark:text-blue-300">
                        Wird unter {customAbrechnungsjahr} gebucht
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label>Belegnummer (optional)</Label>
                <Input
                  placeholder="z.B. RE-2024-001"
                  value={newExpense.beleg_nummer}
                  onChange={(e) => setNewExpense(prev => ({ ...prev, beleg_nummer: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label>Notizen (optional)</Label>
                <Textarea
                  placeholder="Zusätzliche Informationen..."
                  value={newExpense.notizen}
                  onChange={(e) => setNewExpense(prev => ({ ...prev, notizen: e.target.value }))}
                />
              </div>

              {/* Receipt Question */}
              <div className="space-y-3">
                <Label>Haben Sie einen Rechnungsbeleg?</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={hasReceipt === true ? 'default' : 'outline'}
                    onClick={() => setHasReceipt(true)}
                    className="flex-1"
                  >
                    Ja, Beleg vorhanden
                  </Button>
                  <Button
                    type="button"
                    variant={hasReceipt === false ? 'default' : 'outline'}
                    onClick={() => {
                      setHasReceipt(false);
                      setSelectedFile(null);
                    }}
                    className="flex-1"
                  >
                    Nein, ohne Beleg
                  </Button>
                </div>
              </div>

              {/* File Upload - only shown when hasReceipt is true */}
              {hasReceipt === true && (
                <div className="space-y-2">
                  <Label>Rechnungsbeleg</Label>
                  {selectedFile ? (
                    // Show already selected file (e.g., from OCR)
                    <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                      <FileText className="h-5 w-5 text-primary flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{selectedFile.name}</p>
                        <p className="text-xs text-muted-foreground">Wird automatisch als Beleg gespeichert</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setSelectedFile(null)}
                        className="flex-shrink-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    // Show upload button when no file selected
                    <div className="flex flex-col gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="application/pdf,image/*"
                        onChange={(e) => handleFileChange(e, false)}
                        className="hidden"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full"
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        Beleg hochladen
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        PDF oder Bild, max. 10 MB
                      </p>
                    </div>
                  )}
                </div>
              )}

              {hasReceipt === false && (
                <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
                  <p className="text-sm text-foreground">
                    Die Kosten werden ohne Beleg erfasst. Sie können später einen Beleg hinzufügen.
                  </p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleDialogOpenChange(false)}>
                Abbrechen
              </Button>
              <Button 
                onClick={handleCreateExpense} 
                disabled={uploading || createExpense.isPending}
              >
                {(uploading || createExpense.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {uploading ? 'Hochladen...' : 'Erfassen'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Building2 className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Betriebskosten (umlagefähig)</p>
                <p className="text-2xl font-bold">
                  € {categoryStats?.totalBetriebskosten.toLocaleString('de-AT', { minimumFractionDigits: 2 }) || '0,00'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
                <Wrench className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Instandhaltung</p>
                <p className="text-2xl font-bold">
                  € {categoryStats?.totalInstandhaltung.toLocaleString('de-AT', { minimumFractionDigits: 2 }) || '0,00'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                <Euro className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Gesamtkosten {selectedYear}</p>
                <p className="text-2xl font-bold">
                  € {categoryStats?.total.toLocaleString('de-AT', { minimumFractionDigits: 2 }) || '0,00'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs & Table */}
      <Card>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
          <CardHeader className="pb-0">
            <TabsList>
              <TabsTrigger value="all">Alle</TabsTrigger>
              <TabsTrigger value="betriebskosten_umlagefaehig">Betriebskosten</TabsTrigger>
              <TabsTrigger value="instandhaltung">Instandhaltung</TabsTrigger>
            </TabsList>
          </CardHeader>
          
          <CardContent className="p-0 pt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : !filteredExpenses || filteredExpenses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Receipt className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Keine Kosten gefunden</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Klicken Sie auf "Kosten erfassen" um eine neue Position hinzuzufügen.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Datum</TableHead>
                    <TableHead>Liegenschaft</TableHead>
                    <TableHead>Bezeichnung</TableHead>
                    <TableHead>Kategorie</TableHead>
                    <TableHead>Art</TableHead>
                    <TableHead>Bank</TableHead>
                    <TableHead>Beleg-Nr.</TableHead>
                    <TableHead>Scan</TableHead>
                    <TableHead className="text-right">Betrag</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredExpenses.map((expense) => (
                    <TableRow key={expense.id}>
                      <TableCell>
                        {format(new Date(expense.datum), 'dd.MM.yyyy', { locale: de })}
                      </TableCell>
                      <TableCell className="font-medium">
                        {(expense as any).properties?.name || '-'}
                      </TableCell>
                      <TableCell>{expense.bezeichnung}</TableCell>
                      <TableCell>
                        <Badge 
                          variant="outline"
                          className={expense.category === 'betriebskosten_umlagefaehig' 
                            ? 'border-blue-500 text-blue-700 dark:text-blue-300' 
                            : 'border-orange-500 text-orange-700 dark:text-orange-300'
                          }
                        >
                          {expense.category === 'betriebskosten_umlagefaehig' ? 'BK' : 'IH'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {expenseTypeLabels[(expense as any)?.expenseType as ExpenseType]}
                      </TableCell>
                      <TableCell>
                        <TransactionMatchBadge
                          expenseId={expense.id}
                          linkedTransaction={expense.linkedTransaction}
                          suggestedMatches={expense.suggestedMatches}
                        />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {(expense as any).belegNummer || '-'}
                      </TableCell>
                      <TableCell>
                        {(expense as any).beleg_url ? (
                          <a
                            href={(expense as any).beleg_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group relative block"
                            title="Beleg öffnen"
                          >
                            {(expense as any).beleg_url.toLowerCase().endsWith('.pdf') ? (
                              // PDF: Show icon with hover effect
                              <div className="flex items-center justify-center w-10 h-10 rounded border bg-muted/50 group-hover:bg-primary/10 group-hover:border-primary/30 transition-colors">
                                <FileText className="h-5 w-5 text-muted-foreground group-hover:text-primary" />
                              </div>
                            ) : (
                              // Image: Show thumbnail
                              <div className="relative w-10 h-10 rounded border overflow-hidden group-hover:ring-2 group-hover:ring-primary/50 transition-all">
                                <img
                                  src={(expense as any).beleg_url}
                                  alt="Beleg"
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                                  <ExternalLink className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 drop-shadow-md transition-opacity" />
                                </div>
                              </div>
                            )}
                          </a>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs text-muted-foreground hover:text-primary"
                            onClick={() => openEditDialog(expense as any)}
                          >
                            <Upload className="h-3 w-3 mr-1" />
                            Beleg
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        € {Number(expense.betrag).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => openEditDialog(expense as any)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteExpense.mutate(expense.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Tabs>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Kosten bearbeiten</DialogTitle>
            <DialogDescription>
              Bearbeiten Sie die Ausgabe oder fügen Sie einen Rechnungsbeleg hinzu.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Liegenschaft</Label>
              <Input
                value={editingExpense?.properties?.name || '-'}
                disabled
                className="bg-muted"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Kategorie</Label>
                <Select
                  value={editForm.category}
                  onValueChange={(value: ExpenseCategory) => setEditForm(prev => ({ 
                    ...prev, 
                    category: value,
                    expense_type: expenseTypesByCategory[value][0] 
                  }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="betriebskosten_umlagefaehig">Betriebskosten (umlagefähig)</SelectItem>
                    <SelectItem value="instandhaltung">Instandhaltung</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Art</Label>
                <Select
                  value={editForm.expense_type}
                  onValueChange={(value: ExpenseType) => setEditForm(prev => ({ ...prev, expense_type: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {expenseTypesByCategory[editForm.category].map(type => (
                      <SelectItem key={type} value={type}>{expenseTypeLabels[type]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Bezeichnung</Label>
              <Input
                placeholder="z.B. Gebäudeversicherung 2024"
                value={editForm.bezeichnung}
                onChange={(e) => setEditForm(prev => ({ ...prev, bezeichnung: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Betrag (€)</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={editForm.betrag}
                  onChange={(e) => setEditForm(prev => ({ ...prev, betrag: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label>Datum</Label>
                <Input
                  type="date"
                  value={editForm.datum}
                  onChange={(e) => setEditForm(prev => ({ ...prev, datum: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Belegnummer (optional)</Label>
              <Input
                placeholder="z.B. RE-2024-001"
                value={editForm.beleg_nummer}
                onChange={(e) => setEditForm(prev => ({ ...prev, beleg_nummer: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>Notizen (optional)</Label>
              <Textarea
                placeholder="Zusätzliche Informationen..."
                value={editForm.notizen}
                onChange={(e) => setEditForm(prev => ({ ...prev, notizen: e.target.value }))}
              />
            </div>

            {/* PDF Upload / Existing PDF */}
            <div className="space-y-2">
              <Label>Rechnungsbeleg (PDF)</Label>
              
              {/* Show existing PDF if available */}
              {editForm.beleg_url && !editSelectedFile && (
                <div className="flex items-center gap-2 p-2 border rounded-lg bg-muted/50">
                  <FileText className="h-4 w-4 text-primary" />
                  <a
                    href={editForm.beleg_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline flex-1 truncate"
                  >
                    Vorhandener Beleg anzeigen
                  </a>
                  <ExternalLink className="h-3 w-3 text-muted-foreground" />
                </div>
              )}
              
              <div className="flex items-center gap-2">
                <input
                  ref={editFileInputRef}
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => handleFileChange(e, true)}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => editFileInputRef.current?.click()}
                  className="w-full"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {editSelectedFile 
                    ? editSelectedFile.name 
                    : editForm.beleg_url 
                      ? 'Neuen Beleg hochladen' 
                      : 'PDF hochladen'
                  }
                </Button>
                {editSelectedFile && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditSelectedFile(null)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Max. 10 MB, nur PDF-Format
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Abbrechen
            </Button>
            <Button 
              onClick={handleUpdateExpense} 
              disabled={uploading || updateExpense.isPending}
            >
              {(uploading || updateExpense.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {uploading ? 'Hochladen...' : 'Speichern'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
