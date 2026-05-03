import { z } from 'zod';
import { computeNextOccurrence } from '../utils/recurrence.js';
import { ok, fail } from '../utils/mcp.js';
const PRIORITY = ['low', 'medium', 'high', 'critical'];
export function registerTaskTools(server, pool) {
    server.tool('create_task', 'Create a new task', {
        title: z.string().describe('Task title'),
        description: z.string().optional().describe('Optional notes or details'),
        due_date: z.string().optional().describe('ISO 8601 datetime'),
        priority: z.enum(PRIORITY).optional().default('medium'),
        tag_ids: z.array(z.string()).optional().describe('Tag UUIDs to assign'),
    }, async ({ title, description, due_date, priority, tag_ids }) => {
        try {
            const { rows: [task] } = await pool.query(`INSERT INTO tasks (title, description, due_date, priority)
           VALUES ($1, $2, $3, $4)
           RETURNING *`, [title, description ?? null, due_date ?? null, priority]);
            if (tag_ids?.length) {
                await Promise.all(tag_ids.map((tid) => pool.query('INSERT INTO task_tags (task_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [task.id, tid])));
            }
            return ok(task);
        }
        catch (e) {
            return fail(e);
        }
    });
    server.tool('get_task', 'Retrieve a task by ID, including its tags and direct subtasks', { id: z.string().describe('Task UUID') }, async ({ id }) => {
        try {
            const { rows } = await pool.query(`SELECT t.*,
             COALESCE(
               json_agg(DISTINCT jsonb_build_object('id', tg.id, 'name', tg.name, 'color', tg.color))
               FILTER (WHERE tg.id IS NOT NULL), '[]'
             ) AS tags,
             COALESCE(
               json_agg(DISTINCT jsonb_build_object(
                 'id', s.id, 'title', s.title,
                 'status', s.status, 'priority', s.priority,
                 'due_date', s.due_date
               )) FILTER (WHERE s.id IS NOT NULL), '[]'
             ) AS subtasks
           FROM tasks t
           LEFT JOIN task_tags tt ON t.id = tt.task_id
           LEFT JOIN tags tg ON tt.tag_id = tg.id
           LEFT JOIN tasks s ON t.id = s.parent_task_id
           WHERE t.id = $1
           GROUP BY t.id`, [id]);
            if (!rows[0])
                return fail(new Error(`Task ${id} not found`));
            return ok(rows[0]);
        }
        catch (e) {
            return fail(e);
        }
    });
    server.tool('list_tasks', 'List tasks with optional filters. Returns top-level tasks only (subtasks excluded).', {
        status: z.enum(['active', 'completed', 'archived']).optional(),
        priority: z.enum(PRIORITY).optional(),
        tag_id: z.string().optional().describe('Filter by tag UUID'),
        from_date: z.string().optional().describe('ISO 8601 lower bound for due_date (inclusive)'),
        to_date: z.string().optional().describe('ISO 8601 upper bound for due_date (inclusive)'),
        limit: z.number().int().min(1).max(200).optional().default(50),
        offset: z.number().int().min(0).optional().default(0),
    }, async ({ status, priority, tag_id, from_date, to_date, limit, offset }) => {
        try {
            const { rows } = await pool.query(`SELECT t.*,
             COALESCE(
               json_agg(DISTINCT jsonb_build_object('id', tg.id, 'name', tg.name, 'color', tg.color))
               FILTER (WHERE tg.id IS NOT NULL), '[]'
             ) AS tags
           FROM tasks t
           LEFT JOIN task_tags tt ON t.id = tt.task_id
           LEFT JOIN tags tg ON tt.tag_id = tg.id
           WHERE t.parent_task_id IS NULL
             AND ($1::task_status IS NULL OR t.status = $1)
             AND ($2::priority_level IS NULL OR t.priority = $2)
             AND ($3::uuid IS NULL OR EXISTS (
               SELECT 1 FROM task_tags x WHERE x.task_id = t.id AND x.tag_id = $3
             ))
             AND ($4::timestamptz IS NULL OR t.due_date >= $4)
             AND ($5::timestamptz IS NULL OR t.due_date <= $5)
           GROUP BY t.id
           ORDER BY
             CASE t.priority
               WHEN 'critical' THEN 1 WHEN 'high' THEN 2
               WHEN 'medium' THEN 3 ELSE 4
             END,
             t.due_date ASC NULLS LAST
           LIMIT $6 OFFSET $7`, [
                status ?? null,
                priority ?? null,
                tag_id ?? null,
                from_date ?? null,
                to_date ?? null,
                limit,
                offset,
            ]);
            return ok(rows);
        }
        catch (e) {
            return fail(e);
        }
    });
    server.tool('update_task', 'Update mutable fields of an existing task. Only provided fields are changed.', {
        id: z.string().describe('Task UUID'),
        title: z.string().optional(),
        description: z.string().nullable().optional().describe('Pass null to clear'),
        due_date: z.string().nullable().optional().describe('ISO 8601 datetime, or null to clear'),
        priority: z.enum(PRIORITY).optional(),
        tag_ids: z
            .array(z.string())
            .optional()
            .describe('Replaces all current tag assignments when provided'),
    }, async ({ id, title, description, due_date, priority, tag_ids }) => {
        try {
            const sets = [];
            const vals = [];
            let p = 1;
            if (title !== undefined) {
                sets.push(`title = $${p++}`);
                vals.push(title);
            }
            if (description !== undefined) {
                sets.push(`description = $${p++}`);
                vals.push(description);
            }
            if (due_date !== undefined) {
                sets.push(`due_date = $${p++}`);
                vals.push(due_date);
            }
            if (priority !== undefined) {
                sets.push(`priority = $${p++}`);
                vals.push(priority);
            }
            if (sets.length === 0 && tag_ids === undefined) {
                return fail(new Error('No fields to update'));
            }
            let task;
            if (sets.length > 0) {
                sets.push('updated_at = NOW()');
                vals.push(id);
                const { rows } = await pool.query(`UPDATE tasks SET ${sets.join(', ')} WHERE id = $${p} RETURNING *`, vals);
                task = rows[0];
                if (!task)
                    return fail(new Error(`Task ${id} not found`));
            }
            if (tag_ids !== undefined) {
                await pool.query('DELETE FROM task_tags WHERE task_id = $1', [id]);
                await Promise.all(tag_ids.map((tid) => pool.query('INSERT INTO task_tags (task_id, tag_id) VALUES ($1, $2)', [id, tid])));
            }
            return ok(task ?? { id, updated: 'tags only' });
        }
        catch (e) {
            return fail(e);
        }
    });
    server.tool('delete_task', 'Permanently delete a task and all its subtasks', { id: z.string().describe('Task UUID') }, async ({ id }) => {
        try {
            const { rowCount } = await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
            if (!rowCount)
                return fail(new Error(`Task ${id} not found`));
            return ok({ deleted: id });
        }
        catch (e) {
            return fail(e);
        }
    });
    server.tool('search_tasks', 'Search active tasks by title or description (case-insensitive substring match)', {
        query: z.string().describe('Search terms'),
        limit: z.number().int().min(1).max(100).optional().default(20),
    }, async ({ query, limit }) => {
        try {
            const { rows } = await pool.query(`SELECT * FROM tasks
           WHERE status = 'active'
             AND (title ILIKE $1 OR description ILIKE $1)
           ORDER BY due_date ASC NULLS LAST
           LIMIT $2`, [`%${query}%`, limit]);
            return ok(rows);
        }
        catch (e) {
            return fail(e);
        }
    });
    server.tool('complete_task', 'Mark a task as completed. For recurring tasks, the next occurrence is automatically created.', { id: z.string().describe('Task UUID') }, async ({ id }) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { rows: [task] } = await client.query(`UPDATE tasks
           SET status = 'completed', completed_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND status = 'active'
           RETURNING *`, [id]);
            if (!task) {
                await client.query('ROLLBACK');
                return fail(new Error(`Task ${id} not found or not active`));
            }
            let nextTask = null;
            if (task.recurrence_rule_id) {
                const { rows } = await client.query(`UPDATE recurrence_rules
             SET occurrences_generated = occurrences_generated + 1
             WHERE id = $1
             RETURNING *`, [task.recurrence_rule_id]);
                const rule = rows[0];
                const nextDate = computeNextOccurrence(rule, task.due_date ?? new Date());
                if (nextDate) {
                    const { rows: [nt] } = await client.query(`INSERT INTO tasks (title, description, priority, due_date, recurrence_rule_id)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING *`, [task.title, task.description, task.priority, nextDate, task.recurrence_rule_id]);
                    nextTask = nt;
                    const { rows: tagRows } = await client.query('SELECT tag_id FROM task_tags WHERE task_id = $1', [id]);
                    await Promise.all(tagRows.map(({ tag_id }) => client.query('INSERT INTO task_tags (task_id, tag_id) VALUES ($1, $2)', [
                        nt.id,
                        tag_id,
                    ])));
                }
            }
            await client.query('COMMIT');
            return ok({ completed: task, next_occurrence: nextTask });
        }
        catch (e) {
            await client.query('ROLLBACK');
            return fail(e);
        }
        finally {
            client.release();
        }
    });
    server.tool('reopen_task', 'Revert a completed task back to active status', { id: z.string().describe('Task UUID') }, async ({ id }) => {
        try {
            const { rows: [task] } = await pool.query(`UPDATE tasks
           SET status = 'active', completed_at = NULL, updated_at = NOW()
           WHERE id = $1 AND status = 'completed'
           RETURNING *`, [id]);
            if (!task)
                return fail(new Error(`Task ${id} not found or not completed`));
            return ok(task);
        }
        catch (e) {
            return fail(e);
        }
    });
    server.tool('add_subtask', 'Add a child task under an existing parent (e.g. grocery items under a shopping trip)', {
        parent_task_id: z.string().describe('Parent task UUID'),
        title: z.string().describe('Subtask title'),
        description: z.string().optional(),
        due_date: z.string().optional().describe('ISO 8601 datetime'),
        priority: z.enum(PRIORITY).optional().default('medium'),
    }, async ({ parent_task_id, title, description, due_date, priority }) => {
        try {
            const { rows: [task] } = await pool.query(`INSERT INTO tasks (title, description, due_date, priority, parent_task_id)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`, [title, description ?? null, due_date ?? null, priority, parent_task_id]);
            return ok(task);
        }
        catch (e) {
            return fail(e);
        }
    });
}
