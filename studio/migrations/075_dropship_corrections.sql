-- Preserve immutable source facts; mistakes are voided and linked to a corrected new record.
ALTER TABLE dropship_cost_versions ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK(status IN('active','void'));
ALTER TABLE dropship_refund_versions ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK(status IN('active','void'));
CREATE TABLE dropship_document_replacements (
 original_document_id uuid PRIMARY KEY REFERENCES dropship_cost_documents(id),
 document_id uuid UNIQUE NOT NULL REFERENCES dropship_cost_documents(id),
 actor_id uuid NOT NULL REFERENCES accounts(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(original_document_id<>document_id)
);
ALTER TABLE dropship_refunds ADD COLUMN replaces_refund_id uuid UNIQUE REFERENCES dropship_refunds(id);
DROP INDEX dropship_refund_source;
CREATE UNIQUE INDEX dropship_refund_source ON dropship_refunds(line_id,lower(source_reference)) WHERE replaces_refund_id IS NULL;
CREATE INDEX dropship_document_source_lookup ON dropship_cost_documents(lower(btrim(supplier)),lower(btrim(source_reference)));
CREATE TRIGGER dropship_replacements_append_only BEFORE UPDATE OR DELETE ON dropship_document_replacements FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
-- Business-fact corrections retain stable line/refund identities, including real refunds.
CREATE TABLE dropship_business_versions (
 document_id uuid NOT NULL REFERENCES dropship_cost_documents(id),
 cost_version integer NOT NULL CHECK(cost_version>1),business_date date NOT NULL,
 supplier text NOT NULL CHECK(length(btrim(supplier)) BETWEEN 1 AND 150),
 source_reference text NOT NULL CHECK(length(btrim(source_reference)) BETWEEN 1 AND 200),
 lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array' AND jsonb_array_length(lines) BETWEEN 1 AND 100),
 actor_id uuid NOT NULL REFERENCES accounts(id),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(document_id,cost_version)
);
CREATE TRIGGER dropship_business_append_only BEFORE UPDATE OR DELETE ON dropship_business_versions FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE VIEW dropship_effective_documents AS
 SELECT d.id,d.code,coalesce(v.business_date,d.business_date) AS business_date,coalesce(v.supplier,d.supplier) AS supplier,
 coalesce(v.source_reference,d.source_reference) AS source_reference,d.actor_id,d.created_at
 FROM dropship_cost_documents d LEFT JOIN LATERAL(SELECT * FROM dropship_business_versions v WHERE v.document_id=d.id ORDER BY cost_version DESC LIMIT 1) v ON true;
CREATE VIEW dropship_effective_lines AS
 SELECT l.id,l.document_id,l.position,coalesce((f.value->>'skuId')::uuid,l.sku_id) AS sku_id,
 coalesce((f.value->>'storeId')::uuid,l.store_id) AS store_id,coalesce((f.value->>'quantity')::int,l.quantity) AS quantity,
 coalesce(f.value->'snapshot',l.snapshot) AS snapshot
 FROM dropship_cost_lines l LEFT JOIN LATERAL(SELECT v.lines FROM dropship_business_versions v WHERE v.document_id=l.document_id ORDER BY cost_version DESC LIMIT 1) v ON true
 LEFT JOIN LATERAL(SELECT value FROM jsonb_array_elements(v.lines) f(value) WHERE f.value->>'id'=l.id::text) f ON true;
CREATE TABLE dropship_business_references (
 document_id uuid NOT NULL REFERENCES dropship_cost_documents(id),sku_id uuid NOT NULL REFERENCES product_skus(id),
 store_id uuid NOT NULL REFERENCES stores(id),PRIMARY KEY(document_id,sku_id,store_id)
);
CREATE TRIGGER dropship_business_references_append_only BEFORE UPDATE OR DELETE ON dropship_business_references FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
