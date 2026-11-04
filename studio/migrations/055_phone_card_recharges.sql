-- Manual records, not carrier payments or a second expense ledger.
CREATE TABLE phone_card_recharges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 card_id uuid NOT NULL REFERENCES phone_cards(id) ON DELETE RESTRICT,
 created_by uuid NOT NULL REFERENCES accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(card_id,id)
);
CREATE TABLE phone_card_recharge_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recharge_id uuid NOT NULL,
 card_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),
 previous_id uuid REFERENCES phone_card_recharge_versions(id),
 status text NOT NULL CHECK(status IN('recorded','voided')),
 recharge_date date NOT NULL CHECK(recharge_date>='0001-01-01'::date),
 amount_cents integer NOT NULL CHECK(amount_cents>0),
 recharge_type text NOT NULL CHECK(length(btrim(recharge_type)) BETWEEN 1 AND 80),
 handler_kind text NOT NULL CHECK(handler_kind IN('operator','member')),
 handler_member_id uuid REFERENCES members(id),
 handler_account_id uuid REFERENCES accounts(id),
 handler_name text NOT NULL,
 payer_kind text NOT NULL CHECK(payer_kind IN('company','member')),
 payer_member_id uuid REFERENCES members(id),
 payer_name text NOT NULL,
 store_id uuid REFERENCES stores(id),
 store_name text,
 business_purpose text NOT NULL CHECK(length(btrim(business_purpose)) BETWEEN 1 AND 200),
 note text NOT NULL CHECK(length(note)<=2000),
 expense_id uuid REFERENCES expense_records(id) ON DELETE RESTRICT,
 expense_snapshot jsonb,
 card_snapshot jsonb NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 actor_id uuid NOT NULL REFERENCES accounts(id),
 actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(card_id,recharge_id) REFERENCES phone_card_recharges(card_id,id),
 UNIQUE(recharge_id,version),
 CHECK((version=1 AND previous_id IS NULL AND status='recorded') OR (version>1 AND previous_id IS NOT NULL)),
 CHECK((handler_kind='operator' AND handler_member_id IS NULL AND handler_account_id IS NOT NULL) OR (handler_kind='member' AND handler_member_id IS NOT NULL AND handler_account_id IS NULL)),
 CHECK((payer_kind='company' AND payer_member_id IS NULL) OR (payer_kind='member' AND payer_member_id IS NOT NULL)),
 CHECK((expense_id IS NULL)=(expense_snapshot IS NULL))
);
CREATE TABLE phone_card_balances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 card_id uuid NOT NULL REFERENCES phone_cards(id),
 version integer NOT NULL CHECK(version>0),
 amount_cents integer CHECK(amount_cents>=-2147483647),
 observed_at timestamptz NOT NULL,
 card_snapshot jsonb NOT NULL,
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 1 AND 2000),
 actor_id uuid NOT NULL REFERENCES accounts(id),
 actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(card_id,version)
);
CREATE TABLE phone_card_reminder_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 card_id uuid NOT NULL REFERENCES phone_cards(id),
 version integer NOT NULL CHECK(version>0),
 next_recharge_on date CHECK(next_recharge_on>='0001-01-01'::date),
 card_snapshot jsonb NOT NULL,
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 1 AND 2000),
 actor_id uuid NOT NULL REFERENCES accounts(id),
 actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(card_id,version)
);
CREATE TABLE phone_card_operation_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),
 request_key uuid NOT NULL,
 action text NOT NULL,
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,request_key)
);
CREATE TRIGGER phone_card_recharges_append_only BEFORE UPDATE OR DELETE ON phone_card_recharges FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER phone_card_recharge_versions_append_only BEFORE UPDATE OR DELETE ON phone_card_recharge_versions FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER phone_card_balances_append_only BEFORE UPDATE OR DELETE ON phone_card_balances FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER phone_card_reminders_append_only BEFORE UPDATE OR DELETE ON phone_card_reminder_versions FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER phone_card_operations_append_only BEFORE UPDATE OR DELETE ON phone_card_operation_receipts FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
