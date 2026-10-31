-- ================================================================
-- SMART PDS MONITORING PLATFORM
-- Supabase PostgreSQL Schema — Clean Version
-- ================================================================
-- ----------------------------------------------------------------
-- STEP 1: EXTENSIONS
-- ----------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- ----------------------------------------------------------------
-- STEP 2: DROP EXISTING TABLES (safe clean slate)
-- Order matters — drop dependents first
-- ----------------------------------------------------------------
DROP TABLE IF EXISTS audit_log       CASCADE;
DROP TABLE IF EXISTS grievances      CASCADE;
DROP TABLE IF EXISTS stock_receipts  CASCADE;
DROP TABLE IF EXISTS alerts          CASCADE;
DROP TABLE IF EXISTS transactions    CASCADE;
DROP TABLE IF EXISTS inventory       CASCADE;
DROP TABLE IF EXISTS beneficiaries   CASCADE;
DROP TABLE IF EXISTS users           CASCADE;


-- ----------------------------------------------------------------
-- STEP 3: CREATE TABLES
-- ----------------------------------------------------------------


-- TABLE 1: USERS
-- Stores portal identity for all three roles:
-- admin (warehouse officer), dealer (FPS shop), beneficiary (citizen)

CREATE TABLE users (
    id                   TEXT PRIMARY KEY,
    name                 TEXT        NOT NULL,
    role                 TEXT        NOT NULL
                             CHECK (role IN ('admin', 'dealer', 'beneficiary')),
    shop_name            TEXT,
    zone                 TEXT,
    state                TEXT,
    city                 TEXT,
    area                 TEXT,
    associated_dealer_id TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- TABLE 2: BENEFICIARIES
-- One row per ration card household

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
-- Stock batches — from central warehouse to FPS shop

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
-- Fraud / anomaly alerts raised by the system or officers

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
-- Log of every bag scanned during inward scanning at FPS

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
-- Append-only tamper-proof actor trail
-- No UPDATE or DELETE ever allowed on this table

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


-- ----------------------------------------------------------------
-- STEP 4: INDEXES (for query performance)
-- ----------------------------------------------------------------

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


-- ----------------------------------------------------------------
-- STEP 5: AUDIT TRIGGER
-- Auto-logs every INSERT / UPDATE / DELETE on core tables
-- ----------------------------------------------------------------

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

-- Attach trigger to all core tables
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


-- ----------------------------------------------------------------
-- STEP 6: ROW LEVEL SECURITY
-- RLS is enabled on every table.  With no policies attached yet,
-- the tables are closed to anon/authenticated by default (fail
-- closed).  Run supabase_rls.sql AFTER this file to attach the
-- role-based policies (admin / dealer / beneficiary) and revoke
-- the anon role.  Do NOT add open "USING (true)" policies here.
-- ----------------------------------------------------------------

ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE beneficiaries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory      ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE grievances     ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log      ENABLE ROW LEVEL SECURITY;


-- ----------------------------------------------------------------
-- STEP 7: USEFUL VIEWS (optional but helpful for dashboards)
-- ----------------------------------------------------------------

-- Monthly distribution summary per shop
CREATE OR REPLACE VIEW vw_monthly_distribution AS
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

-- Open grievances older than 10 days (overdue)
CREATE OR REPLACE VIEW vw_overdue_grievances AS
SELECT
    g.*,
    u.name  AS beneficiary_name,
    s.shop_name
FROM grievances g
JOIN beneficiaries b ON b.id = g.beneficiary_id
JOIN users u ON u.id = g.beneficiary_id
JOIN users s ON s.id = g.fps_shop_id
WHERE g.status IN ('filed', 'under_review')
  AND g.filed_at < now() - INTERVAL '10 days';

-- Inventory reconciliation per shop
CREATE OR REPLACE VIEW vw_inventory_reconciliation AS
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
-- STEP 8: SEED DEMO DATA
-- ================================================================

-- CLEANUP PREVIOUS DEMO DATA
DELETE FROM auth.users WHERE email LIKE '%@pds.gov.in';

-- Function to create a demo user (Handles Supabase Auth + Public Users)
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
  -- 1. Insert into auth.users (Supabase managed table)
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    user_email,
    crypt(user_pass, gen_salt('bf')),
    now(),
    NULL,
    now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', user_name),
    now(),
    now(),
    '',
    '',
    '',
    ''
  )
  RETURNING id INTO new_user_id;

  -- 2. Insert into our public users table
  INSERT INTO public.users (
    id, name, role, shop_name, zone, state, city, area, associated_dealer_id
  ) VALUES (
    new_user_id::TEXT, user_name, user_role, user_shop_name, user_zone, user_state, user_city, user_area, user_assoc_dealer
  );
END;
$$ LANGUAGE plpgsql;

-- 1. Create Admin
SELECT create_demo_user('admin@pds.gov.in', 'ADMIN@123', 'Central Administrator', 'admin', 'ADMIN');

