import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import pg from 'pg';
import {
  getTestPool,
  closeTestPool,
  truncateAll,
  createTestClient,
  insertTag,
  insertRecurrenceRule,
  insertTask,
  parseResult,
} from '../setup/testHelpers.js';

let pool: pg.Pool;
let client: Client;

beforeAll(async () => {
  pool = getTestPool();
  ({ client } = await createTestClient(pool));
});

afterAll(async () => {
  await closeTestPool();
});

beforeEach(async () => {
  await truncateAll(pool);
});

describe('create_recurring_task', () => {
  test('creates recurrence_rule and task in one transaction', async () => {
    const result = await client.callTool({
      name: 'create_recurring_task',
      arguments: {
        title: 'Daily Standup',
        due_date: '2026-01-01T09:00:00Z',
        frequency: 'daily',
        interval_count: 1,
      },
    });
    expect(result.isError).toBeFalsy();
    const body = parseResult(result) as {
      task: Record<string, unknown>;
      recurrence_rule: Record<string, unknown>;
    };
    expect(body.task.id).toBeTruthy();
    expect(body.recurrence_rule.id).toBeTruthy();
    expect(body.task.recurrence_rule_id).toBe(body.recurrence_rule.id);
  });

  test('stores correct frequency and interval on the rule', async () => {
    const result = await client.callTool({
      name: 'create_recurring_task',
      arguments: {
        title: 'Bi-weekly',
        due_date: '2026-01-05T09:00:00Z',
        frequency: 'weekly',
        interval_count: 2,
        days_of_week: [1, 3],
      },
    });
    const body = parseResult(result) as { recurrence_rule: Record<string, unknown> };
    expect(body.recurrence_rule.frequency).toBe('weekly');
    expect(body.recurrence_rule.interval_count).toBe(2);
    expect(body.recurrence_rule.days_of_week).toEqual([1, 3]);
  });

  test('assigns tag_ids to the created task', async () => {
    const tag = await insertTag(pool, { name: 'Work' });
    const result = await client.callTool({
      name: 'create_recurring_task',
      arguments: {
        title: 'Tagged Recurring',
        due_date: '2026-01-01T09:00:00Z',
        frequency: 'daily',
        tag_ids: [tag.id],
      },
    });
    const body = parseResult(result) as { task: Record<string, unknown> };
    const { rows } = await pool.query(
      'SELECT tag_id FROM task_tags WHERE task_id = $1',
      [body.task.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tag_id).toBe(tag.id);
  });

  test('end_after_occurrences is stored on the rule', async () => {
    const result = await client.callTool({
      name: 'create_recurring_task',
      arguments: {
        title: 'Limited',
        due_date: '2026-01-01T09:00:00Z',
        frequency: 'monthly',
        end_after_occurrences: 6,
      },
    });
    const body = parseResult(result) as { recurrence_rule: Record<string, unknown> };
    expect(body.recurrence_rule.end_after_occurrences).toBe(6);
    expect(body.recurrence_rule.occurrences_generated).toBe(0);
  });
});

describe('get_upcoming_occurrences', () => {
  test('returns count future dates from the active task due_date', async () => {
    const rule = await insertRecurrenceRule(pool, { frequency: 'daily', interval_count: 1 });
    await insertTask(pool, {
      recurrence_rule_id: rule.id,
      due_date: '2026-01-01T09:00:00Z',
    });

    const result = await client.callTool({
      name: 'get_upcoming_occurrences',
      arguments: { recurrence_rule_id: rule.id, count: 3 },
    });
    expect(result.isError).toBeFalsy();
    const body = parseResult(result) as { upcoming_dates: string[] };
    expect(body.upcoming_dates).toHaveLength(3);
    expect(body.upcoming_dates[0].slice(0, 10)).toBe('2026-01-02');
    expect(body.upcoming_dates[1].slice(0, 10)).toBe('2026-01-03');
    expect(body.upcoming_dates[2].slice(0, 10)).toBe('2026-01-04');
  });

  test('stops early when end_after_occurrences would be exhausted', async () => {
    const rule = await insertRecurrenceRule(pool, {
      frequency: 'daily',
      end_after_occurrences: 2,
      occurrences_generated: 1,
    });
    await insertTask(pool, {
      recurrence_rule_id: rule.id,
      due_date: '2026-01-01T09:00:00Z',
    });

    const result = await client.callTool({
      name: 'get_upcoming_occurrences',
      arguments: { recurrence_rule_id: rule.id, count: 5 },
    });
    const body = parseResult(result) as { upcoming_dates: string[] };
    // Only 1 remaining (occurrences_generated=1, end=2 → one more allowed)
    expect(body.upcoming_dates).toHaveLength(1);
  });

  test('returns error for unknown recurrence_rule_id', async () => {
    const result = await client.callTool({
      name: 'get_upcoming_occurrences',
      arguments: { recurrence_rule_id: '00000000-0000-0000-0000-000000000000' },
    });
    expect(result.isError).toBe(true);
  });
});
