-- Individual equipment only. Products, samples, accounts and members retain their original tables.
CREATE TABLE equipment_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 asset_tag text NOT NULL CHECK(length(asset_tag) BETWEEN 1 AND 64),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 model text NOT NULL DEFAULT '' CHECK(length(model)<=200),
 keeper_member_id uuid REFERENCES members(id) ON DELETE RESTRICT,
 location text NOT NULL CHECK(length(location) BETWEEN 1 AND 150),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 status text NOT NULL DEFAULT 'available' CHECK(status IN('available','on_loan','maintenance','retired')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid NOT NULL REFERENCES accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX equipment_asset_tag_casefold ON equipment_assets(lower(asset_tag));
CREATE TABLE equipment_loans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 equipment_id uuid NOT NULL REFERENCES equipment_assets(id) ON DELETE RESTRICT,
 owner_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 shooting_request_id uuid REFERENCES shooting_requests(id) ON DELETE RESTRICT,
 shooting_title text,
 location text NOT NULL CHECK(length(location) BETWEEN 1 AND 150),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=2000),
 return_condition text CHECK(return_condition IN('ok','issue')),
 return_note text NOT NULL DEFAULT '' CHECK(length(return_note)<=2000),
 return_location text CHECK(return_location IS NULL OR length(return_location) BETWEEN 1 AND 150),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 borrowed_at timestamptz NOT NULL DEFAULT now(),
 returned_at timestamptz,
 CHECK((returned_at IS NULL AND return_condition IS NULL AND return_location IS NULL) OR (returned_at IS NOT NULL AND return_condition IS NOT NULL AND return_location IS NOT NULL))
);
CREATE UNIQUE INDEX equipment_one_open_loan ON equipment_loans(equipment_id) WHERE returned_at IS NULL;
CREATE INDEX equipment_loans_owner ON equipment_loans(owner_id,borrowed_at DESC,id);
CREATE TABLE equipment_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 equipment_id uuid NOT NULL REFERENCES equipment_assets(id) ON DELETE RESTRICT,
 loan_id uuid REFERENCES equipment_loans(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES accounts(id),
 action text NOT NULL CHECK(action IN('registered','edited','borrowed','returned','relocated','maintenance','ready','retired')),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=2000),
 before_value jsonb,
 after_value jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX equipment_events_asset ON equipment_events(equipment_id,created_at DESC,id);
CREATE TABLE equipment_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),
 request_key uuid NOT NULL,
 action text NOT NULL,
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,request_key)
);
