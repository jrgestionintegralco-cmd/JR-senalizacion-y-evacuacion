# Informe de entrega — Etapa 1

**Proyecto:** Plataforma web independiente de JR Gestión Integral S.A.S.  
**Fecha de verificación:** 14 de septiembre de 2026  
**Estado:** Implementación terminada con validaciones locales aprobadas

## Resumen ejecutivo

Se construyó desde cero la base tecnológica independiente de JR. La solución no comparte código, datos, almacenamiento ni credenciales con TruePlan. La interfaz y la API incluyen únicamente funciones transversales de Etapa 1; no se desarrollaron clientes, establecimientos, proyectos, plantas, editor geométrico, rutas de evacuación, inteligencia artificial ni BIM.

## Elementos construidos

1. **Aplicación PWA instalable**
   - Interfaz adaptable a computador, tableta y celular.
   - Manifiesto, icono, color de aplicación y service worker.
   - Caché del contenedor visual; las operaciones protegidas siempre consultan el servidor.

2. **Identidad visual JR**
   - Logotipo corporativo existente.
   - Paleta institucional: azul `#052B62`, verde `#138A2E` y amarillo `#F8BF00`.
   - Pantalla de acceso y panel administrativo en español.

3. **Autenticación y sesiones**
   - Contraseñas protegidas con scrypt, sal aleatoria y comparación resistente a temporización.
   - Sesiones opacas aleatorias; la base solo conserva la huella SHA-256.
   - Cookie HttpOnly y SameSite Strict, con modo Secure para producción.
   - Límite de intentos de inicio de sesión y revocación de sesiones.

4. **Usuarios, roles y permisos**
   - Alta y suspensión/reactivación de cuentas.
   - Rol administrador inicial y catálogo granular de permisos.
   - Verificación de permisos en la API para cada acción.
   - Separación de datos por organización.

5. **PostgreSQL/PostGIS**
   - Esquema inicial idempotente para organización, usuarios, roles, permisos, sesiones, auditoría, configuración, archivos y respaldos.
   - Extensiones PostGIS y pgcrypto habilitadas.
   - Índices para consultas frecuentes y JSONB auditado.
   - Sin entidades anticipadas de módulos futuros.

6. **Almacenamiento de archivos**
   - MinIO local compatible con S3 y contenedor privado.
   - Metadatos en PostgreSQL.
   - URL temporal de carga, clave no predecible, límite de tamaño y sanitización del nombre.

7. **Auditoría**
   - Registro de accesos exitosos/fallidos, cierres de sesión, creación/cambio de usuarios, roles, configuración y solicitudes de carga.
   - Actor, fecha, dirección IP, agente de usuario, resultado y metadatos JSON.

8. **Configuración**
   - Perfil organizacional, zona horaria, idioma/región y aviso interno.
   - Secretos únicamente mediante variables de entorno.

9. **Copias de seguridad**
   - Script de respaldo PostgreSQL en formato personalizado.
   - Cálculo SHA-256, retención configurable y script de restauración.
   - Procedimiento operativo documentado.

10. **Monitoreo**
    - Pruebas `/health/live` y `/health/ready` (esta última valida PostgreSQL y la versión de PostGIS).
    - Métricas Prometheus de proceso y latencia HTTP.
    - Contenedor Prometheus y configuración de recolección.

11. **Despliegue portable**
    - Dockerfile multietapa.
    - Docker Compose para web, API, PostgreSQL/PostGIS, MinIO y Prometheus.
    - Proxy Nginx y configuración para rutas de SPA.

## Pruebas ejecutadas

| Validación | Resultado |
|---|---|
| Pruebas de contraseñas, sesiones, correo y rutas de archivo | 4 aprobadas |
| Pruebas de configuración y fallos por servicios críticos | 2 aprobadas |
| Pruebas de autorización RBAC (permitido/denegado) | 2 aprobadas |
| Pruebas HTTP de vida y protección sin sesión | 2 aprobadas |
| Pruebas de manifiesto PWA y límites de alcance | 2 aprobadas |
| **Total automatizado** | **12 de 12 aprobadas** |
| Verificación TypeScript de API y web | Aprobada |
| Compilación de producción de API y PWA | Aprobada |
| Arranque real de API compilada y `/health/live` | HTTP 200, aprobada |
| Auditoría de dependencias de producción | 0 vulnerabilidades |
| Respuesta HTTP de vista previa PWA | HTTP 200, aprobada |

Vitest informa dos vulnerabilidades moderadas sin corrección disponible en una dependencia usada solo durante las pruebas (`@vitest/mocker`). No está incluida en el código servido en producción; `npm audit --omit=dev` reportó cero vulnerabilidades.

## Validación pendiente por limitación del equipo

Docker no está instalado en el equipo donde se realizó esta entrega. Por ello no fue posible ejecutar aquí la prueba integrada de los contenedores PostgreSQL/PostGIS y MinIO ni una restauración real. La composición, el esquema y los scripts quedaron preparados, y la prueba `/health/ready` validará ambos PostgreSQL y PostGIS al iniciar el entorno.

Antes de producción se debe completar:

- instalar Docker Desktop;
- levantar la composición y comprobar `/health/ready`;
- cargar y descargar un archivo de prueba;
- generar un respaldo y restaurarlo en un ambiente de prueba;
- reemplazar todas las claves de ejemplo y habilitar HTTPS/`COOKIE_SECURE=true`.

## Cómo abrir la aplicación

### Opción recomendada: Docker Desktop

1. Instale e inicie Docker Desktop.
2. Abra PowerShell en la carpeta del proyecto.
3. Copie `.env.example` como `.env` y cambie todas las claves que contienen `change_me`.
4. Ejecute:

```powershell
npm install
docker compose up --build -d
docker compose exec api node apps/api/dist/seed.js
```

5. Abra <http://localhost:8080>.
6. Ingrese con los valores definidos en `INITIAL_ADMIN_EMAIL` e `INITIAL_ADMIN_PASSWORD`.

Para detener la plataforma:

```powershell
docker compose down
```

Los volúmenes de datos se conservan. No use `docker compose down -v` salvo que desee eliminar deliberadamente la base de datos y los archivos locales.

## Criterio de cierre

La Etapa 1 está terminada en código y supera todas las validaciones ejecutables en el entorno disponible. Su cierre operativo queda condicionado únicamente a la prueba integrada con Docker/PostGIS/MinIO y al ensayo de restauración indicados anteriormente.
