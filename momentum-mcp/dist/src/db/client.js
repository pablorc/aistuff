import pg from 'pg';
const { Pool } = pg;
let _pool = null;
export function getPool() {
    if (!_pool) {
        _pool = new Pool({ connectionString: process.env.DATABASE_URL });
    }
    return _pool;
}
