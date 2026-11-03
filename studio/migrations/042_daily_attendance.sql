-- One daily association to original attendance facts; no second clock or balance.
-- Do not merge or guess the meaning of legacy duplicate/missing periods.
CREATE TABLE attendance_daily_links (
 owner_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 work_date date NOT NULL,
 period_id uuid NOT NULL UNIQUE REFERENCES attendance_periods(id) ON DELETE RESTRICT,
 origin text NOT NULL CHECK(origin IN('login','legacy-adopted')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,work_date),
 FOREIGN KEY(period_id,owner_id) REFERENCES attendance_periods(id,owner_id)
);
CREATE TRIGGER attendance_daily_links_append_only BEFORE UPDATE OR DELETE ON attendance_daily_links
FOR EACH ROW EXECUTE FUNCTION keep_account_lifecycle_history();
