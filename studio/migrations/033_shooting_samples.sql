-- Shooting samples only: no sales, procurement, cost or payroll models.
CREATE TABLE shooting_samples (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 product_id uuid REFERENCES products(id) ON DELETE SET NULL,
 product_label text,
 warehouse_location text NOT NULL CHECK(length(warehouse_location) BETWEEN 1 AND 150),
 keeper_member_id uuid REFERENCES members(id) ON DELETE SET NULL,
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 available_quantity integer NOT NULL DEFAULT 0 CHECK(available_quantity>=0),
 active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid NOT NULL REFERENCES accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shooting_samples_catalog ON shooting_samples(active,created_at DESC,id);
CREATE TABLE shooting_sample_loans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sample_id uuid NOT NULL REFERENCES shooting_samples(id),
 owner_id uuid NOT NULL REFERENCES accounts(id),
 member_id uuid NOT NULL REFERENCES members(id),
 quantity integer NOT NULL CHECK(quantity>0),
 returned_quantity integer NOT NULL DEFAULT 0 CHECK(returned_quantity>=0 AND returned_quantity<=quantity),
 location text NOT NULL CHECK(length(location) BETWEEN 1 AND 150),
 shooting_request_id uuid REFERENCES shooting_requests(id) ON DELETE SET NULL,
 shooting_title text,
 note text NOT NULL DEFAULT '' CHECK(length(note)<=2000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shooting_sample_loans_owner ON shooting_sample_loans(owner_id,created_at DESC,id);
CREATE INDEX shooting_sample_loans_sample ON shooting_sample_loans(sample_id,created_at DESC,id);
CREATE TABLE shooting_sample_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sample_id uuid NOT NULL REFERENCES shooting_samples(id),
 loan_id uuid REFERENCES shooting_sample_loans(id),
 actor_id uuid NOT NULL REFERENCES accounts(id),
 actor_name text NOT NULL,
 action text NOT NULL CHECK(action IN('registered','edited','stock-in','borrowed','returned','stocktake','relocated')),
 quantity_delta integer NOT NULL,
 before_value jsonb,
 after_value jsonb NOT NULL,
 note text NOT NULL DEFAULT '' CHECK(length(note)<=2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX shooting_sample_events_sample ON shooting_sample_events(sample_id,created_at,id);
CREATE INDEX shooting_sample_events_loan ON shooting_sample_events(loan_id,created_at,id);
CREATE TABLE shooting_sample_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),
 request_key uuid NOT NULL,
 action text NOT NULL,
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,request_key)
);
