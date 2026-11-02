-- Shared store identities for future business and finance references. No seed data.
CREATE TABLE stores (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL UNIQUE CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 100),
 active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE store_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
 action text NOT NULL CHECK (action IN ('created', 'updated')),
 before_value jsonb,
 after_value jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX store_events_store ON store_events(store_id, created_at);
