# L'ARTISAN · Respaldo y recuperación

Este procedimiento es exclusivo de Administración autorizada. No guardar
claves, certificados, tokens ni copias desencriptadas en repositorios,
carpetas públicas, chats o planillas.

## Qué protege el respaldo

La copia SQL cifrada protege todas las tablas: usuarios, clientes, catálogo,
stock, ventas, ítems, pagos, cajas, fichajes, auditoría, comprobantes y estados
operativos. Los cierres enviados a Sheets y la constancia de ARCA son controles
complementarios; no reemplazan esta copia.

Los archivos de usuario y la configuración privada se respaldan por una tarea
separada, en un destino privado cifrado. No se deben incluir directamente en la
copia SQL ni subir a `public_html`.

## Configuración privada requerida en el servidor

En `/lartisan-backup-config.php` (fuera de `public_html`, permisos `600`) debe
existir una clave aleatoria de 32 bytes codificada en base64, más las credenciales
de Drive ya autorizadas. La clave se genera una única vez en el servidor y se
guarda en un gestor de secretos administrado; no se imprime ni se copia en este
documento.

La tarea programada debe ejecutar la copia todos los días. Además, debe conservar
en Drive clases `daily` por 30 días, `weekly` por 3 meses y `monthly` por 12
meses. La tarea local conserva únicamente 30 días. El monitor se ejecuta cada
hora y avisa si falla una copia o pasan más de 26 horas sin una copia cifrada y
validada.

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

La prueba se hace en una base aislada y con una copia reciente. Debe comprobar
la estructura, los recuentos esenciales y el arranque de la API sin emitir
facturas, sincronizar Drive ni modificar Producción. El resultado se guarda en
`backup_restore_tests` y cualquier fallo abre una alerta.
