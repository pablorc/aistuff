export async function up(pgm) {
    pgm.createType('priority_level', ['low', 'medium', 'high', 'critical']);
    pgm.createType('task_status', ['active', 'completed', 'archived']);
    pgm.createType('recur_freq', ['daily', 'weekly', 'monthly', 'yearly']);
    pgm.createTable('recurrence_rules', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
        frequency: { type: 'recur_freq', notNull: true },
        interval_count: { type: 'integer', default: 1, notNull: true },
        days_of_week: { type: 'integer[]' },
        day_of_month: { type: 'integer' },
        end_after_occurrences: { type: 'integer' },
        occurrences_generated: { type: 'integer', default: 0, notNull: true },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()'), notNull: true },
    });
    pgm.createTable('tasks', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
        title: { type: 'text', notNull: true },
        description: { type: 'text' },
        priority: { type: 'priority_level', default: "'medium'", notNull: true },
        status: { type: 'task_status', default: "'active'", notNull: true },
        due_date: { type: 'timestamptz' },
        completed_at: { type: 'timestamptz' },
        recurrence_rule_id: {
            type: 'uuid',
            references: '"recurrence_rules"',
            onDelete: 'SET NULL',
        },
        parent_task_id: { type: 'uuid' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()'), notNull: true },
        updated_at: { type: 'timestamptz', default: pgm.func('NOW()'), notNull: true },
    });
    pgm.addConstraint('tasks', 'fk_tasks_parent_task_id', 'FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE CASCADE');
    pgm.createTable('tags', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
        name: { type: 'text', notNull: true, unique: true },
        color: { type: 'text' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()'), notNull: true },
    });
    pgm.createTable('task_tags', {
        task_id: { type: 'uuid', notNull: true, references: '"tasks"', onDelete: 'CASCADE' },
        tag_id: { type: 'uuid', notNull: true, references: '"tags"', onDelete: 'CASCADE' },
    });
    pgm.addConstraint('task_tags', 'pk_task_tags', 'PRIMARY KEY (task_id, tag_id)');
    pgm.createIndex('tasks', 'status');
    pgm.createIndex('tasks', 'due_date');
    pgm.createIndex('tasks', 'priority');
    pgm.createIndex('tasks', 'parent_task_id');
    pgm.createIndex('tasks', 'recurrence_rule_id');
}
export async function down(pgm) {
    pgm.dropTable('task_tags', { cascade: true });
    pgm.dropTable('tags', { cascade: true });
    pgm.dropTable('tasks', { cascade: true });
    pgm.dropTable('recurrence_rules', { cascade: true });
    pgm.dropType('recur_freq');
    pgm.dropType('task_status');
    pgm.dropType('priority_level');
}
