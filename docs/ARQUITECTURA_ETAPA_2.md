# Arquitectura — Etapa 2

## Alcance autorizado

La Etapa 2 añade tres módulos de dominio al monolito modular existente: clientes, establecimientos y proyectos. Reutiliza autenticación, permisos, auditoría, configuración y separación por organización de la Etapa 1.

Quedan fuera plantas, carga de planos, editor geométrico, inspecciones, rutas de evacuación, señalización, inteligencia artificial y BIM.

## Modelo de dominio

| Entidad | Responsabilidad | Relación principal |
|---|---|---|
| Cliente | Identificación, contacto y estado de una organización o persona atendida | Pertenece a la organización de JR |
| Establecimiento | Sede física y contacto operativo de un cliente | Pertenece a un cliente |
| Proyecto | Trabajo contratado y su estado administrativo | Pertenece a un cliente y a uno de sus establecimientos |

La base de datos impide asociar un proyecto con un establecimiento de otro cliente. Todas las consultas y escrituras incluyen `organization_id`, de modo que ninguna entidad puede cruzar organizaciones.

Los registros se activan o inactivan; no se ofrece eliminación desde la API. Los proyectos usan los estados `draft`, `active`, `on_hold`, `completed` y `cancelled`.

## Preparación para evolución

Los identificadores UUID de establecimiento y proyecto permiten asociar posteriormente plantas, planos, inspecciones y rutas sin modificar el formato maestro de clientes. Esta etapa no crea tablas, permisos, rutas HTTP ni componentes visuales para esos dominios futuros.

La ubicación geográfica del establecimiento es opcional y se conserva como latitud y longitud validadas. PostGIS sigue disponible como capacidad de infraestructura, pero no se introduce geometría operativa.

## API y permisos

Cada dominio tiene permisos independientes de consulta y administración:

- `clients.read` y `clients.manage`;
- `establishments.read` y `establishments.manage`;
- `projects.read` y `projects.manage`.

La API ofrece operaciones de listado, creación, actualización y cambio de estado. No expone borrado. Los cambios generan eventos de auditoría con actor, entidad, resultado y metadatos mínimos.

## Cloud-first y aislamiento

- La API continúa sin estado y usa sesiones almacenadas en PostgreSQL.
- Los datos de dominio residen en PostgreSQL y usan claves foráneas verificables.
- La configuración y los secretos permanecen en variables de entorno.
- Docker Compose sigue siendo el entorno local reproducible; la misma separación permite desplegar web, API, PostgreSQL y almacenamiento S3 en servicios administrados.
- El proyecto no comparte repositorio, base de datos, credenciales ni almacenamiento con TruePlan AI.

## Migración

`infra/db/init/002_stage2.sql` crea las tablas, índices, permisos y disparadores. Se ejecuta automáticamente en bases nuevas y debe aplicarse una vez en instalaciones existentes antes de desplegar la nueva API.
