-- Preserve historical uncertainty: a missing store alone does not imply a public operating expense.
ALTER TABLE expense_records
 ADD COLUMN expense_scope text NOT NULL DEFAULT 'unclassified' CHECK(expense_scope IN('public','store','unclassified')),
 ADD COLUMN expense_use text NOT NULL DEFAULT 'unclassified' CHECK(expense_use IN('operating','inventory','prepaid','unclassified')),
 ADD CONSTRAINT expense_scope_store CHECK((expense_scope<>'public' OR store_id IS NULL) AND (expense_scope<>'store' OR store_id IS NOT NULL));
CREATE TABLE expense_attribution_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),request_key uuid NOT NULL,expense_id uuid NOT NULL,
 request_hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(actor_id,request_key)
);
CREATE TRIGGER expense_attribution_receipts_append_only BEFORE UPDATE OR DELETE ON expense_attribution_receipts FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
