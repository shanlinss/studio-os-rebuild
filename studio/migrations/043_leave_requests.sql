-- Leave intervals reference original identities and never replace clock records or salary.
CREATE TABLE leave_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 leave_type text NOT NULL CHECK(length(btrim(leave_type)) BETWEEN 1 AND 40),
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected','withdrawn','revoked')),
 reviewed_by uuid REFERENCES accounts(id) ON DELETE RESTRICT,
 reviewed_at timestamptz,
 review_note text NOT NULL DEFAULT '',
 withdrawn_at timestamptz,
 withdrawal_reason text NOT NULL DEFAULT '',
 revoked_by uuid REFERENCES accounts(id) ON DELETE RESTRICT,
 revoked_at timestamptz,
 revoke_note text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at>starts_at),
 CHECK((status IN('pending','withdrawn') AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_note='') OR (status IN('approved','rejected','revoked') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND length(btrim(review_note)) BETWEEN 1 AND 2000)),
 CHECK((status='withdrawn' AND withdrawn_at IS NOT NULL AND length(btrim(withdrawal_reason)) BETWEEN 1 AND 2000) OR (status<>'withdrawn' AND withdrawn_at IS NULL AND withdrawal_reason='')),
 CHECK((status='revoked' AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND length(btrim(revoke_note)) BETWEEN 1 AND 2000) OR (status<>'revoked' AND revoked_by IS NULL AND revoked_at IS NULL AND revoke_note=''))
);
CREATE INDEX leave_requests_owner ON leave_requests(owner_id,starts_at DESC,id);
CREATE INDEX leave_requests_review ON leave_requests(status,created_at DESC,id);
CREATE TABLE leave_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 leave_id uuid NOT NULL REFERENCES leave_requests(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 actor_name text NOT NULL,
 action text NOT NULL CHECK(action IN('submitted','edited','approved','rejected','withdrawn','revoked')),
 before_value jsonb,
 after_value jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leave_events_record ON leave_events(leave_id,created_at,id);
CREATE TRIGGER leave_events_append_only BEFORE UPDATE OR DELETE ON leave_events
FOR EACH ROW EXECUTE FUNCTION keep_account_lifecycle_history();
CREATE TABLE leave_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL,
 action text NOT NULL,
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,request_key)
);
