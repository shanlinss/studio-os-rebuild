CREATE TABLE materials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
 source_url text NOT NULL,
 created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_key uuid NOT NULL UNIQUE,
 request_hash text NOT NULL,
 title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
 conclusion text,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE plan_materials (
 plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
 material_id uuid NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
 PRIMARY KEY(plan_id,material_id)
);
CREATE TABLE tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
 member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 account_id uuid NOT NULL REFERENCES business_accounts(id) ON DELETE RESTRICT,
 target_count integer NOT NULL CHECK(target_count>0),
 UNIQUE(plan_id,member_id,account_id)
);
CREATE INDEX tasks_member ON tasks(member_id);
CREATE TABLE publications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 url text NOT NULL,
 published_at timestamptz NOT NULL,
 created_by uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(task_id,url)
);
CREATE TABLE data_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 publication_id uuid NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
 observed_at timestamptz NOT NULL,
 views integer CHECK(views>=0),
 likes integer CHECK(likes>=0),
 favorites integer CHECK(favorites>=0),
 comments integer CHECK(comments>=0),
 created_by uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(publication_id,observed_at),
 CHECK(views IS NOT NULL OR likes IS NOT NULL OR favorites IS NOT NULL OR comments IS NOT NULL)
);
CREATE TABLE workflow_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
 action text NOT NULL CHECK(action IN('dispatched','published','snapshot','conclusion')),
 reference_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
