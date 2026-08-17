type CsvRow = Record<string, string | number | boolean | null | undefined>;

export const exportToCSV = (
  data: CsvRow[],
  filename: string,
  headers?: Record<string, string>
) => {
  if (data.length === 0) return;

  const keys = Object.keys(headers || data[0]);
  const headerLabels = headers ? Object.values(headers) : keys;
  
  const csvContent = [
    headerLabels.join(';'),
    ...data.map(row => 
      keys.map(key => {
        const value = row[key];
        if (value === null || value === undefined) return '';
        if (typeof value === 'string') {
          return `"${value.replace(/"/g, '""')}"`;
        }
        if (typeof value === 'number') {
          return value.toLocaleString('de-AT');
        }
        return String(value);
      }).join(';')
    )
  ].join('\n');

  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
};

export const formatCurrency = (value: number): string => {
  return `€ ${value.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const formatDate = (date: string | Date | null | undefined): string => {
  if (!date) return '';
  return new Date(date).toLocaleDateString('de-AT');
};

export const formatPercent = (value: number): string => {
  return `${value.toLocaleString('de-AT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
};
