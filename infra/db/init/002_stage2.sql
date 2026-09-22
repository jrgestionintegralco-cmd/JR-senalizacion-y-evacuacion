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
