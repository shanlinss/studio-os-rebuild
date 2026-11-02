CREATE TABLE products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 store_id uuid REFERENCES stores(id) ON DELETE RESTRICT,
 active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE product_stages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 position integer NOT NULL CHECK(position>0),
 UNIQUE(product_id,id), UNIQUE(product_id,position) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE product_images (
 product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 mime text NOT NULL CHECK(mime IN('image/png','image/jpeg','image/webp','image/gif')),
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 8388608)
);
CREATE TABLE product_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
 action text NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE product_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
 decision text NOT NULL CHECK(decision IN('continue','adjust','stop')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE plans ADD COLUMN source_type text NOT NULL DEFAULT 'material' CHECK(source_type IN('material','product'));
ALTER TABLE plans ADD COLUMN product_id uuid REFERENCES products(id) ON DELETE RESTRICT;
ALTER TABLE plans ADD COLUMN stage_id uuid;
ALTER TABLE plans ADD COLUMN requirements text NOT NULL DEFAULT '' CHECK(length(requirements)<=2000);
ALTER TABLE plans ADD CONSTRAINT product_stage_parent FOREIGN KEY(product_id,stage_id) REFERENCES product_stages(product_id,id) ON DELETE RESTRICT;
ALTER TABLE plans ADD CONSTRAINT plan_business_source CHECK((source_type='material' AND product_id IS NULL AND stage_id IS NULL) OR(source_type='product' AND product_id IS NOT NULL AND stage_id IS NOT NULL AND experiment_id IS NULL));
ALTER TABLE tasks ADD COLUMN kind text NOT NULL DEFAULT 'publication' CHECK(kind IN('publication','action'));
ALTER TABLE tasks ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE tasks ADD CONSTRAINT task_account_kind CHECK((kind='publication' AND account_id IS NOT NULL) OR(kind='action' AND account_id IS NULL AND target_count=1));
CREATE TABLE action_completions (
 task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
 evidence_url text,
 feedback text NOT NULL DEFAULT '' CHECK(length(feedback)<=2000),
 completed_by uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 completed_at timestamptz NOT NULL DEFAULT now(),
 CHECK(evidence_url IS NOT NULL OR length(trim(feedback))>0)
);
CREATE TABLE task_materials (
 task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 material_id uuid NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
 target_count integer NOT NULL CHECK(target_count>0),
 requirements text NOT NULL DEFAULT '' CHECK(length(requirements)<=2000),
 topic_reference text NOT NULL DEFAULT '' CHECK(length(topic_reference)<=1000),
 title_reference text NOT NULL DEFAULT '' CHECK(length(title_reference)<=1000),
 cover_reference text NOT NULL DEFAULT '' CHECK(length(cover_reference)<=1000),
 PRIMARY KEY(task_id,material_id)
);
ALTER TABLE publications ADD COLUMN material_id uuid REFERENCES materials(id) ON DELETE RESTRICT;

ALTER TABLE workflow_events DROP CONSTRAINT workflow_events_action_check;
ALTER TABLE workflow_events ADD CONSTRAINT workflow_events_action_check CHECK(action IN('dispatched','published','snapshot','conclusion','action_completed'));
