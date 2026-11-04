CREATE TABLE finance_month_closures (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),month text NOT NULL CHECK(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 version integer NOT NULL CHECK(version>0),action text NOT NULL CHECK(action IN('lock','reopen')),
 previous_id uuid REFERENCES finance_month_closures(id),source_hash text NOT NULL CHECK(length(source_hash)=64),snapshot jsonb NOT NULL,
 coverage_confirmed boolean NOT NULL,review_confirmed boolean NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 actor_id uuid NOT NULL REFERENCES accounts(id),actor_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(month,version)
);
CREATE TABLE finance_month_closure_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),request_key uuid NOT NULL,month text NOT NULL,action text NOT NULL,
 request_hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(actor_id,request_key)
);
CREATE TRIGGER finance_closures_append_only BEFORE UPDATE OR DELETE ON finance_month_closures FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER finance_closure_receipts_append_only BEFORE UPDATE OR DELETE ON finance_month_closure_receipts FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE VIEW finance_locked_months AS SELECT month,id FROM (SELECT DISTINCT ON(month) month,id,action FROM finance_month_closures ORDER BY month,version DESC) heads WHERE action='lock';
-- All source statements join one transaction fence. Closing holds it exclusively before reading.
CREATE FUNCTION finance_source_fence() RETURNS trigger LANGUAGE plpgsql SET search_path=studio_os,pg_catalog AS $$ BEGIN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('studio-finance-closing',0)); RETURN NULL;
END $$;
CREATE FUNCTION finance_assert_period(p text,carry boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SET search_path=studio_os,pg_catalog AS $$ BEGIN
 IF p IS NOT NULL AND EXISTS(SELECT 1 FROM finance_locked_months WHERE (carry AND month>=p) OR (NOT carry AND month=p)) THEN
  RAISE EXCEPTION 'Reopen affected financial month before changing its source' USING ERRCODE='PFC01';
 END IF;
END $$;
CREATE FUNCTION finance_assert_expense(p uuid) RETURNS void LANGUAGE plpgsql SET search_path=studio_os,pg_catalog AS $$ DECLARE d text; BEGIN
 SELECT to_char(expense_date,'YYYY-MM') INTO d FROM expense_records WHERE id=p; PERFORM finance_assert_period(d);
 -- Inventory evidence may carry a historical expense into a later locked valuation.
 IF EXISTS(SELECT 1 FROM finance_locked_months l JOIN finance_month_closures c ON c.id=l.id
  WHERE c.snapshot->'expenseIds' ? p::text) THEN RAISE EXCEPTION 'Financial source is locked' USING ERRCODE='PFC01'; END IF;
END $$;
CREATE FUNCTION finance_source_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=studio_os,pg_catalog AS $$
DECLARE j jsonb; v jsonb; p text; d date; e uuid; rec record; BEGIN
 -- Check both old and new dates/references. Moving a source out of a locked month is also a change.
 FOR j IN SELECT x FROM unnest(CASE WHEN TG_OP='UPDATE' THEN ARRAY[to_jsonb(OLD),to_jsonb(NEW)] WHEN TG_OP='DELETE' THEN ARRAY[to_jsonb(OLD)] ELSE ARRAY[to_jsonb(NEW)] END) x LOOP
  p:=NULL; d:=NULL;
  IF TG_TABLE_NAME IN('store_month_income_versions','finance_month_scope_versions') THEN PERFORM finance_assert_period(j->>'month');
  ELSIF TG_TABLE_NAME='expense_records' THEN PERFORM finance_assert_expense((j->>'id')::uuid);PERFORM finance_assert_period(left(j->>'expense_date',7));
  ELSIF TG_TABLE_NAME='operating_finance_versions' THEN
   PERFORM finance_assert_period(left(j->>'business_date',7));
   FOR rec IN SELECT business_date FROM operating_finance_versions WHERE record_id=(j->>'record_id')::uuid LOOP PERFORM finance_assert_period(to_char(rec.business_date,'YYYY-MM')); END LOOP;
   SELECT expense_id INTO e FROM operating_finance_records WHERE id=(j->>'record_id')::uuid;PERFORM finance_assert_expense(e);
  ELSIF TG_TABLE_NAME='operating_finance_records' THEN PERFORM finance_assert_expense((j->>'expense_id')::uuid);
  ELSIF TG_TABLE_NAME IN('dropship_cost_documents','dropship_business_versions') THEN
   PERFORM finance_assert_period(left(j->>'business_date',7));
   FOR rec IN SELECT business_date FROM dropship_effective_documents WHERE id=coalesce((j->>'document_id')::uuid,(j->>'id')::uuid)
    OR (lower(btrim(supplier))=lower(btrim(j->>'supplier')) AND lower(btrim(source_reference))=lower(btrim(j->>'source_reference'))) LOOP PERFORM finance_assert_period(to_char(rec.business_date,'YYYY-MM')); END LOOP;
  ELSIF TG_TABLE_NAME='dropship_cost_versions' THEN SELECT business_date INTO d FROM dropship_effective_documents WHERE id=(j->>'document_id')::uuid;PERFORM finance_assert_period(to_char(d,'YYYY-MM'));
   FOR rec IN SELECT r.business_date FROM dropship_refunds r JOIN dropship_cost_lines l ON l.id=r.line_id WHERE l.document_id=(j->>'document_id')::uuid LOOP PERFORM finance_assert_period(to_char(rec.business_date,'YYYY-MM')); END LOOP;
  ELSIF TG_TABLE_NAME='dropship_refunds' THEN PERFORM finance_assert_period(left(j->>'business_date',7));
  ELSIF TG_TABLE_NAME='dropship_refund_versions' THEN SELECT business_date INTO d FROM dropship_refunds WHERE id=(j->>'refund_id')::uuid;PERFORM finance_assert_period(to_char(d,'YYYY-MM'));
  ELSIF TG_TABLE_NAME='warehouse_movements' THEN
   SELECT business_date INTO d FROM product_stock_effective_documents WHERE id=(j->>'product_stock_document_id')::uuid;
   PERFORM finance_assert_period(to_char(coalesce(d,((j->>'created_at')::timestamptz AT TIME ZONE 'Asia/Shanghai')::date),'YYYY-MM'),true);
  ELSIF TG_TABLE_NAME IN('product_stock_documents','product_stock_correction_versions') THEN
   PERFORM finance_assert_period(left(j->>'business_date',7),true);
   SELECT business_date INTO d FROM product_stock_effective_documents WHERE id=(j->>'document_id')::uuid;PERFORM finance_assert_period(to_char(d,'YYYY-MM'),true);
  ELSIF TG_TABLE_NAME IN('product_purchase_versions','product_opening_cost_versions','inventory_cost_evidence_versions') THEN
   IF TG_TABLE_NAME='product_purchase_versions' THEN
    SELECT d.business_date INTO d FROM product_purchase_batches b JOIN product_stock_effective_documents d ON d.id=b.inbound_document_id WHERE b.id=(j->>'batch_id')::uuid;
    PERFORM finance_assert_period(to_char(d,'YYYY-MM'),true);
   ELSIF TG_TABLE_NAME='product_opening_cost_versions' THEN
    SELECT min((created_at AT TIME ZONE 'Asia/Shanghai')::date) INTO d FROM warehouse_movements WHERE item_id=(j->>'item_id')::uuid AND type='opening';PERFORM finance_assert_period(to_char(d,'YYYY-MM'),true);
   ELSE
    SELECT coalesce(x.business_date,(m.created_at AT TIME ZONE 'Asia/Shanghai')::date) INTO d FROM warehouse_movements m LEFT JOIN product_stock_effective_documents x ON x.id=m.product_stock_document_id WHERE m.id=(j->>'movement_id')::uuid;PERFORM finance_assert_period(to_char(d,'YYYY-MM'),true);
   END IF;PERFORM finance_assert_expense((j->>'expense_id')::uuid);
  ELSIF TG_TABLE_NAME='shooting_sample_events' THEN
   IF j->>'action' IN('stock-in','stocktake') AND (j->>'quantity_delta')::int<>0 THEN PERFORM finance_assert_period(to_char((j->>'created_at')::timestamptz AT TIME ZONE 'Asia/Shanghai','YYYY-MM'),true); END IF;
  ELSIF TG_TABLE_NAME='sample_cost_evidence_versions' THEN SELECT (created_at AT TIME ZONE 'Asia/Shanghai')::date INTO d FROM shooting_sample_events WHERE id=(j->>'event_id')::uuid;PERFORM finance_assert_period(to_char(d,'YYYY-MM'),true);PERFORM finance_assert_expense((j->>'expense_id')::uuid);
  ELSIF TG_TABLE_NAME='packaging_purchases' THEN PERFORM finance_assert_period(to_char((j->>'created_at')::timestamptz AT TIME ZONE 'Asia/Shanghai','YYYY-MM'),true);PERFORM finance_assert_expense((j->>'expense_id')::uuid);
  ELSIF TG_TABLE_NAME IN('equipment_purchase_versions','phone_card_recharge_versions') THEN
   PERFORM finance_assert_expense((j->>'expense_id')::uuid);
   IF TG_TABLE_NAME='equipment_purchase_versions' THEN
    FOR rec IN SELECT expense_id FROM equipment_purchase_versions WHERE equipment_id=(j->>'equipment_id')::uuid ORDER BY version DESC LIMIT 2 LOOP PERFORM finance_assert_expense(rec.expense_id); END LOOP;
   ELSE FOR rec IN SELECT expense_id FROM phone_card_recharge_versions WHERE recharge_id=(j->>'recharge_id')::uuid ORDER BY version DESC LIMIT 2 LOOP PERFORM finance_assert_expense(rec.expense_id); END LOOP; END IF;
  END IF;
 END LOOP;
 RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['expense_records','store_month_income_versions','finance_month_scope_versions','operating_finance_records','operating_finance_versions','dropship_cost_documents','dropship_business_versions','dropship_cost_versions','dropship_refunds','dropship_refund_versions','warehouse_movements','product_stock_documents','product_stock_correction_versions','product_purchase_versions','product_opening_cost_versions','inventory_cost_evidence_versions','shooting_sample_events','sample_cost_evidence_versions','packaging_purchases','equipment_purchase_versions','phone_card_recharge_versions'] LOOP
  EXECUTE format('CREATE TRIGGER finance_closing_fence BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION finance_source_fence()',t);
  EXECUTE format('CREATE TRIGGER finance_closing_guard AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION finance_source_guard()',t);
 END LOOP;
END $$;
-- Cash and reimbursements remain writable; they join the snapshot fence only.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['cash_movement_records','cash_movement_versions','expense_settlements','expense_settlement_items','expense_reimbursements'] LOOP
  EXECUTE format('CREATE TRIGGER finance_closing_fence BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION finance_source_fence()',t);
 END LOOP;
END $$;
