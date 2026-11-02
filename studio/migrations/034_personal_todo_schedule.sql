-- Additive compatibility only. Legacy unscheduled todos remain unscheduled.
ALTER TABLE personal_todos
 ADD COLUMN planned_on date,
 ADD COLUMN due_at timestamptz,
 ADD COLUMN completed_at timestamptz,
 ADD CONSTRAINT personal_todo_schedule_order CHECK (
  planned_on IS NULL OR due_at IS NULL OR
  due_at >= (planned_on::timestamp AT TIME ZONE 'Asia/Shanghai')
 );
CREATE INDEX personal_todos_schedule ON personal_todos(owner_id,planned_on,id)
 WHERE deleted_at IS NULL;
-- Keep legacy categories while accepting the approved workspace categories.
ALTER TABLE personal_todos DROP CONSTRAINT personal_todos_task_type_check;
ALTER TABLE personal_todos ADD CONSTRAINT personal_todos_task_type_check CHECK (
 task_type IN ('素材收集','内容策划','素材测试','数据回填','内容整理',
              '内容制作','数据记录','测试复盘','其他事项')
);
-- No inferred historical completion timestamp: old rows keep NULL until a new
-- explicit transition to completed. Editing a historical completed row does not
-- invent a completion event.
