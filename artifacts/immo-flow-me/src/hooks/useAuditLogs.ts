import { useQuery } from '@tanstack/react-query';

export interface AuditLog {
  id: string;
  user_id: string | null;
  table_name: string;
  record_id: string | null;
  action: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  ip_address: unknown;
  user_agent: string | null;
  hash: string | null;
  previous_hash: string | null;
  created_at: string;
}

export interface AuditLogFilters {
  tableName?: string;
  action?: string;
  limit?: number;
  startDate?: string;
  endDate?: string;
}

export function useAuditLogs(filters?: AuditLogFilters) {
  return useQuery({
    queryKey: ['audit-logs', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.tableName) params.set('table_name', filters.tableName);
      if (filters?.action) params.set('action', filters.action);
      if (filters?.limit) params.set('limit', String(filters.limit));
      if (filters?.startDate) params.set('start_date', filters.startDate);
      if (filters?.endDate) params.set('end_date', filters.endDate);

      const response = await fetch(`/api/audit-logs?${params.toString()}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Fehler beim Laden der Audit-Logs');
      return response.json() as Promise<AuditLog[]>;
    },
  });
}

export function useAuditLogStats() {
  const { data: logs } = useAuditLogs({ limit: 1000 });

  if (!logs) {
    return {
      totalLogs: 0,
      createCount: 0,
      updateCount: 0,
      deleteCount: 0,
      tableStats: {} as Record<string, number>,
    };
  }

  const createCount = logs.filter(l => l.action === 'create').length;
  const updateCount = logs.filter(l => l.action === 'update').length;
  const deleteCount = logs.filter(l => l.action === 'delete').length;

  const tableStats: Record<string, number> = {};
  logs.forEach(log => {
    tableStats[log.table_name] = (tableStats[log.table_name] || 0) + 1;
  });

  return {
    totalLogs: logs.length,
    createCount,
    updateCount,
    deleteCount,
    tableStats,
  };
}
