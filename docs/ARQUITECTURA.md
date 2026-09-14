# Arquitectura — Etapa 1

## Decisión principal

La plataforma es un monolito modular TypeScript con dos superficies desplegables: una PWA React para el equipo de JR y una API Fastify para autenticación, autorización y servicios transversales. Los datos viven en PostgreSQL 16 con PostGIS; los archivos viven en almacenamiento S3 compatible (MinIO en local). No comparte repositorio, base de datos, credenciales ni almacenamiento con TruePlan.

## Componentes

| Componente | Responsabilidad |
|---|---|
| PWA React/Vite | Acceso, usuarios, roles, auditoría, configuración y estado de plataforma |
| API Fastify | Sesiones, RBAC, validación, auditoría, carga segura y métricas |
| PostgreSQL/PostGIS | Datos relacionales, sesiones, permisos, auditoría y preparación espacial |
| MinIO | Objetos privados compatibles con S3 y enlaces temporales |
| Prometheus | Métricas de proceso y latencia HTTP |
| PowerShell + pg_dump | Respaldo verificable y restauración controlada |

## Controles de seguridad

- Contraseñas derivadas con scrypt y sal aleatoria.
- Sesiones opacas de 256 bits; en base de datos solo se guarda SHA-256 del token.
- Cookie `HttpOnly`, `SameSite=Strict` y `Secure` configurable/obligatorio en producción.
- Límite específico de intentos de inicio de sesión.
- Autorización en servidor por permiso, no solo ocultamiento en interfaz.
- Separación por `organization_id` en todas las consultas administrativas.
- Validación de entradas con Zod y consultas parametrizadas.
- Revocación inmediata de sesiones al suspender una cuenta.
- Auditoría de inicio/cierre de sesión, usuarios, roles, configuración y archivos.
- Encabezados de seguridad, CORS restringido y sin secretos en el cliente.
- Archivos privados con URL de carga temporal y clave no predecible.

## Límites explícitos

La base no define entidades ni flujos de clientes, sedes, establecimientos, proyectos, edificios, plantas, geometría, evacuación, IA o BIM. PostGIS queda habilitado como capacidad de infraestructura, sin anticipar el modelo geométrico.

## Evolución segura

Los futuros módulos deben añadirse como módulos de dominio independientes y reutilizar identidad, permisos, auditoría, archivos y configuración mediante contratos internos. Cada módulo debe introducir sus propios permisos y migraciones sin modificar el formato maestro de otros dominios.
