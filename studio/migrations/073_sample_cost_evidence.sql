-- Cost evidence only; sample quantities and loans remain in their original tables.
CREATE TABLE sample_cost_evidence_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES shooting_sample_events(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version>0),
 mode text NOT NULL CHECK(mode IN('basis','outflow')),
 amount_cents integer CHECK(amount_cents>=0),
 scope text CHECK(scope IN('public','store','unclassified')),
 store_id uuid REFERENCES stores(id) ON DELETE RESTRICT,
 loss_kind text CHECK(loss_kind IN('loss','scrap')),
 expense_id uuid REFERENCES expense_records(id) ON DELETE RESTRICT,
 expense_snapshot jsonb,
 source_reference text NOT NULL CHECK(length(source_reference) BETWEEN 1 AND 200),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 event_snapshot jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES accounts(id),
 actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(event_id,version),
 CHECK((mode='basis' AND amount_cents IS NOT NULL AND scope IS NULL AND store_id IS NULL AND loss_kind IS NULL)
 OR (mode='outflow' AND amount_cents IS NULL AND scope IS NOT NULL AND loss_kind IS NOT NULL AND ((scope='store' AND store_id IS NOT NULL) OR (scope IN('public','unclassified') AND store_id IS NULL)))),
 CHECK((expense_id IS NULL)=(expense_snapshot IS NULL))
);
CREATE TABLE sample_cost_expense_links (
 expense_id uuid PRIMARY KEY REFERENCES expense_records(id) ON DELETE RESTRICT,
 event_id uuid NOT NULL REFERENCES shooting_sample_events(id) ON DELETE RESTRICT
);
CREATE TABLE sample_cost_evidence_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),request_key uuid NOT NULL,
 event_id uuid NOT NULL REFERENCES shooting_sample_events(id),request_hash text NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,request_key)
);
CREATE TRIGGER sample_cost_evidence_append_only BEFORE UPDATE OR DELETE ON sample_cost_evidence_versions FOR EACH ROW EXECUTE FUNCTION warehouse_keep_transfer_history();
CREATE TRIGGER sample_cost_links_append_only BEFORE UPDATE OR DELETE ON sample_cost_expense_links FOR EACH ROW EXECUTE FUNCTION warehouse_keep_transfer_history();
CREATE TRIGGER sample_cost_receipts_append_only BEFORE UPDATE OR DELETE ON sample_cost_evidence_receipts FOR EACH ROW EXECUTE FUNCTION warehouse_keep_transfer_history();
