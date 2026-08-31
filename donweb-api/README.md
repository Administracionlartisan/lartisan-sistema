# API privada de L'Artisan

Servicio PHP independiente para autenticación, sesiones, solicitudes de recuperación y administración de usuarios.

- Publicar en una carpeta exclusiva, por ejemplo `sistema-api`.
- Copiar `config.example.php` como `config.local.php` únicamente en el servidor.
- No versionar ni descargar `config.local.php`.
- Los orígenes habilitados son `ventas.lartisantaller.com` y `admin.lartisantaller.com`.
- La cookie de sesión es segura, HTTP-only y compartida solo dentro de `lartisantaller.com`.