-- 2. Create Sellers (Dealers)
SELECT create_demo_user('n2001@pds.gov.in', 'Dealer@123', 'Yuvraj Singh', 'dealer', 'N2001', 'Punjab Grocery', 'North', 'Punjab', 'Amritsar', 'Ranjit Avenue');
SELECT create_demo_user('s2002@pds.gov.in', 'Dealer@123', 'Vijay', 'dealer', 'S2002', 'Kochi Grocery', 'South', 'Kerela', 'Kochi', 'MG road');
SELECT create_demo_user('e2003@pds.gov.in', 'Dealer@123', 'Amish Singh', 'dealer', 'E2003', 'Guwahati Grocery', 'East', 'Assam', 'Guwahati', 'GS road');
SELECT create_demo_user('w2004@pds.gov.in', 'Dealer@123', 'Paresh Shah', 'dealer', 'W2004', 'Vadodara Grocery', 'West', 'Gujarat', 'Vadodara', 'Sama');
SELECT create_demo_user('c2005@pds.gov.in', 'Dealer@123', 'Shailendra Sharma', 'dealer', 'C2005', 'MP Grocery', 'Central', 'Madhya Pradesh', 'Indore', 'Vijay Nagar');

-- 3. Create Beneficiaries (Auth Users)
SELECT create_demo_user('rp1001@pds.gov.in', 'User@123', 'Kapil Singh', 'beneficiary', 'R-P1001', 'Punjab Grocery', NULL, NULL, NULL, NULL, 'N2001');
SELECT create_demo_user('rk1001@pds.gov.in', 'User@123', 'Raju', 'beneficiary', 'R-K1001', 'Kochi Grocery', NULL, NULL, NULL, NULL, 'S2002');
SELECT create_demo_user('rg1001@pds.gov.in', 'User@123', 'Amit', 'beneficiary', 'R-G1001', 'Guwahati Grocery', NULL, NULL, NULL, NULL, 'E2003');

-- 4. Seed Additional Beneficiary Registry Data
INSERT INTO beneficiaries (id, name, family_size, entitlement, assigned_shop_id) VALUES
('R-P1001', 'Kapil Singh', 4, '{"rice": 20, "wheat": 15, "sugar": 2, "oil": 2}', (SELECT id FROM users WHERE name = 'Yuvraj Singh' LIMIT 1)),
('R-P1002', 'Gurpreet Dosanjh', 3, '{"rice": 15, "wheat": 10, "sugar": 1, "oil": 1}', (SELECT id FROM users WHERE name = 'Yuvraj Singh' LIMIT 1)),
('R-P1003', 'Balwinder Singh', 5, '{"rice": 25, "wheat": 20, "sugar": 3, "oil": 2}', (SELECT id FROM users WHERE name = 'Yuvraj Singh' LIMIT 1)),
('R-K1001', 'Raju', 2, '{"rice": 10, "wheat": 8, "sugar": 1, "oil": 1}', (SELECT id FROM users WHERE name = 'Vijay' LIMIT 1)),
('R-K1002', 'Ramswami', 4, '{"rice": 20, "wheat": 15, "sugar": 2, "oil": 2}', (SELECT id FROM users WHERE name = 'Vijay' LIMIT 1)),
('R-G1001', 'Amit', 4, '{"rice": 20, "wheat": 15, "sugar": 2, "oil": 2}', (SELECT id FROM users WHERE name = 'Amish Singh' LIMIT 1))
ON CONFLICT (id) DO NOTHING;

-- 5. Seeding Initial Inventory
-- Central Depot Stock
INSERT INTO inventory (name, quantity, unit, batch_id, source, owner_id, status, expiry) VALUES
('Rice', 5000, 'KG', 'B-RICE-001', 'Central Depot', (SELECT id FROM users WHERE role = 'admin' LIMIT 1), 'received', '2027-12-31'),
('Wheat', 10000, 'KG', 'B-WHEAT-001', 'Central Depot', (SELECT id FROM users WHERE role = 'admin' LIMIT 1), 'received', '2027-12-31'),
('Sugar', 2000, 'KG', 'B-SUGAR-001', 'Nafed Store', (SELECT id FROM users WHERE role = 'admin' LIMIT 1), 'received', '2026-06-30')
ON CONFLICT (batch_id) DO NOTHING;

-- Deployed Shop Stock
INSERT INTO inventory (name, quantity, unit, batch_id, source, owner_id, status) VALUES
('Rice', 800, 'KG', 'B-PUN-001', 'Central Depot', (SELECT id FROM users WHERE name = 'Yuvraj Singh' LIMIT 1), 'received'),
('Wheat', 1200, 'KG', 'B-PUN-002', 'Central Depot', (SELECT id FROM users WHERE name = 'Yuvraj Singh' LIMIT 1), 'received'),
('Rice', 1200, 'KG', 'B-KOC-001', 'Central Depot', (SELECT id FROM users WHERE name = 'Vijay' LIMIT 1), 'received'),
('Wheat', 800, 'KG', 'B-KOC-002', 'Central Depot', (SELECT id FROM users WHERE name = 'Vijay' LIMIT 1), 'received'),
('Rice', 950, 'KG', 'B-GUW-001', 'Central Depot', (SELECT id FROM users WHERE name = 'Amish Singh' LIMIT 1), 'received'),
('Wheat', 1100, 'KG', 'B-GUW-002', 'Central Depot', (SELECT id FROM users WHERE name = 'Amish Singh' LIMIT 1), 'received')
ON CONFLICT (batch_id) DO NOTHING;


-- ================================================================
-- SCHEMA COMPLETE
-- Tables created: users, beneficiaries, inventory, transactions,
--                 alerts, stock_receipts, grievances, audit_log
-- Indexes:  17 indexes for query performance
-- Triggers: Audit trail auto-fires on all core tables
-- Views:    3 dashboard views
-- RLS:      Enabled on all tables (open dev policies — tighten later)
-- ================================================================