-- Durable dispatch receipts; execution rows still live only in the existing tasks table.
CREATE TABLE lab_dispatch_requests (
 request_key uuid PRIMARY KEY,
 request_hash text NOT NULL CHECK(length(request_hash)=64),
 experiment_id uuid NOT NULL REFERENCES lab_experiments(id) ON DELETE CASCADE,
 plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 task_ids jsonb NOT NULL CHECK(jsonb_typeof(task_ids)='array'),
 result_version integer NOT NULL CHECK(result_version>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
