CREATE TABLE accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 username text UNIQUE NOT NULL CHECK (username ~ '^[a-z0-9][a-z0-9_.-]{2,63}$'),
 password_hash text NOT NULL,
 role text NOT NULL CHECK (role IN ('admin', 'employee')),
 active boolean NOT NULL DEFAULT true
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 csrf_token text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_account ON sessions(account_id);
CREATE TABLE login_limits (
 key text PRIMARY KEY,
 attempts integer NOT NULL,
 reset_at timestamptz NOT NULL
);
