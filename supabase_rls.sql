-- ================================================================
-- SMART PDS — ROW LEVEL SECURITY (production policies)
-- =================================================---------------
-- Replaces the Phase-1 "dev_open_*" policies (which allowed ANYONE
-- with the publishable key to read/write every table).
--
-- HOW TO APPLY: paste this whole file into the Supabase Dashboard
--   -> SQL Editor -> New query -> Run.  Idempotent: safe to re-run.
--
-- DESIGN NOTES
--   * users.id stores the Supabase Auth UUID as TEXT, so every
--     "own row" check is  id = auth.uid()::text
--   * Role lookups go through SECURITY DEFINER helper functions so
--     that policy evaluation never recurses into users' own RLS.
--   * The frontend links a beneficiary auth user to their ration
--     card ROW via users.name = beneficiaries.name (see
--     AuthContext.fetchProfile) — the helpers mirror that logic.
--   * All policies are TO authenticated; anon gets nothing.
--   * audit_log stays append-only: clients get SELECT (admin only)
--     and no write policies; the audit trigger is SECURITY DEFINER
--     (owner = postgres, bypasses RLS) so logging keeps working.
-- ================================================================


-- ----------------------------------------------------------------
-- STEP 1: HELPER FUNCTIONS
-- ----------------------------------------------------------------

-- Role of the currently signed-in user ('admin' | 'dealer' | 'beneficiary')
CREATE OR REPLACE FUNCTION public.app_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid()::text;
$$;

-- Ration-card ID (beneficiaries.id, e.g. 'R-P1001') of the signed-in
-- beneficiary.  Mirrors AuthContext: match users.name -> beneficiaries.name.
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
--   beneficiary -> assigned_shop_id of their ration card
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

-- Lock helper execution down: authenticated sessions only.
REVOKE EXECUTE ON FUNCTION public.app_role()         FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_beneficiary_id() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_my_shop()      FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.app_role()         TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.app_beneficiary_id() TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.app_my_shop()      TO authenticated, service_role;


-- ----------------------------------------------------------------
-- STEP 2: DROP THE DEV-MODE OPEN POLICIES
-- ----------------------------------------------------------------

DROP POLICY IF EXISTS "dev_open_users"          ON public.users;
DROP POLICY IF EXISTS "dev_open_beneficiaries"  ON public.beneficiaries;
DROP POLICY IF EXISTS "dev_open_inventory"      ON public.inventory;
DROP POLICY IF EXISTS "dev_open_transactions"   ON public.transactions;
DROP POLICY IF EXISTS "dev_open_alerts"         ON public.alerts;
DROP POLICY IF EXISTS "dev_open_stock_receipts" ON public.stock_receipts;
DROP POLICY IF EXISTS "dev_open_grievances"     ON public.grievances;
DROP POLICY IF EXISTS "dev_open_audit_log"      ON public.audit_log;

-- Also drop this file's own policies so a re-run is clean.
DROP POLICY IF EXISTS "users_select_self_or_admin"    ON public.users;
DROP POLICY IF EXISTS "users_admin_all"               ON public.users;
DROP POLICY IF EXISTS "beneficiaries_admin_all"       ON public.beneficiaries;
DROP POLICY IF EXISTS "beneficiaries_dealer_read"     ON public.beneficiaries;
DROP POLICY IF EXISTS "beneficiaries_self_read"       ON public.beneficiaries;
DROP POLICY IF EXISTS "inventory_admin_all"           ON public.inventory;
DROP POLICY IF EXISTS "inventory_dealer_read"         ON public.inventory;
DROP POLICY IF EXISTS "inventory_dealer_update"       ON public.inventory;
DROP POLICY IF EXISTS "inventory_beneficiary_read"    ON public.inventory;
DROP POLICY IF EXISTS "transactions_admin_all"        ON public.transactions;
DROP POLICY IF EXISTS "transactions_dealer_read"      ON public.transactions;
DROP POLICY IF EXISTS "transactions_dealer_insert"    ON public.transactions;
DROP POLICY IF EXISTS "transactions_beneficiary_read" ON public.transactions;
DROP POLICY IF EXISTS "alerts_admin_all"              ON public.alerts;
DROP POLICY IF EXISTS "alerts_dealer_read"            ON public.alerts;
DROP POLICY IF EXISTS "alerts_dealer_insert"          ON public.alerts;
DROP POLICY IF EXISTS "alerts_beneficiary_insert"     ON public.alerts;
DROP POLICY IF EXISTS "stock_receipts_admin_all"      ON public.stock_receipts;
DROP POLICY IF EXISTS "stock_receipts_dealer_read"    ON public.stock_receipts;
DROP POLICY IF EXISTS "stock_receipts_dealer_insert"  ON public.stock_receipts;
DROP POLICY IF EXISTS "grievances_admin_all"          ON public.grievances;
DROP POLICY IF EXISTS "grievances_beneficiary_read"   ON public.grievances;
DROP POLICY IF EXISTS "grievances_beneficiary_insert" ON public.grievances;
DROP POLICY IF EXISTS "grievances_dealer_read"        ON public.grievances;
DROP POLICY IF EXISTS "audit_log_admin_select"        ON public.audit_log;


