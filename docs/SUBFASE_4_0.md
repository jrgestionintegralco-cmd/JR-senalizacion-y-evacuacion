# SAFE ENTER 360 — Subfase 4.0

Nombre confirmado por JR: **SAFE ENTER 360**, sin número adicional al final. La búsqueda preliminar no acredita disponibilidad jurídica definitiva. No se compraron dominios ni se presentó una solicitud de marca.

## Estado

Implementada y desplegada localmente el 25 de septiembre de 2026. Docker fue iniciado con autorización al retomar la tarea. Construcción, ensayo aislado de recuperación, respaldo operativo, migración y comprobaciones HTTP satisfactorios. No se inició la subfase 4.1.

Verificación: 45 pruebas aprobadas (35 API/herramientas y 10 interfaz), TypeScript aprobado, auditoría de dependencias con cero vulnerabilidades y 20/20 comprobaciones de integración real con PostgreSQL/MinIO. Una ejecución inicial mientras se construían las imágenes agotó el tiempo de una prueba de salud; la repetición con un solo worker terminó satisfactoriamente.

Pendiente de aceptación visual por JR: el navegador de comprobación no logró adjuntar su pestaña en dos intentos. No se declara comprobada la pantalla ni la activación del service worker en un navegador existente; sí se verificaron por HTTP los archivos desplegados, sus cabeceras y el nombre exacto. Los cambios de esta subfase siguen en el árbol de trabajo, sin un nuevo commit de Git.

## Alcance implementado

- Migración aditiva `004_stage40.sql`: una sola versión vigente por organización/planta. Si encuentra vigentes duplicadas, falla sin elegir ni borrar registros.
- Numeración serializada mediante bloqueo de la planta. Confirmación repetible; una versión antigua que termina tarde queda como anterior, sin desplazar una superior ya completada.
- Auditoría y cambios de confirmación comparten transacción.
- Subidas temporales con tamaño y tipo firmados. Los bytes se comprueban antes de publicarse: tamaño, formato, parseo de PDF o decodificación de imagen y SHA-256.
- Copia definitiva en clave nueva, escrita exclusivamente por el servidor, con precondición de no sobrescritura y lectura posterior para comprobar SHA-256. Reutilizar la URL de subida solo afecta al temporal.
- Límite actual de 25 MiB por configuración; adicionalmente 100 páginas PDF, dimensión de página de hasta 14400 unidades PDF y 25 millones de píxeles por imagen. Imágenes animadas/multipágina y PDF protegidos se rechazan. Validadores fuera del hilo HTTP, máximo dos validaciones simultáneas por instancia, con límite de tiempo y memoria del worker.
- No se interpreta el plano ni se extrae geometría. La validación no es un antivirus ni garantiza que todo contenido PDF pueda renderizarse; el visor tendrá sus propios límites en 4.1.
- Caché limitada a recursos públicos del mismo origen; purga de la caché antigua JR al activar el nuevo service worker. API y descargas firmadas llevan `no-store`.
- Nombre SAFE ENTER 360 en acceso, barra lateral, título del navegador y manifiesto instalable; se conserva la identidad empresarial de JR. La validación jurídica de la marca sigue pendiente.
- Vitest actualizado a 4.1.11 por el aviso GHSA-82fw-gwwq-j7x9. No se aplicó una actualización forzada general.

## Respaldo integral

`infra/backup/bundle.mjs` implementa `backup`, `verify` y `restore`.

El respaldo contiene:

1. `database.dump`, generado con un snapshot consistente de PostgreSQL.
2. `objects/`, con bytes de archivos referenciados no eliminados.
3. `manifest.json`, con claves, tamaños, huellas y correspondencia con los registros.
4. `COMPLETE.sha256`, escrito al terminar. Sin él la copia no se considera restaurable.

Durante la copia se bloquean escrituras sobre `stored_files` y `floor_plans`; las consultas siguen disponibles. Ejecutar en ventana de baja actividad: cargas/confirmaciones pueden esperar mientras dura el respaldo. Las cargas pendientes sin archivo se registran explícitamente; no se promete recuperar una subida que nunca se completó. Temporales u objetos huérfanos no referenciados no forman parte del conjunto recuperable.

