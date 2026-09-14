CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  legal_name text NOT NULL,
  tax_id text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  email text NOT NULL,
  full_name text NOT NULL,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, email)
);

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  code text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS permissions (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  outcome text NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'failure')),
  ip_address inet,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_settings (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  is_secret boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, key)
);

CREATE TABLE IF NOT EXISTS stored_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  object_key text NOT NULL UNIQUE,
  original_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256 text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'quarantined', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS backup_runs (
  id bigserial PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  location text,
  checksum_sha256 text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_users_org_status ON users (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_user_expires ON sessions (user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_org_time ON audit_events (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_metadata ON audit_events USING gin (metadata);
CREATE INDEX IF NOT EXISTS idx_files_org_time ON stored_files (organization_id, created_at DESC);

INSERT INTO organizations (name, legal_name, tax_id)
VALUES ('JR Gestión Integral', 'JR Gestión Integral S.A.S.', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO permissions (code, name, description) VALUES
  ('platform.dashboard.read', 'Ver panel', 'Consulta el estado general de la plataforma'),
  ('users.read', 'Consultar usuarios', 'Lista usuarios y su estado'),
  ('users.manage', 'Administrar usuarios', 'Crea, edita y suspende usuarios'),
  ('roles.read', 'Consultar roles', 'Lista roles y permisos'),
  ('roles.manage', 'Administrar roles', 'Crea roles y asigna permisos'),
  ('audit.read', 'Consultar auditoría', 'Consulta eventos de seguridad y cambios'),
  ('settings.read', 'Consultar configuración', 'Consulta parámetros no secretos'),
  ('settings.manage', 'Administrar configuración', 'Actualiza parámetros organizacionales'),
  ('files.create', 'Cargar archivos', 'Solicita cargas seguras al almacenamiento'),
  ('files.read', 'Consultar archivos', 'Consulta metadatos y descargas autorizadas')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

WITH org AS (
  SELECT id FROM organizations WHERE legal_name = 'JR Gestión Integral S.A.S.' LIMIT 1
)
INSERT INTO roles (organization_id, code, name, description, is_system)
SELECT id, 'administrator', 'Administración', 'Control completo de la base tecnológica', true FROM org
ON CONFLICT (organization_id, code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'administrator'
ON CONFLICT DO NOTHING;

WITH org AS (
  SELECT id FROM organizations WHERE legal_name = 'JR Gestión Integral S.A.S.' LIMIT 1
)
INSERT INTO app_settings (organization_id, key, value)
SELECT id, 'organization.profile', '{"timezone":"America/Bogota","locale":"es-CO","name":"JR Gestión Integral S.A.S."}'::jsonb FROM org
ON CONFLICT (organization_id, key) DO NOTHING;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS organizations_set_updated_at ON organizations;
CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON organizations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
