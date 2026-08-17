import { useState, useCallback, useEffect } from 'react';
import { Upload, FileText, Image, X, Check, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

export interface QueuedFile {
  file: File;
  previewUrl: string | null;
  status: 'pending' | 'processing' | 'done' | 'error';
  error?: string;
}

interface InvoiceDropZoneProps {
  onFileSelect: (file: File) => void;
  onBatchSelect?: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
  // Batch processing props
  queue?: QueuedFile[];
  currentIndex?: number;
  onCancelQueue?: () => void;
}

export function InvoiceDropZone({ 
  onFileSelect, 
  onBatchSelect,
  disabled, 
  className,
  queue,
  currentIndex,
  onCancelQueue,
}: InvoiceDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragError, setDragError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<(string | null)[]>([]);
  const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);
  const [loadingPreviews, setLoadingPreviews] = useState(false);

  const validateFile = useCallback((file: File): string | null => {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    
    if (!validTypes.includes(file.type)) {
      return 'Nur Bilder (JPG, PNG) oder PDFs erlaubt';
    }
    
    if (file.size > 20 * 1024 * 1024) {
      return 'Datei zu groß (max. 20 MB)';
    }
    
    return null;
  }, []);

  // Generate previews when files are selected
  useEffect(() => {
    if (selectedFiles.length === 0) {
      setPreviewUrls([]);
      return;
    }

    setLoadingPreviews(true);
    const generatePreviews = async () => {
      const urls: (string | null)[] = [];
      
      for (const file of selectedFiles) {
        if (file.type.startsWith('image/')) {
          urls.push(URL.createObjectURL(file));
        } else if (file.type === 'application/pdf') {
          const url = await generatePdfPreview(file);
          urls.push(url);
        } else {
          urls.push(null);
        }
      }
      
      setPreviewUrls(urls);
      setLoadingPreviews(false);
    };

    generatePreviews();

    return () => {
      previewUrls.forEach(url => {
        if (url && url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [selectedFiles]);

  const generatePdfPreview = async (file: File): Promise<string | null> => {
    try {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
      
      
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1);
      
      const scale = 0.5;
      const viewport = page.getViewport({ scale });
      
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      
      const context = canvas.getContext('2d');
      if (!context) return null;
      
      await page.render({ canvasContext: context, viewport }).promise;
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  };

  const handleFileSelection = useCallback((files: File[]) => {
    const validFiles: File[] = [];
    let hasError = false;
    
    for (const file of files) {
      const error = validateFile(file);
      if (error) {
        setDragError(error);
        setTimeout(() => setDragError(null), 3000);
        hasError = true;
        break;
      }
      validFiles.push(file);
    }
    
    if (!hasError && validFiles.length > 0) {
      setSelectedFiles(validFiles);
      setCurrentPreviewIndex(0);
    }
  }, [validateFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && selectedFiles.length === 0 && !queue) {
      setIsDragOver(true);
      setDragError(null);
    }
  }, [disabled, selectedFiles.length, queue]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    setDragError(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (disabled || selectedFiles.length > 0 || queue) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    handleFileSelection(files);
  }, [disabled, selectedFiles.length, queue, handleFileSelection]);

  const handleClick = useCallback(() => {
    if (disabled || selectedFiles.length > 0 || queue) return;
    
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf';
    input.multiple = true;
    input.onchange = (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || []);
      if (files.length > 0) {
        handleFileSelection(files);
      }
    };
    input.click();
  }, [disabled, selectedFiles.length, queue, handleFileSelection]);

  const handleConfirm = useCallback(() => {
    if (selectedFiles.length === 1) {
      onFileSelect(selectedFiles[0]);
    } else if (selectedFiles.length > 1 && onBatchSelect) {
      onBatchSelect(selectedFiles);
    }
    setSelectedFiles([]);
    setPreviewUrls([]);
    setCurrentPreviewIndex(0);
  }, [selectedFiles, onFileSelect, onBatchSelect]);

  const handleCancel = useCallback(() => {
    setSelectedFiles([]);
    setPreviewUrls([]);
    setCurrentPreviewIndex(0);
  }, []);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Queue processing mode
  if (queue && queue.length > 0) {
    const processedCount = queue.filter(q => q.status === 'done').length;
    const currentFile = queue[currentIndex || 0];
    const progress = (processedCount / queue.length) * 100;

    return (
      <div className={cn(
        'relative border-2 border-primary rounded-lg p-4 transition-all',
        'flex flex-col items-center gap-4',
        className
      )}>
        {/* Progress */}
        <div className="w-full space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Stapelverarbeitung</span>
            <span className="text-muted-foreground">{processedCount} / {queue.length}</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Current file preview */}
        {currentFile && (
          <div className="flex items-center gap-4 w-full">
            <div className="relative w-20 h-20 bg-muted rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0">
              {currentFile.previewUrl ? (
                <img 
                  src={currentFile.previewUrl} 
                  alt="Vorschau" 
                  className="w-full h-full object-contain"
                />
              ) : (
                <FileText className="h-8 w-8 text-muted-foreground" />
              )}
              {currentFile.status === 'processing' && (
                <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              )}
              {currentFile.status === 'done' && (
                <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                  <Check className="h-6 w-6 text-primary" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{currentFile.file.name}</p>
              <p className="text-xs text-muted-foreground">
                {currentFile.status === 'processing' && 'Wird analysiert...'}
                {currentFile.status === 'done' && 'Abgeschlossen'}
                {currentFile.status === 'pending' && 'Wartend...'}
                {currentFile.status === 'error' && (currentFile.error || 'Fehler')}
              </p>
            </div>
          </div>
        )}

        {/* Queue preview */}
        <div className="flex gap-1 overflow-x-auto w-full pb-2">
          {queue.map((item, idx) => (
            <div 
              key={idx}
              className={cn(
                'relative w-10 h-10 rounded flex-shrink-0 overflow-hidden border-2',
                idx === currentIndex ? 'border-primary' : 'border-transparent',
                item.status === 'done' && 'opacity-50'
              )}
            >
              {item.previewUrl ? (
                <img src={item.previewUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-muted flex items-center justify-center">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
              {item.status === 'done' && (
                <div className="absolute inset-0 bg-primary/40 flex items-center justify-center">
                  <Check className="h-3 w-3 text-primary-foreground" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Cancel button */}
        {onCancelQueue && (
          <Button variant="outline" size="sm" onClick={onCancelQueue}>
            <X className="h-4 w-4 mr-1" />
            Abbrechen
          </Button>
        )}
      </div>
    );
  }

  // Preview mode (single or multiple files)
  if (selectedFiles.length > 0) {
    const currentFile = selectedFiles[currentPreviewIndex];
    const currentPreview = previewUrls[currentPreviewIndex];
    const isPdf = currentFile?.type === 'application/pdf';
    const isMultiple = selectedFiles.length > 1;
    
    return (
      <div className={cn(
        'relative border-2 border-primary rounded-lg p-4 transition-all',
        'flex flex-col items-center gap-4',
        className
      )}>
        {/* Multiple file indicator */}
        {isMultiple && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{selectedFiles.length} Dateien</span>
            <span>ausgewählt</span>
          </div>
        )}

        {/* Preview with navigation */}
        <div className="relative w-full max-w-xs">
          {isMultiple && currentPreviewIndex > 0 && (
            <Button
              variant="outline"
              size="icon"
              className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 h-8 w-8 rounded-full"
              onClick={() => setCurrentPreviewIndex(i => Math.max(0, i - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          
          <div className="aspect-[3/4] bg-muted rounded-lg overflow-hidden flex items-center justify-center">
            {loadingPreviews ? (
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            ) : currentPreview ? (
              <img 
                src={currentPreview} 
                alt="Vorschau" 
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <FileText className="h-12 w-12" />
                <span className="text-xs">Keine Vorschau</span>
              </div>
            )}
            {isPdf && (
              <div className="absolute top-2 right-2 bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded">
                PDF
              </div>
            )}
          </div>

          {isMultiple && currentPreviewIndex < selectedFiles.length - 1 && (
            <Button
              variant="outline"
              size="icon"
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10 h-8 w-8 rounded-full"
              onClick={() => setCurrentPreviewIndex(i => Math.min(selectedFiles.length - 1, i + 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Thumbnail strip for multiple files */}
        {isMultiple && (
          <div className="flex gap-1 overflow-x-auto w-full pb-2 justify-center">
            {selectedFiles.map((file, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentPreviewIndex(idx)}
                className={cn(
                  'relative w-10 h-10 rounded flex-shrink-0 overflow-hidden border-2 transition-all',
                  idx === currentPreviewIndex ? 'border-primary ring-2 ring-primary/20' : 'border-muted hover:border-primary/50'
                )}
              >
                {previewUrls[idx] ? (
                  <img src={previewUrls[idx]!} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-muted flex items-center justify-center">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {/* File info */}
        <div className="text-center space-y-1">
          <p className="text-sm font-medium truncate max-w-[250px]">{currentFile?.name}</p>
          <p className="text-xs text-muted-foreground">
            {currentFile && formatFileSize(currentFile.size)}
            {isMultiple && ` • ${currentPreviewIndex + 1} von ${selectedFiles.length}`}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCancel} disabled={disabled}>
            <X className="h-4 w-4 mr-1" />
            Abbrechen
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={disabled}>
            <Check className="h-4 w-4 mr-1" />
            {isMultiple ? `${selectedFiles.length} analysieren` : 'Analysieren'}
          </Button>
        </div>
      </div>
    );
  }

  // Drop zone mode
  return (
    <div
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'relative border-2 border-dashed rounded-xl p-12 transition-all cursor-pointer min-h-[200px]',
        'flex flex-col items-center justify-center gap-4 text-center',
        isDragOver && !disabled && 'border-primary bg-primary/10 scale-[1.02] shadow-lg shadow-primary/20',
        !isDragOver && !disabled && 'border-primary/40 bg-primary/5 hover:border-primary hover:bg-primary/10 hover:shadow-md',
        disabled && 'opacity-50 cursor-not-allowed',
        dragError && 'border-destructive bg-destructive/5',
        className
      )}
    >
      {dragError ? (
        <>
          <div className="p-4 rounded-xl bg-destructive/10">
            <X className="h-10 w-10 text-destructive" />
          </div>
          <p className="text-lg font-semibold text-destructive">{dragError}</p>
        </>
      ) : (
        <>
          {/* OCR Badge */}
          <div className="absolute top-3 right-3 bg-primary/10 text-primary text-xs font-medium px-2.5 py-1 rounded-full">
            OCR-Analyse
          </div>

          <div className={cn(
            'p-4 rounded-xl transition-all',
            isDragOver ? 'bg-primary/20 scale-110' : 'bg-primary/10'
          )}>
            <Upload className={cn(
              'h-10 w-10 transition-colors',
              isDragOver ? 'text-primary animate-bounce' : 'text-primary/70'
            )} />
          </div>
          
          <div className="space-y-2">
            <p className={cn(
              'text-lg font-semibold transition-colors',
              isDragOver ? 'text-primary' : 'text-foreground'
            )}>
              {isDragOver ? 'Jetzt loslassen!' : 'Rechnungen hier ablegen oder klicken'}
            </p>
            <p className="text-sm text-muted-foreground">
              Dateien per Drag & Drop ablegen oder klicken zum Auswählen
            </p>
            <p className="text-xs text-muted-foreground">
              Mehrere Dateien gleichzeitig möglich • Max. 20 MB pro Datei
            </p>
          </div>

          <div className="flex items-center gap-6 mt-3">
            <div className="flex items-center gap-2 bg-muted/50 px-3 py-1.5 rounded-full">
              <Image className="h-5 w-5 text-primary" />
              <span className="text-sm font-medium">JPG, PNG</span>
            </div>
            <div className="flex items-center gap-2 bg-muted/50 px-3 py-1.5 rounded-full">
              <FileText className="h-5 w-5 text-primary" />
              <span className="text-sm font-medium">PDF</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
