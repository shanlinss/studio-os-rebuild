ALTER TABLE equipment_assets ADD COLUMN device_type text NOT NULL DEFAULT '' CHECK(length(device_type)<=80);
ALTER TABLE equipment_assets ADD COLUMN brand text NOT NULL DEFAULT '' CHECK(length(brand)<=100);
ALTER TABLE equipment_assets ADD COLUMN serial_number text NOT NULL DEFAULT '' CHECK(length(serial_number)<=150);
CREATE FUNCTION equipment_keep_asset_tag() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.asset_tag IS DISTINCT FROM OLD.asset_tag THEN
  RAISE EXCEPTION 'Equipment asset tag is permanent' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER equipment_permanent_tag BEFORE UPDATE ON equipment_assets FOR EACH ROW EXECUTE FUNCTION equipment_keep_asset_tag();
CREATE TABLE equipment_images (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 equipment_id uuid NOT NULL REFERENCES equipment_assets(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 mime text NOT NULL CHECK(mime IN('image/png','image/jpeg','image/gif','image/webp')),
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 8388608),
 digest text NOT NULL,
 actor_id uuid NOT NULL REFERENCES accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(equipment_id,id)
);
ALTER TABLE equipment_assets ADD COLUMN image_id uuid;
ALTER TABLE equipment_assets ADD CONSTRAINT equipment_current_image_owner FOREIGN KEY(id,image_id) REFERENCES equipment_images(equipment_id,id);
CREATE TRIGGER equipment_images_append_only BEFORE UPDATE OR DELETE ON equipment_images FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
ALTER TABLE equipment_loans DROP CONSTRAINT equipment_loans_return_condition_check;
ALTER TABLE equipment_loans ADD CONSTRAINT equipment_loans_return_condition_check CHECK(return_condition IN('ok','issue','handover'));
ALTER TABLE equipment_events DROP CONSTRAINT equipment_events_action_check;
ALTER TABLE equipment_events ADD CONSTRAINT equipment_events_action_check CHECK(action IN('registered','edited','borrowed','returned','relocated','maintenance','ready','retired','image-added','image-removed','handover'));
CREATE TABLE equipment_handovers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 equipment_id uuid NOT NULL REFERENCES equipment_assets(id) ON DELETE RESTRICT,
 previous_loan_id uuid UNIQUE REFERENCES equipment_loans(id) ON DELETE RESTRICT,
 new_loan_id uuid NOT NULL UNIQUE REFERENCES equipment_loans(id) ON DELETE RESTRICT,
 from_member_id uuid REFERENCES members(id) ON DELETE RESTRICT,
 to_member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 from_name text,
 to_name text NOT NULL,
 occurred_at timestamptz NOT NULL,
 condition text NOT NULL CHECK(length(btrim(condition)) BETWEEN 1 AND 500),
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 1 AND 2000),
 actor_id uuid NOT NULL REFERENCES accounts(id),
 actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((previous_loan_id IS NULL)=(from_member_id IS NULL)),
 CHECK((from_member_id IS NULL)=(from_name IS NULL)),
 CHECK(from_member_id IS DISTINCT FROM to_member_id),
 CHECK(previous_loan_id IS DISTINCT FROM new_loan_id)
);
CREATE INDEX equipment_handovers_asset ON equipment_handovers(equipment_id,occurred_at DESC,id);
CREATE TRIGGER equipment_handovers_append_only BEFORE UPDATE OR DELETE ON equipment_handovers FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
