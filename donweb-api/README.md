# API privada de L'Artisan

Servicio PHP independiente para autenticación, sesiones, solicitudes de recuperación y administración de usuarios.

- Publicar en una carpeta exclusiva, por ejemplo `sistema-api`.
- Copiar `config.example.php` como `config.local.php` únicamente en el servidor.
- No versionar ni descargar `config.local.php`.
- Los orígenes habilitados son `ventas.lartisantaller.com` y `admin.lartisantaller.com`.
- La cookie de sesión es segura, HTTP-only y compartida solo dentro de `lartisantaller.com`.

## Respaldo programado

- `backup.php run` genera una copia SQL comprimida, verifica que esté completa y la sube a la carpeta privada de Google Drive configurada.
- `backup.php verify` valida la copia más reciente sin modificar la base de datos.
- Las copias locales se guardan fuera de `public_html` y se eliminan según `local_retention_days`.
- Programación requerida en DonWeb: lunes y jueves a las 21:00 (`0 21 * * 1,4`).
- En DonWeb, las credenciales y la clave del disparador se guardan en `/lartisan-backup-config.php`, fuera de `public_html`, con permisos `600`; nunca se incorporan al repositorio.
- La tarea de Ferozo invoca `backup.php` por HTTPS con la clave en el encabezado `X-Backup-Key`; cualquier acceso normal sin esa clave responde `404`.

## ARCA · Factura Electrónica (WSFE)

La base de la integración se publica con la emisión desactivada. El estado se
consulta como Administración en `GET /sistema-api/admin/arca/status`; esa ruta
jamás expone rutas, claves, token ni certificado.

- La clave privada y el certificado firmado se guardan fuera de `public_html`,
  por ejemplo en `/lartisan-arca/`, con permisos `600`.
- El archivo privado `/lartisan-arca-config.php` debe devolver solo la sección
  `arca` de `config.example.php`, con `environment` en `homologacion` durante
  las pruebas y las rutas absolutas al `.crt` y al `.key`.
- Nunca se suben la clave privada, el certificado, token o firma a Git, al
  frontend ni a una carpeta accesible desde la web.
- La emisión en producción queda bloqueada hasta completar una prueba WSAA/WSFE
  de homologación y configurar los datos fiscales del comprobante.
