-- Immutable confirmed versions; subsequent source corrections never rewrite these facts.
CREATE TABLE attendance_month_closures (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 owner_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 month text NOT NULL CHECK(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 revision integer NOT NULL CHECK(revision>0),
 previous_id uuid REFERENCES attendance_month_closures(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN('lock','reopen')),
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 snapshot jsonb,
 day_notes jsonb NOT NULL,
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 1 AND 2000),
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(member_id,month,revision),
 CHECK((action='lock' AND snapshot IS NOT NULL) OR(action='reopen' AND snapshot IS NULL))
);
CREATE TRIGGER attendance_month_closures_append_only BEFORE UPDATE OR DELETE ON attendance_month_closures
FOR EACH ROW EXECUTE FUNCTION keep_account_lifecycle_history();
CREATE INDEX attendance_month_closures_latest ON attendance_month_closures(member_id,month,revision DESC);
CREATE TABLE attendance_month_closure_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL,
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 PRIMARY KEY(actor_id,request_key)
);
