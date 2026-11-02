-- OLD-007 employee operational observations; separate from tasks, Todo and competitors.
CREATE TABLE operational_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 author_id uuid NOT NULL REFERENCES accounts(id),
 body text NOT NULL DEFAULT '' CHECK(length(body)<=4000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operational_observations_author_date ON operational_observations(author_id,created_at DESC,id);
CREATE INDEX operational_observations_date ON operational_observations(created_at DESC,id);
CREATE TABLE operational_observation_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 observation_id uuid NOT NULL REFERENCES operational_observations(id) ON DELETE CASCADE,
 added_version integer NOT NULL CHECK(added_version>0),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 mime text NOT NULL CHECK(mime IN('image/png','image/jpeg','image/webp','image/gif')),
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 8388608),
 digest text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operational_observation_assets_parent ON operational_observation_assets(observation_id);
CREATE TABLE operational_observation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 observation_id uuid NOT NULL REFERENCES operational_observations(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL REFERENCES accounts(id),
 actor_name text NOT NULL,
 request_key uuid NOT NULL,
 request_hash text NOT NULL,
 before_value jsonb,
 after_value jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_id,request_key)
);
CREATE INDEX operational_observation_events_parent ON operational_observation_events(observation_id,created_at DESC,id);
