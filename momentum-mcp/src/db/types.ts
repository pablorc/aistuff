export type PriorityLevel = 'low' | 'medium' | 'high' | 'critical';
export type TaskStatus = 'active' | 'completed' | 'archived';
export type RecurFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurrenceRule {
  id: string;
  frequency: RecurFreq;
  interval_count: number;
  days_of_week: number[] | null;
  day_of_month: number | null;
  end_after_occurrences: number | null;
  occurrences_generated: number;
  created_at: Date;
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  created_at: Date;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: PriorityLevel;
  status: TaskStatus;
  due_date: Date | null;
  completed_at: Date | null;
  recurrence_rule_id: string | null;
  parent_task_id: string | null;
  created_at: Date;
  updated_at: Date;
  tags?: Tag[];
  subtasks?: Omit<Task, 'tags' | 'subtasks'>[];
}
