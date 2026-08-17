import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { apiRequest } from '@/lib/queryClient';

export const usePropertyManager = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const assignProperty = useMutation({
    mutationFn: async (propertyId: string) => {
      if (!user) throw new Error('Not authenticated');
      
      const response = await apiRequest('POST', '/api/property-managers', {
        propertyId,
      });

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      queryClient.invalidateQueries({ queryKey: ['property_managers'] });
    },
  });

  const unassignProperty = useMutation({
    mutationFn: async (propertyId: string) => {
      if (!user) throw new Error('Not authenticated');
      
      await apiRequest('DELETE', `/api/property-managers/${propertyId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      queryClient.invalidateQueries({ queryKey: ['property_managers'] });
    },
  });

  const createPropertyWithOwnership = useCallback(async (propertyData: {
    name: string;
    address: string;
    city: string;
    postal_code: string;
    country?: string;
    building_year?: number | null;
  }) => {
    if (!user) throw new Error('Not authenticated');

    const propertyId = crypto.randomUUID();

    const response = await apiRequest('POST', '/api/properties', {
      id: propertyId,
      ...propertyData,
    });

    return response.json();
  }, [user]);

  return {
    assignProperty,
    unassignProperty,
    createPropertyWithOwnership,
  };
};
