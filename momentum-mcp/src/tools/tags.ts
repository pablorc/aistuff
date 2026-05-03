import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Pool } from 'pg';
import { z } from 'zod';
import { ok, fail } from '../utils/mcp.js';

export function registerTagTools(server: McpServer, pool: Pool): void {
  server.tool(
    'create_tag',
    'Create a new tag for categorizing tasks',
    {
      name: z.string().describe('Tag name, e.g. "Work" or "Personal" (stored without #)'),
      color: z.string().optional().describe('Optional hex color, e.g. "#ff5733"'),
    },
    async ({ name, color }) => {
      try {
        const { rows: [tag] } = await pool.query(
          'INSERT INTO tags (name, color) VALUES ($1, $2) RETURNING *',
          [name, color ?? null],
        );
        return ok(tag);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool('list_tags', 'List all available tags', {}, async () => {
    try {
      const { rows } = await pool.query('SELECT * FROM tags ORDER BY name ASC');
      return ok(rows);
    } catch (e) {
      return fail(e);
    }
  });

  server.tool(
    'delete_tag',
    'Delete a tag and remove it from all tasks',
    { id: z.string().describe('Tag UUID') },
    async ({ id }) => {
      try {
        const { rowCount } = await pool.query('DELETE FROM tags WHERE id = $1', [id]);
        if (!rowCount) return fail(new Error(`Tag ${id} not found`));
        return ok({ deleted: id });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
