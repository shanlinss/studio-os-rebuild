CREATE TABLE shooting_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 product_id uuid REFERENCES products(id) ON DELETE RESTRICT,
 product_description text NOT NULL DEFAULT '' CHECK(length(product_description)<=200),
 created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 assignee_id uuid REFERENCES members(id) ON DELETE RESTRICT,
 due_on date NOT NULL,
 status text NOT NULL DEFAULT '待拍摄' CHECK(status IN('待拍摄','拍摄中','待确认','需补拍','已完成')),
 summary text NOT NULL DEFAULT '' CHECK(length(summary)<=2000),
 feedback text NOT NULL DEFAULT '' CHECK(length(feedback)<=2000),
 nas_path text NOT NULL DEFAULT '' CHECK(length(nas_path)<=2000),
 archived boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 last_completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shooting_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL REFERENCES shooting_requests(id) ON DELETE CASCADE,
 position integer NOT NULL CHECK(position>=0),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 kind text NOT NULL CHECK(kind IN('图片','视频')),
 priority text NOT NULL CHECK(priority IN('S','A','B','C')),
 material_id uuid REFERENCES materials(id) ON DELETE RESTRICT,
 references_text jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(references_text)='array' AND jsonb_array_length(references_text)<=20),
 requirements jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(requirements)='array' AND jsonb_array_length(requirements)<=20),
 completed boolean NOT NULL DEFAULT false,
 archived boolean NOT NULL DEFAULT false,
 UNIQUE(request_id,id)
);
CREATE UNIQUE INDEX shooting_item_position ON shooting_items(request_id,position) WHERE NOT archived;
CREATE TABLE shooting_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL REFERENCES shooting_requests(id) ON DELETE CASCADE,
 item_id uuid,
 kind text NOT NULL CHECK(kind IN('reference','delivery')),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 mime text NOT NULL CHECK(mime IN('image/png','image/jpeg','image/webp','image/gif','video/mp4')),
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 8388608),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=1000),
 removed boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(request_id,item_id) REFERENCES shooting_items(request_id,id) ON DELETE CASCADE,
 CHECK((kind='reference' AND item_id IS NOT NULL AND mime<>'video/mp4') OR(kind='delivery' AND item_id IS NULL))
);
CREATE INDEX shooting_assets_parent ON shooting_assets(request_id,item_id);
CREATE TABLE shooting_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL,
 actor_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
 actor_name text NOT NULL CHECK(length(actor_name) BETWEEN 1 AND 100),
 action text NOT NULL,
 revision integer NOT NULL CHECK(revision>0),
 detail jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(request_id,revision)
);
CREATE TABLE shooting_mutations (
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 request_key uuid NOT NULL,
 request_id uuid,
 request_hash text NOT NULL CHECK(length(request_hash)=64),
 result jsonb,
 PRIMARY KEY(actor_id,request_key)
);
ALTER TABLE plans ADD COLUMN shooting_request_id uuid UNIQUE REFERENCES shooting_requests(id) ON DELETE CASCADE;
ALTER TABLE plans DROP CONSTRAINT plans_source_type_check;
ALTER TABLE plans ADD CONSTRAINT plans_source_type_check CHECK(source_type IN('material','product','template','shooting'));
ALTER TABLE plans DROP CONSTRAINT plan_business_source;
ALTER TABLE plans ADD CONSTRAINT plan_business_source CHECK(
 (source_type='material' AND product_id IS NULL AND stage_id IS NULL AND shooting_request_id IS NULL)
 OR(source_type='product' AND product_id IS NOT NULL AND stage_id IS NOT NULL AND experiment_id IS NULL AND shooting_request_id IS NULL)
 OR(source_type='template' AND experiment_id IS NULL AND shooting_request_id IS NULL AND ((product_id IS NULL AND stage_id IS NULL) OR(product_id IS NOT NULL AND stage_id IS NOT NULL)))
 OR(source_type='shooting' AND shooting_request_id IS NOT NULL AND product_id IS NULL AND stage_id IS NULL AND experiment_id IS NULL)
);
ALTER TABLE tasks DROP CONSTRAINT tasks_kind_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_kind_check CHECK(kind IN('publication','action','shooting'));
ALTER TABLE tasks DROP CONSTRAINT task_account_kind;
ALTER TABLE tasks ADD CONSTRAINT task_account_kind CHECK(
 (kind='publication' AND account_id IS NOT NULL)
 OR(kind='action' AND account_id IS NULL AND target_count=1)
 OR(kind='shooting' AND account_id IS NULL)
);
CREATE UNIQUE INDEX tasks_shooting_plan ON tasks(plan_id) WHERE kind='shooting';
