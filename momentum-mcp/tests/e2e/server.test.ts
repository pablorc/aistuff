import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

type TextResult = { content: Array<{ type: string; text: string }>; isError?: boolean };
function asText(result: unknown): TextResult {
  return result as TextResult;
}
function parse(result: unknown): unknown {
  return JSON.parse((result as TextResult).content[0].text);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://momentum:momentum@localhost:5432/momentum_test';

let client: Client;
let transport: StdioClientTransport;

beforeAll(async () => {
  execSync('npm run build', { cwd: ROOT, stdio: 'pipe' });

  transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/src/index.js'],
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: TEST_DB_URL } as Record<string, string>,
    stderr: 'pipe',
  });

  client = new Client({ name: 'e2e-test', version: '0.0.0' });
  await client.connect(transport);
}, 60_000);

afterAll(async () => {
  await client.close();
});

test('server exposes all expected tools', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);

  const expected = [
    'create_task',
    'get_task',
    'list_tasks',
    'update_task',
    'delete_task',
    'search_tasks',
    'complete_task',
    'reopen_task',
    'add_subtask',
    'create_tag',
    'list_tags',
    'delete_tag',
    'create_recurring_task',
    'get_upcoming_occurrences',
    'get_daily_review',
    'get_overdue_tasks',
  ];

  for (const name of expected) {
    expect(names).toContain(name);
  }
});

test('create_task and get_task round-trip over stdio', async () => {
  const created = await client.callTool({
    name: 'create_task',
    arguments: { title: 'E2E Smoke Task', priority: 'high' },
  });
  expect(asText(created).isError).toBeFalsy();

  const task = parse(created) as Record<string, unknown>;
  expect(task.title).toBe('E2E Smoke Task');
  expect(task.priority).toBe('high');

  const fetched = await client.callTool({
    name: 'get_task',
    arguments: { id: task.id },
  });
  expect(asText(fetched).isError).toBeFalsy();
  const fetchedTask = parse(fetched) as Record<string, unknown>;
  expect(fetchedTask.id).toBe(task.id);
  expect(fetchedTask.tags).toEqual([]);
  expect(fetchedTask.subtasks).toEqual([]);
});

test('get_daily_review returns correct response shape', async () => {
  const result = await client.callTool({ name: 'get_daily_review', arguments: {} });
  expect(asText(result).isError).toBeFalsy();
  const body = parse(result) as Record<string, unknown>;
  expect(body).toHaveProperty('overdue');
  expect(body).toHaveProperty('today');
  expect(body).toHaveProperty('upcoming_7_days');
  expect(Array.isArray(body.overdue)).toBe(true);
});
