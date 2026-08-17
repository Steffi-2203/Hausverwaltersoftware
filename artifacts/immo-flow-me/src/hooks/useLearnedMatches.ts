import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';

export interface LearnedMatch {
  id: string;
  organization_id: string | null;
  pattern: string;
  unit_id: string | null;
  tenant_id: string | null;
  match_count: number | null;
  created_at: string;
  updated_at: string;
}

export interface LearnedMatchInsert {
  organization_id?: string | null;
  pattern: string;
  unit_id?: string | null;
  tenant_id?: string | null;
}

export function useLearnedMatches() {
  return useQuery({
    queryKey: ['learned_matches'],
    queryFn: async () => {
      const response = await fetch('/api/learned-matches', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch learned matches');
      return response.json() as Promise<LearnedMatch[]>;
    },
  });
}

export function useCreateLearnedMatch() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (match: LearnedMatchInsert) => {
      const response = await apiRequest('POST', '/api/learned-matches', match);
      return response.json() as Promise<LearnedMatch>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learned_matches'] });
    },
    onError: (error) => {
      console.error('Create learned match error:', error);
    },
  });
}

export function useIncrementLearnedMatch() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest('POST', `/api/learned-matches/${id}/increment`, {});
      return response.json() as Promise<LearnedMatch>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learned_matches'] });
    },
  });
}

export function useDeleteLearnedMatch() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/learned-matches/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learned_matches'] });
      toast.success('Gelerntes Pattern gelöscht');
    },
    onError: (error) => {
      toast.error('Fehler beim Löschen');
      console.error('Delete learned match error:', error);
    },
  });
}
