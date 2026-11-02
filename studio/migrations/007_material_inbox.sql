ALTER TABLE materials ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE materials ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version > 0);
ALTER TABLE materials ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE material_stores (
 material_id uuid NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
 store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
 PRIMARY KEY(material_id,store_id)
);
CREATE TABLE material_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 material_id uuid NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 mime text NOT NULL CHECK(mime IN('image/png','image/jpeg','image/webp','image/gif','video/mp4')),
 kind text NOT NULL CHECK(kind IN('screenshot','reference')),
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 8388608),
 created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX material_assets_parent ON material_assets(material_id);
CREATE TABLE material_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 material_id uuid,
 actor_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
 action text NOT NULL CHECK(action IN('created','updated','deleted','uploaded','asset_deleted')),
 created_at timestamptz NOT NULL DEFAULT now()
);
