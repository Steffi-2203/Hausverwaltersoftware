import { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';

export function OfflineIndicator() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);

    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-destructive px-4 py-1.5 text-center text-sm text-destructive-foreground" data-testid="banner-offline">
      <div className="flex items-center justify-center gap-2">
        <WifiOff className="h-3.5 w-3.5" />
        <span>Keine Internetverbindung. Einige Funktionen sind eingeschränkt.</span>
      </div>
    </div>
  );
}
