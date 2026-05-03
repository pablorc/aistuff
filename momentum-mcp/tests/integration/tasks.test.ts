import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import pg from 'pg';
import {
  getTestPool,
  closeTestPool,
  truncateAll,
  createTestClient,
  insertTag,
  insertTask,
  insertRecurrenceRule,
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

describe('create_task', () => {
  test('minimal params: defaults priority=medium, status=active', async () => {
    const result = await client.callTool({
      name: 'create_task',
      arguments: { title: 'My Task' },
    });
    expect(result.isError).toBeFalsy();
    const task = parseResult(result) as Record<string, unknown>;
    expect(task.id).toBeTruthy();
    expect(task.title).toBe('My Task');
    expect(task.priority).toBe('medium');
    expect(task.status).toBe('active');
    expect(task.due_date).toBeNull();
  });

  test('creates task with due_date', async () => {
    const result = await client.callTool({
      name: 'create_task',
      arguments: { title: 'Dated', due_date: '2026-06-01T12:00:00Z' },
    });
    expect(result.isError).toBeFalsy();
    const task = parseResult(result) as Record<string, unknown>;
    expect(task.due_date).toBeTruthy();
  });

  test('assigns tag_ids', async () => {
    const tag = await insertTag(pool, { name: 'Work' });
    const result = await client.callTool({
      name: 'create_task',
      arguments: { title: 'Tagged', tag_ids: [tag.id] },
    });
    expect(result.isError).toBeFalsy();
    const task = parseResult(result) as Record<string, unknown>;
    const { rows } = await pool.query('SELECT * FROM task_tags WHERE task_id = $1', [task.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].tag_id).toBe(tag.id);
  });

  test('silently ignores unknown tag_id (ON CONFLICT DO NOTHING)', async () => {
    const result = await client.callTool({
      name: 'create_task',
      arguments: { title: 'Ghosted', tag_ids: ['00000000-0000-0000-0000-000000000000'] },
    });
    // Should not error — the bad tag_id is silently skipped
    expect(result.isError).toBeFalsy();
  });
});

describe('get_task', () => {
  test('returns task with empty tags and subtasks arrays', async () => {
    const task = await insertTask(pool, { title: 'Plain' });
    const result = await client.callTool({ name: 'get_task', arguments: { id: task.id } });
    expect(result.isError).toBeFalsy();
    const body = parseResult(result) as Record<string, unknown>;
    expect(body.id).toBe(task.id);
    expect(body.tags).toEqual([]);
    expect(body.subtasks).toEqual([]);
  });

  test('includes populated tags array', async () => {
    const tag = await insertTag(pool, { name: 'Work' });
    const task = await insertTask(pool);
    await pool.query('INSERT INTO task_tags (task_id, tag_id) VALUES ($1, $2)', [task.id, tag.id]);

    const result = await client.callTool({ name: 'get_task', arguments: { id: task.id } });
    const body = parseResult(result) as Record<string, unknown>;
    expect((body.tags as unknown[]).length).toBe(1);
    expect((body.tags as Array<{ name: string }>)[0].name).toBe('Work');
  });

  test('includes populated subtasks array', async () => {
    const parent = await insertTask(pool, { title: 'Parent' });
    await insertTask(pool, { title: 'Child', parent_task_id: parent.id });

    const result = await client.callTool({ name: 'get_task', arguments: { id: parent.id } });
    const body = parseResult(result) as Record<string, unknown>;
    expect((body.subtasks as unknown[]).length).toBe(1);
    expect((body.subtasks as Array<{ title: string }>)[0].title).toBe('Child');
  });

  test('returns error for unknown id', async () => {
    const result = await client.callTool({
      name: 'get_task',
      arguments: { id: '00000000-0000-0000-0000-000000000000' },
    });
    expect(result.isError).toBe(true);
  });
});

describe('list_tasks', () => {
  test('returns empty array when no tasks', async () => {
    const result = await client.callTool({ name: 'list_tasks', arguments: {} });
    expect(parseResult(result)).toEqual([]);
  });

  test('filters by status', async () => {
    await insertTask(pool, { title: 'Active', status: 'active' });
    await insertTask(pool, { title: 'Done', status: 'completed' });

    const result = await client.callTool({
      name: 'list_tasks',
      arguments: { status: 'completed' },
    });
    const tasks = parseResult(result) as Array<{ title: string }>;
    expect(tasks.every((t) => t.title === 'Done')).toBe(true);
    expect(tasks).toHaveLength(1);
  });

  test('filters by priority', async () => {
    await insertTask(pool, { priority: 'high' });
    await insertTask(pool, { priority: 'low' });

    const result = await client.callTool({
      name: 'list_tasks',
      arguments: { priority: 'high' },
    });
    const tasks = parseResult(result) as Array<{ priority: string }>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].priority).toBe('high');
  });

  test('filters by tag_id', async () => {
    const tag = await insertTag(pool, { name: 'Tagged' });
    const tagged = await insertTask(pool, { title: 'Tagged Task' });
    await insertTask(pool, { title: 'Untagged Task' });
    await pool.query('INSERT INTO task_tags (task_id, tag_id) VALUES ($1, $2)', [tagged.id, tag.id]);

    const result = await client.callTool({
      name: 'list_tasks',
      arguments: { tag_id: tag.id },
    });
    const tasks = parseResult(result) as Array<{ title: string }>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Tagged Task');
  });

  test('filters by from_date and to_date', async () => {
    await insertTask(pool, { title: 'InRange', due_date: '2026-03-15T00:00:00Z' });
    await insertTask(pool, { title: 'TooEarly', due_date: '2026-02-01T00:00:00Z' });
    await insertTask(pool, { title: 'TooLate', due_date: '2026-05-01T00:00:00Z' });

    const result = await client.callTool({
      name: 'list_tasks',
      arguments: { from_date: '2026-03-01T00:00:00Z', to_date: '2026-03-31T23:59:59Z' },
    });
    const tasks = parseResult(result) as Array<{ title: string }>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('InRange');
  });

  test('excludes subtasks (parent_task_id IS NOT NULL)', async () => {
    const parent = await insertTask(pool, { title: 'Parent' });
    await insertTask(pool, { title: 'Subtask', parent_task_id: parent.id });

    const result = await client.callTool({ name: 'list_tasks', arguments: {} });
    const tasks = parseResult(result) as Array<{ title: string }>;
    expect(tasks.some((t) => t.title === 'Subtask')).toBe(false);
    expect(tasks.some((t) => t.title === 'Parent')).toBe(true);
  });

  test('respects limit and offset', async () => {
    for (let i = 0; i < 5; i++) await insertTask(pool, { title: `Task ${i}` });

    const first = await client.callTool({
      name: 'list_tasks',
      arguments: { limit: 2, offset: 0 },
    });
    expect((parseResult(first) as unknown[]).length).toBe(2);

    const next = await client.callTool({
      name: 'list_tasks',
      arguments: { limit: 2, offset: 2 },
    });
    expect((parseResult(next) as unknown[]).length).toBe(2);
  });
});

