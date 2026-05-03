import { z } from 'zod';
import { computeNextOccurrence } from '../utils/recurrence.js';
import { ok, fail } from '../utils/mcp.js';
const PRIORITY = ['low', 'medium', 'high', 'critical'];
export function registerRecurrenceTools(server, pool) {
    server.tool('create_recurring_task', 'Create a task that repeats on a schedule. Each time it is completed a new occurrence is automatically generated.', {
        title: z.string().describe('Task title'),
        description: z.string().optional(),
        due_date: z.string().describe('ISO 8601 datetime for the first occurrence'),
        priority: z.enum(PRIORITY).optional().default('medium'),
        tag_ids: z.array(z.string()).optional().describe('Tag UUIDs to assign'),
        frequency: z
            .enum(['daily', 'weekly', 'monthly', 'yearly'])
            .describe('Recurrence frequency'),
        interval_count: z
            .number()
            .int()
            .min(1)
            .optional()
            .default(1)
            .describe('Repeat every N frequency units'),
        days_of_week: z
            .array(z.number().int().min(0).max(6))
            .optional()
            .describe('For weekly: days to repeat on (0=Sun … 6=Sat)'),
        day_of_month: z
            .number()
            .int()
            .min(1)
            .max(31)
            .optional()
            .describe('For monthly: day of the month'),
        end_after_occurrences: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('Stop creating new occurrences after N completions (omit for infinite)'),
    }, async ({ title, description, due_date, priority, tag_ids, frequency, interval_count, days_of_week, day_of_month, end_after_occurrences, }) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { rows: [rule] } = await client.query(`INSERT INTO recurrence_rules
             (frequency, interval_count, days_of_week, day_of_month, end_after_occurrences)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`, [
                frequency,
                interval_count,
                days_of_week ?? null,
                day_of_month ?? null,
                end_after_occurrences ?? null,
            ]);
            const { rows: [task] } = await client.query(`INSERT INTO tasks (title, description, priority, due_date, recurrence_rule_id)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`, [title, description ?? null, priority, due_date, rule.id]);
            if (tag_ids?.length) {
                await Promise.all(tag_ids.map((tid) => client.query('INSERT INTO task_tags (task_id, tag_id) VALUES ($1, $2)', [
                    task.id,
                    tid,
                ])));
            }
            await client.query('COMMIT');
            return ok({ task, recurrence_rule: rule });
        }
        catch (e) {
            await client.query('ROLLBACK');
            return fail(e);
        }
        finally {
            client.release();
        }
    });
    server.tool('get_upcoming_occurrences', 'Preview the next N due dates for a recurring task without making any changes', {
        recurrence_rule_id: z.string().describe('Recurrence rule UUID'),
        count: z.number().int().min(1).max(52).optional().default(5),
    }, async ({ recurrence_rule_id, count }) => {
        try {
            const { rows } = await pool.query('SELECT * FROM recurrence_rules WHERE id = $1', [recurrence_rule_id]);
            const rule = rows[0];
            if (!rule)
                return fail(new Error(`Recurrence rule ${recurrence_rule_id} not found`));
            const { rows: latest } = await pool.query(`SELECT due_date FROM tasks
           WHERE recurrence_rule_id = $1 AND status = 'active'
           ORDER BY due_date DESC
           LIMIT 1`, [recurrence_rule_id]);
            const dates = [];
            const sim = { ...rule };
            let cursor = latest[0]?.due_date ?? new Date();
            for (let i = 0; i < count; i++) {
                const next = computeNextOccurrence(sim, cursor);
                if (!next)
                    break;
                dates.push(next.toISOString());
                cursor = next;
                sim.occurrences_generated++;
            }
            return ok({ upcoming_dates: dates });
        }
        catch (e) {
            return fail(e);
        }
    });
}
