# Publicación de cierres en Google Sheets

Archivos a publicar en `public_html/sistema-api`:

- `index.php`
- `cash_sheet_sync.php`

No se debe reemplazar `config.local.php`. En el archivo privado de integración
fuera de `public_html` (`/lartisan-backup-config.php`) se debe añadir la
sección `cash_sheet_sync` de `config.example.php`. Conservar las claves de
respaldo que ya existen y agregar esta nueva sección, no reemplazar el archivo
completo.

En Google Cloud, dentro del cliente OAuth ya utilizado por el sistema, agregar
la URI de redirección exacta:

`https://www.lartisantaller.com/sistema-api/admin/cash-sheets/google-callback`

Luego, una persona con acceso de edición a las planillas debe abrir la ruta de
autorización como Administración:

`GET /sistema-api/admin/cash-sheets/authorization-url`

La cuenta Google elegida debe tener permiso Editor en las planillas de
Recoleta, Villa Mitre, Congreso y Maure. Novo Pacheco queda bloqueado hasta
registrar su ID, pestaña y encabezados verificados.

La integración sólo actualiza la fila preexistente de la fecha del cierre. No
crea filas, no pisa fórmulas y se detiene si alguna celda ya contiene un valor
distinto. Cada cierre se identifica por un UUID y un reintento no duplica la
carga.
