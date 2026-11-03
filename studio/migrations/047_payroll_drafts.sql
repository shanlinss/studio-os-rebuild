-- Payroll is independently granted; no existing administrator is automatically granted it.
ALTER TABLE accounts DROP CONSTRAINT account_permission_names;
ALTER TABLE accounts ADD CONSTRAINT account_permission_names CHECK(admin_permissions <@ ARRAY['finance','account_security','payroll']::text[] AND array_position(admin_permissions,NULL) IS NULL);
CREATE TABLE salary_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 effective_month text NOT NULL CHECK(effective_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 revision integer NOT NULL CHECK(revision>0),
 amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 0 AND 1000000000000),
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 1 AND 2000),
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(member_id,revision)
);
CREATE TRIGGER salary_versions_append_only BEFORE UPDATE OR DELETE ON salary_versions FOR EACH ROW EXECUTE FUNCTION keep_account_lifecycle_history();
CREATE INDEX salary_versions_effective ON salary_versions(member_id,effective_month DESC,revision DESC);
CREATE TABLE payroll_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 month text NOT NULL CHECK(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 revision integer NOT NULL CHECK(revision>0),
 previous_id uuid REFERENCES payroll_drafts(id) ON DELETE RESTRICT,
 closure_id uuid NOT NULL REFERENCES attendance_month_closures(id) ON DELETE RESTRICT,
 salary_id uuid NOT NULL REFERENCES salary_versions(id) ON DELETE RESTRICT,
 attendance_hash text NOT NULL,
 base_cents bigint NOT NULL CHECK(base_cents BETWEEN 0 AND 1000000000000),
 bonus_cents bigint NOT NULL CHECK(bonus_cents BETWEEN 0 AND 1000000000000),
 allowance_cents bigint NOT NULL CHECK(allowance_cents BETWEEN 0 AND 1000000000000),
 adjustment_cents bigint NOT NULL CHECK(adjustment_cents BETWEEN -1000000000000 AND 1000000000000),
 total_cents bigint NOT NULL CHECK(total_cents BETWEEN 0 AND 1000000000000 AND total_cents=base_cents+bonus_cents+allowance_cents+adjustment_cents),
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 1 AND 2000),
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(member_id,month,revision)
);
CREATE TRIGGER payroll_drafts_append_only BEFORE UPDATE OR DELETE ON payroll_drafts FOR EACH ROW EXECUTE FUNCTION keep_account_lifecycle_history();
CREATE INDEX payroll_drafts_latest ON payroll_drafts(member_id,month,revision DESC);
CREATE TABLE payroll_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL,
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 PRIMARY KEY(actor_id,request_key)
);
