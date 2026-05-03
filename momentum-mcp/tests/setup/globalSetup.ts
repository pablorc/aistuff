import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { runner } from 'node-pg-migrate';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '../..');

export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://momentum:momentum@localhost:5432/momentum_test';

const ADMIN_DB_URL = 'postgresql://momentum:momentum@localhost:5432/momentum';

export async function setup() {
  const adminPool = new pg.Pool({ connectionString: ADMIN_DB_URL });
  try {
    await adminPool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = 'momentum_test' AND pid <> pg_backend_pid()`,
    );
    await adminPool.query('DROP DATABASE IF EXISTS momentum_test');
    await adminPool.query('CREATE DATABASE momentum_test');
  } finally {
    await adminPool.end();
  }

  // Build first so dist/migrations/*.js are up to date
  execSync('npm run build', { cwd: ROOT, stdio: 'pipe' });

  await runner({
    databaseUrl: TEST_DB_URL,
    dir: resolve(ROOT, 'dist/migrations'),
    migrationsTable: 'pgmigrations',
    direction: 'up',
    verbose: false,
    log: () => {},
  });
}

export async function teardown() {
  // Leave the DB; the next run drops and recreates it
}
