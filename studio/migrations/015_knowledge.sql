CREATE TABLE knowledge_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 entry_type text NOT NULL DEFAULT 'knowledge' CHECK(entry_type IN('knowledge','learning')),
 kind text NOT NULL CHECK(kind IN('article','link','conclusion')),
 category text NOT NULL DEFAULT '' CHECK(length(category)<=100),
 summary text NOT NULL DEFAULT '' CHECK(length(summary)<=2000),
 body text NOT NULL DEFAULT '' CHECK(length(body)<=20000),
 source_url text,
 experiment_id uuid REFERENCES lab_experiments(id) ON DELETE RESTRICT,
 product_review_id uuid REFERENCES product_reviews(id) ON DELETE RESTRICT,
 tags jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(tags)='array' AND jsonb_array_length(tags)<=30),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='article' AND length(trim(body))>0 AND experiment_id IS NULL AND product_review_id IS NULL)
 OR(kind='link' AND source_url IS NOT NULL AND body='' AND experiment_id IS NULL AND product_review_id IS NULL)
 OR(kind='conclusion' AND body='' AND source_url IS NULL AND ((experiment_id IS NOT NULL)::integer+(product_review_id IS NOT NULL)::integer)=1))
);
CREATE TABLE knowledge_covers (
 asset_id uuid PRIMARY KEY REFERENCES knowledge_assets(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 mime text NOT NULL CHECK(mime IN('image/png','image/jpeg','image/webp','image/gif')),
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 8388608)
);
CREATE TABLE knowledge_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 asset_id uuid NOT NULL,
 actor_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
 action text NOT NULL CHECK(action IN('created','updated','deleted','cover_updated','cover_deleted')),
 before_value jsonb,
 after_value jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
