-- Coordination fence shared by draft edits and confirmations under repeatable-read.
CREATE TABLE payroll_month_heads (member_id uuid NOT NULL REFERENCES members(id), month text NOT NULL, revision bigint NOT NULL DEFAULT 1, PRIMARY KEY(member_id,month));
CREATE TABLE payroll_confirmations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 month text NOT NULL CHECK(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 revision integer NOT NULL CHECK(revision>0),
 previous_id uuid REFERENCES payroll_confirmations(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN('confirm','reopen')),
 draft_id uuid NOT NULL REFERENCES payroll_drafts(id) ON DELETE RESTRICT,
 snapshot jsonb,
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 1 AND 2000),
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(member_id,month,revision),
 CHECK((action='confirm' AND snapshot IS NOT NULL) OR(action='reopen' AND snapshot IS NULL))
);
CREATE TRIGGER payroll_confirmations_append_only BEFORE UPDATE OR DELETE ON payroll_confirmations FOR EACH ROW EXECUTE FUNCTION keep_account_lifecycle_history();
CREATE INDEX payroll_confirmations_latest ON payroll_confirmations(member_id,month,revision DESC);
CREATE TABLE payroll_confirmation_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL,
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 PRIMARY KEY(actor_id,request_key)
);
CREATE TABLE payroll_exports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL,
 request_hash text NOT NULL,
 month text NOT NULL,
 payload jsonb NOT NULL,
 file_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(actor_id,request_key)
);
CREATE TRIGGER payroll_exports_append_only BEFORE UPDATE OR DELETE ON payroll_exports FOR EACH ROW EXECUTE FUNCTION keep_account_lifecycle_history();