-- ----------------------------------------------------------------
-- STEP 3: TABLE: users
--   read  -> own row, or everything if admin
--   write -> admin only
-- ----------------------------------------------------------------

CREATE POLICY users_select_self_or_admin ON public.users
  FOR SELECT TO authenticated
  USING (id = auth.uid()::text OR public.app_role() = 'admin');

CREATE POLICY users_admin_all ON public.users
  FOR ALL TO authenticated
  USING (public.app_role() = 'admin')
  WITH CHECK (public.app_role() = 'admin');


-- ----------------------------------------------------------------
-- STEP 4: TABLE: beneficiaries
--   admin      -> full access (Manage Users page)
--   dealer     -> read cards assigned to their shop (Distribute Ration search)
--   beneficiary-> read own card only
-- ----------------------------------------------------------------

CREATE POLICY beneficiaries_admin_all ON public.beneficiaries
  FOR ALL TO authenticated
  USING (public.app_role() = 'admin')
  WITH CHECK (public.app_role() = 'admin');

CREATE POLICY beneficiaries_dealer_read ON public.beneficiaries
  FOR SELECT TO authenticated
  USING (public.app_role() = 'dealer' AND assigned_shop_id = auth.uid()::text);

CREATE POLICY beneficiaries_self_read ON public.beneficiaries
  FOR SELECT TO authenticated
  USING (public.app_role() = 'beneficiary' AND id = public.app_beneficiary_id());


-- ----------------------------------------------------------------
-- STEP 5: TABLE: inventory
--   admin      -> full access (Manage Stock page)
--   dealer     -> read/update rows they own or that are destined
--                 for their shop (Dashboard, Receive Stock, Distribute)
--   beneficiary-> read 'received' stock of their assigned shop only
--                 (Consumer Portal "shop stock" display)
-- ----------------------------------------------------------------

CREATE POLICY inventory_admin_all ON public.inventory
  FOR ALL TO authenticated
  USING (public.app_role() = 'admin')
  WITH CHECK (public.app_role() = 'admin');

CREATE POLICY inventory_dealer_read ON public.inventory
  FOR SELECT TO authenticated
  USING (
    public.app_role() = 'dealer'
    AND (owner_id = auth.uid()::text OR destination_shop_id = auth.uid()::text)
  );

-- Receive Stock flips pending->received & sets owner_id=self;
-- Distribute Ration decrements quantity on owned rows.
CREATE POLICY inventory_dealer_update ON public.inventory
  FOR UPDATE TO authenticated
  USING (
    public.app_role() = 'dealer'
    AND (owner_id = auth.uid()::text OR destination_shop_id = auth.uid()::text)
  )
  WITH CHECK (
    public.app_role() = 'dealer'
    AND (owner_id = auth.uid()::text OR destination_shop_id = auth.uid()::text)
  );

CREATE POLICY inventory_beneficiary_read ON public.inventory
  FOR SELECT TO authenticated
  USING (
    public.app_role() = 'beneficiary'
    AND status = 'received'
    AND owner_id = public.app_my_shop()
  );


-- ----------------------------------------------------------------
-- STEP 6: TABLE: transactions
--   admin      -> full access
--   dealer     -> read own sales; insert sales made at their own
--                 shop (must also be a card assigned to their shop
--                 -> blocks cross-shop distribution at the DB level)
--   beneficiary-> read own history only
-- ----------------------------------------------------------------

CREATE POLICY transactions_admin_all ON public.transactions
  FOR ALL TO authenticated
  USING (public.app_role() = 'admin')
  WITH CHECK (public.app_role() = 'admin');

CREATE POLICY transactions_dealer_read ON public.transactions
  FOR SELECT TO authenticated
  USING (public.app_role() = 'dealer' AND dealer_id = auth.uid()::text);

CREATE POLICY transactions_dealer_insert ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.app_role() = 'dealer'
    AND dealer_id = auth.uid()::text
    AND beneficiary_id IN (
      SELECT b.id FROM public.beneficiaries b
      WHERE b.assigned_shop_id = auth.uid()::text
    )
  );

CREATE POLICY transactions_beneficiary_read ON public.transactions
  FOR SELECT TO authenticated
  USING (public.app_role() = 'beneficiary' AND beneficiary_id = public.app_beneficiary_id());


-- ----------------------------------------------------------------
-- STEP 7: TABLE: alerts
--   admin      -> full access (Fraud Alerts page)
--   dealer     -> read own shop's alerts; insert own (Receive Stock
--                 auto-raises STOCK_MISMATCH with shop_id = self)
--   beneficiary-> may file a report against their own shop only
--                 (Consumer Portal report modal)
-- ----------------------------------------------------------------

