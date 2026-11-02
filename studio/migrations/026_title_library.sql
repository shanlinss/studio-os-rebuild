-- Independent restoration of TitlesPanel@dd8337d; no legacy SQL is executed.
CREATE TABLE title_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 batch_date date NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE title_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 batch_id uuid NOT NULL REFERENCES title_batches(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 500),
 direction text NOT NULL DEFAULT '未分类' CHECK(length(direction) BETWEEN 1 AND 100),
 usage_count integer NOT NULL DEFAULT 0 CHECK(usage_count>=0),
 position integer NOT NULL CHECK(position>=0)
);
CREATE INDEX title_entries_batch ON title_entries(batch_id,position,id);
CREATE TABLE title_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 batch_id uuid NOT NULL,
 actor_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
 action text NOT NULL CHECK(action IN('created','renamed','appended','edited','removed','deleted','copied')),
 detail jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE title_copy_receipts (
 id uuid PRIMARY KEY,
 batch_id uuid NOT NULL REFERENCES title_batches(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
 entry_ids jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
