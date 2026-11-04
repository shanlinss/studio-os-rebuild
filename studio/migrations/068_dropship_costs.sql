CREATE TABLE dropship_cost_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL CHECK(length(btrim(code)) BETWEEN 1 AND 64),
 business_date date NOT NULL,supplier text NOT NULL CHECK(length(btrim(supplier)) BETWEEN 1 AND 150),
 source_reference text NOT NULL CHECK(length(btrim(source_reference)) BETWEEN 1 AND 200),
 actor_id uuid NOT NULL REFERENCES accounts(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX dropship_cost_code ON dropship_cost_documents(lower(code));
CREATE TABLE dropship_cost_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid NOT NULL REFERENCES dropship_cost_documents(id),
 position integer NOT NULL CHECK(position>=0),sku_id uuid NOT NULL REFERENCES product_skus(id),store_id uuid NOT NULL REFERENCES stores(id),
 quantity integer NOT NULL CHECK(quantity>0),snapshot jsonb NOT NULL,UNIQUE(document_id,position)
);
CREATE TABLE dropship_cost_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid NOT NULL REFERENCES dropship_cost_documents(id),
 version integer NOT NULL CHECK(version>0),lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array'),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),actor_id uuid NOT NULL REFERENCES accounts(id),actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(document_id,version)
);
CREATE TABLE dropship_refunds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),line_id uuid NOT NULL REFERENCES dropship_cost_lines(id),quantity integer NOT NULL CHECK(quantity>0),
 business_date date NOT NULL,source_reference text NOT NULL CHECK(length(btrim(source_reference)) BETWEEN 1 AND 200)
);
CREATE UNIQUE INDEX dropship_refund_source ON dropship_refunds(line_id,lower(source_reference));
CREATE TABLE dropship_refund_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),refund_id uuid NOT NULL REFERENCES dropship_refunds(id),version integer NOT NULL CHECK(version>0),
 amount_cents integer NOT NULL CHECK(amount_cents>=0),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 actor_id uuid NOT NULL REFERENCES accounts(id),actor_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(refund_id,version)
);
CREATE TABLE dropship_cost_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),request_key uuid NOT NULL,operation text NOT NULL,target_id uuid,
 request_hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(actor_id,request_key)
);
CREATE TRIGGER dropship_cost_documents_append_only BEFORE UPDATE OR DELETE ON dropship_cost_documents FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER dropship_cost_lines_append_only BEFORE UPDATE OR DELETE ON dropship_cost_lines FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER dropship_cost_versions_append_only BEFORE UPDATE OR DELETE ON dropship_cost_versions FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER dropship_refunds_append_only BEFORE UPDATE OR DELETE ON dropship_refunds FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER dropship_refund_versions_append_only BEFORE UPDATE OR DELETE ON dropship_refund_versions FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER dropship_cost_receipts_append_only BEFORE UPDATE OR DELETE ON dropship_cost_receipts FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