CREATE POLICY alerts_admin_all ON public.alerts
  FOR ALL TO authenticated
  USING (public.app_role() = 'admin')
  WITH CHECK (public.app_role() = 'admin');

CREATE POLICY alerts_dealer_read ON public.alerts
  FOR SELECT TO authenticated
  USING (public.app_role() = 'dealer' AND shop_id = auth.uid()::text);

CREATE POLICY alerts_dealer_insert ON public.alerts
  FOR INSERT TO authenticated
  WITH CHECK (public.app_role() = 'dealer' AND shop_id = auth.uid()::text);

CREATE POLICY alerts_beneficiary_insert ON public.alerts
  FOR INSERT TO authenticated
  WITH CHECK (public.app_role() = 'beneficiary' AND shop_id = public.app_my_shop());


-- ----------------------------------------------------------------
-- STEP 8: TABLE: stock_receipts
--   admin      -> full access
--   dealer     -> read & append their own inward-scan log
-- ----------------------------------------------------------------

CREATE POLICY stock_receipts_admin_all ON public.stock_receipts
  FOR ALL TO authenticated
  USING (public.app_role() = 'admin')
  WITH CHECK (public.app_role() = 'admin');

CREATE POLICY stock_receipts_dealer_read ON public.stock_receipts
  FOR SELECT TO authenticated
  USING (public.app_role() = 'dealer' AND dealer_id = auth.uid()::text);

CREATE POLICY stock_receipts_dealer_insert ON public.stock_receipts
  FOR INSERT TO authenticated
  WITH CHECK (public.app_role() = 'dealer' AND dealer_id = auth.uid()::text);


-- ----------------------------------------------------------------
-- STEP 9: TABLE: grievances  (not yet wired into the frontend)
--   admin -> full; beneficiary -> own; dealer -> their shop
-- ----------------------------------------------------------------

CREATE POLICY grievances_admin_all ON public.grievances
  FOR ALL TO authenticated
  USING (public.app_role() = 'admin')
  WITH CHECK (public.app_role() = 'admin');

CREATE POLICY grievances_beneficiary_read ON public.grievances
  FOR SELECT TO authenticated
  USING (public.app_role() = 'beneficiary' AND beneficiary_id = public.app_beneficiary_id());

CREATE POLICY grievances_beneficiary_insert ON public.grievances
  FOR INSERT TO authenticated
  WITH CHECK (public.app_role() = 'beneficiary' AND beneficiary_id = public.app_beneficiary_id());

CREATE POLICY grievances_dealer_read ON public.grievances
  FOR SELECT TO authenticated
  USING (public.app_role() = 'dealer' AND fps_shop_id = auth.uid()::text);


-- ----------------------------------------------------------------
-- STEP 10: TABLE: audit_log  (append-only tamper-proof trail)
--   Clients: admin may READ; nobody may write from the client.
--   The trg_audit_* triggers live in fn_audit_trigger(), which is
--   SECURITY DEFINER owned by postgres -> bypasses RLS, so the
--   audit trail keeps recording every change.
-- ----------------------------------------------------------------

CREATE POLICY audit_log_admin_select ON public.audit_log
  FOR SELECT TO authenticated
  USING (public.app_role() = 'admin');


-- ----------------------------------------------------------------
-- STEP 11: VIEWS — recreate with security_invoker so they respect
-- each caller's RLS instead of leaking everything (view-owner
-- semantics bypass RLS by default).
-- ----------------------------------------------------------------

DROP VIEW IF EXISTS public.vw_monthly_distribution;
CREATE VIEW public.vw_monthly_distribution
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

DROP VIEW IF EXISTS public.vw_overdue_grievances;
CREATE VIEW public.vw_overdue_grievances
WITH (security_invoker = true) AS
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

DROP VIEW IF EXISTS public.vw_inventory_reconciliation;
CREATE VIEW public.vw_inventory_reconciliation
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


-- ----------------------------------------------------------------
-- STEP 12: CUT THE anon ROLE OFF COMPLETELY
-- The frontend never queries tables before login (Login page has no
-- supabase table calls), so anon needs no privileges at all.
-- RLS alone would already return zero rows for anon — this is
-- defense in depth.
-- ----------------------------------------------------------------

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE USAGE  ON SCHEMA public FROM anon;


-- ================================================================
-- DONE.  Expected state:
--   anon           -> cannot touch anything
--   dealer         -> own shop's cards / stock / sales / receipts
--   beneficiary    -> own card, own history, own shop's received stock
--   admin          -> everything
--   audit_log      -> append-only (admin reads, triggers write)
--   views          -> security_invoker (per-caller RLS)
-- ================================================================
