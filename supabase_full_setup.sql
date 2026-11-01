-- ================================================================
-- SMART PDS — ANNOPRAVAH : COMPLETE SUPABASE SETUP (RUN ONCE)
-- ================================================================
-- One file to rule them all:  schema + triggers + views + seed
-- data + production Row-Level Security.
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste this
--   entire file -> Run.  Wait for "Success. No rows returned".
--
-- ⚠️  THIS IS A DESTRUCTIVE RESET
--   It drops and recreates all 8 public tables and re-seeds the 9
--   demo accounts.  Any data you created by hand in the dashboard
--   will be gone.  (For a NON-destructive lockdown that keeps all
--   existing rows, run supabase_rls.sql instead.)
--
-- WHY THIS FILE EXISTS
--   * supabase_schema.sql lacked the live users.business_id column
--     (Manage Users / Manage Stock depend on it) -> added here.
--   * vw_overdue_grievances joined users.id = grievance.beneficiary_id
--     (a ration-card ID) -> never matched a row -> fixed here.
--   * All 3 views now use security_invoker so they respect RLS.
--   * RLS policies from supabase_rls.sql are included at the end.
--
-- SAFE TO RE-RUN: every step is idempotent (drop-if-exists,
-- create-or-replace, on-conflict-do-nothing).
-- ================================================================


-- ================================================================
-- PART A — CLEAN SLATE
-- ================================================================

DROP TABLE IF EXISTS audit_log       CASCADE;
DROP TABLE IF EXISTS grievances      CASCADE;
DROP TABLE IF EXISTS stock_receipts  CASCADE;
DROP TABLE IF EXISTS alerts          CASCADE;
DROP TABLE IF EXISTS transactions    CASCADE;
DROP TABLE IF EXISTS inventory       CASCADE;
DROP TABLE IF EXISTS beneficiaries   CASCADE;
DROP TABLE IF EXISTS users           CASCADE;
DROP VIEW  IF EXISTS vw_monthly_distribution;
DROP VIEW  IF EXISTS vw_overdue_grievances;
DROP VIEW  IF EXISTS vw_inventory_reconciliation;

-- Remove the previous demo auth accounts (they get re-created in
-- PART D with fresh UUIDs and the same emails/passwords).
DELETE FROM auth.users WHERE email LIKE '%@pds.gov.in';


-- ================================================================
-- PART B — EXTENSIONS, TABLES, INDEXES
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- TABLE 1: USERS
-- Portal identity for all three roles:
-- admin (warehouse officer), dealer (FPS shop), beneficiary (citizen)
-- business_id: dealers hold their FPS code (N2001...),
--              beneficiaries hold their ration-card ID (R-P1001...)

