ALTER TABLE accounts ADD COLUMN superadmin boolean NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN admin_permissions text[] NOT NULL DEFAULT '{}';
ALTER TABLE accounts ADD CONSTRAINT account_permission_names CHECK(admin_permissions <@ ARRAY['finance','account_security']::text[] AND array_position(admin_permissions,NULL) IS NULL);
ALTER TABLE accounts ADD CONSTRAINT superadmin_is_administrator CHECK(NOT superadmin OR role='admin');
-- Preserve existing administrators' access during upgrade. New administrators
-- receive no sensitive grants by default. No emergency identity is guessed here.
UPDATE accounts SET admin_permissions=ARRAY['finance','account_security'] WHERE role='admin';
CREATE TABLE account_permission_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 before_value jsonb NOT NULL,
 after_value jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_permission_events_account ON account_permission_events(account_id,created_at DESC,id);
CREATE TRIGGER account_permissions_append_only BEFORE UPDATE OR DELETE ON account_permission_events
FOR EACH ROW EXECUTE FUNCTION keep_account_lifecycle_history();