La adquisición de esos bloqueos usa NOWAIT: si ya existe una escritura en curso, el respaldo falla sin marcarse completo y debe repetirse en una ventana tranquila. Así se evita esperar en orden inverso a una confirmación de carga.

Un archivo disponible faltante, de tamaño incorrecto o con SHA distinto provoca fallo del respaldo. Las huellas detectan corrupción accidental, no sustituyen firma digital ni control de acceso a los respaldos.

La restauración valida toda la copia ANTES de conectarse al destino. Exige nombre de base de datos y bucket distintos del origen, base vacía y bucket nuevo o vacío sin política pública. No usa `--clean`, no elimina el origen y revoca las sesiones restauradas. Comprueba por lectura la huella de cada objeto recuperado y sus vínculos con los archivos disponibles en la base restaurada. Un fallo puede dejar objetos en el destino de prueba; no borrar datos automáticamente ni habilitar ese destino para usuarios.

Mantener los respaldos en almacenamiento privado, cifrado y fuera del mismo equipo, con política de retención aprobada. La carpeta `backups/stage40-*` está excluida de Git, pero esto no impide la sincronización de OneDrive. No hay todavía programación automática ni política de borrado automático para estos conjuntos.

Los scripts PowerShell anteriores siguen disponibles para copias históricas SOLO de PostgreSQL y ahora lo advierten expresamente. No son equivalentes al respaldo integral.

## Operación con Docker

Desde la raíz del repositorio, con Docker disponible:

```powershell
docker compose -f docker-compose.yml -f docker-compose.tools.yml build maintenance
docker compose -f docker-compose.yml -f docker-compose.tools.yml run --rm -e RUN_STAGE40_INTEGRATION=yes maintenance node apps/api/tests/integration-stage40.mjs
```

El ensayo crea bases `jr_stage40_test_*` y `jr_stage40_restore_*` y buckets `jr-stage40-test-*` y `jr-stage40-restore-*`. No usa la base operativa como destino del API de pruebas y conserva los recursos aislados para inspección. Cualquier limpieza posterior debe identificar exactamente los recursos de ese ensayo; nunca usar comodines para borrar bases/buckets.

Incluye pruebas de migración e idempotencia, seis solicitudes de versión simultáneas, límite firmado, carga antigua finalizada tarde, dos confirmaciones simultáneas, reintentos, inmutabilidad frente a la URL temporal, formato falso, restricción de única vigente, autenticación, organizaciones, permisos, fallo de auditoría, respaldo, restauración con archivos reales y revocación de sesiones.

En este equipo se ejecutó el binario `docker-compose.exe` incluido con Docker Desktop. El servicio de mantenimiento monta sus herramientas y el ensayo en solo lectura; los respaldos se escriben únicamente en su volumen `/backups`.

### Evidencia del ensayo del 25 de septiembre de 2026

- 20/20 comprobaciones aprobadas. Carga, validación y descarga exacta de PNG, PDF y JPEG.
- Base de ensayo: `jr_stage40_test_920922ef54b5`; base recuperada: `jr_stage40_restore_920922ef54b5`.
- Buckets: `jr-stage40-test-920922ef54b5` y `jr-stage40-restore-920922ef54b5`.
- Respaldo: `backups/stage40-test-920922ef54b5`; ocho objetos recuperados y seis archivos disponibles, con sus huellas comprobadas. Los otros dos archivos corresponden a cargas pendientes del ensayo.
- SHA-256 del manifiesto: `a580b6d3fb827ad2e0515d81fc9ba840eab905d7a38bf4eee775543789328310`.
- Sesiones del destino recuperado revocadas y única versión vigente por planta comprobada.
- Recursos de prueba conservados y separados de la base operativa; no se agregaron clientes de prueba a la aplicación de JR.

Ejemplo de respaldo operativo (usar un directorio nuevo en cada ejecución):

```powershell
docker compose -f docker-compose.yml -f docker-compose.tools.yml run --rm maintenance node infra/backup/bundle.mjs backup /backups/stage40-AAAA-MM-DD-HHMMSS
docker compose -f docker-compose.yml -f docker-compose.tools.yml run --rm maintenance node infra/backup/bundle.mjs verify /backups/stage40-AAAA-MM-DD-HHMMSS
```

