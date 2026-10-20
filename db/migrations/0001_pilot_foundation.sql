CREATE TABLE IF NOT EXISTS pilot_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('vendedora', 'supervisora', 'administracion')),
  site TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  pin_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pilot_sales (
  id TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  created_at TEXT NOT NULL,
  gross_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  net_cents INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  invoice_type TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'activa',
  created_by_user_id TEXT
);

CREATE TABLE IF NOT EXISTS pilot_cash_closures (
  id TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  expected_cents INTEGER NOT NULL DEFAULT 0,
  counted_cents INTEGER,
  envelope_cents INTEGER NOT NULL DEFAULT 0,
  difference_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'abierta',
  created_by_user_id TEXT
);

CREATE TABLE IF NOT EXISTS pilot_stock_movements (
  id TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  movement_type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  remito TEXT,
  detail TEXT,
  created_at TEXT NOT NULL,
  created_by_user_id TEXT
);

CREATE TABLE IF NOT EXISTS pilot_audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  site TEXT,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL,
  actor_user_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_pilot_sales_site_created_at ON pilot_sales(site, created_at);
CREATE INDEX IF NOT EXISTS idx_pilot_cash_closures_site_status ON pilot_cash_closures(site, status);
CREATE INDEX IF NOT EXISTS idx_pilot_stock_movements_site_product ON pilot_stock_movements(site, product_id);
