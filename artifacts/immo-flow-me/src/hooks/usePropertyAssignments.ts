import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';

export interface PropertyAssignment {
  property_id: string;
  property_name: string;
  property_address: string;
}

export function useUserPropertyAssignments(userId: string | undefined) {
  return useQuery({
    queryKey: ['user-property-assignments', userId],
    queryFn: async () => {
      if (!userId) return [];
      const response = await fetch(`/api/users/${userId}/property-assignments`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch property assignments');
      return response.json() as Promise<PropertyAssignment[]>;
    },
    enabled: !!userId,
  });
}

export function useUpdatePropertyAssignments() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      userId, 
      propertyIds 
    }: { 
      userId: string; 
      propertyIds: string[];
    }) => {
      const response = await apiRequest('PUT', `/api/users/${userId}/property-assignments`, { propertyIds });
      return response.json();
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['user-property-assignments', variables.userId] });
      queryClient.invalidateQueries({ queryKey: ['team-members'] });
      queryClient.invalidateQueries({ queryKey: ['property_managers'] });
      
      if (result.added > 0 || result.removed > 0) {
        toast.success(`Zuweisungen aktualisiert: ${result.added} hinzugefügt, ${result.removed} entfernt`);
      } else {
        toast.success('Keine Änderungen vorgenommen');
      }
    },
    onError: (error) => {
      console.error('Error updating property assignments:', error);
      toast.error('Fehler beim Aktualisieren der Zuweisungen');
    },
  });
}
