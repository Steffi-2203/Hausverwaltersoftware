import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { X, Download } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const INSTALL_DISMISSED_KEY = 'immoflow_install_dismissed';

export function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      const val = localStorage.getItem(INSTALL_DISMISSED_KEY);
      if (!val) return false;
      const ts = parseInt(val, 10);
      return Date.now() - ts < 7 * 24 * 60 * 60 * 1000;
    } catch { return false; }
  });
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => setIsInstalled(true));

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(INSTALL_DISMISSED_KEY, Date.now().toString());
    } catch {}
  };

  if (isInstalled || dismissed || !deferredPrompt) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md" data-testid="banner-pwa-install">
      <div className="flex items-center gap-3 rounded-md border bg-card p-3 shadow-lg">
        <Download className="h-5 w-5 shrink-0 text-primary" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium" data-testid="text-install-title">App installieren</p>
          <p className="text-xs text-muted-foreground" data-testid="text-install-desc">Schnellerer Zugriff direkt vom Startbildschirm</p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" onClick={handleInstall} data-testid="button-install-app">
            Installieren
          </Button>
          <Button size="icon" variant="ghost" onClick={handleDismiss} data-testid="button-dismiss-install">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
