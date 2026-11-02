-- Manual whole-product observations are independent of publication aggregates.
CREATE TABLE product_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 observed_at timestamptz NOT NULL,
 views integer CHECK(views>=0), likes integer CHECK(likes>=0),
 favorites integer CHECK(favorites>=0), comments integer CHECK(comments>=0),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(product_id,observed_at),
 CHECK(views IS NOT NULL OR likes IS NOT NULL OR favorites IS NOT NULL OR comments IS NOT NULL)
);
CREATE TABLE product_observation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 observation_id uuid NOT NULL REFERENCES product_observations(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
 before_value jsonb,
 after_value jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_observation_events_parent ON product_observation_events(observation_id,created_at,id);
CREATE TABLE product_observation_requests (
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 request_key uuid NOT NULL,
 product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 request_hash text NOT NULL CHECK(length(request_hash)=64),
 result jsonb,
 PRIMARY KEY(actor_id,request_key)
);
