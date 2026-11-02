-- Infrastructure identity only. Domain tables will follow confirmed product rules.
CREATE TABLE installation (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO installation (singleton) VALUES (true);
