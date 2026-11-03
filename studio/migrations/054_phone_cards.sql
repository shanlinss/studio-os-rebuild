ALTER TABLE accounts DROP CONSTRAINT account_permission_names;
ALTER TABLE accounts ADD CONSTRAINT account_permission_names CHECK(admin_permissions <@ ARRAY['finance','account_security','payroll','personnel','resources','resource_identity']::text[] AND array_position(admin_permissions,NULL) IS NULL);
-- No automatic real-name grant, including for existing resource administrators.
CREATE TABLE phone_cards (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 card_code text NOT NULL CHECK(length(btrim(card_code)) BETWEEN 1 AND 64),
 phone_number text NOT NULL CHECK(length(phone_number) BETWEEN 3 AND 40),
 carrier text NOT NULL DEFAULT '' CHECK(length(carrier)<=100),
 status text NOT NULL DEFAULT 'spare' CHECK(status IN('active','spare','suspended','retired')),
 user_member_id uuid REFERENCES members(id) ON DELETE RESTRICT,
 device_id uuid REFERENCES equipment_assets(id) ON DELETE RESTRICT,
 store_id uuid REFERENCES stores(id) ON DELETE RESTRICT,
 plan_description text NOT NULL DEFAULT '' CHECK(length(plan_description)<=1000),
 plan_expires_on date CHECK(plan_expires_on>='0001-01-01'::date),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid NOT NULL REFERENCES accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX phone_cards_code ON phone_cards(lower(card_code));
CREATE UNIQUE INDEX phone_cards_current_number ON phone_cards(regexp_replace(phone_number,'[^0-9]','','g')) WHERE status<>'retired';
CREATE FUNCTION phone_card_permanent_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.card_code IS DISTINCT FROM OLD.card_code THEN
  RAISE EXCEPTION 'Phone card code is permanent' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER phone_cards_permanent_code BEFORE UPDATE ON phone_cards FOR EACH ROW EXECUTE FUNCTION phone_card_permanent_code();
CREATE TABLE phone_card_accounts (
 card_id uuid NOT NULL REFERENCES phone_cards(id) ON DELETE RESTRICT,
 account_id uuid NOT NULL REFERENCES business_accounts(id) ON DELETE RESTRICT,
 PRIMARY KEY(card_id,account_id)
);
CREATE INDEX phone_card_accounts_account ON phone_card_accounts(account_id,card_id);
CREATE TABLE phone_card_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 card_id uuid NOT NULL REFERENCES phone_cards(id),
 actor_id uuid NOT NULL REFERENCES accounts(id),
 actor_name text NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 before_value jsonb,
 after_value jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX phone_card_events_card ON phone_card_events(card_id,created_at DESC,id);
CREATE TRIGGER phone_card_events_append_only BEFORE UPDATE OR DELETE ON phone_card_events FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TABLE phone_card_identities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 card_id uuid NOT NULL REFERENCES phone_cards(id),
 version integer NOT NULL CHECK(version>0),
 card_snapshot jsonb NOT NULL,
 registered_entity text CHECK(length(btrim(registered_entity)) BETWEEN 1 AND 200),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 actor_id uuid NOT NULL REFERENCES accounts(id),
 actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(card_id,version)
);
CREATE TRIGGER phone_card_identities_append_only BEFORE UPDATE OR DELETE ON phone_card_identities FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TABLE phone_card_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),
 request_key uuid NOT NULL,
 action text NOT NULL,
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,request_key)
);
CREATE TRIGGER phone_card_receipts_append_only BEFORE UPDATE OR DELETE ON phone_card_receipts FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
