CREATE TABLE equipment_store_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),equipment_id uuid NOT NULL REFERENCES equipment_assets(id),version integer NOT NULL CHECK(version>0),
 scope text NOT NULL CHECK(scope IN('public','store','unclassified')),store_id uuid REFERENCES stores(id),store_name text,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),actor_id uuid NOT NULL REFERENCES accounts(id),actor_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(equipment_id,version),CHECK((scope='store' AND store_id IS NOT NULL AND store_name IS NOT NULL) OR (scope<>'store' AND store_id IS NULL AND store_name IS NULL))
);
CREATE TABLE equipment_handover_account_reviews (
 handover_id uuid NOT NULL REFERENCES equipment_handovers(id),account_id uuid NOT NULL REFERENCES business_accounts(id),decision text NOT NULL CHECK(decision IN('keep','sync')),
 before_value jsonb NOT NULL,after_value jsonb NOT NULL,PRIMARY KEY(handover_id,account_id)
);
CREATE TABLE phone_card_plan_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),card_id uuid NOT NULL REFERENCES phone_cards(id),version integer NOT NULL CHECK(version>0),
 plan_name text NOT NULL CHECK(length(btrim(plan_name)) BETWEEN 1 AND 200),fixed_cents integer CHECK(fixed_cents>=0),cycle text NOT NULL CHECK(cycle IN('monthly','yearly','one-off','unknown')),
 billing_day integer CHECK(billing_day BETWEEN 1 AND 31),effective_on date NOT NULL,details text NOT NULL CHECK(length(details)<=2000),card_snapshot jsonb NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),actor_id uuid NOT NULL REFERENCES accounts(id),actor_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(card_id,version),CHECK(billing_day IS NULL OR cycle='monthly')
);
CREATE TABLE resource_profile_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),request_key uuid NOT NULL,kind text NOT NULL CHECK(kind IN('equipment-store','card-plan')),target_id uuid NOT NULL,
 request_hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(actor_id,request_key)
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['equipment_store_versions','equipment_handover_account_reviews','phone_card_plan_versions','resource_profile_receipts'] LOOP
 EXECUTE format('CREATE TRIGGER resource_profiles_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history()',t);
END LOOP; END $$;
