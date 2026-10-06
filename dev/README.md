# Entorno local de pruebas

Todo corre en esta PC, con datos inventados. No se conecta a DonWeb, Google,
OpenAI ni ARCA. Nada de esta carpeta se publica.

| Pieza | Dónde | Puerto |
|---|---|---|
| MariaDB 11.4 | `C:\lartisan-dev\mariadb`, datos en `C:\lartisan-dev\data` | 127.0.0.1:3307 |
| PHP 8.3 (API) | `C:\lartisan-dev\php` | http://localhost:8080/sistema-api |
| Web (vinext) | este proyecto | http://localhost:3000 |

## Levantar

En tres terminales, desde la carpeta del proyecto:

```powershell
# 1. Base de datos
C:\lartisan-dev\mariadb\bin\mariadbd.exe --defaults-file=C:/lartisan-dev/data/my.ini --console

# 2. API (usa dev/config.dev.php, nunca config.local.php)
$env:LARTISAN_CONFIG = "$PWD\dev\config.dev.php"
C:\lartisan-dev\php\php.exe -S 127.0.0.1:8080 dev\router.php

# 3. Web apuntando a la API local
$env:VITE_LARTISAN_API_BASE = "http://localhost:8080/sistema-api"
npx vinext dev --port 3000
```

Primera vez (o para reponer usuarios): `C:\lartisan-dev\php\php.exe dev\seed.php`

## Acceso

- Administración: http://localhost:3000/?portal=admin
- Ventas: http://localhost:3000/?portal=ventas

Usuarios (clave `Pruebas2026!`): `admin.pruebas`, `supervisora.pruebas`,
`vendedora.pruebas`, `compras.pruebas`.

## Notas

- `schema-base.sql` reconstruye las tablas que la API no crea (`users`,
  `user_sessions`, `audit_log`, `password_reset_requests`) a partir del código.
  Debe compararse con producción (`SHOW CREATE TABLE ...`) cuando haya acceso.
- `router.php` imita el `.htaccess`: solo `index.php` responde; el resto de los
  archivos de `donweb-api/` devuelven 403.
- Para borrar todo el entorno: detener los procesos y eliminar `C:\lartisan-dev`.
