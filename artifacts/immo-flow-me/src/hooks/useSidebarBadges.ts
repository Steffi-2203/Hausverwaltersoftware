import { useQuery } from '@tanstack/react-query';

interface SidebarBadges {
  dunning: number;
  maintenance: number;
  messages: number;
  invoiceApproval: number;
}

export function useSidebarBadges() {
  return useQuery<SidebarBadges>({
    queryKey: ['/api/sidebar-badges'],
    queryFn: async () => ({
      dunning: 0,
      maintenance: 0,
      messages: 0,
      invoiceApproval: 0,
    }),
    staleTime: 60000,
  });
}
