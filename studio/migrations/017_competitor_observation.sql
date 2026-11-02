CREATE TABLE competitor_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 xhs_id text NOT NULL UNIQUE CHECK(length(xhs_id) BETWEEN 1 AND 100),
 profile_url text,
 status text NOT NULL DEFAULT '普通观察' CHECK(status IN('重点观察','普通观察','暂停观察')),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE competitor_store_links (
 competitor_id uuid NOT NULL REFERENCES competitor_accounts(id) ON DELETE CASCADE,
 store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
 PRIMARY KEY(competitor_id,store_id)
);
CREATE TABLE competitor_product_links (
 competitor_id uuid NOT NULL REFERENCES competitor_accounts(id) ON DELETE CASCADE,
 product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
 PRIMARY KEY(competitor_id,product_id)
);
CREATE TABLE competitor_sub_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 competitor_id uuid NOT NULL REFERENCES competitor_accounts(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 xhs_id text NOT NULL UNIQUE CHECK(length(xhs_id) BETWEEN 1 AND 100),
 profile_url text,notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(competitor_id,id)
);
CREATE TABLE competitor_products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 competitor_id uuid NOT NULL REFERENCES competitor_accounts(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),product_url text,
 linked_product_id uuid REFERENCES products(id) ON DELETE RESTRICT,
 price_cents integer CHECK(price_cents>=0),notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(competitor_id,id)
);
CREATE TABLE competitor_sales_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 competitor_id uuid NOT NULL REFERENCES competitor_accounts(id) ON DELETE CASCADE,
 product_id uuid NOT NULL,
 snapshot_date date NOT NULL,sales integer NOT NULL CHECK(sales>=0),
 price_cents integer CHECK(price_cents>=0),
 created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(competitor_id,product_id) REFERENCES competitor_products(competitor_id,id) ON DELETE CASCADE,
 UNIQUE(product_id,snapshot_date)
);
CREATE TABLE competitor_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 competitor_id uuid NOT NULL REFERENCES competitor_accounts(id) ON DELETE CASCADE,
 sub_account_id uuid,
 observation_date date NOT NULL,content text NOT NULL CHECK(length(content) BETWEEN 1 AND 4000),
 created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(competitor_id,sub_account_id) REFERENCES competitor_sub_accounts(competitor_id,id) ON DELETE CASCADE,
 UNIQUE(competitor_id,id)
);
CREATE TABLE competitor_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 competitor_id uuid NOT NULL REFERENCES competitor_accounts(id) ON DELETE CASCADE,
 sub_account_id uuid,product_id uuid,observation_id uuid,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 mime text NOT NULL CHECK(mime IN('image/png','image/jpeg','image/webp','image/gif')),
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 8388608),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(num_nonnulls(sub_account_id,product_id,observation_id)<=1),
 FOREIGN KEY(competitor_id,sub_account_id) REFERENCES competitor_sub_accounts(competitor_id,id) ON DELETE CASCADE,
 FOREIGN KEY(competitor_id,product_id) REFERENCES competitor_products(competitor_id,id) ON DELETE CASCADE,
 FOREIGN KEY(competitor_id,observation_id) REFERENCES competitor_observations(competitor_id,id) ON DELETE CASCADE
);
CREATE INDEX competitor_files_parent ON competitor_files(competitor_id);
CREATE TABLE competitor_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),competitor_id uuid NOT NULL,
 actor_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
 action text NOT NULL,detail jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
