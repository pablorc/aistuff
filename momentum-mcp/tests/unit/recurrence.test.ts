import { computeNextOccurrence } from '../../src/utils/recurrence.js';
import type { RecurrenceRule } from '../../src/db/types.js';

function rule(overrides: Partial<RecurrenceRule>): RecurrenceRule {
  return {
    id: 'test-id',
    frequency: 'daily',
    interval_count: 1,
    days_of_week: null,
    day_of_month: null,
    end_after_occurrences: null,
    occurrences_generated: 0,
    created_at: new Date(),
    ...overrides,
  };
}

function date(iso: string): Date {
  return new Date(iso);
}

describe('computeNextOccurrence — daily', () => {
  test('advances by 1 day', () => {
    const next = computeNextOccurrence(rule({ frequency: 'daily', interval_count: 1 }), date('2026-01-01'));
    expect(next?.toISOString().slice(0, 10)).toBe('2026-01-02');
  });

  test('advances by interval_count=3 days', () => {
    const next = computeNextOccurrence(rule({ frequency: 'daily', interval_count: 3 }), date('2026-01-01'));
    expect(next?.toISOString().slice(0, 10)).toBe('2026-01-04');
  });

  test('returns null when occurrences_generated >= end_after_occurrences', () => {
    const next = computeNextOccurrence(
      rule({ frequency: 'daily', end_after_occurrences: 5, occurrences_generated: 5 }),
      date('2026-01-01'),
    );
    expect(next).toBeNull();
  });

  test('returns null when occurrences_generated exceeds end_after_occurrences', () => {
    const next = computeNextOccurrence(
      rule({ frequency: 'daily', end_after_occurrences: 3, occurrences_generated: 10 }),
      date('2026-01-01'),
    );
    expect(next).toBeNull();
  });

  test('returns date when occurrences_generated is one below end_after_occurrences', () => {
    const next = computeNextOccurrence(
      rule({ frequency: 'daily', end_after_occurrences: 5, occurrences_generated: 4 }),
      date('2026-01-01'),
    );
    expect(next).not.toBeNull();
  });

  test('null end_after_occurrences means infinite', () => {
    const next = computeNextOccurrence(
      rule({ frequency: 'daily', end_after_occurrences: null, occurrences_generated: 9999 }),
      date('2026-01-01'),
    );
    expect(next).not.toBeNull();
  });
});

describe('computeNextOccurrence — weekly with days_of_week', () => {
  // 2026-01-05 is a Monday (day 1)
  test('from Monday, days_of_week=[3] returns next Wednesday', () => {
    const next = computeNextOccurrence(
      rule({ frequency: 'weekly', days_of_week: [3] }),
      date('2026-01-05'),
    );
    expect(next?.toISOString().slice(0, 10)).toBe('2026-01-07'); // Wednesday
  });

  test('from Friday, days_of_week=[1,3] wraps to next Monday', () => {
    // 2026-01-09 is a Friday (day 5)
    const next = computeNextOccurrence(
      rule({ frequency: 'weekly', days_of_week: [1, 3] }),
      date('2026-01-09'),
    );
    expect(next?.toISOString().slice(0, 10)).toBe('2026-01-12'); // Monday
  });

  test('from Wednesday, days_of_week=[3] returns the FOLLOWING Wednesday (not today)', () => {
    // 2026-01-07 is a Wednesday (day 3). Loop starts at i=1, so the earliest candidate is
    // Thursday (+1). None of +1..+6 match day 3. +7 = next Wednesday = 2026-01-14.
    const next = computeNextOccurrence(
      rule({ frequency: 'weekly', days_of_week: [3] }),
      date('2026-01-07'),
    );
    expect(next?.toISOString().slice(0, 10)).toBe('2026-01-14');
  });

  test('empty days_of_week falls through to 7*interval_count path', () => {
    const next = computeNextOccurrence(
      rule({ frequency: 'weekly', days_of_week: [], interval_count: 1 }),
      date('2026-01-05'),
    );
    expect(next?.toISOString().slice(0, 10)).toBe('2026-01-12');
  });
});

describe('computeNextOccurrence — weekly without days_of_week', () => {
  test('advances by 7 days with interval_count=1', () => {
    const next = computeNextOccurrence(
      rule({ frequency: 'weekly', days_of_week: null, interval_count: 1 }),
      date('2026-01-05'),
    );
    expect(next?.toISOString().slice(0, 10)).toBe('2026-01-12');
  });

  test('advances by 14 days with interval_count=2', () => {
    const next = computeNextOccurrence(
      rule({ frequency: 'weekly', days_of_week: null, interval_count: 2 }),
      date('2026-01-05'),
    );
    expect(next?.toISOString().slice(0, 10)).toBe('2026-01-19');
  });
});

describe('computeNextOccurrence — monthly', () => {
  test('advances by 1 month keeping same day', () => {
    const next = computeNextOccurrence(
      rule({ frequency: 'monthly', interval_count: 1, day_of_month: null }),
      date('2026-01-15'),
    );
    expect(next?.toISOString().slice(0, 10)).toBe('2026-02-15');
  });

  test('advances by 3 months keeping same day', () => {
    const next = computeNextOccurrence(
      rule({ frequency: 'monthly', interval_count: 3, day_of_month: null }),
      date('2026-01-01'),
    );
    expect(next?.toISOString().slice(0, 10)).toBe('2026-04-01');
  });

  test('day_of_month overrides the day', () => {
    const next = computeNextOccurrence(
      rule({ frequency: 'monthly', interval_count: 1, day_of_month: 20 }),
      date('2026-01-05'),
    );
    expect(next?.toISOString().slice(0, 10)).toBe('2026-02-20');
  });

  test('Jan 31 + 1 month with no day_of_month overflows to March 3 (JS Date behavior)', () => {
    // JS setMonth(1) on Jan 31 → Feb 31 → Mar 3 (or Mar 2 in leap year)
    const next = computeNextOccurrence(
      rule({ frequency: 'monthly', interval_count: 1, day_of_month: null }),
      date('2026-01-31'),
    );
    // 2026 is not a leap year; Feb has 28 days. Jan 31 + 1 month = Mar 3.
    expect(next?.toISOString().slice(0, 10)).toBe('2026-03-03');
  });
});

describe('computeNextOccurrence — yearly', () => {
  test('advances by 1 year', () => {
    const next = computeNextOccurrence(
      rule({ frequency: 'yearly', interval_count: 1 }),
      date('2026-06-15'),
    );
    expect(next?.toISOString().slice(0, 10)).toBe('2027-06-15');
  });

  test('advances by 2 years', () => {
    const next = computeNextOccurrence(
      rule({ frequency: 'yearly', interval_count: 2 }),
      date('2026-01-01'),
    );
    expect(next?.toISOString().slice(0, 10)).toBe('2028-01-01');
  });
});

describe('computeNextOccurrence — occurrence limit edge cases', () => {
  test('occurrences_generated=0, end_after_occurrences=1 returns a date (not yet exhausted)', () => {
    const next = computeNextOccurrence(
      rule({ frequency: 'daily', end_after_occurrences: 1, occurrences_generated: 0 }),
      date('2026-01-01'),
    );
    expect(next).not.toBeNull();
  });

  test('occurrences_generated=1, end_after_occurrences=1 returns null', () => {
    const next = computeNextOccurrence(
      rule({ frequency: 'daily', end_after_occurrences: 1, occurrences_generated: 1 }),
      date('2026-01-01'),
    );
    expect(next).toBeNull();
  });
});
