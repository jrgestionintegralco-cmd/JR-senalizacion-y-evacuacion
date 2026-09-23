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
