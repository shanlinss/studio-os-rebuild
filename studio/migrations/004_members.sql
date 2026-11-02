-- A business member has a stable identity independent of display name or login name.
CREATE TABLE members (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 100 AND display_name = btrim(display_name)),
 login_account_id uuid UNIQUE REFERENCES accounts(id) ON DELETE RESTRICT,
 active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE identity_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 entity_type text NOT NULL CHECK (entity_type IN ('member')),
 entity_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
 action text NOT NULL CHECK (action IN ('created', 'updated')),
 before_value jsonb,
 after_value jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX identity_events_entity ON identity_events(entity_id, created_at);
