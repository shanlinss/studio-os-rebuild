-- Attendance facts and immutable request audit survive removal of an optional draft task.
-- 031 was already applied in the isolated development DB; do not edit that migration.
ALTER TABLE attendance_periods DROP CONSTRAINT attendance_periods_task_id_fkey;
ALTER TABLE attendance_periods ADD CONSTRAINT attendance_periods_task_id_fkey FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL;
