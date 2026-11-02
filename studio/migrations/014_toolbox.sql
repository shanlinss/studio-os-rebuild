CREATE TABLE toolbox_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 url text NOT NULL CHECK(length(url)<=2048),
 category text NOT NULL DEFAULT '' CHECK(length(category)<=60),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=2000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- Keep edit/delete audit after the original link is removed.
CREATE TABLE toolbox_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 link_id uuid NOT NULL,
 actor_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
 action text NOT NULL CHECK(action IN('created','updated','deleted')),
 before_value jsonb,
 after_value jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
