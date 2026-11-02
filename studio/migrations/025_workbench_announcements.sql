-- Independent restoration of the historical dashboard announcement board.
CREATE TABLE announcements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
 content text NOT NULL CHECK(length(content) BETWEEN 1 AND 3000),
 is_active boolean NOT NULL DEFAULT true,
 is_pinned boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 request_key uuid NOT NULL,
 request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz,
 UNIQUE(created_by,request_key)
);
CREATE INDEX announcements_board ON announcements(is_pinned DESC,created_at DESC,id) WHERE deleted_at IS NULL;
CREATE TABLE announcement_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 announcement_id uuid NOT NULL,
 actor_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
 action text NOT NULL CHECK(action IN('created','updated','deleted')),
 before_value jsonb,
 after_value jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX announcement_events_parent ON announcement_events(announcement_id,created_at,id);
