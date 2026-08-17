import { useQuery } from '@tanstack/react-query';
import { useAuth } from './useAuth';

export function useKiAutopilot() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery<{ active: boolean; trialEndsAt: string | null }>({
    queryKey: ['/api/user/ki-autopilot-status'],
    enabled: !!user,
  });

  return {
    isActive: data?.active ?? false,
    isLoading,
  };
}
