import { useQuery } from '@tanstack/react-query';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { normalizeFields } from '@/utils/fieldNormalizer';

export interface CalendarEvent {
  id: string;
  date: string;
  title: string;
  type: 'maintenance' | 'rental_end' | 'rental_start' | 'invoice' | 'task';
  propertyName?: string;
  unitNumber?: string;
  link?: string;
}

const EVENT_COLORS = {
  maintenance: 'bg-orange-500',
  rental_end: 'bg-red-500',
  rental_start: 'bg-green-500',
  invoice: 'bg-blue-500',
  task: 'bg-purple-500',
} as const;

export function getEventColor(type: CalendarEvent['type']): string {
  return EVENT_COLORS[type];
}

function normalizeCalendarEvent(event: any) {
  return normalizeFields(event);
}

export function useCalendarEvents(year: number, month: number) {
  const startDate = format(startOfMonth(new Date(year, month - 1)), 'yyyy-MM-dd');
  const endDate = format(endOfMonth(new Date(year, month - 1)), 'yyyy-MM-dd');

  return useQuery({
    queryKey: ['calendarEvents', year, month],
    queryFn: async () => {
      const response = await fetch(`/api/calendar-events?start_date=${startDate}&end_date=${endDate}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch calendar events');
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeCalendarEvent) : [normalizeCalendarEvent(data)] as CalendarEvent[];
    },
  });
}

export function groupEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const grouped = new Map<string, CalendarEvent[]>();
  
  events.forEach((event) => {
    const dateKey = event.date;
    if (!grouped.has(dateKey)) {
      grouped.set(dateKey, []);
    }
    grouped.get(dateKey)!.push(event);
  });
  
  return grouped;
}
