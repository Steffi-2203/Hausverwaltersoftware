import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday, getDay, addMonths, subMonths } from 'date-fns';
import { de } from 'date-fns/locale';
import { useCalendarEvents, groupEventsByDate, getEventColor, CalendarEvent } from '@/hooks/useCalendarEvents';
import { Link } from 'react-router-dom';

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const EVENT_LABELS = {
  maintenance: 'Wartung',
  rental_end: 'Mietende',
  rental_start: 'Mietbeginn',
  invoice: 'Vorschreibung',
  task: 'Aufgabe',
} as const;

export function CalendarWidget() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;
  
  const { data: events, isLoading } = useCalendarEvents(year, month);
  const eventsByDate = events ? groupEventsByDate(events) : new Map();
  
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  
  // Calculate starting offset (Monday = 0)
  const startOffset = (getDay(monthStart) + 6) % 7;
  
  const goToPreviousMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const goToNextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const goToToday = () => setCurrentDate(new Date());
  
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Kalender
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goToPreviousMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-sm" onClick={goToToday}>
              Heute
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goToNextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {format(currentDate, 'MMMM yyyy', { locale: de })}
        </p>
      </CardHeader>
      
      <CardContent>
        {isLoading ? (
          <div className="h-64 flex items-center justify-center">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : (
          <>
            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {WEEKDAYS.map((day) => (
                <div key={day} className="text-center text-xs font-medium text-muted-foreground py-1">
                  {day}
                </div>
              ))}
            </div>
            
            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1">
              {/* Empty cells for offset */}
              {Array.from({ length: startOffset }).map((_, i) => (
                <div key={`empty-${i}`} className="aspect-square" />
              ))}
              
              {/* Day cells */}
              {days.map((day) => {
                const dateKey = format(day, 'yyyy-MM-dd');
                const dayEvents = eventsByDate.get(dateKey) || [];
                const hasEvents = dayEvents.length > 0;
                const isCurrentDay = isToday(day);
                
                return (
                  <Popover key={dateKey}>
                    <PopoverTrigger asChild>
                      <button
                        className={`
                          aspect-square p-1 rounded-md text-sm relative
                          transition-colors hover:bg-accent
                          ${isCurrentDay ? 'bg-primary text-primary-foreground font-bold' : ''}
                          ${!isSameMonth(day, currentDate) ? 'text-muted-foreground' : ''}
                        `}
                      >
                        {format(day, 'd')}
                        {hasEvents && (
                          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">
                            {dayEvents.slice(0, 3).map((event, i) => (
                              <div
                                key={i}
                                className={`h-1 w-1 rounded-full ${getEventColor(event.type)}`}
                              />
                            ))}
                            {dayEvents.length > 3 && (
                              <div className="h-1 w-1 rounded-full bg-muted-foreground" />
                            )}
                          </div>
                        )}
                      </button>
                    </PopoverTrigger>
                    
                    {hasEvents && (
                      <PopoverContent className="w-72 p-2" align="center">
                        <div className="space-y-1.5">
                          <p className="font-medium text-sm mb-2">
                            {format(day, 'd. MMMM yyyy', { locale: de })}
                          </p>
                          {dayEvents.map((event) => (
                            <EventItem key={event.id} event={event} />
                          ))}
                        </div>
                      </PopoverContent>
                    )}
                  </Popover>
                );
              })}
            </div>
            
            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t">
              {Object.entries(EVENT_LABELS).map(([type, label]) => (
                <div key={type} className="flex items-center gap-1.5 text-xs">
                  <div className={`h-2 w-2 rounded-full ${getEventColor(type as CalendarEvent['type'])}`} />
                  <span className="text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function EventItem({ event }: { event: CalendarEvent }) {
  const content = (
    <div className="flex items-start gap-2 p-2 rounded-md hover:bg-accent transition-colors">
      <div className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${getEventColor(event.type)}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{event.title}</p>
        {(event.propertyName || event.unitNumber) && (
          <p className="text-xs text-muted-foreground truncate">
            {[event.propertyName, event.unitNumber].filter(Boolean).join(' • ')}
          </p>
        )}
      </div>
      <Badge variant="secondary" className="text-xs shrink-0">
        {EVENT_LABELS[event.type]}
      </Badge>
    </div>
  );
  
  if (event.link) {
    return <Link to={event.link}>{content}</Link>;
  }
  
  return content;
}
