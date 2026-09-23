# Plataforma JR — Etapas 1, 2 y 3

Plataforma tecnológica independiente de **JR Gestión Integral S.A.S.** La Etapa 1 aporta PWA, autenticación, usuarios, roles y permisos, PostgreSQL/PostGIS, archivos privados, auditoría, configuración, copias de seguridad, monitoreo e identidad visual. La Etapa 2 incorpora clientes, establecimientos y proyectos. La Etapa 3 incorpora edificios, plantas y carga documental versionada de planos.

No contiene editor geométrico, interpretación automática de planos, inspecciones, rutas de evacuación, señalización, IA ni BIM.

## Requisitos

- Node.js 22 o superior.
- Docker Desktop con Docker Compose (recomendado para ejecutar PostgreSQL/PostGIS, MinIO, API, web y Prometheus).

## Inicio rápido con Docker

1. Duplique `.env.example` como `.env`.
2. Cambie `POSTGRES_PASSWORD`, `S3_SECRET_KEY` e `INITIAL_ADMIN_PASSWORD` por valores únicos y fuertes. Mantenga el mismo valor de `POSTGRES_PASSWORD` dentro de `DATABASE_URL`.
3. Desde esta carpeta ejecute:

```powershell
npm install
docker compose up --build -d
docker compose exec api node apps/api/dist/seed.js
```

4. Abra <http://localhost:8080> e ingrese con `INITIAL_ADMIN_EMAIL` y `INITIAL_ADMIN_PASSWORD`.

En una instalación existente, aplique en orden las migraciones pendientes antes de reconstruir los servicios:

```powershell
Get-Content -Raw .\infra\db\init\002_stage2.sql | docker compose exec -T postgres psql -U jr_app -d jr_platform
Get-Content -Raw .\infra\db\init\003_stage3.sql | docker compose exec -T postgres psql -U jr_app -d jr_platform
docker compose up --build -d
```

Las instalaciones nuevas aplican automáticamente `001_platform.sql`, `002_stage2.sql` y `003_stage3.sql` al crear el volumen de PostgreSQL.

Servicios de operación:

- Aplicación: <http://localhost:8080>
- API y salud: <http://localhost:4000/health/ready>
- Consola de almacenamiento: <http://localhost:9001>
- Monitoreo Prometheus: <http://localhost:9090>

## Desarrollo local

Con PostgreSQL/PostGIS y MinIO disponibles y `.env` configurado:

```powershell
npm install
npm run seed
npm run dev
```

La interfaz se abre en <http://localhost:5173> y la API en <http://localhost:4000>.

## Pruebas y compilación

```powershell
npm test
npm run typecheck
npm run build
```

La prueba de disponibilidad completa de PostgreSQL/PostGIS se ejecuta al consultar `/health/ready`. Docker debe estar activo para probar la infraestructura integrada.

## Copias de seguridad

Con `DATABASE_URL` definida y las herramientas de PostgreSQL instaladas:

```powershell
./infra/backup/backup.ps1
./infra/backup/restore.ps1 -BackupFile ./backups/jr-platform-AAAAMMDD-HHMMSS.dump
```

La copia usa formato personalizado de PostgreSQL, calcula SHA-256 y elimina automáticamente respaldos más antiguos que `BACKUP_RETENTION_DAYS`. Antes de una restauración productiva debe probarse el procedimiento en un ambiente separado.

## Seguridad operativa

- No confirme `.env` ni credenciales en Git.
- En producción use HTTPS y establezca `COOKIE_SECURE=true`.
- Rote las claves iniciales y limite el acceso a MinIO, PostgreSQL y Prometheus mediante red privada.
- Ejecute copias automáticas fuera del servidor principal y valide restauraciones periódicamente.
- Mantenga las imágenes Docker y dependencias actualizadas mediante un proceso controlado.

La base tecnológica se documenta en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) y [docs/INFORME_ETAPA_1.md](docs/INFORME_ETAPA_1.md). Las entregas de dominio se documentan en [docs/ARQUITECTURA_ETAPA_2.md](docs/ARQUITECTURA_ETAPA_2.md), [docs/INFORME_ETAPA_2.md](docs/INFORME_ETAPA_2.md), [docs/ARQUITECTURA_ETAPA_3.md](docs/ARQUITECTURA_ETAPA_3.md) y [docs/INFORME_ETAPA_3.md](docs/INFORME_ETAPA_3.md).
