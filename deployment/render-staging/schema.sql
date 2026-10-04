-- Isolated fresh-staging schema derived from stages 1–4.0. No organization/user seeds.
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

CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  legal_name text NOT NULL,
  trade_name text,
  document_type text NOT NULL CHECK (document_type IN ('nit', 'cc', 'ce', 'passport', 'other')),
  document_number text NOT NULL,
  contact_name text,
  email text,
  phone text,
  address text,
  city text,
  notes text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, document_type, document_number)
);

CREATE TABLE IF NOT EXISTS establishments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  client_id uuid NOT NULL,
  code text,
  name text NOT NULL,
  address text NOT NULL,
  city text NOT NULL,
  department text,
  country text NOT NULL DEFAULT 'Colombia',
  latitude double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision CHECK (longitude BETWEEN -180 AND 180),
  contact_name text,
  email text,
  phone text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT establishments_coordinates_pair CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CONSTRAINT establishments_client_fk FOREIGN KEY (organization_id, client_id)
    REFERENCES clients (organization_id, id),
  UNIQUE (organization_id, id, client_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  client_id uuid NOT NULL,
  establishment_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'on_hold', 'completed', 'cancelled')),
  starts_on date,
  due_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_dates_order CHECK (due_on IS NULL OR starts_on IS NULL OR due_on >= starts_on),
  CONSTRAINT projects_client_fk FOREIGN KEY (organization_id, client_id)
    REFERENCES clients (organization_id, id),
  CONSTRAINT projects_establishment_fk FOREIGN KEY (organization_id, establishment_id, client_id)
    REFERENCES establishments (organization_id, id, client_id),
  UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_clients_org_status_name ON clients (organization_id, status, legal_name);
CREATE INDEX IF NOT EXISTS idx_establishments_org_client_status ON establishments (organization_id, client_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_establishments_org_client_code ON establishments (organization_id, client_id, code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_org_client_status ON projects (organization_id, client_id, status);
CREATE INDEX IF NOT EXISTS idx_projects_org_establishment ON projects (organization_id, establishment_id);

INSERT INTO permissions (code, name, description) VALUES
  ('clients.read', 'Consultar clientes', 'Consulta clientes y sus datos de contacto'),
  ('clients.manage', 'Administrar clientes', 'Crea, actualiza y cambia el estado de clientes'),
  ('establishments.read', 'Consultar establecimientos', 'Consulta establecimientos asociados a clientes'),
  ('establishments.manage', 'Administrar establecimientos', 'Crea, actualiza y cambia el estado de establecimientos'),
  ('projects.read', 'Consultar proyectos', 'Consulta proyectos y su avance administrativo'),
  ('projects.manage', 'Administrar proyectos', 'Crea, actualiza y cambia el estado de proyectos')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM roles r
JOIN permissions p ON p.code IN (
  'clients.read', 'clients.manage',
  'establishments.read', 'establishments.manage',
  'projects.read', 'projects.manage'
)
WHERE r.code = 'administrator'
ON CONFLICT DO NOTHING;

DROP TRIGGER IF EXISTS clients_set_updated_at ON clients;
CREATE TRIGGER clients_set_updated_at BEFORE UPDATE ON clients
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS establishments_set_updated_at ON establishments;
CREATE TRIGGER establishments_set_updated_at BEFORE UPDATE ON establishments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS projects_set_updated_at ON projects;
CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'projects_org_id_unique' AND conrelid = 'projects'::regclass
  ) THEN
    ALTER TABLE projects ADD CONSTRAINT projects_org_id_unique UNIQUE (organization_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS buildings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL,
  code text,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT buildings_project_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES projects (organization_id, id),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, project_id, name)
);

CREATE TABLE IF NOT EXISTS floors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  building_id uuid NOT NULL,
  code text,
  name text NOT NULL,
  level_number integer NOT NULL CHECK (level_number BETWEEN -20 AND 300),
  elevation_m numeric(8,2),
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT floors_building_fk FOREIGN KEY (organization_id, building_id)
    REFERENCES buildings (organization_id, id),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, building_id, level_number)
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stored_files_org_id_unique' AND conrelid = 'stored_files'::regclass
  ) THEN
    ALTER TABLE stored_files ADD CONSTRAINT stored_files_org_id_unique UNIQUE (organization_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS floor_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  floor_id uuid NOT NULL,
  stored_file_id uuid NOT NULL,
  title text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'superseded', 'rejected')),
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  CONSTRAINT floor_plans_floor_fk FOREIGN KEY (organization_id, floor_id)
    REFERENCES floors (organization_id, id),
  CONSTRAINT floor_plans_file_fk FOREIGN KEY (organization_id, stored_file_id)
    REFERENCES stored_files (organization_id, id),
  UNIQUE (organization_id, floor_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_buildings_project_code ON buildings (organization_id, project_id, code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_floors_building_code ON floors (organization_id, building_id, code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_buildings_org_project_status ON buildings (organization_id, project_id, status);
CREATE INDEX IF NOT EXISTS idx_floors_org_building_status ON floors (organization_id, building_id, status);
CREATE INDEX IF NOT EXISTS idx_floor_plans_org_floor_version ON floor_plans (organization_id, floor_id, version DESC);

INSERT INTO permissions (code, name, description) VALUES
  ('buildings.read', 'Consultar edificios', 'Consulta edificios vinculados a proyectos'),
  ('buildings.manage', 'Administrar edificios', 'Crea, actualiza y cambia el estado de edificios'),
  ('floors.read', 'Consultar plantas', 'Consulta plantas vinculadas a edificios'),
  ('floors.manage', 'Administrar plantas', 'Crea, actualiza y cambia el estado de plantas'),
  ('plans.read', 'Consultar planos', 'Consulta y descarga planos de las plantas'),
  ('plans.manage', 'Administrar planos', 'Carga y versiona planos de las plantas')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM roles r
JOIN permissions p ON p.code IN (
  'buildings.read', 'buildings.manage',
  'floors.read', 'floors.manage',
  'plans.read', 'plans.manage'
)
WHERE r.code = 'administrator'
ON CONFLICT DO NOTHING;

DROP TRIGGER IF EXISTS buildings_set_updated_at ON buildings;
CREATE TRIGGER buildings_set_updated_at BEFORE UPDATE ON buildings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS floors_set_updated_at ON floors;
CREATE TRIGGER floors_set_updated_at BEFORE UPDATE ON floors
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Additive migration. Fail closed if pre-existing data needs manual reconciliation.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM floor_plans WHERE status='ready' GROUP BY organization_id,floor_id HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Multiple current plans: reconcile explicitly before applying 004';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_floor_plans_one_ready
  ON floor_plans (organization_id,floor_id) WHERE status='ready';
ALTER TABLE stored_files ADD COLUMN IF NOT EXISTS verified_at timestamptz;
COMMENT ON COLUMN stored_files.verified_at IS 'Validated bytes sealed by stage 4.0; NULL means legacy or pending, not verified';
