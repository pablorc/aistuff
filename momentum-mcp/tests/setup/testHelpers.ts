import pg from 'pg';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTaskTools } from '../../src/tools/tasks.js';
import { registerTagTools } from '../../src/tools/tags.js';
import { registerRecurrenceTools } from '../../src/tools/recurrence.js';
import { registerReviewTools } from '../../src/tools/review.js';
import { TEST_DB_URL } from './globalSetup.js';

let _pool: pg.Pool | null = null;

export function getTestPool(): pg.Pool {
  if (!_pool) _pool = new pg.Pool({ connectionString: TEST_DB_URL });
  return _pool;
}

export async function closeTestPool(): Promise<void> {
  await _pool?.end();
  _pool = null;
}

export async function truncateAll(pool: pg.Pool): Promise<void> {
  await pool.query('TRUNCATE task_tags, tasks, recurrence_rules, tags CASCADE');
}

export async function createTestClient(pool: pg.Pool) {
  const server = new McpServer({ name: 'test-server', version: '0.0.0' });
  registerTaskTools(server, pool);
  registerTagTools(server, pool);
  registerRecurrenceTools(server, pool);
  registerReviewTools(server, pool);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return { client, server };
}

// callTool returns a discriminated union (content | toolResult); we always use the content form
export function parseResult(result: unknown): unknown {
  const r = result as { content: Array<{ type: string; text: string }> };
  return JSON.parse(r.content[0].text);
}

// --- Fixture helpers ---

export async function insertTag(
  pool: pg.Pool,
  overrides: { name?: string; color?: string } = {},
) {
  const { rows } = await pool.query<{ id: string; name: string; color: string | null }>(
    'INSERT INTO tags (name, color) VALUES ($1, $2) RETURNING *',
    [overrides.name ?? 'Test Tag', overrides.color ?? null],
  );
  return rows[0];
}

export async function insertTask(
  pool: pg.Pool,
  overrides: Partial<{
    title: string;
    description: string;
    priority: string;
    status: string;
    due_date: string;
    recurrence_rule_id: string;
    parent_task_id: string;
  }> = {},
) {
  const { rows } = await pool.query(
    `INSERT INTO tasks (title, description, priority, status, due_date, recurrence_rule_id, parent_task_id)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6::uuid, $7::uuid)
     RETURNING *`,
    [
      overrides.title ?? 'Test Task',
      overrides.description ?? null,
      overrides.priority ?? 'medium',
      overrides.status ?? 'active',
      overrides.due_date ?? null,
      overrides.recurrence_rule_id ?? null,
      overrides.parent_task_id ?? null,
    ],
  );
  return rows[0];
}

export async function insertRecurrenceRule(
  pool: pg.Pool,
  overrides: Partial<{
    frequency: string;
    interval_count: number;
    days_of_week: number[] | null;
    day_of_month: number | null;
    end_after_occurrences: number | null;
    occurrences_generated: number;
  }> = {},
) {
  const { rows } = await pool.query(
    `INSERT INTO recurrence_rules
       (frequency, interval_count, days_of_week, day_of_month, end_after_occurrences, occurrences_generated)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      overrides.frequency ?? 'daily',
      overrides.interval_count ?? 1,
      overrides.days_of_week ?? null,
      overrides.day_of_month ?? null,
      overrides.end_after_occurrences ?? null,
      overrides.occurrences_generated ?? 0,
    ],
  );
  return rows[0];
}
