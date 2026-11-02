CREATE TABLE expense_categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL UNIQUE CHECK(length(name) BETWEEN 1 AND 100 AND name=btrim(name)),
 active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE expense_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),expense_date date NOT NULL,
 store_id uuid REFERENCES stores(id) ON DELETE RESTRICT,
 category_id uuid REFERENCES expense_categories(id) ON DELETE RESTRICT,
 description text NOT NULL CHECK(length(description) BETWEEN 1 AND 2000),
 amount_cents integer NOT NULL CHECK(amount_cents>0),
 payment_mode text NOT NULL CHECK(payment_mode IN('advance','company')),
 payer_id uuid REFERENCES members(id) ON DELETE RESTRICT,
 note text NOT NULL DEFAULT '' CHECK(length(note)<=2000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 request_key uuid NOT NULL UNIQUE,request_hash text NOT NULL CHECK(length(request_hash)=64),
 created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((payment_mode='advance' AND payer_id IS NOT NULL) OR(payment_mode='company' AND payer_id IS NULL))
);
CREATE INDEX expense_records_date ON expense_records(expense_date);
CREATE TABLE expense_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),expense_id uuid NOT NULL REFERENCES expense_records(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 mime text NOT NULL CHECK(mime IN('image/png','image/jpeg','image/webp','image/gif')),
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 10485760),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expense_receipts_parent ON expense_receipts(expense_id);
CREATE TABLE expense_settlements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),payer_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 start_date date NOT NULL,end_date date NOT NULL,
 note text NOT NULL DEFAULT '' CHECK(length(note)<=2000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 request_key uuid NOT NULL UNIQUE,request_hash text NOT NULL CHECK(length(request_hash)=64),
 created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(start_date<=end_date),UNIQUE(id,payer_id)
);
CREATE TABLE expense_settlement_items (
 expense_id uuid PRIMARY KEY REFERENCES expense_records(id) ON DELETE RESTRICT,
 settlement_id uuid NOT NULL REFERENCES expense_settlements(id) ON DELETE RESTRICT,
 amount_cents integer NOT NULL CHECK(amount_cents>0)
);
CREATE INDEX expense_settlement_items_parent ON expense_settlement_items(settlement_id);
CREATE TABLE expense_reimbursements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),payer_id uuid NOT NULL,
 settlement_id uuid NOT NULL,
 amount_cents integer NOT NULL CHECK(amount_cents>0),paid_date date NOT NULL,
 note text NOT NULL DEFAULT '' CHECK(length(note)<=2000),
 request_key uuid NOT NULL UNIQUE,request_hash text NOT NULL CHECK(length(request_hash)=64),
 created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(settlement_id,payer_id) REFERENCES expense_settlements(id,payer_id) ON DELETE RESTRICT
);
CREATE INDEX expense_reimbursements_parent ON expense_reimbursements(settlement_id);
CREATE TABLE expense_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),entity_type text NOT NULL CHECK(entity_type IN('category','expense','settlement','payment','receipt')),
 entity_id uuid NOT NULL,actor_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
 action text NOT NULL,detail jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
