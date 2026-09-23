# Arquitectura — Etapa 3

## Alcance

La Etapa 3 añade edificios, plantas y carga documental versionada de planos. Reutiliza organizaciones, proyectos, permisos, auditoría y almacenamiento S3 compatible de las etapas anteriores. No incorpora edición geométrica, análisis del contenido, rutas, señalización, inspecciones, IA ni BIM.

## Modelo de dominio

```text
Organización
└── Cliente
    └── Establecimiento
        └── Proyecto
            └── Edificio
                └── Planta
                    └── Plano (versiones)
```

- Un edificio pertenece a un proyecto y hereda por esa relación el establecimiento y el cliente.
- Una planta pertenece a un edificio y tiene un número de nivel único dentro de él.
- Cada carga genera una nueva versión del plano de la planta.
- Al confirmar una nueva versión, la versión vigente anterior pasa a estado `superseded`; nunca se sobrescribe el archivo histórico.

## Archivos

Los objetos se guardan de forma privada con una clave no predecible bajo el prefijo de la organización. La API solo acepta PDF, PNG y JPEG, valida el límite configurado y entrega enlaces firmados con vigencia de cinco minutos. La confirmación consulta el objeto en el almacenamiento y verifica su tamaño antes de declararlo disponible.

El entorno Docker usa `S3_ENDPOINT` para la comunicación interna entre la API y MinIO, y `S3_PUBLIC_ENDPOINT` para producir enlaces que el navegador pueda alcanzar. En producción ambos valores pueden apuntar al proveedor S3 administrado correspondiente.

## Seguridad

- Todas las consultas se filtran por `organization_id`.
- Las claves foráneas compuestas impiden relaciones entre organizaciones.
- Los permisos `buildings.*`, `floors.*` y `plans.*` separan consulta y administración.
- Las cargas, confirmaciones, descargas y cambios de entidades generan auditoría.
- No existen rutas de borrado destructivo para edificios, plantas o planos.

## Migración

`infra/db/init/003_stage3.sql` crea tablas, índices, restricciones, permisos y disparadores. Es idempotente para instalaciones existentes y se ejecuta automáticamente en bases nuevas.
