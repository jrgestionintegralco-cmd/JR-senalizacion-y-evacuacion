BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

SELECT pg_advisory_xact_lock(764031902);

LOCK TABLE public.organizations, public.roles,
           public.permissions, public.role_permissions
IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    jr_name CONSTANT text := 'JR Gestión Integral S.A.S.';
    expected CONSTANT text[] := ARRAY[
        'platform.dashboard.read',
        'users.read', 'users.manage',
        'roles.read', 'roles.manage',
        'audit.read',
        'settings.read', 'settings.manage',
        'files.create', 'files.read',
        'clients.read', 'clients.manage',
        'establishments.read', 'establishments.manage',
        'projects.read', 'projects.manage',
        'buildings.read', 'buildings.manage',
        'floors.read', 'floors.manage',
        'plans.read', 'plans.manage'
    ];
    org_id uuid;
    admin_role_id uuid;
    matches integer;
BEGIN
    IF current_database() <> 'safe_enter_render_staging' THEN
        RAISE EXCEPTION 'Base distinta del staging autorizado';
    END IF;

    -- No crear ni modificar permisos: los 22 deben existir.
    IF (
        SELECT count(*)
        FROM public.permissions
        WHERE code = ANY(expected)
    ) <> 22 THEN
        RAISE EXCEPTION 'Faltan permisos requeridos';
    END IF;

    -- Comparación normalizada para detectar también variantes del nombre.
    SELECT count(*) INTO matches
    FROM public.organizations
    WHERE lower(btrim(legal_name)) = lower(jr_name);

    IF matches > 1 THEN
        RAISE EXCEPTION 'Organizaciones JR duplicadas';
    ELSIF matches = 0 THEN
        INSERT INTO public.organizations
            (name, legal_name, status)
        VALUES
            ('JR Gestión Integral', jr_name, 'active')
        RETURNING id INTO org_id;
    ELSE
        SELECT id INTO org_id
        FROM public.organizations
        WHERE legal_name = jr_name AND status = 'active';

        IF org_id IS NULL THEN
            RAISE EXCEPTION
                'Organización existente inactiva o con nombre no exacto';
        END IF;
    END IF;

    SELECT count(*) INTO matches
    FROM public.roles
    WHERE organization_id = org_id
      AND lower(btrim(code)) = 'administrator';

    IF matches > 1 THEN
        RAISE EXCEPTION 'Roles administrator ambiguos';
    ELSIF matches = 0 THEN
        INSERT INTO public.roles
            (organization_id, code, name, description, is_system)
        VALUES
            (org_id, 'administrator', 'Administración',
             'Control completo de la base tecnológica', true)
        RETURNING id INTO admin_role_id;
    ELSE
        SELECT id INTO admin_role_id
        FROM public.roles
        WHERE organization_id = org_id
          AND code = 'administrator';

        IF admin_role_id IS NULL THEN
            RAISE EXCEPTION 'Rol existente con código no exacto';
        END IF;
    END IF;

    -- No eliminar asociaciones adicionales: abortar si existen.
    IF EXISTS (
        SELECT 1
        FROM public.role_permissions
        WHERE role_id = admin_role_id
          AND NOT (permission_code = ANY(expected))
    ) THEN
        RAISE EXCEPTION 'El rol tiene asociaciones inesperadas';
    END IF;

    INSERT INTO public.role_permissions (role_id, permission_code)
    SELECT admin_role_id, code
    FROM public.permissions
    WHERE code = ANY(expected)
    ON CONFLICT (role_id, permission_code) DO NOTHING;

    -- Verificación final.
    IF (
        SELECT count(*)
        FROM public.organizations
        WHERE lower(btrim(legal_name)) = lower(jr_name)
    ) <> 1 OR NOT EXISTS (
        SELECT 1 FROM public.organizations
        WHERE id = org_id
          AND legal_name = jr_name
          AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Verificación final de organización fallida';
    END IF;

    IF (
        SELECT count(*)
        FROM public.roles
        WHERE organization_id = org_id
          AND code = 'administrator'
    ) <> 1 THEN
        RAISE EXCEPTION 'Verificación final del rol fallida';
    END IF;

    IF (
        SELECT count(*)
        FROM public.role_permissions
        WHERE role_id = admin_role_id
    ) <> 22 OR (
        SELECT count(*)
        FROM public.role_permissions
        WHERE role_id = admin_role_id
          AND permission_code = ANY(expected)
    ) <> 22 THEN
        RAISE EXCEPTION 'Verificación final de asociaciones fallida';
    END IF;
END;
$$;

COMMIT;
