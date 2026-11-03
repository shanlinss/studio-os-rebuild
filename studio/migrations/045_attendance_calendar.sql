-- Explicit studio-wide calendar overrides; default means return to weekday rules.
CREATE TABLE attendance_calendar (
 work_date date PRIMARY KEY,
 mode text NOT NULL CHECK(mode IN('work','rest','default')),
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 1 AND 2000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE attendance_calendar_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 work_date date NOT NULL REFERENCES attendance_calendar(work_date) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 actor_name text NOT NULL,
 before_value jsonb,
 after_value jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER attendance_calendar_events_append_only BEFORE UPDATE OR DELETE ON attendance_calendar_events
FOR EACH ROW EXECUTE FUNCTION keep_account_lifecycle_history();
CREATE INDEX attendance_calendar_events_date ON attendance_calendar_events(work_date,created_at,id);
CREATE TABLE attendance_calendar_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL,
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 PRIMARY KEY(actor_id,request_key)
);
