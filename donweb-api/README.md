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
- Las credenciales de Drive deben existir únicamente en `config.local.php`, nunca en el repositorio.
