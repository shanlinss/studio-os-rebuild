-- V1.1 additive research layer; no historical rows merged or removed.
CREATE TABLE reference_dimensions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_key uuid UNIQUE, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
 description text NOT NULL DEFAULT '', ai_rule text NOT NULL DEFAULT '', position integer NOT NULL DEFAULT 0,
 active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1 CHECK(version>0)
);
INSERT INTO reference_dimensions(name,position) VALUES('选题',0),('标题',1),('内容结构',2),('文案',3),('Tag',4),('封面',5),('内页',6);
CREATE TABLE material_elements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_key uuid UNIQUE, material_id uuid NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
 dimension_id uuid NOT NULL REFERENCES reference_dimensions(id) ON DELETE RESTRICT,
 content text NOT NULL CHECK(length(content) BETWEEN 1 AND 4000), reason text NOT NULL DEFAULT '',
 evidence text NOT NULL DEFAULT '', asset_id uuid REFERENCES material_assets(id) ON DELETE RESTRICT,
 store_id uuid REFERENCES stores(id) ON DELETE RESTRICT, product_id uuid REFERENCES products(id) ON DELETE RESTRICT,
 theme text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid REFERENCES accounts(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX material_elements_parent ON material_elements(material_id);
CREATE TABLE personal_inspirations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 request_key uuid NOT NULL, title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200), content text NOT NULL DEFAULT '',
 source_url text, version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,request_key)
);
CREATE INDEX personal_inspirations_owner ON personal_inspirations(owner_id,created_at DESC);
CREATE TABLE research_candidates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 hypothesis text NOT NULL DEFAULT '', scope text NOT NULL DEFAULT '', evidence_level text NOT NULL DEFAULT '',
 priority text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','scheduled','deferred','archived')),
 created_by uuid REFERENCES accounts(id) ON DELETE SET NULL, request_key uuid NOT NULL UNIQUE,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE candidate_references (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), candidate_id uuid NOT NULL REFERENCES research_candidates(id) ON DELETE CASCADE,
 material_id uuid REFERENCES materials(id) ON DELETE RESTRICT, element_id uuid REFERENCES material_elements(id) ON DELETE RESTRICT,
 template_id uuid REFERENCES note_templates(id) ON DELETE RESTRICT, idea text NOT NULL DEFAULT '',
 CHECK(num_nonnulls(material_id,element_id,template_id)+(CASE WHEN idea<>'' THEN 1 ELSE 0 END)=1)
);
CREATE INDEX candidate_references_parent ON candidate_references(candidate_id);
CREATE TABLE plan_candidate_sources (
 plan_id uuid PRIMARY KEY REFERENCES plans(id) ON DELETE CASCADE,
 candidate_id uuid NOT NULL REFERENCES research_candidates(id) ON DELETE RESTRICT,
 source_snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plan_candidate_sources_candidate ON plan_candidate_sources(candidate_id);
CREATE TABLE research_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_id uuid NOT NULL, actor_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
 action text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
-- Index derived values for new collection duplicate warnings, not a uniqueness
-- constraint: old duplicates and unknown short links remain untouched.
CREATE INDEX material_source_url_lookup ON materials(source_url) WHERE source_url IS NOT NULL;