CREATE TABLE users (
    id                   TEXT PRIMARY KEY,
    name                 TEXT        NOT NULL,
    role                 TEXT        NOT NULL
                             CHECK (role IN ('admin', 'dealer', 'beneficiary')),
    business_id          TEXT,
    shop_name            TEXT,
    zone                 TEXT,
    state                TEXT,
    city                 TEXT,
    area                 TEXT,
    associated_dealer_id TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- TABLE 2: BENEFICIARIES
-- One row per ration-card household

CREATE TABLE beneficiaries (
    id               TEXT        PRIMARY KEY,
    name             TEXT        NOT NULL,
    family_size      INTEGER     NOT NULL DEFAULT 1,
    entitlement      JSONB       NOT NULL DEFAULT '{}',
    assigned_shop_id TEXT        REFERENCES users(id) ON DELETE SET NULL,
    category         TEXT        NOT NULL DEFAULT 'PHH'
                         CHECK (category IN ('PHH', 'AAY', 'NFSA')),
    mobile_last4     TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- TABLE 3: INVENTORY
-- Stock batches — central warehouse -> FPS shop

CREATE TABLE inventory (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id             TEXT        NOT NULL UNIQUE,
    name                 TEXT        NOT NULL,
    quantity             NUMERIC     NOT NULL CHECK (quantity >= 0),
    unit                 TEXT        NOT NULL DEFAULT 'KG',
    bags_count           INTEGER     NOT NULL DEFAULT 0,
    source               TEXT,
    destination_shop_id  TEXT        REFERENCES users(id) ON DELETE SET NULL,
    owner_id             TEXT        NOT NULL,
    status               TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'pending_approval', 'received', 'exhausted')),
    expiry               TEXT,
    dispatch_date        TIMESTAMPTZ,
    approved_by          TEXT,
    approved_at          TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- TABLE 4: TRANSACTIONS
-- Every POS distribution event at an FPS shop
-- NOTE: the timestamp column is called created_at (the frontend
--       previously referenced a nonexistent "timestamp" column).

CREATE TABLE transactions (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    beneficiary_id TEXT        NOT NULL REFERENCES beneficiaries(id) ON DELETE RESTRICT,
    dealer_id      TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    items          JSONB       NOT NULL DEFAULT '{}',
    batch_mappings JSONB,
    otp_verified   BOOLEAN     NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- TABLE 5: ALERTS
-- Fraud / anomaly alerts raised by the system, dealers or citizens

CREATE TABLE alerts (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id     TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT        NOT NULL
                    CHECK (type IN ('STOCK_MISMATCH', 'GHOST_USER',
                                    'ABNORMAL_SPIKE', 'CROSS_SHOP',
                                    'OVERDUE_GRIEVANCE', 'OTHER')),
    severity    TEXT        NOT NULL
                    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    description TEXT        NOT NULL,
    status      TEXT        NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'resolved')),
    assigned_to TEXT,
    resolved_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- TABLE 6: STOCK RECEIPTS
-- Log of every bag scanned during inward scanning at an FPS

CREATE TABLE stock_receipts (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id    TEXT        NOT NULL,
    item_name   TEXT        NOT NULL,
    quantity    NUMERIC     NOT NULL CHECK (quantity >= 0),
    dealer_id   TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    matched     BOOLEAN     NOT NULL DEFAULT true,
    scanned_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- TABLE 7: GRIEVANCES
-- Citizen complaints — filed, tracked, escalated, resolved

CREATE TABLE grievances (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id  TEXT,
    beneficiary_id  TEXT        NOT NULL REFERENCES beneficiaries(id) ON DELETE RESTRICT,
    fps_shop_id     TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    issue_type      TEXT        NOT NULL
                        CHECK (issue_type IN (
                            'not_received',
                            'short_weight',
                            'extra_payment',
                            'wrong_commodity',
                            'other'
                        )),
    description     TEXT,
    status          TEXT        NOT NULL DEFAULT 'filed'
                        CHECK (status IN ('filed', 'under_review', 'resolved', 'escalated')),
    assigned_to     TEXT,
    resolution_note TEXT,
    filed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ,
    escalated_at    TIMESTAMPTZ
);


-- TABLE 8: AUDIT LOG
-- Append-only tamper-proof actor trail.
-- No UPDATE or DELETE ever allowed on this table.

CREATE TABLE audit_log (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id   TEXT,
    actor_role TEXT,
    action     TEXT        NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    table_name TEXT        NOT NULL,
    row_id     TEXT,
    old_value  JSONB,
    new_value  JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------------------- INDEXES -------------------------------

CREATE INDEX idx_users_business        ON users(business_id);
CREATE INDEX idx_users_role            ON users(role);
CREATE INDEX idx_beneficiaries_shop    ON beneficiaries(assigned_shop_id);
CREATE INDEX idx_inventory_owner       ON inventory(owner_id);
CREATE INDEX idx_inventory_dest_shop   ON inventory(destination_shop_id);
CREATE INDEX idx_inventory_status      ON inventory(status);
CREATE INDEX idx_inventory_batch       ON inventory(batch_id);
CREATE INDEX idx_transactions_ben      ON transactions(beneficiary_id);
CREATE INDEX idx_transactions_dealer   ON transactions(dealer_id);
CREATE INDEX idx_transactions_date     ON transactions(created_at DESC);
CREATE INDEX idx_alerts_shop           ON alerts(shop_id);
CREATE INDEX idx_alerts_status         ON alerts(status);
CREATE INDEX idx_stock_receipts_batch  ON stock_receipts(batch_id);
CREATE INDEX idx_stock_receipts_dealer ON stock_receipts(dealer_id);
CREATE INDEX idx_grievances_ben        ON grievances(beneficiary_id);
CREATE INDEX idx_grievances_shop       ON grievances(fps_shop_id);
CREATE INDEX idx_grievances_status     ON grievances(status);
CREATE INDEX idx_audit_actor           ON audit_log(actor_id);
CREATE INDEX idx_audit_table           ON audit_log(table_name);
CREATE INDEX idx_audit_created         ON audit_log(created_at DESC);


-- ================================================================
-- PART C — AUDIT TRIGGER (append-only tamper trail)
-- ================================================================
-- SECURITY DEFINER owned by postgres (table owner) -> the trigger
-- writes into audit_log even while RLS locks that table to admins.

CREATE OR REPLACE FUNCTION fn_audit_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        INSERT INTO audit_log (action, table_name, row_id, new_value)
        VALUES ('INSERT', TG_TABLE_NAME, NEW.id::TEXT, to_jsonb(NEW));
        RETURN NEW;
    ELSIF (TG_OP = 'UPDATE') THEN
        INSERT INTO audit_log (action, table_name, row_id, old_value, new_value)
        VALUES ('UPDATE', TG_TABLE_NAME, NEW.id::TEXT, to_jsonb(OLD), to_jsonb(NEW));
        RETURN NEW;
    ELSIF (TG_OP = 'DELETE') THEN
        INSERT INTO audit_log (action, table_name, row_id, old_value)
        VALUES ('DELETE', TG_TABLE_NAME, OLD.id::TEXT, to_jsonb(OLD));
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_audit_users
    AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_audit_beneficiaries
    AFTER INSERT OR UPDATE OR DELETE ON beneficiaries
    FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_audit_inventory
    AFTER INSERT OR UPDATE OR DELETE ON inventory
    FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_audit_transactions
    AFTER INSERT OR UPDATE OR DELETE ON transactions
    FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_audit_alerts
    AFTER INSERT OR UPDATE OR DELETE ON alerts
    FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_audit_grievances
    AFTER INSERT OR UPDATE OR DELETE ON grievances
    FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();


-- ================================================================
-- PART D — ROW LEVEL SECURITY (fail closed)
-- ================================================================
-- RLS enabled with NO policies yet = closed to anon/authenticated.
-- Real policies are attached in PART F below.

ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE beneficiaries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory      ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE grievances     ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log      ENABLE ROW LEVEL SECURITY;


-- ================================================================
-- PART E — VIEWS (security_invoker = per-caller RLS applies)
-- ================================================================

CREATE VIEW vw_monthly_distribution
WITH (security_invoker = true) AS
SELECT
    t.dealer_id,
    u.shop_name,
    DATE_TRUNC('month', t.created_at) AS month,
    COUNT(*)                          AS transaction_count,
    SUM((t.items->>'rice')::NUMERIC)  AS rice_kg,
    SUM((t.items->>'wheat')::NUMERIC) AS wheat_kg,
    SUM((t.items->>'sugar')::NUMERIC) AS sugar_kg
FROM transactions t
JOIN users u ON u.id = t.dealer_id
GROUP BY t.dealer_id, u.shop_name, DATE_TRUNC('month', t.created_at);

-- FIXED: beneficiary name now comes from beneficiaries, not users
CREATE VIEW vw_overdue_grievances
WITH (security_invoker = true) AS
SELECT
    g.*,
    b.name  AS beneficiary_name,
    s.shop_name
FROM grievances g
JOIN beneficiaries b ON b.id = g.beneficiary_id
JOIN users s ON s.id = g.fps_shop_id
WHERE g.status IN ('filed', 'under_review')
  AND g.filed_at < now() - INTERVAL '10 days';

CREATE VIEW vw_inventory_reconciliation
WITH (security_invoker = true) AS
SELECT
    i.owner_id        AS shop_id,
    u.shop_name,
    i.name            AS commodity,
    i.batch_id,
    i.quantity        AS dispatched_kg,
    COALESCE(SUM((t.items->>LOWER(i.name))::NUMERIC), 0) AS distributed_kg,
    i.quantity - COALESCE(SUM((t.items->>LOWER(i.name))::NUMERIC), 0) AS variance_kg
FROM inventory i
JOIN users u ON u.id = i.owner_id
LEFT JOIN transactions t ON t.dealer_id = i.owner_id
WHERE i.status = 'received'
GROUP BY i.owner_id, u.shop_name, i.name, i.batch_id, i.quantity;


-- ================================================================
-- PART F — SEED DEMO DATA
-- ================================================================
-- Runs as the postgres table owner, so it works even with RLS on.

-- Helper: create a Supabase Auth user + matching public.users row
CREATE OR REPLACE FUNCTION create_demo_user(
  user_email TEXT,
  user_pass TEXT,
  user_name TEXT,
  user_role TEXT,
  user_business_id TEXT,
  user_shop_name TEXT DEFAULT NULL,
  user_zone TEXT DEFAULT NULL,
  user_state TEXT DEFAULT NULL,
  user_city TEXT DEFAULT NULL,
  user_area TEXT DEFAULT NULL,
  user_assoc_dealer TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  new_user_id UUID;
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, last_sign_in_at, raw_app_meta_data,
    raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    user_email,
    crypt(user_pass, gen_salt('bf')),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', user_name),
    now(),
    now(),
    '', '', '', ''
  )
  RETURNING id INTO new_user_id;

  INSERT INTO public.users (
    id, name, role, business_id, shop_name, zone, state, city, area, associated_dealer_id
  ) VALUES (
    new_user_id::TEXT, user_name, user_role, user_business_id,
    user_shop_name, user_zone, user_state, user_city, user_area, user_assoc_dealer
  );
END;
$$ LANGUAGE plpgsql;

-- 1. Admin
SELECT create_demo_user('admin@pds.gov.in', 'ADMIN@123', 'Central Administrator', 'admin', 'ADMIN');

-- 2. Dealers (FPS shops)
SELECT create_demo_user('n2001@pds.gov.in', 'Dealer@123', 'Yuvraj Singh',   'dealer', 'N2001', 'Punjab Grocery',  'North',    'Punjab',       'Amritsar', 'Ranjit Avenue');
SELECT create_demo_user('s2002@pds.gov.in', 'Dealer@123', 'Vijay',          'dealer', 'S2002', 'Kochi Grocery',   'South',    'Kerela',      'Kochi',    'MG road');
SELECT create_demo_user('e2003@pds.gov.in', 'Dealer@123', 'Amish Singh',    'dealer', 'E2003', 'Guwahati Grocery','East',     'Assam',       'Guwahati', 'GS road');
SELECT create_demo_user('w2004@pds.gov.in', 'Dealer@123', 'Paresh Shah',    'dealer', 'W2004', 'Vadodara Grocery','West',     'Gujarat',     'Vadodara', 'Sama');
SELECT create_demo_user('c2005@pds.gov.in', 'Dealer@123', 'Shailendra Sharma','dealer','C2005', 'MP Grocery',      'Central',  'Madhya Pradesh','Indore', 'Vijay Nagar');

-- 3. Beneficiaries with login accounts
SELECT create_demo_user('rp1001@pds.gov.in', 'User@123', 'Kapil Singh', 'beneficiary', 'R-P1001', 'Punjab Grocery',  NULL, NULL, NULL, NULL, 'N2001');
SELECT create_demo_user('rk1001@pds.gov.in', 'User@123', 'Raju',        'beneficiary', 'R-K1001', 'Kochi Grocery',   NULL, NULL, NULL, NULL, 'S2002');
SELECT create_demo_user('rg1001@pds.gov.in', 'User@123', 'Amit',        'beneficiary', 'R-G1001', 'Guwahati Grocery',NULL, NULL, NULL, NULL, 'E2003');

-- 4. Beneficiary registry (ration cards)
INSERT INTO beneficiaries (id, name, family_size, entitlement, assigned_shop_id) VALUES
('R-P1001', 'Kapil Singh',      4, '{"rice": 20, "wheat": 15, "sugar": 2, "oil": 2}', (SELECT id FROM users WHERE name = 'Yuvraj Singh' LIMIT 1)),
('R-P1002', 'Gurpreet Dosanjh', 3, '{"rice": 15, "wheat": 10, "sugar": 1, "oil": 1}', (SELECT id FROM users WHERE name = 'Yuvraj Singh' LIMIT 1)),
('R-P1003', 'Balwinder Singh',  5, '{"rice": 25, "wheat": 20, "sugar": 3, "oil": 2}', (SELECT id FROM users WHERE name = 'Yuvraj Singh' LIMIT 1)),
('R-K1001', 'Raju',             2, '{"rice": 10, "wheat": 8,  "sugar": 1, "oil": 1}', (SELECT id FROM users WHERE name = 'Vijay' LIMIT 1)),
('R-K1002', 'Ramswami',         4, '{"rice": 20, "wheat": 15, "sugar": 2, "oil": 2}', (SELECT id FROM users WHERE name = 'Vijay' LIMIT 1)),
('R-G1001', 'Amit',             4, '{"rice": 20, "wheat": 15, "sugar": 2, "oil": 2}', (SELECT id FROM users WHERE name = 'Amish Singh' LIMIT 1))
ON CONFLICT (id) DO NOTHING;

-- 5. Central depot stock
INSERT INTO inventory (name, quantity, unit, batch_id, source, owner_id, status, expiry) VALUES
('Rice',  5000,  'KG', 'B-RICE-001',  'Central Depot', (SELECT id FROM users WHERE role = 'admin' LIMIT 1), 'received', '2027-12-31'),
('Wheat', 10000, 'KG', 'B-WHEAT-001', 'Central Depot', (SELECT id FROM users WHERE role = 'admin' LIMIT 1), 'received', '2027-12-31'),
('Sugar', 2000,  'KG', 'B-SUGAR-001', 'Nafed Store',   (SELECT id FROM users WHERE role = 'admin' LIMIT 1), 'received', '2026-06-30')
ON CONFLICT (batch_id) DO NOTHING;

-- 6. Stock already deployed to shops
INSERT INTO inventory (name, quantity, unit, batch_id, source, owner_id, status) VALUES
('Rice',  800,  'KG', 'B-PUN-001', 'Central Depot', (SELECT id FROM users WHERE name = 'Yuvraj Singh' LIMIT 1), 'received'),
('Wheat', 1200, 'KG', 'B-PUN-002', 'Central Depot', (SELECT id FROM users WHERE name = 'Yuvraj Singh' LIMIT 1), 'received'),
('Rice',  1200, 'KG', 'B-KOC-001', 'Central Depot', (SELECT id FROM users WHERE name = 'Vijay' LIMIT 1),       'received'),
('Wheat', 800,  'KG', 'B-KOC-002', 'Central Depot', (SELECT id FROM users WHERE name = 'Vijay' LIMIT 1),       'received'),
('Rice',  950,  'KG', 'B-GUW-001', 'Central Depot', (SELECT id FROM users WHERE name = 'Amish Singh' LIMIT 1),  'received'),
('Wheat', 1100, 'KG', 'B-GUW-002', 'Central Depot', (SELECT id FROM users WHERE name = 'Amish Singh' LIMIT 1),  'received')
ON CONFLICT (batch_id) DO NOTHING;

-- 7. Sample distribution history (so dashboards & charts aren't empty)
INSERT INTO transactions (beneficiary_id, dealer_id, items, batch_mappings, otp_verified, created_at) VALUES
('R-P1001', (SELECT id FROM users WHERE name = 'Yuvraj Singh' LIMIT 1),
 '{"rice":10,"wheat":8,"sugar":1,"oil":1}',
 '[{"batch_id":"B-PUN-001","item":"Rice","quantity":10},{"batch_id":"B-PUN-002","item":"Wheat","quantity":8}]',
 true, now() - INTERVAL '45 days'),
('R-P1002', (SELECT id FROM users WHERE name = 'Yuvraj Singh' LIMIT 1),
 '{"rice":8,"wheat":5,"sugar":1,"oil":1}',
 '[{"batch_id":"B-PUN-001","item":"Rice","quantity":8}]',
 true, now() - INTERVAL '20 days'),
('R-P1001', (SELECT id FROM users WHERE name = 'Yuvraj Singh' LIMIT 1),
 '{"rice":10,"wheat":8,"sugar":1,"oil":1}',
 '[{"batch_id":"B-PUN-001","item":"Rice","quantity":10}]',
 true, now() - INTERVAL '3 days'),
('R-K1001', (SELECT id FROM users WHERE name = 'Vijay' LIMIT 1),
 '{"rice":5,"wheat":4,"sugar":1,"oil":1}',
 '[{"batch_id":"B-KOC-001","item":"Rice","quantity":5}]',
 true, now() - INTERVAL '12 days'),
('R-G1001', (SELECT id FROM users WHERE name = 'Amish Singh' LIMIT 1),
 '{"rice":10,"wheat":6,"sugar":2,"oil":1}',
 '[{"batch_id":"B-GUW-001","item":"Rice","quantity":10}]',
 true, now() - INTERVAL '6 days');

-- 8. Sample fraud alerts (so the Fraud Alerts page isn't empty)
INSERT INTO alerts (shop_id, type, severity, description, status, resolved_at) VALUES
((SELECT id FROM users WHERE name = 'Vijay' LIMIT 1),
 'STOCK_MISMATCH', 'high',
 'Inward scan found 2 damaged Rice bags in batch B-KOC-001 (dispatched 1200 KG, received 1180 KG).',
 'open', NULL),
((SELECT id FROM users WHERE name = 'Yuvraj Singh' LIMIT 1),
 'ABNORMAL_SPIKE', 'medium',
 'Distribution volume for R-P1001 was 3.2x the monthly average in the last cycle.',
 'resolved', now() - INTERVAL '2 days');


-- ================================================================
-- PART G — RLS HELPERS (no recursion, bypass RLS internally)
-- ================================================================

-- Role of the signed-in user: 'admin' | 'dealer' | 'beneficiary'
CREATE OR REPLACE FUNCTION public.app_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid()::text;
$$;

-- Ration-card ID (e.g. 'R-P1001') of the signed-in beneficiary.
-- Mirrors the frontend link: users.name = beneficiaries.name.
CREATE OR REPLACE FUNCTION public.app_beneficiary_id()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id
  FROM public.beneficiaries b
  JOIN public.users u ON u.name = b.name
  WHERE u.id = auth.uid()::text
  LIMIT 1;
$$;

-- Shop UUID the signed-in user belongs to:
--   dealer      -> their own users.id
--   beneficiary -> their card's assigned_shop_id
CREATE OR REPLACE FUNCTION public.app_my_shop()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN u.role = 'dealer' THEN u.id
    ELSE (
      SELECT b.assigned_shop_id
      FROM public.beneficiaries b
      JOIN public.users u2 ON u2.name = b.name
      WHERE u2.id = auth.uid()::text
      LIMIT 1
    )
  END
  FROM public.users u
  WHERE u.id = auth.uid()::text;
$$;

REVOKE EXECUTE ON FUNCTION public.app_role()           FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_beneficiary_id() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_my_shop()        FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.app_role()           TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.app_beneficiary_id() TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.app_my_shop()        TO authenticated, service_role;


-- ================================================================
-- PART H — RLS POLICIES (role-based)
-- ================================================================

-- users: read own row or all (admin); write admin only
CREATE POLICY users_select_self_or_admin ON users
  FOR SELECT TO authenticated
  USING (id = auth.uid()::text OR public.app_role() = 'admin');

CREATE POLICY users_admin_all ON users
  FOR ALL TO authenticated
  USING (public.app_role() = 'admin')
  WITH CHECK (public.app_role() = 'admin');

-- beneficiaries: admin all; dealer own-shop cards; self own card
CREATE POLICY beneficiaries_admin_all ON beneficiaries
  FOR ALL TO authenticated
  USING (public.app_role() = 'admin')
  WITH CHECK (public.app_role() = 'admin');

CREATE POLICY beneficiaries_dealer_read ON beneficiaries
  FOR SELECT TO authenticated
  USING (public.app_role() = 'dealer' AND assigned_shop_id = auth.uid()::text);

CREATE POLICY beneficiaries_self_read ON beneficiaries
  FOR SELECT TO authenticated
  USING (public.app_role() = 'beneficiary' AND id = public.app_beneficiary_id());

-- inventory: admin all; dealer own/destined rows (read+update);
--            beneficiary read received stock of assigned shop
CREATE POLICY inventory_admin_all ON inventory
  FOR ALL TO authenticated
  USING (public.app_role() = 'admin')
  WITH CHECK (public.app_role() = 'admin');

CREATE POLICY inventory_dealer_read ON inventory
  FOR SELECT TO authenticated
  USING (
    public.app_role() = 'dealer'
    AND (owner_id = auth.uid()::text OR destination_shop_id = auth.uid()::text)
  );

CREATE POLICY inventory_dealer_update ON inventory
  FOR UPDATE TO authenticated
  USING (
    public.app_role() = 'dealer'
    AND (owner_id = auth.uid()::text OR destination_shop_id = auth.uid()::text)
  )
  WITH CHECK (
    public.app_role() = 'dealer'
    AND (owner_id = auth.uid()::text OR destination_shop_id = auth.uid()::text)
  );

CREATE POLICY inventory_beneficiary_read ON inventory
  FOR SELECT TO authenticated
  USING (
    public.app_role() = 'beneficiary'
    AND status = 'received'
    AND owner_id = public.app_my_shop()
  );

-- transactions: admin all; dealer own sales + insert own-shop cards
--               only (blocks cross-shop distribution at DB level);
--               beneficiary own history
CREATE POLICY transactions_admin_all ON transactions
  FOR ALL TO authenticated
  USING (public.app_role() = 'admin')
  WITH CHECK (public.app_role() = 'admin');

CREATE POLICY transactions_dealer_read ON transactions
  FOR SELECT TO authenticated
  USING (public.app_role() = 'dealer' AND dealer_id = auth.uid()::text);

CREATE POLICY transactions_dealer_insert ON transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.app_role() = 'dealer'
    AND dealer_id = auth.uid()::text
    AND beneficiary_id IN (
      SELECT b.id FROM public.beneficiaries b
      WHERE b.assigned_shop_id = auth.uid()::text
    )
  );

CREATE POLICY transactions_beneficiary_read ON transactions
  FOR SELECT TO authenticated
  USING (public.app_role() = 'beneficiary' AND beneficiary_id = public.app_beneficiary_id());

-- alerts: admin all; dealer read+insert own shop; beneficiary may
--         file a report against their own shop
CREATE POLICY alerts_admin_all ON alerts
  FOR ALL TO authenticated
  USING (public.app_role() = 'admin')
  WITH CHECK (public.app_role() = 'admin');

CREATE POLICY alerts_dealer_read ON alerts
  FOR SELECT TO authenticated
  USING (public.app_role() = 'dealer' AND shop_id = auth.uid()::text);

CREATE POLICY alerts_dealer_insert ON alerts
  FOR INSERT TO authenticated
  WITH CHECK (public.app_role() = 'dealer' AND shop_id = auth.uid()::text);

CREATE POLICY alerts_beneficiary_insert ON alerts
  FOR INSERT TO authenticated
  WITH CHECK (public.app_role() = 'beneficiary' AND shop_id = public.app_my_shop());

-- stock_receipts: admin all; dealer own inward-scan log
CREATE POLICY stock_receipts_admin_all ON stock_receipts
  FOR ALL TO authenticated
  USING (public.app_role() = 'admin')
  WITH CHECK (public.app_role() = 'admin');

CREATE POLICY stock_receipts_dealer_read ON stock_receipts
  FOR SELECT TO authenticated
  USING (public.app_role() = 'dealer' AND dealer_id = auth.uid()::text);

CREATE POLICY stock_receipts_dealer_insert ON stock_receipts
  FOR INSERT TO authenticated
  WITH CHECK (public.app_role() = 'dealer' AND dealer_id = auth.uid()::text);

-- grievances: admin all; beneficiary own; dealer their shop
CREATE POLICY grievances_admin_all ON grievances
  FOR ALL TO authenticated
  USING (public.app_role() = 'admin')
  WITH CHECK (public.app_role() = 'admin');

CREATE POLICY grievances_beneficiary_read ON grievances
  FOR SELECT TO authenticated
  USING (public.app_role() = 'beneficiary' AND beneficiary_id = public.app_beneficiary_id());

CREATE POLICY grievances_beneficiary_insert ON grievances
  FOR INSERT TO authenticated
  WITH CHECK (public.app_role() = 'beneficiary' AND beneficiary_id = public.app_beneficiary_id());

CREATE POLICY grievances_dealer_read ON grievances
  FOR SELECT TO authenticated
  USING (public.app_role() = 'dealer' AND fps_shop_id = auth.uid()::text);

-- audit_log: admin READ only; nobody writes from the client
--            (the SECURITY DEFINER trigger keeps appending)
CREATE POLICY audit_log_admin_select ON audit_log
  FOR SELECT TO authenticated
  USING (public.app_role() = 'admin');


-- ================================================================
-- PART I — GRANTS & REVOKE anon (defense in depth)
-- ================================================================
-- Keep authenticated/service_role table privileges (RLS gates the
-- rows); cut the anon key off completely.  The frontend never
-- queries tables before login, so anon needs nothing.

GRANT USAGE  ON SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE USAGE  ON SCHEMA public FROM anon;


-- ================================================================
-- ✅ SETUP COMPLETE
--
-- Expected state:
--   anon           -> cannot touch anything (REST calls rejected)
--   dealer         -> own shop's cards / stock / sales / receipts
--   beneficiary    -> own card, own history, own shop's stock
--   admin          -> everything
--   audit_log      -> append-only (admin reads, triggers write)
--   views          -> security_invoker (per-caller RLS)
--
-- Demo logins (unchanged):
--   admin    admin@pds.gov.in    / ADMIN@123
--   dealers  n2001@ s2002@ e2003@ w2004@ c2005@pds.gov.in / Dealer@123
--   users    rp1001@ rk1001@ rg1001@pds.gov.in / User@123
-- ================================================================
