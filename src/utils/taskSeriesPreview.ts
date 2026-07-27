import type { TaskSeriesRecurrence } from '../types';

// Mirrors the eligibility check in the DB scheduler (supabase/schema.sql,
// the task-series cron function) so the create-series form can show a
// non-technical officer what their config actually produces before they
// save it, instead of them having to reason about weekday/day-of-month
// math themselves.
function toDateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`);
}

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** First date on/after `startDate` that this recurrence rule would actually
    fire on — null if the rule can't resolve (e.g. no weekdays picked yet). */
export function computeFirstOccurrenceDate(
  recurrenceType: TaskSeriesRecurrence,
  rule: { weekdays?: number[]; dayOfMonth?: number; intervalDays?: number },
  startDate: string,
): string | null {
  if (!startDate) return null;
  const start = toDateOnly(startDate);
  if (Number.isNaN(start.getTime())) return null;

  if (recurrenceType === 'daily' || recurrenceType === 'custom_interval') {
    return toIsoDate(start);
  }
  if (recurrenceType === 'weekly' || recurrenceType === 'weekdays') {
    const weekdays = rule.weekdays ?? [];
    if (weekdays.length === 0) return null;
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      if (weekdays.includes(d.getDay())) return toIsoDate(d);
    }
    return null;
  }
  if (recurrenceType === 'monthly') {
    const dayOfMonth = rule.dayOfMonth ?? 1;
    for (let i = 0; i < 60; i++) {
      const d = addDays(start, i);
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      if (d.getDate() === Math.min(dayOfMonth, daysInMonth)) return toIsoDate(d);
    }
    return null;
  }
  return null;
}

export function computeDueDate(firstOccurrenceDate: string, dueOffsetDays: number): string {
  return toIsoDate(addDays(toDateOnly(firstOccurrenceDate), Math.max(dueOffsetDays, 0)));
}
