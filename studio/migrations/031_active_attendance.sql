-- Explicit actions only; no payroll, schedule, geolocation or inferred attendance.
CREATE TABLE attendance_periods (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES accounts(id),
 member_id uuid NOT NULL REFERENCES members(id),
 kind text NOT NULL CHECK(kind IN('studio','field')),
 work_date date NOT NULL,
 expected_from text,
 expected_to text,
 reason text NOT NULL DEFAULT '' CHECK(length(reason)<=2000),
 task_id uuid REFERENCES tasks(id),
 approval_status text NOT NULL CHECK(approval_status IN('not-required','pending','approved','rejected')),
 reviewed_by uuid REFERENCES accounts(id),
 reviewed_at timestamptz,
 review_note text NOT NULL DEFAULT '' CHECK(length(review_note)<=2000),
 original_in timestamptz,
 original_out timestamptz,
 adjusted_in timestamptz,
 adjusted_out timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,owner_id),
 CHECK((kind='studio' AND approval_status='not-required') OR (kind='field' AND approval_status<>'not-required')),
 CHECK(coalesce(adjusted_out,original_out) IS NULL OR (coalesce(adjusted_in,original_in) IS NOT NULL AND coalesce(adjusted_out,original_out)>=coalesce(adjusted_in,original_in)))
);
CREATE INDEX attendance_periods_owner ON attendance_periods(owner_id,work_date DESC,created_at DESC,id);
CREATE INDEX attendance_periods_team ON attendance_periods(work_date DESC,created_at DESC,id);
CREATE TABLE attendance_corrections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES accounts(id),
 member_id uuid NOT NULL REFERENCES members(id),
 period_id uuid,
 direction text NOT NULL CHECK(direction IN('in','out')),
 proposed_at timestamptz NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 period_version integer,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),
 reviewed_by uuid REFERENCES accounts(id),
 reviewed_at timestamptz,
 review_note text NOT NULL DEFAULT '' CHECK(length(review_note)<=2000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(period_id,owner_id) REFERENCES attendance_periods(id,owner_id),
 CHECK(period_id IS NOT NULL OR direction='in'),
 CHECK(status<>'approved' OR period_id IS NOT NULL)
);
CREATE INDEX attendance_corrections_owner ON attendance_corrections(owner_id,created_at DESC,id);
CREATE TABLE attendance_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES accounts(id),
 period_id uuid REFERENCES attendance_periods(id),
 correction_id uuid REFERENCES attendance_corrections(id),
 actor_id uuid NOT NULL REFERENCES accounts(id),
 actor_name text NOT NULL,
 action text NOT NULL,
 before_value jsonb,
 after_value jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attendance_events_period ON attendance_events(period_id,created_at,id);
CREATE TABLE attendance_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),
 request_key uuid NOT NULL,
 action text NOT NULL,
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,request_key)
);
