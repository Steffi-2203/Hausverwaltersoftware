import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Clock, Zap } from "lucide-react";
import { Link } from "react-router-dom";

interface DemoStatus {
  isDemo: boolean;
  endsAt: string | null;
  remainingMinutes: number;
}

export function DemoTimerBanner() {
  const [timeLeft, setTimeLeft] = useState<number>(0);

  const { data: demoStatus } = useQuery<DemoStatus>({
    queryKey: ["/api/demo/status"],
    refetchInterval: 60000,
  });

  useEffect(() => {
    if (!demoStatus?.isDemo || !demoStatus.endsAt) return;

    const updateTimer = () => {
      const now = new Date().getTime();
      const end = new Date(demoStatus.endsAt!).getTime();
      const remaining = Math.max(0, Math.floor((end - now) / 1000));
      setTimeLeft(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [demoStatus]);

  if (!demoStatus?.isDemo) return null;

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const isExpired = timeLeft <= 0;
  const isUrgent = timeLeft <= 300;

  if (isExpired) {
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-8 max-w-md text-center shadow-2xl">
          <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900 rounded-full flex items-center justify-center mx-auto mb-4">
            <Clock className="w-8 h-8 text-orange-600" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Demo abgelaufen</h2>
          <p className="text-muted-foreground mb-6">
            Ihre 30-Minuten Demo ist beendet. Wir hoffen, ImmoFlowMe hat Ihnen gefallen!
          </p>
          <div className="space-y-3">
            <Button asChild className="w-full" data-testid="button-upgrade-now">
              <Link to="/einstellungen">
                <Zap className="w-4 h-4 mr-2" />
                Jetzt upgraden
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full" data-testid="button-contact-sales">
              <a href="mailto:kontakt@immoflowme.at">Kontakt aufnehmen</a>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Alert 
      className={`fixed top-0 left-0 right-0 z-50 rounded-none border-x-0 border-t-0 ${
        isUrgent 
          ? "bg-orange-500 text-white border-orange-600" 
          : "bg-blue-500 text-white border-blue-600"
      }`}
    >
      <div className="container flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4" />
          <AlertDescription className="text-white font-medium">
            Demo-Zugang: <span className="font-mono">{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}</span> verbleibend
          </AlertDescription>
        </div>
        <Button 
          asChild 
          size="sm" 
          variant={isUrgent ? "secondary" : "outline"} 
          className={isUrgent ? "" : "text-white border-white hover:bg-white/20"}
          data-testid="button-demo-upgrade"
        >
          <Link to="/settings/subscription">
            <Zap className="w-3 h-3 mr-1" />
            Upgraden
          </Link>
        </Button>
      </div>
    </Alert>
  );
}
