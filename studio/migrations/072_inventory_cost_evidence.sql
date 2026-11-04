CREATE TABLE inventory_cost_evidence_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),movement_id uuid NOT NULL REFERENCES warehouse_movements(id),
 version integer NOT NULL CHECK(version>0),mode text NOT NULL CHECK(mode IN('basis','outflow')),
 amount_cents integer CHECK(amount_cents>=0),scope text CHECK(scope IN('public','store','unclassified')),store_id uuid REFERENCES stores(id),
 expense_id uuid REFERENCES expense_records(id),expense_snapshot jsonb,
 source_reference text NOT NULL CHECK(length(btrim(source_reference)) BETWEEN 1 AND 200),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 movement_snapshot jsonb NOT NULL,actor_id uuid NOT NULL REFERENCES accounts(id),actor_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(movement_id,version),
 CHECK((mode='basis' AND amount_cents IS NOT NULL AND scope IS NULL AND store_id IS NULL)
  OR (mode='outflow' AND amount_cents IS NULL AND scope IS NOT NULL AND (scope<>'public' OR store_id IS NULL) AND (scope<>'store' OR store_id IS NOT NULL))),
 CHECK((expense_id IS NULL)=(expense_snapshot IS NULL))
);
CREATE TABLE inventory_cost_expense_links (
 expense_id uuid PRIMARY KEY REFERENCES expense_records(id),movement_id uuid NOT NULL REFERENCES warehouse_movements(id)
);
CREATE TABLE inventory_cost_evidence_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),request_key uuid NOT NULL,movement_id uuid NOT NULL REFERENCES warehouse_movements(id),
 request_hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(actor_id,request_key)
);
CREATE TRIGGER inventory_cost_evidence_versions_append_only BEFORE UPDATE OR DELETE ON inventory_cost_evidence_versions FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER inventory_cost_expense_links_append_only BEFORE UPDATE OR DELETE ON inventory_cost_expense_links FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER inventory_cost_evidence_receipts_append_only BEFORE UPDATE OR DELETE ON inventory_cost_evidence_receipts FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
