import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import pg from 'pg';
import {
  getTestPool,
  closeTestPool,
  truncateAll,
  createTestClient,
  insertTag,
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

describe('create_tag', () => {
  test('creates a tag and returns id, name, color', async () => {
    const result = await client.callTool({
      name: 'create_tag',
      arguments: { name: 'Work', color: '#ff5733' },
    });
    expect(result.isError).toBeFalsy();
    const tag = parseResult(result) as Record<string, unknown>;
    expect(tag.id).toBeTruthy();
    expect(tag.name).toBe('Work');
    expect(tag.color).toBe('#ff5733');
  });

  test('creates a tag with null color when color omitted', async () => {
    const result = await client.callTool({
      name: 'create_tag',
      arguments: { name: 'Personal' },
    });
    expect(result.isError).toBeFalsy();
    const tag = parseResult(result) as Record<string, unknown>;
    expect(tag.color).toBeNull();
  });

  test('returns error on duplicate name', async () => {
    await insertTag(pool, { name: 'Duplicate' });
    const result = await client.callTool({
      name: 'create_tag',
      arguments: { name: 'Duplicate' },
    });
    expect(result.isError).toBe(true);
  });
});

describe('list_tags', () => {
  test('returns empty array when no tags exist', async () => {
    const result = await client.callTool({ name: 'list_tags', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(parseResult(result)).toEqual([]);
  });

  test('returns tags sorted alphabetically', async () => {
    await insertTag(pool, { name: 'Zebra' });
    await insertTag(pool, { name: 'Alpha' });
    await insertTag(pool, { name: 'Middle' });

    const result = await client.callTool({ name: 'list_tags', arguments: {} });
    const tags = parseResult(result) as Array<{ name: string }>;
    expect(tags.map((t) => t.name)).toEqual(['Alpha', 'Middle', 'Zebra']);
  });
});

describe('delete_tag', () => {
  test('deletes a tag and returns deleted id', async () => {
    const tag = await insertTag(pool, { name: 'ToDelete' });

    const result = await client.callTool({
      name: 'delete_tag',
      arguments: { id: tag.id },
    });
    expect(result.isError).toBeFalsy();
    const body = parseResult(result) as Record<string, unknown>;
    expect(body.deleted).toBe(tag.id);

    const { rows } = await pool.query('SELECT * FROM tags WHERE id = $1', [tag.id]);
    expect(rows).toHaveLength(0);
  });

  test('returns error for unknown id', async () => {
    const result = await client.callTool({
      name: 'delete_tag',
      arguments: { id: '00000000-0000-0000-0000-000000000000' },
    });
    expect(result.isError).toBe(true);
  });

  test('cascades: deleting a tag removes task_tags rows', async () => {
    const tag = await insertTag(pool, { name: 'CascadeMe' });
    const task = await insertTask(pool, { title: 'Tagged Task' });
    await pool.query('INSERT INTO task_tags (task_id, tag_id) VALUES ($1, $2)', [task.id, tag.id]);

    await client.callTool({ name: 'delete_tag', arguments: { id: tag.id } });

    const { rows } = await pool.query(
      'SELECT * FROM task_tags WHERE task_id = $1',
      [task.id],
    );
    expect(rows).toHaveLength(0);
  });
});
