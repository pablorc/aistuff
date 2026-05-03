import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import pg from 'pg';
import {
  getTestPool,
  closeTestPool,
  truncateAll,
  createTestClient,
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

describe('get_daily_review', () => {
  test('response has overdue, today, and upcoming_7_days keys', async () => {
    const result = await client.callTool({ name: 'get_daily_review', arguments: {} });
    expect(result.isError).toBeFalsy();
    const body = parseResult(result) as Record<string, unknown>;
    expect(body).toHaveProperty('overdue');
    expect(body).toHaveProperty('today');
    expect(body).toHaveProperty('upcoming_7_days');
  });

  test('overdue: active task due in the past appears', async () => {
    await insertTask(pool, { title: 'Overdue', due_date: "NOW() - INTERVAL '1 hour'" });

    // Use raw SQL for time-relative due dates
    await pool.query(
      `INSERT INTO tasks (title, due_date) VALUES ('Overdue Task', NOW() - INTERVAL '2 hours')`,
    );

    const result = await client.callTool({ name: 'get_daily_review', arguments: {} });
    const body = parseResult(result) as { overdue: Array<{ title: string }> };
    expect(body.overdue.some((t) => t.title === 'Overdue Task')).toBe(true);
  });

  test('today: task due today (within current calendar day) appears', async () => {
    await pool.query(
      `INSERT INTO tasks (title, due_date)
       VALUES ('Today Task', CURRENT_DATE::timestamptz + INTERVAL '6 hours')`,
    );

    const result = await client.callTool({ name: 'get_daily_review', arguments: {} });
    const body = parseResult(result) as { today: Array<{ title: string }> };
    expect(body.today.some((t) => t.title === 'Today Task')).toBe(true);
  });

  test('upcoming_7_days: task due tomorrow through day 7 appears', async () => {
    await pool.query(
      `INSERT INTO tasks (title, due_date)
       VALUES ('Upcoming Task', CURRENT_DATE::timestamptz + INTERVAL '3 days')`,
    );

    const result = await client.callTool({ name: 'get_daily_review', arguments: {} });
    const body = parseResult(result) as { upcoming_7_days: Array<{ title: string }> };
    expect(body.upcoming_7_days.some((t) => t.title === 'Upcoming Task')).toBe(true);
  });

  test('task due in 8 days does NOT appear in upcoming_7_days', async () => {
    await pool.query(
      `INSERT INTO tasks (title, due_date)
       VALUES ('Far Future', CURRENT_DATE::timestamptz + INTERVAL '8 days')`,
    );

    const result = await client.callTool({ name: 'get_daily_review', arguments: {} });
    const body = parseResult(result) as { upcoming_7_days: Array<{ title: string }> };
    expect(body.upcoming_7_days.some((t) => t.title === 'Far Future')).toBe(false);
  });

  test('completed tasks do not appear in any bucket', async () => {
    await pool.query(
      `INSERT INTO tasks (title, status, due_date)
       VALUES ('Done Task', 'completed', NOW() - INTERVAL '1 hour')`,
    );

    const result = await client.callTool({ name: 'get_daily_review', arguments: {} });
    const body = parseResult(result) as {
      overdue: Array<{ title: string }>;
      today: Array<{ title: string }>;
      upcoming_7_days: Array<{ title: string }>;
    };
    const allTitles = [
      ...body.overdue.map((t) => t.title),
      ...body.today.map((t) => t.title),
      ...body.upcoming_7_days.map((t) => t.title),
    ];
    expect(allTitles).not.toContain('Done Task');
  });

  test('overdue task does not also appear in today bucket', async () => {
    // A task due yesterday is overdue and must NOT be in today
    await pool.query(
      `INSERT INTO tasks (title, due_date)
       VALUES ('Yesterday Task', CURRENT_DATE::timestamptz - INTERVAL '1 hour')`,
    );

    const result = await client.callTool({ name: 'get_daily_review', arguments: {} });
    const body = parseResult(result) as {
      overdue: Array<{ title: string }>;
      today: Array<{ title: string }>;
    };
    expect(body.overdue.some((t) => t.title === 'Yesterday Task')).toBe(true);
    expect(body.today.some((t) => t.title === 'Yesterday Task')).toBe(false);
  });
});

describe('get_overdue_tasks', () => {
  test('returns only active tasks with due_date in the past', async () => {
    await pool.query(
      `INSERT INTO tasks (title, due_date) VALUES ('Overdue Active', NOW() - INTERVAL '1 hour')`,
    );
    await pool.query(
      `INSERT INTO tasks (title, status, due_date)
       VALUES ('Overdue Done', 'completed', NOW() - INTERVAL '1 hour')`,
    );
    await pool.query(
      `INSERT INTO tasks (title, due_date)
       VALUES ('Future Task', NOW() + INTERVAL '1 day')`,
    );

    const result = await client.callTool({ name: 'get_overdue_tasks', arguments: {} });
    expect(result.isError).toBeFalsy();
    const tasks = parseResult(result) as Array<{ title: string }>;
    expect(tasks.some((t) => t.title === 'Overdue Active')).toBe(true);
    expect(tasks.some((t) => t.title === 'Overdue Done')).toBe(false);
    expect(tasks.some((t) => t.title === 'Future Task')).toBe(false);
  });

  test('returns empty array when nothing is overdue', async () => {
    await pool.query(
      `INSERT INTO tasks (title, due_date) VALUES ('Future', NOW() + INTERVAL '1 day')`,
    );

    const result = await client.callTool({ name: 'get_overdue_tasks', arguments: {} });
    expect(parseResult(result)).toEqual([]);
  });
});
