# L'ARTISAN · Respaldo y recuperación

Este procedimiento es exclusivo de Administración autorizada. No guardar
claves, certificados, tokens ni copias desencriptadas en repositorios,
carpetas públicas, chats o planillas.

## Qué protege el respaldo

La copia SQL cifrada protege todas las tablas: usuarios, clientes, catálogo,
stock, ventas, ítems, pagos, cajas, fichajes, auditoría, comprobantes y estados
operativos. Los cierres enviados a Sheets y la constancia de ARCA son controles
complementarios; no reemplazan esta copia.

Los archivos de usuario y la configuración privada se empaquetan por separado
(`lartisan-assets-*.zip.enc`) y se cifran antes de enviarse al destino privado.
Se incluyen documentos, imágenes, adjuntos y las configuraciones de recuperación
fuera del webroot. La clave de cifrado no se incorpora jamás al archivo.

## Configuración privada requerida en el servidor

Las credenciales de Drive viven en `/lartisan-backup-config.php` y la clave
aleatoria de 32 bytes codificada en base64 vive separada en
`/lartisan-backup-encryption.php`, ambos fuera de `public_html` y con permisos
`600`. La clave se guarda además en un gestor de secretos administrado; no se
imprime ni se copia en este documento.

La tarea programada debe ejecutar la copia todos los días. Además, la limpieza
automática conserva en Drive clases `daily` por 30 días, `weekly` por 92 días y
`monthly` por 366 días. La copia local conserva únicamente 30 días. El monitor
avisa si falla una copia, si falla la integridad/cifrado, o si pasan más de 26
horas sin respaldos de base y archivos verificados. Las alertas se deduplican por
incidente durante seis horas.

## Recuperación segura

1. Detener escrituras y preservar el estado actual mediante una copia nueva.
2. Elegir la última copia `verified`, con hash y validación `restore_ready`.
3. Descargarla en un entorno aislado, validar el hash y descifrarla únicamente
   allí con la clave privada.
4. Restaurar en una base aislada, nunca sobre Producción.
5. Validar usuarios, clientes, ventas, stock, cajas, fichajes, auditoría,
   comprobantes, adjuntos, reportes y sincronización de cierre.
6. Registrar fecha, responsable, copia elegida, duración y resultado de la
   prueba. Si falla, eliminar el entorno de prueba y escalar con el mensaje de
   error sin secretos.
7. Solo ante una aprobación de Administración, planificar la recuperación de
   Producción. Antes de cambiarla, realizar una copia de su estado presente.

## Prueba mensual

`backup_restore_test.php` realiza primero un preflight no destructivo: comprueba
el hash, la autenticidad AES-GCM, la estructura SQL esencial y el manifiesto de
adjuntos, sin modificar Producción. Su resultado queda en
`backup_restore_tests` y un fallo abre una alerta.

Para completar la restauración mensual real se requiere una base MySQL aislada,
con usuario exclusivo y sin acceso a Producción. Una vez configurada por
Administración, se importa allí la copia, se validan los recuentos, usuarios,
ventas, stock, cajas, reportes y arranque de API sin ARCA ni Drive. No se debe
marcar esa etapa como completa hasta que exista esa base aislada y se haya
registrado una ejecución satisfactoria.
