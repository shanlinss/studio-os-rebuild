-- Append-only interpretations of original attendance, never replacement clock or payroll facts.
CREATE TABLE attendance_exception_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 period_id uuid NOT NULL REFERENCES attendance_periods(id) ON DELETE RESTRICT,
 owner_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN('late','insufficient')),
 outcome text NOT NULL CHECK(outcome IN('confirmed','special','reopened')),
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 1 AND 2000),
 period_version integer NOT NULL CHECK(period_version>0),
 revision integer NOT NULL CHECK(revision>0),
 previous_review_id uuid REFERENCES attendance_exception_reviews(id) ON DELETE RESTRICT,
 source_snapshot jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(period_id,kind,revision),
 FOREIGN KEY(period_id,owner_id) REFERENCES attendance_periods(id,owner_id)
);
CREATE INDEX attendance_exception_reviews_latest ON attendance_exception_reviews(period_id,kind,revision DESC);
CREATE TRIGGER attendance_exception_reviews_append_only BEFORE UPDATE OR DELETE ON attendance_exception_reviews
FOR EACH ROW EXECUTE FUNCTION keep_account_lifecycle_history();
CREATE TABLE attendance_exception_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL,
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,request_key)
);
