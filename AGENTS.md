# Instrucciones para agentes y desarrolladores — Sistema L'Artisan

Este archivo lo leen automáticamente Codex y otros agentes de código. Aplica a
cualquier persona o herramienta que modifique el proyecto.

El sistema pasó por una auditoría (octubre 2026) que corrigió 31 errores, varios
críticos (ventas que no se guardaban, cajas que no llegaban a reportes,
facturación ARCA que no funcionaba). Las reglas de abajo existen para que esos
errores **no vuelvan**. Cada una está protegida por una prueba automática.

## Antes de entregar cualquier cambio

1. Corré `npm run check`. Tiene que terminar en `✓ Todo en orden`.
2. Si una prueba falla, **el problema casi siempre está en el cambio, no en la
   prueba**. No borres, no debilites ni saltees pruebas para que pasen. Si de
   verdad hay que cambiar una regla, explicá por qué en el commit y actualizá la
   prueba y este archivo en el mismo cambio.
3. Si el cambio toca ventas, caja, stock o la API, probalo además en el entorno
   local (`dev/README.md`) operando la pantalla, no solo con pruebas.
4. Un commit por tema, con un mensaje que diga qué se corrigió y cómo se verificó.

## Arquitectura en dos líneas

- **Web**: `app/` (React/Next con vinext). Toda la lógica de pantallas está en
  `app/page.tsx`; los módulos nuevos van en `app/modules/<área>/`.
- **API**: `donweb-api/` (PHP 8 + MySQL en DonWeb). `index.php` enruta,
  `bootstrap.php` tiene permisos, sincronización y reglas de negocio.
- Cada local guarda su operación en un estado JSON (`operation_site_states`) que
  la web envía completo y el servidor autoriza, combina, recorta y copia a tablas
  normalizadas (`lartisan_sales`, `lartisan_cash_sessions`, etc.).

## Reglas que no se pueden romper

### Guardado de ventas
- **`keepalive` solo para envíos menores a 60 KB** (`sendPendingWrite`). Chrome y
  Edge descartan sin enviar un keepalive de más de 64 KB: las ventas quedaban
  pendientes para siempre.
- **La cola de pendientes vive en IndexedDB** (`modules/shared/operationalOutbox.ts`),
  nunca en `localStorage` (5 MB: no alcanzaba para dos ventas sin conexión).
- **Orden estricto por local**: un envío ya despachado se reintenta con el mismo
  `requestId`; lo posterior espera su confirmación. Saltear este orden descuenta
  stock dos veces.
- **No recargar el estado (`loadOperationalData`) con operaciones pendientes**:
  pisaría cambios no confirmados.

### Estado de cada local (servidor)
- **Todo PUT de operaciones pasa por `compact_operational_state` y
  `archive_removed_operational_items`**. Sin eso el estado crece hasta 4 MB y el
  local se bloquea (~1.850 ventas). Nada se borra: lo recortado va a
  `operation_archive` y las ventas siguen en `lartisan_sales`.
- **Una lista nueva en el estado** (por ejemplo, un nuevo tipo de registro) debe
  agregarse a `operational_retention_rules()` (con su fecha y estados "cerrados")
  y a las reglas de permisos de `authorize_operational_snapshot()`.
- **Nunca mandar un campo como `undefined` para borrarlo**: JSON lo omite y el
  servidor conserva el valor viejo. Usar `null` (ver `activeShift`).
- **Con `baseState`, `/sync` siempre combina** (`merge_operational_snapshot`),
  aunque la revisión coincida: tras una confirmación combinada el navegador
  conoce la revisión nueva pero no las ventas de otro equipo, y reemplazar el
  estado las sacaba del local.
- **Dentro de la transacción de `/sync` no puede haber DDL** (`CREATE`/`ALTER`):
  MySQL hace COMMIT implícito, libera el `FOR UPDATE` y el rollback deja de
  servir. La estructura se crea en la migración inicial de `index.php`.
- **Un rechazo definitivo responde 422** (`OperationalSyncRejected`): la cola
  del equipo se detiene y se conserva. Un 500 hace que reintente a ciegas.
