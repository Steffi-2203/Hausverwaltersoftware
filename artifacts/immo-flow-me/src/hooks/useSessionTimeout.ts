import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const WARNING_MS = 5 * 60 * 1000; // 5 minutes before timeout

export function useSessionTimeout() {
  const { signOut, isAuthenticated } = useAuth();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const warningRef = useRef<NodeJS.Timeout | null>(null);
  const [showWarning, setShowWarning] = useState(false);

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (warningRef.current) {
      clearTimeout(warningRef.current);
      warningRef.current = null;
    }
  }, []);

  const handleLogout = useCallback(async () => {
    clearTimers();
    setShowWarning(false);
    toast.info('Sie wurden aus Sicherheitsgründen automatisch abgemeldet.');
    await signOut();
  }, [signOut, clearTimers]);

  const resetTimer = useCallback(() => {
    if (!isAuthenticated) return;

    clearTimers();
    setShowWarning(false);

    // Set warning timer (5 minutes before timeout)
    warningRef.current = setTimeout(() => {
      setShowWarning(true);
      toast.warning('Ihre Sitzung läuft in 5 Minuten ab. Bewegen Sie die Maus oder drücken Sie eine Taste, um angemeldet zu bleiben.', {
        duration: 10000,
      });
    }, TIMEOUT_MS - WARNING_MS);

    // Set logout timer
    timeoutRef.current = setTimeout(handleLogout, TIMEOUT_MS);
  }, [isAuthenticated, clearTimers, handleLogout]);

  const extendSession = useCallback(() => {
    if (showWarning) {
      toast.success('Sitzung verlängert.');
    }
    resetTimer();
  }, [showWarning, resetTimer]);

  useEffect(() => {
    if (!isAuthenticated) {
      clearTimers();
      return;
    }

    // Activity events to track
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];

    const handleActivity = () => {
      resetTimer();
    };

    // Add event listeners
    events.forEach((event) => {
      document.addEventListener(event, handleActivity, { passive: true });
    });

    // Initial timer setup
    resetTimer();

    return () => {
      clearTimers();
      events.forEach((event) => {
        document.removeEventListener(event, handleActivity);
      });
    };
  }, [isAuthenticated, resetTimer, clearTimers]);

  return {
    showWarning,
    extendSession,
    remainingTime: TIMEOUT_MS,
  };
}