Para restaurar, preparar una base vacía y otro bucket y proporcionar `DATABASE_URL` y `S3_BUCKET` de destino mediante variables de entorno del contenedor. No pegar contraseñas en documentación, historial de comandos o reportes. La ejecución normal con las variables de producción se rechaza porque apuntaría al origen.

## Procedimiento de despliegue seguro

1. Verificar estado real de PostgreSQL/MinIO y recuento de planos existentes.
2. Construir y ejecutar el ensayo aislado; resolver cualquier fallo antes de tocar producción.
3. Crear y verificar un respaldo integral predespliegue.
4. En ventana breve de mantenimiento de API, aplicar `004_stage40.sql` con parada ante error y volver a aplicarla para verificar idempotencia. Los scripts de inicialización no se ejecutan automáticamente sobre un volumen existente.
5. Desplegar API e interfaz juntos; comprobar salud, permisos, carga, descarga y activación del nuevo service worker. No volver a desplegar la API antigua con la nueva política de integridad.
6. Los archivos anteriores con `verified_at IS NULL` no se declaran verificados retroactivamente. Revisarlos y consolidarlos antes de habilitar cualquier editor sobre ellos; no borrar ni sustituir originales sin un respaldo comprobado.
7. Registrar resultados y solo entonces cerrar 4.0. No iniciar 4.1 automáticamente.

### Despliegue realizado

- Antes y después: cero clientes y cero planos en la base operativa. Se conservaron usuarios, configuración y demás registros; no había archivos históricos que consolidar.
- Respaldo previo: `backups/stage40-predeploy-20260925-01`, verificado. SHA-256 del manifiesto: `80d6a5c53d081e7c0dfae15c0f2a078288c94abafedffb1b87015bf25391481d`.
- API pausada durante la migración. `004_stage40.sql` aplicada dos veces sin errores; índice único y columna `verified_at` confirmados en la base operativa.
- API e interfaz recreadas con las imágenes nuevas, sin recrear PostgreSQL ni MinIO. Imágenes: API `24df9881acaf`, web `1b59adfe4cc5`, mantenimiento `8e36f81c5291`.
- `/health/ready`: HTTP 200, base de datos disponible y PostGIS 3.4. `/clients` sin sesión: HTTP 401. Ambos con `no-store`.
- Interfaz HTTP 200, título y manifiesto SAFE ENTER 360. `/sw.js` coincide con el archivo local `jr-platform-shell-v2` y se entrega con `no-store, must-revalidate, no-cache`.
- Respaldo posterior: `backups/stage40-final-20260925-01`. SHA-256 del manifiesto: `6344ea8a03620221aaa686ac6e47a85015f1dfc4145735f8b9638cca7eea6b95`. Los respaldos operativos contienen cero objetos porque actualmente no hay planos guardados; el ensayo de recuperación sí incluyó archivos reales.
- Imágenes anteriores conservadas como referencia: API `3e0be21d1bccf428f9f4ff3a45c9b997e267e228a4d9d0fac52aecd973d68c47`, web `b1285313a9d3c7880c0cdc2a438a18aa542f47ab89c8d2eadaa6184ee71fa6a6`. No realizar una reversión automática sobre datos nuevos; requiere evaluación coordinada con el respaldo y las reglas de integridad.

El cierre técnico no equivale a publicar la plataforma en Internet ni a certificar cumplimiento normativo de rutas. La aceptación visual y el registro final en Git quedan identificados como pendientes; no se autoriza ni inicia el editor por este informe.

## Límites deliberados

No hay editor, coordenadas, escala, rutas, señales, IA, BIM o inspecciones. No se comparte infraestructura con TruePlan AI. La clave definitiva protege contra reutilización de enlaces de subida, no contra un administrador con acceso directo a MinIO: no se habilitó retención WORM. Un fallo posterior a escribir el objeto definitivo puede dejar un objeto huérfano; se conserva para no arriesgar borrar un archivo confirmado, sin recolección automática en esta subfase.
