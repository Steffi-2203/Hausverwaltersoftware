import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';

export function useEbicsConnections() {
  return useQuery({
    queryKey: ['/api/ebics/connections'],
  });
}

export function useEbicsOrders() {
  return useQuery({
    queryKey: ['/api/ebics/orders'],
  });
}

export function useEbicsPaymentBatches() {
  return useQuery({
    queryKey: ['/api/ebics/payment-batches'],
  });
}

export function useCreateEbicsConnection() {
  return useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/ebics/connections', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ebics/connections'] });
    },
  });
}

export function useDeleteEbicsConnection() {
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/ebics/connections/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ebics/connections'] });
    },
  });
}

export function useInitEbicsKeys() {
  return useMutation({
    mutationFn: async (connectionId: string) => {
      const res = await apiRequest('POST', `/api/ebics/connections/${connectionId}/init-keys`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ebics/connections'] });
      queryClient.invalidateQueries({ queryKey: ['/api/ebics/orders'] });
    },
  });
}

export function useActivateEbicsConnection() {
  return useMutation({
    mutationFn: async (connectionId: string) => {
      const res = await apiRequest('POST', `/api/ebics/connections/${connectionId}/activate`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ebics/connections'] });
      queryClient.invalidateQueries({ queryKey: ['/api/ebics/orders'] });
    },
  });
}

export function useFetchEbicsStatements() {
  return useMutation({
    mutationFn: async ({ connectionId, fromDate, toDate }: { connectionId: string; fromDate: string; toDate: string }) => {
      const res = await apiRequest('POST', `/api/ebics/connections/${connectionId}/fetch-statements`, { fromDate, toDate });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ebics/orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/ebics/connections'] });
    },
  });
}

export function useSubmitEbicsPaymentBatch() {
  return useMutation({
    mutationFn: async (batchId: string) => {
      const res = await apiRequest('POST', `/api/ebics/payment-batches/${batchId}/submit`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ebics/payment-batches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/ebics/orders'] });
    },
  });
}
