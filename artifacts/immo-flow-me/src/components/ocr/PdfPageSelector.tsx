import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, FileText, CheckSquare, Square } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configure PDF.js worker (bundled by Vite)
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

interface PagePreview {
  pageNumber: number;
  thumbnail: string;
}

interface PdfPageSelectorProps {
  file: File;
  onPagesSelected: (selectedPages: number[], allPagesImage?: string) => void;
  onCancel: () => void;
}

export function PdfPageSelector({ file, onPagesSelected, onCancel }: PdfPageSelectorProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<PagePreview[]>([]);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [processing, setProcessing] = useState(false);

  // Load PDF and generate thumbnails
  useEffect(() => {
    const loadPdf = async () => {
      try {
        setLoading(true);
        setError(null);

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const numPages = pdf.numPages;

        const pagePreviews: PagePreview[] = [];

        for (let i = 1; i <= numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 0.3 }); // Small thumbnails

          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          if (!context) continue;

          canvas.height = viewport.height;
          canvas.width = viewport.width;

          await page.render({
            canvasContext: context,
            viewport: viewport,
          }).promise;

          pagePreviews.push({
            pageNumber: i,
            thumbnail: canvas.toDataURL('image/jpeg', 0.7),
          });
        }

        setPages(pagePreviews);
        // Select first page by default
        setSelectedPages(new Set([1]));
      } catch (err) {
        console.error('Error loading PDF:', err);
        setError('PDF konnte nicht geladen werden');
      } finally {
        setLoading(false);
      }
    };

    loadPdf();
  }, [file]);

  const togglePage = useCallback((pageNumber: number) => {
    setSelectedPages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(pageNumber)) {
        newSet.delete(pageNumber);
      } else {
        newSet.add(pageNumber);
      }
      return newSet;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedPages(new Set(pages.map(p => p.pageNumber)));
  }, [pages]);

  const selectNone = useCallback(() => {
    setSelectedPages(new Set());
  }, []);

  const handleConfirm = useCallback(async () => {
    if (selectedPages.size === 0) return;

    setProcessing(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      // If only one page selected, render it at higher resolution
      if (selectedPages.size === 1) {
        const pageNum = Array.from(selectedPages)[0];
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2.0 }); // Higher res for OCR

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas context error');

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({
          canvasContext: context,
          viewport: viewport,
        }).promise;

        const imageData = canvas.toDataURL('image/png');
        onPagesSelected(Array.from(selectedPages), imageData);
      } else {
        // For multiple pages, create a combined image (stacked vertically)
        const sortedPages = Array.from(selectedPages).sort((a, b) => a - b);
        const pageImages: { canvas: HTMLCanvasElement; height: number; width: number }[] = [];

        let totalHeight = 0;
        let maxWidth = 0;

        for (const pageNum of sortedPages) {
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1.5 });

          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          if (!context) continue;

          canvas.height = viewport.height;
          canvas.width = viewport.width;

          await page.render({
            canvasContext: context,
            viewport: viewport,
          }).promise;

          pageImages.push({ canvas, height: viewport.height, width: viewport.width });
          totalHeight += viewport.height + 20; // 20px gap between pages
          maxWidth = Math.max(maxWidth, viewport.width);
        }

        // Combine all pages into one image
        const combinedCanvas = document.createElement('canvas');
        combinedCanvas.width = maxWidth;
        combinedCanvas.height = totalHeight;
        const combinedContext = combinedCanvas.getContext('2d');

        if (combinedContext) {
          combinedContext.fillStyle = '#ffffff';
          combinedContext.fillRect(0, 0, maxWidth, totalHeight);

          let yOffset = 0;
          for (const { canvas, height } of pageImages) {
            combinedContext.drawImage(canvas, 0, yOffset);
            yOffset += height + 20;
          }

          const imageData = combinedCanvas.toDataURL('image/png');
          onPagesSelected(sortedPages, imageData);
        }
      }
    } catch (err) {
      console.error('Error processing pages:', err);
      setError('Fehler beim Verarbeiten der Seiten');
    } finally {
      setProcessing(false);
    }
  }, [file, selectedPages, onPagesSelected]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-sm text-muted-foreground">PDF wird geladen...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <FileText className="h-8 w-8 text-destructive mb-4" />
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={onCancel} className="mt-4">
          Abbrechen
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {pages.length} Seite{pages.length !== 1 ? 'n' : ''} gefunden
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={selectAll}>
            <CheckSquare className="h-4 w-4 mr-1" />
            Alle
          </Button>
          <Button variant="ghost" size="sm" onClick={selectNone}>
            <Square className="h-4 w-4 mr-1" />
            Keine
          </Button>
        </div>
      </div>

      <ScrollArea className="h-[300px] rounded-md border p-4">
        <div className="grid grid-cols-3 gap-4">
          {pages.map((page) => (
            <div
              key={page.pageNumber}
              className={`relative cursor-pointer rounded-lg border-2 overflow-hidden transition-all ${
                selectedPages.has(page.pageNumber)
                  ? 'border-primary ring-2 ring-primary/20'
                  : 'border-border hover:border-muted-foreground'
              }`}
              onClick={() => togglePage(page.pageNumber)}
            >
              <img
                src={page.thumbnail}
                alt={`Seite ${page.pageNumber}`}
                className="w-full h-auto"
              />
              <div className="absolute top-2 left-2">
                <Checkbox
                  checked={selectedPages.has(page.pageNumber)}
                  onCheckedChange={() => togglePage(page.pageNumber)}
                />
              </div>
              <div className="absolute bottom-0 left-0 right-0 bg-background/80 text-center py-1">
                <span className="text-xs font-medium">Seite {page.pageNumber}</span>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button
          onClick={handleConfirm}
          disabled={selectedPages.size === 0 || processing}
        >
          {processing ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Verarbeite...
            </>
          ) : (
            <>
              {selectedPages.size} Seite{selectedPages.size !== 1 ? 'n' : ''} analysieren
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
