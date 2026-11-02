CREATE TABLE note_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 structure text NOT NULL CHECK(length(structure) BETWEEN 1 AND 4000),
 product text NOT NULL DEFAULT '' CHECK(length(product)<=200),
 scene text NOT NULL DEFAULT '' CHECK(length(scene)<=100),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=2000),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=2000),
 tags jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(tags)='array' AND jsonb_array_length(tags)<=30),
 rating text CHECK(rating IN('S','A','B','C')),
 benchmark_url text,
 source_material_id uuid REFERENCES materials(id) ON DELETE RESTRICT,
 source_experiment_id uuid REFERENCES lab_experiments(id) ON DELETE RESTRICT,
 archived boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE template_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 template_id uuid NOT NULL REFERENCES note_templates(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 mime text NOT NULL CHECK(mime IN('image/png','image/jpeg','image/webp','image/gif','video/mp4')),
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 8388608),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX template_assets_parent ON template_assets(template_id);
CREATE TABLE template_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 template_id uuid NOT NULL,
 actor_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
 action text NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE plans DROP CONSTRAINT plans_source_type_check;
ALTER TABLE plans ADD CONSTRAINT plans_source_type_check CHECK(source_type IN('material','product','template'));
ALTER TABLE plans DROP CONSTRAINT plan_business_source;
ALTER TABLE plans ADD CONSTRAINT plan_business_source CHECK(
 (source_type='material' AND product_id IS NULL AND stage_id IS NULL)
 OR(source_type='product' AND product_id IS NOT NULL AND stage_id IS NOT NULL AND experiment_id IS NULL)
 OR(source_type='template' AND experiment_id IS NULL AND ((product_id IS NULL AND stage_id IS NULL) OR(product_id IS NOT NULL AND stage_id IS NOT NULL)))
);
ALTER TABLE tasks ADD COLUMN template_id uuid REFERENCES note_templates(id) ON DELETE RESTRICT;
ALTER TABLE tasks ADD COLUMN template_material_id uuid REFERENCES materials(id) ON DELETE RESTRICT;
ALTER TABLE tasks ADD COLUMN template_version integer;
ALTER TABLE tasks ADD CONSTRAINT task_template_source CHECK((template_id IS NULL AND template_material_id IS NULL AND template_version IS NULL) OR(template_id IS NOT NULL AND template_version IS NOT NULL AND template_version>0 AND kind='publication'));
ALTER TABLE tasks ADD COLUMN instructions text NOT NULL DEFAULT '' CHECK(length(instructions)<=2000);
ALTER TABLE tasks DROP CONSTRAINT tasks_plan_id_member_id_account_id_key;
CREATE UNIQUE INDEX tasks_plain_assignment ON tasks(plan_id,member_id,account_id) WHERE template_id IS NULL;
CREATE UNIQUE INDEX tasks_template_assignment ON tasks(plan_id,member_id,account_id,template_id) WHERE template_id IS NOT NULL;
CREATE INDEX tasks_template ON tasks(template_id);
ALTER TABLE publications ADD COLUMN template_id uuid REFERENCES note_templates(id) ON DELETE RESTRICT;
ALTER TABLE publications ADD COLUMN title text NOT NULL DEFAULT '' CHECK(length(title)<=200);
ALTER TABLE publications ADD COLUMN note text NOT NULL DEFAULT '' CHECK(length(note)<=2000);
ALTER TABLE publications ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
CREATE INDEX publications_template ON publications(template_id);
ALTER TABLE workflow_events DROP CONSTRAINT workflow_events_action_check;
ALTER TABLE workflow_events ADD CONSTRAINT workflow_events_action_check CHECK(action IN('dispatched','published','snapshot','conclusion','action_completed','plan_updated','publication_updated','assignment_cancelled'));

ALTER TABLE data_snapshots ADD COLUMN has_conversion boolean;
ALTER TABLE data_snapshots DROP CONSTRAINT snapshot_some_metric;
ALTER TABLE data_snapshots ADD CONSTRAINT snapshot_some_metric CHECK(views IS NOT NULL OR likes IS NOT NULL OR favorites IS NOT NULL OR comments IS NOT NULL OR product_clicks IS NOT NULL OR add_to_cart IS NOT NULL OR conversions IS NOT NULL OR has_conversion IS NOT NULL);
ALTER TABLE data_snapshots ADD CONSTRAINT snapshot_conversion_state CHECK(has_conversion IS NULL OR conversions IS NULL OR has_conversion=(conversions>0));
