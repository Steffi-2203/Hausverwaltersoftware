import { useState, useCallback, useEffect } from 'react';

const ONBOARDING_KEY = 'immoflow_onboarding_complete';

export function useOnboardingStatus() {
  const [isComplete, setIsComplete] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(ONBOARDING_KEY) === 'true';
  });

  useEffect(() => {
    // Sync with localStorage on mount
    const stored = localStorage.getItem(ONBOARDING_KEY);
    setIsComplete(stored === 'true');
  }, []);

  const markComplete = useCallback(() => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    setIsComplete(true);
  }, []);

  const resetOnboarding = useCallback(() => {
    localStorage.removeItem(ONBOARDING_KEY);
    setIsComplete(false);
  }, []);

  return {
    isComplete,
    markComplete,
    resetOnboarding,
  };
}
