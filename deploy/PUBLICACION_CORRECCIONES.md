# Publicación de las correcciones (rama `fix/auditoria-bugs`)

Guía para subir las correcciones de la auditoría. La web y la API cambian en
conjunto: **se publican las dos en la misma ventana**, fuera del horario de venta.

## 1. Antes de publicar

1. Respaldo de la base desde Administración → Protección de datos (o
   `backup.php run`) y copia de la versión publicada actual de la web y de
   `sistema-api/`.
2. Confirmar que ningún equipo de los locales tenga operaciones pendientes
   (Tareas → «Sin operaciones pendientes de sincronización»).

## 2. API (DonWeb, carpeta `sistema-api/`)

Reemplazar estos archivos de `donweb-api/`:

| Archivo | Motivo principal |
|---|---|
| `.htaccess` | Bloquea todo salvo `index.php` y `backup.php` |
| `index.php` | Origen obligatorio en escrituras, clave temporal, fiscal, límites, permisos |
| `bootstrap.php` | Zona horaria, recorte y archivo del estado, control de importes, cajas |
| `arca_fiscal_queue.php` | Preparación de facturas y notas de crédito |
| `arca_wsfe.php` | Respuesta de ARCA sin CAE legible → pendiente de conciliación |
| `mrp_sync.php` | Permisos de recetas y stock de insumos |

**No** subir `config.example.php` como configuración ni la carpeta `dev/`.
En `config.local.php` del servidor se pueden agregar (opcionales, con estos
valores por defecto):

```php
'timezone' => 'America/Argentina/Buenos_Aires',
'operations' => ['retention_days' => 60],
```

Las tablas nuevas (`operation_archive`, `sale_validation_findings`) se crean
solas en el primer acceso.

## 3. Web

`npm ci && npm run build` y publicar `dist/` por la vía habitual. Sin
`VITE_LARTISAN_API_BASE`, la web usa `https://www.lartisantaller.com/sistema-api`.

## 4. Verificar inmediatamente

1. `https://www.lartisantaller.com/sistema-api/health` → `{"ok":true,...}`.
2. `https://www.lartisantaller.com/sistema-api/config.local.php` → **403**.
   Si devuelve otra cosa, restaurar el `.htaccess` anterior y avisar.
3. Iniciar sesión en ventas y en admin; hacer una venta de prueba y anularla.
4. En cada equipo de los locales: cerrar sesión y volver a ingresar.

## 5. Configuración en Administración → Usuarios

Los permisos que antes dependían de nombres fijos en el código ahora se asignan:

| Permiso | A quién se le daba antes por nombre |
|---|---|
| Cargar compras de producción (con acceso a Villa Mitre) | yamila.palavecino, valentina.parra |
| Editar recetas y costos | jhaiber.brazon |
| Contar stock de insumos (MRP) | usuarios con «betzi» en el nombre |

**Central de pedidos**: alcanza con acceso a Villa Mitre y permiso de pedidos.
De los demás locales ve solo pedidos y ajustes pendientes; puede preparar,
despachar y aprobar/rechazar ajustes, pero no vender ni operar caja o stock en
ellos. Si un usuario de Central tenía «Todos los locales» solo para ver
pedidos, conviene quitárselo.

Revisar también **Límites**: los valores de cada local (descuento, egreso,
diferencia de caja) ahora sí se aplican en los locales. Una diferencia de caja
mayor al límite ya no bloquea el cierre: pide un motivo y crea una incidencia
para Administración.

## 5 bis. Cambios de funcionamiento acordados

- **Egresos**: «Pagado con efectivo de la caja» (marcado por defecto)
  descuenta el egreso del efectivo esperado. En el cierre, el campo se llama
  «Otros gastos en efectivo (no cargados en Egresos)».
- **Comprobante de una venta registrada**: solo con permiso «Anular ventas» y
  nunca si la venta ya tiene comprobante ARCA.
- **Contraseña temporal**: hasta cambiarla, el usuario no puede registrar
  ninguna operación.

## 6. Volver atrás

Restaurar los archivos de `sistema-api/` y la web guardados en el paso 1. Las
tablas nuevas pueden quedar: la versión anterior no las usa. Los datos
operativos recortados del estado de cada local siguen en `operation_archive` y
`lartisan_sales`.

## 7. No verificado en el entorno local

ARCA real (homologación/producción), Google (P&L, gastos, respaldo a Drive) y
OpenAI: no había credenciales. Sin ellas cada integración responde con un
mensaje claro. Probarlas en el servidor después de publicar.