describe('update_task', () => {
  test('updates title', async () => {
    const task = await insertTask(pool, { title: 'Old' });
    const result = await client.callTool({
      name: 'update_task',
      arguments: { id: task.id, title: 'New' },
    });
    expect(result.isError).toBeFalsy();
    const updated = parseResult(result) as Record<string, unknown>;
    expect(updated.title).toBe('New');
  });

  test('clears description by passing null', async () => {
    const task = await insertTask(pool, { title: 'T', description: 'notes' });
    const result = await client.callTool({
      name: 'update_task',
      arguments: { id: task.id, description: null },
    });
    expect(result.isError).toBeFalsy();
    const updated = parseResult(result) as Record<string, unknown>;
    expect(updated.description).toBeNull();
  });

  test('replaces tag assignments', async () => {
    const tag1 = await insertTag(pool, { name: 'OldTag' });
    const tag2 = await insertTag(pool, { name: 'NewTag' });
    const task = await insertTask(pool);
    await pool.query('INSERT INTO task_tags (task_id, tag_id) VALUES ($1, $2)', [task.id, tag1.id]);

    const result = await client.callTool({
      name: 'update_task',
      arguments: { id: task.id, tag_ids: [tag2.id] },
    });
    expect(result.isError).toBeFalsy();

    const { rows } = await pool.query(
      'SELECT tag_id FROM task_tags WHERE task_id = $1',
      [task.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tag_id).toBe(tag2.id);
  });

  test('returns error when no fields provided', async () => {
    const task = await insertTask(pool);
    const result = await client.callTool({
      name: 'update_task',
      arguments: { id: task.id },
    });
    expect(result.isError).toBe(true);
  });

  test('returns error for unknown id', async () => {
    const result = await client.callTool({
      name: 'update_task',
      arguments: { id: '00000000-0000-0000-0000-000000000000', title: 'X' },
    });
    expect(result.isError).toBe(true);
  });
});

describe('delete_task', () => {
  test('deletes a task', async () => {
    const task = await insertTask(pool);
    const result = await client.callTool({
      name: 'delete_task',
      arguments: { id: task.id },
    });
    expect(result.isError).toBeFalsy();
    const body = parseResult(result) as Record<string, unknown>;
    expect(body.deleted).toBe(task.id);
    const { rows } = await pool.query('SELECT id FROM tasks WHERE id = $1', [task.id]);
    expect(rows).toHaveLength(0);
  });

  test('cascades to subtasks', async () => {
    const parent = await insertTask(pool, { title: 'Parent' });
    const child = await insertTask(pool, { title: 'Child', parent_task_id: parent.id });

    await client.callTool({ name: 'delete_task', arguments: { id: parent.id } });

    const { rows } = await pool.query('SELECT id FROM tasks WHERE id = $1', [child.id]);
    expect(rows).toHaveLength(0);
  });

  test('returns error for unknown id', async () => {
    const result = await client.callTool({
      name: 'delete_task',
      arguments: { id: '00000000-0000-0000-0000-000000000000' },
    });
    expect(result.isError).toBe(true);
  });
});

describe('search_tasks', () => {
  test('finds by title substring (case-insensitive)', async () => {
    await insertTask(pool, { title: 'Buy Groceries' });
    await insertTask(pool, { title: 'Call Doctor' });

    const result = await client.callTool({
      name: 'search_tasks',
      arguments: { query: 'groceries' },
    });
    const tasks = parseResult(result) as Array<{ title: string }>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Buy Groceries');
  });

  test('finds by description substring', async () => {
    await insertTask(pool, { title: 'Task A', description: 'important meeting notes' });
    await insertTask(pool, { title: 'Task B', description: 'nothing special' });

    const result = await client.callTool({
      name: 'search_tasks',
      arguments: { query: 'meeting' },
    });
    const tasks = parseResult(result) as Array<{ title: string }>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Task A');
  });

  test('excludes completed tasks', async () => {
    await insertTask(pool, { title: 'Active Match', status: 'active' });
    await insertTask(pool, { title: 'Completed Match', status: 'completed' });

    const result = await client.callTool({
      name: 'search_tasks',
      arguments: { query: 'match' },
    });
    const tasks = parseResult(result) as Array<{ title: string }>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Active Match');
  });
});

describe('complete_task', () => {
  test('marks task as completed and sets completed_at', async () => {
    const task = await insertTask(pool);
    const result = await client.callTool({ name: 'complete_task', arguments: { id: task.id } });
    expect(result.isError).toBeFalsy();
    const body = parseResult(result) as { completed: Record<string, unknown>; next_occurrence: null };
    expect(body.completed.status).toBe('completed');
    expect(body.completed.completed_at).toBeTruthy();
    expect(body.next_occurrence).toBeNull();
  });

  test('returns error for already-completed task', async () => {
    const task = await insertTask(pool, { status: 'completed' });
    const result = await client.callTool({ name: 'complete_task', arguments: { id: task.id } });
    expect(result.isError).toBe(true);
  });

  test('recurring: creates next occurrence task', async () => {
    const rule = await insertRecurrenceRule(pool, {
      frequency: 'daily',
      interval_count: 1,
    });
    const task = await insertTask(pool, {
      title: 'Daily Standup',
      recurrence_rule_id: rule.id,
      due_date: '2026-01-01T09:00:00Z',
    });

    const result = await client.callTool({ name: 'complete_task', arguments: { id: task.id } });
    expect(result.isError).toBeFalsy();
    const body = parseResult(result) as {
      completed: Record<string, unknown>;
      next_occurrence: Record<string, unknown>;
    };
    expect(body.next_occurrence).not.toBeNull();
    expect(body.next_occurrence.title).toBe('Daily Standup');
    expect(body.next_occurrence.recurrence_rule_id).toBe(rule.id);

    // Due date of next occurrence is 2026-01-02
    const nextDue = new Date(body.next_occurrence.due_date as string);
    expect(nextDue.toISOString().slice(0, 10)).toBe('2026-01-02');
  });

  test('recurring: copies tags to next occurrence', async () => {
    const tag = await insertTag(pool, { name: 'Work' });
    const rule = await insertRecurrenceRule(pool, { frequency: 'daily' });
    const task = await insertTask(pool, {
      recurrence_rule_id: rule.id,
      due_date: '2026-01-01T09:00:00Z',
    });
    await pool.query('INSERT INTO task_tags (task_id, tag_id) VALUES ($1, $2)', [task.id, tag.id]);

    const result = await client.callTool({ name: 'complete_task', arguments: { id: task.id } });
    const body = parseResult(result) as {
      next_occurrence: Record<string, unknown>;
    };
    const { rows } = await pool.query(
      'SELECT tag_id FROM task_tags WHERE task_id = $1',
      [body.next_occurrence.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tag_id).toBe(tag.id);
  });

  test('recurring exhausted: no next occurrence created', async () => {
    const rule = await insertRecurrenceRule(pool, {
      frequency: 'daily',
      end_after_occurrences: 3,
      occurrences_generated: 2,
    });
    const task = await insertTask(pool, {
      recurrence_rule_id: rule.id,
      due_date: '2026-01-01T09:00:00Z',
    });

    const result = await client.callTool({ name: 'complete_task', arguments: { id: task.id } });
    expect(result.isError).toBeFalsy();
    const body = parseResult(result) as { next_occurrence: unknown };
    expect(body.next_occurrence).toBeNull();
  });

  test('increments occurrences_generated on the rule', async () => {
    const rule = await insertRecurrenceRule(pool, {
      frequency: 'daily',
      occurrences_generated: 0,
    });
    const task = await insertTask(pool, {
      recurrence_rule_id: rule.id,
      due_date: '2026-01-01T09:00:00Z',
    });

    await client.callTool({ name: 'complete_task', arguments: { id: task.id } });

    const { rows } = await pool.query(
      'SELECT occurrences_generated FROM recurrence_rules WHERE id = $1',
      [rule.id],
    );
    expect(rows[0].occurrences_generated).toBe(1);
  });
});

describe('reopen_task', () => {
  test('reopens a completed task', async () => {
    const task = await insertTask(pool, { status: 'completed' });
    const result = await client.callTool({ name: 'reopen_task', arguments: { id: task.id } });
    expect(result.isError).toBeFalsy();
    const updated = parseResult(result) as Record<string, unknown>;
    expect(updated.status).toBe('active');
    expect(updated.completed_at).toBeNull();
  });

  test('returns error when task is already active', async () => {
    const task = await insertTask(pool, { status: 'active' });
    const result = await client.callTool({ name: 'reopen_task', arguments: { id: task.id } });
    expect(result.isError).toBe(true);
  });
});

describe('add_subtask', () => {
  test('creates subtask with correct parent_task_id', async () => {
    const parent = await insertTask(pool, { title: 'Parent' });
    const result = await client.callTool({
      name: 'add_subtask',
      arguments: { parent_task_id: parent.id, title: 'Child Task' },
    });
    expect(result.isError).toBeFalsy();
    const subtask = parseResult(result) as Record<string, unknown>;
    expect(subtask.parent_task_id).toBe(parent.id);
    expect(subtask.title).toBe('Child Task');
  });

  test("subtask appears in parent's get_task subtasks array", async () => {
    const parent = await insertTask(pool, { title: 'Parent' });
    await client.callTool({
      name: 'add_subtask',
      arguments: { parent_task_id: parent.id, title: 'Subtask A' },
    });

    const result = await client.callTool({ name: 'get_task', arguments: { id: parent.id } });
    const body = parseResult(result) as { subtasks: Array<{ title: string }> };
    expect(body.subtasks.some((s) => s.title === 'Subtask A')).toBe(true);
  });
});
