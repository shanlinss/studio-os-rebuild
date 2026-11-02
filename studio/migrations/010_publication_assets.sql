-- Private execution evidence is never part of the shared reference catalog.
CREATE TABLE publication_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 publication_id uuid NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 mime text NOT NULL CHECK(mime IN('image/png','image/jpeg','image/webp','image/gif','video/mp4')),
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 8388608),
 created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX publication_assets_parent ON publication_assets(publication_id);
CREATE TABLE publication_asset_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 publication_id uuid NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
 asset_id uuid NOT NULL,
 actor_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
 action text NOT NULL CHECK(action IN('uploaded','deleted')),
 created_at timestamptz NOT NULL DEFAULT now()
);