- **El `requestId` se busca después de bloquear el local**: dos envíos
  paralelos del mismo pedido no se procesan dos veces.

### Importes, caja y stock
- **El servidor no confía en los importes del navegador**: `validate_operational_sales`
  recalcula cada venta y registra diferencias. Si cambiás cómo se calcula una
  venta en la pantalla, actualizá también esa función y `tests/sale-validation.php`.
- **El comprobante de una venta registrada** solo lo cambia quien puede anular, y
  nunca si tiene factura ARCA (`enforce_invoice_type_changes`).
- **Aprobar un ajuste de stock aplica la diferencia** (`contado − teórico`) sobre
  el stock vigente; nunca asignar el número contado.
- **El egreso pagado con efectivo** se registra en el libro de caja; no pedir que
  se repita en el cierre.
- **Relevo acumulado**: un único envío con el cierre (con arqueo) del turno
  vigente y la apertura propia del siguiente es válido; cualquier otra apertura
  sobre una caja abierta es un conflicto (422) para conciliar.
- **Cierre obsoleto rechazado**: se descartan solo sus asientos de cierre
  (cierre, sobre, gastos y retiros declarados); ventas, egresos y devoluciones
  del turno anterior se conservan.

### Permisos
- **Nunca autorizar por nombre de usuario.** Los permisos se asignan en
  Administración → Usuarios (`action_permissions`). Una prueba lo impide.
- **Editar un usuario sin enviar permisos conserva los existentes**; `NULL`
  significa "los del cargo" y no debe convertirse en `[]`.
- **Los límites por local** (`limitsBySite`) se envían a cada usuario solo para
  sus locales; la web los combina sobre los valores por defecto.
- **Central de pedidos** recibe de los locales que no opera solo pedidos y ajustes
  (`central_site_view`) y solo puede cambiar eso (`authorize_central_changes`).

### Servidor y seguridad
- **Toda escritura exige un `Origin` habilitado** y que el usuario no tenga
  contraseña temporal (comienzo de `index.php`). No agregar excepciones.
- **`.htaccess` deniega todo** salvo `index.php` y `backup.php`.
- **Una sola zona horaria** (`timezone`, por defecto Argentina) para PHP y MySQL.
  Las fechas ISO del navegador se convierten con `iso_datetime`.
- **Errores**: los mensajes de configuración pueden mostrarse a Administración;
  los de base de datos (`PDOException`) nunca. El manejador global responde JSON.
- **SQL**: consultas siempre con parámetros. Cada `INSERT` debe tener la misma
  cantidad de columnas que de valores (la prueba lo verifica en todo `donweb-api/`).
- **Nunca** versionar `config.local.php`, claves, certificados ni datos reales.

### Facturación ARCA
- Solo un rechazo explícito (`Resultado = R`) habilita reintentar. Cualquier
  respuesta dudosa queda `requires_reconciliation`: reintentar puede emitir dos
  veces el mismo comprobante.

## Pruebas

| Comando | Qué cubre |
|---|---|
| `npm run check` | Todo: tipos, lint, JavaScript y PHP |
| `npm run test:regresion` | Las correcciones de la auditoría |
| `npm run test:security` | Seguridad, cola de pendientes, permisos |
| `php tests/*.php` (con `LARTISAN_CONFIG=dev/config.dev.php`) | Reglas del servidor |
| `npm run test:simulacion-fallas` (entorno local levantado) | Cortes, respuestas perdidas o incompletas, 500, reintentos, cambio de usuario, varios equipos y conflictos de caja; verifica ventas, pagos, stock y caja |

Al corregir un error nuevo, agregá una prueba que falle sin la corrección.

## Entorno local

Ver `dev/README.md`: MariaDB, PHP y la web en la PC, con datos inventados y
usuarios de prueba. No usar datos ni credenciales reales.

## Publicación

Ver `deploy/PUBLICACION_CORRECCIONES.md`. La web y la API se publican juntas,
fuera del horario de venta y después de un respaldo.
