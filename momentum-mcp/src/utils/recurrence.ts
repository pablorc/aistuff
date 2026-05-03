import type { RecurrenceRule } from '../db/types.js';

export function computeNextOccurrence(rule: RecurrenceRule, from: Date): Date | null {
  if (
    rule.end_after_occurrences !== null &&
    rule.occurrences_generated >= rule.end_after_occurrences
  ) {
    return null;
  }

  const next = new Date(from);

  switch (rule.frequency) {
    case 'daily':
      next.setDate(next.getDate() + rule.interval_count);
      break;

    case 'weekly':
      if (rule.days_of_week && rule.days_of_week.length > 0) {
        const sorted = [...rule.days_of_week].sort((a, b) => a - b);
        for (let i = 1; i <= 7; i++) {
          const candidate = new Date(from);
          candidate.setDate(candidate.getDate() + i);
          if (sorted.includes(candidate.getDay())) {
            return candidate;
          }
        }
      }
      next.setDate(next.getDate() + 7 * rule.interval_count);
      break;

    case 'monthly':
      next.setMonth(next.getMonth() + rule.interval_count);
      if (rule.day_of_month !== null) {
        next.setDate(rule.day_of_month);
      }
      break;

    case 'yearly':
      next.setFullYear(next.getFullYear() + rule.interval_count);
      break;
  }

  return next;
}
