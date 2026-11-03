ALTER TABLE members ADD COLUMN end_date date;
ALTER TABLE members ADD CONSTRAINT employment_dates_valid CHECK(end_date IS NULL OR(start_date IS NOT NULL AND end_date>=start_date));
CREATE TRIGGER identity_events_append_only BEFORE UPDATE OR DELETE ON identity_events FOR EACH ROW EXECUTE FUNCTION keep_account_lifecycle_history();
CREATE TABLE employment_date_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),request_key uuid NOT NULL,request_hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(actor_id,request_key)
);
CREATE TABLE admin_payroll_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),member_id uuid NOT NULL REFERENCES members(id),month text NOT NULL,
 revision integer NOT NULL CHECK(revision>0),source_hash text NOT NULL,source_snapshot jsonb NOT NULL,
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 1 AND 2000),actor_id uuid NOT NULL REFERENCES accounts(id),actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(member_id,month,revision)
);
CREATE TRIGGER admin_payroll_reviews_append_only BEFORE UPDATE OR DELETE ON admin_payroll_reviews FOR EACH ROW EXECUTE FUNCTION keep_account_lifecycle_history();
CREATE TABLE admin_payroll_review_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),request_key uuid NOT NULL,request_hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(actor_id,request_key)
);
ALTER TABLE payroll_drafts ALTER COLUMN closure_id DROP NOT NULL;
ALTER TABLE payroll_drafts ADD COLUMN basis_kind text NOT NULL DEFAULT 'attendance';
ALTER TABLE payroll_drafts ADD COLUMN admin_review_id uuid REFERENCES admin_payroll_reviews(id);
ALTER TABLE payroll_drafts ADD CONSTRAINT payroll_basis_complete CHECK((basis_kind='attendance' AND closure_id IS NOT NULL AND admin_review_id IS NULL) OR(basis_kind='admin-exempt' AND closure_id IS NULL AND admin_review_id IS NOT NULL));
