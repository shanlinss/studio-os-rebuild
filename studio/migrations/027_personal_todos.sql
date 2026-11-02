-- TodayPanel / DashboardPanel personal Todo; never a team dispatch table.
CREATE TABLE personal_todos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES accounts(id),
 request_key uuid NOT NULL,
 request_hash text NOT NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 task_type text NOT NULL CHECK(task_type IN('素材收集','内容策划','素材测试','数据回填','内容整理')),
 priority text NOT NULL CHECK(priority IN('高','中','低')),
 status text NOT NULL DEFAULT '待开始' CHECK(status IN('待开始','进行中','已完成','取消')),
 notes text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,request_key)
);
CREATE INDEX personal_todos_owner ON personal_todos(owner_id,created_at DESC,id) WHERE deleted_at IS NULL;
CREATE TABLE personal_todo_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 todo_id uuid NOT NULL REFERENCES personal_todos(id),
 actor_id uuid NOT NULL REFERENCES accounts(id),
 action text NOT NULL CHECK(action IN('created','updated','deleted')),
 detail jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
