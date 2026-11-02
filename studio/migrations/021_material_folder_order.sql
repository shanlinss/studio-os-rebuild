-- Ordering metadata references shared stores; no duplicate store identities.
CREATE TABLE material_folder_layout (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 version integer NOT NULL DEFAULT 1 CHECK(version>0)
);
INSERT INTO material_folder_layout(singleton) VALUES(true);
CREATE TABLE material_folder_positions (
 store_id uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
 position integer NOT NULL CHECK(position>=0)
);
CREATE TABLE material_folder_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
 before_ids uuid[] NOT NULL,
 after_ids uuid[] NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
