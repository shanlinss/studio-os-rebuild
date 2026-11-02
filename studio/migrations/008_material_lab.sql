CREATE TABLE lab_experiments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 hypothesis text NOT NULL DEFAULT '',
 direction text NOT NULL DEFAULT '',
 product text NOT NULL DEFAULT '',
 priority boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'testing' CHECK(status IN('testing','concluded')),
 verdict text CHECK(verdict IN('reusable','conditional','rejected','unclear')),
 finding text,
 recommendation text NOT NULL DEFAULT '',
 tags jsonb NOT NULL DEFAULT '[]',
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz
);
ALTER TABLE plans ADD COLUMN experiment_id uuid REFERENCES lab_experiments(id) ON DELETE RESTRICT;
ALTER TABLE plans ADD COLUMN round_no integer NOT NULL DEFAULT 1 CHECK(round_no>0);
ALTER TABLE plans ADD COLUMN adjustment text NOT NULL DEFAULT '';
ALTER TABLE plans ADD COLUMN test_variable text NOT NULL DEFAULT '';
ALTER TABLE plans ADD COLUMN planned_publish_on date;
-- Existing plans become actual round 1, without guessing a verdict or deleting data.
INSERT INTO lab_experiments(id,title,created_by,created_at) SELECT id,title,created_by,created_at FROM plans;
UPDATE plans SET experiment_id=id;
CREATE UNIQUE INDEX lab_round_number ON plans(experiment_id,round_no);
CREATE TABLE lab_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 experiment_id uuid NOT NULL REFERENCES lab_experiments(id) ON DELETE CASCADE,
 plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
 decision text NOT NULL CHECK(decision IN('表现好','有信号，继续验证','表现差','暂时无法判断')),
 note text NOT NULL,
 request_key uuid NOT NULL UNIQUE,
 request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE lab_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 experiment_id uuid NOT NULL REFERENCES lab_experiments(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
 action text NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Removing the last plan (e.g. a disposable fixture) cannot leave a ghost experiment.
-- This runs only on explicit plan deletion, never on a list/read request.
CREATE FUNCTION remove_empty_lab_experiment() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 DELETE FROM lab_experiments e WHERE e.id=OLD.experiment_id
   AND NOT EXISTS(SELECT 1 FROM plans p WHERE p.experiment_id=e.id);
 RETURN NULL;
END;
$$;
CREATE TRIGGER remove_empty_lab AFTER DELETE ON plans
 FOR EACH ROW EXECUTE FUNCTION remove_empty_lab_experiment();
ALTER TABLE data_snapshots ADD COLUMN product_clicks integer CHECK(product_clicks>=0);
ALTER TABLE data_snapshots ADD COLUMN add_to_cart integer CHECK(add_to_cart>=0);
ALTER TABLE data_snapshots ADD COLUMN conversions integer CHECK(conversions>=0);
ALTER TABLE data_snapshots DROP CONSTRAINT IF EXISTS data_snapshots_check;
ALTER TABLE data_snapshots ADD CONSTRAINT snapshot_some_metric CHECK(views IS NOT NULL OR likes IS NOT NULL OR favorites IS NOT NULL OR comments IS NOT NULL OR product_clicks IS NOT NULL OR add_to_cart IS NOT NULL OR conversions IS NOT NULL);
