-- Accounts, password hashes, sessions and members retain their original identities.
-- No password or password fingerprint is written to request receipts or audit JSON.
CREATE TABLE account_lifecycle_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL,
 action text NOT NULL CHECK(action IN('created','password-reset')),
 metadata_hash text NOT NULL CHECK(length(metadata_hash)=64),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 before_value jsonb NOT NULL,
 after_value jsonb NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_id,request_key)
);
CREATE INDEX account_lifecycle_events_account ON account_lifecycle_events(account_id,created_at DESC,id);
CREATE FUNCTION keep_account_lifecycle_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Account lifecycle history is append-only' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER account_lifecycle_append_only BEFORE UPDATE OR DELETE ON account_lifecycle_events
FOR EACH ROW EXECUTE FUNCTION keep_account_lifecycle_history();
