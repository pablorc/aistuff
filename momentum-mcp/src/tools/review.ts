import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Pool } from 'pg';
import { ok, fail } from '../utils/mcp.js';

export function registerReviewTools(server: McpServer, pool: Pool): void {
  server.tool(
    'get_daily_review',
    "Return the day's dashboard: overdue tasks, today's tasks, and tasks due in the next 7 days",
    {},
    async () => {
      try {
        const [overdueRes, todayRes, upcomingRes] = await Promise.all([
          pool.query(
            `SELECT * FROM tasks
             WHERE status = 'active' AND due_date < NOW()
             ORDER BY due_date ASC`,
          ),
          pool.query(
            `SELECT * FROM tasks
             WHERE status = 'active'
               AND due_date >= CURRENT_DATE
               AND due_date < CURRENT_DATE + INTERVAL '1 day'
             ORDER BY due_date ASC`,
          ),
          pool.query(
            `SELECT * FROM tasks
             WHERE status = 'active'
               AND due_date >= CURRENT_DATE + INTERVAL '1 day'
               AND due_date < CURRENT_DATE + INTERVAL '8 days'
             ORDER BY due_date ASC`,
          ),
        ]);

        return ok({
          overdue: overdueRes.rows,
          today: todayRes.rows,
          upcoming_7_days: upcomingRes.rows,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    'get_overdue_tasks',
    'Return all active tasks whose due date has already passed',
    {},
    async () => {
      try {
        const { rows } = await pool.query(
          `SELECT * FROM tasks
           WHERE status = 'active' AND due_date < NOW()
           ORDER BY due_date ASC`,
        );
        return ok(rows);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
