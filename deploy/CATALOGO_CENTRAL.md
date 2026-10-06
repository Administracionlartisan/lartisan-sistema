# Catálogo y precios

> **Actualización (auditoría, octubre 2026):** la interfaz usa el catálogo de la
> API PHP (`/sistema-api/catalog`, tabla MySQL `catalog_documents`), que entra en
> el respaldo de la base. La ruta `/api/catalog` sobre D1 descripta abajo sigue
> en el proyecto pero la interfaz no la utiliza.

- Fuente compartida: `GET /api/catalog`, persistida en D1, tabla `catalog_revisions`.
- Identidad: cookie HTTP-only de DonWeb, validada en su `auth/me`. GET requiere sesión; PUT exige Administración y mismo origen. No hay contraseña ni bypass en el cliente.
- La migración Drizzle solo crea una tabla nueva. No cambia tablas operativas, cantidades de stock ni IDs.
- Antes de la primera escritura, recupera precios vigentes de las operaciones existentes. El primer acceso de Administración guarda esa lista como revisión 1.
- Cada guardado agrega una revisión completa con responsable y fecha; la PK impide pisar una edición concurrente.
- Las lecturas de locales se actualizan al volver a la ventana, recuperar conexión y cada 30 segundos mientras está visible.
- Un alta recibe un ID nuevo consecutivo y stock 0. No se reutilizan IDs ni se borran productos con historial.
- Cambiar un código conserva el anterior como alias. LART-401 sigue siendo alias de Raviolón de Berenjena (LART-501). Ningún alias puede pertenecer a otro producto.
- El formato admitido es LART- más tres dígitos; el apóstrofe de las lectoras con otra distribución de teclado también se reconoce.
- Cada producto conserva precio Mostrador y Online. Los aumentos y su restauración afectan Mostrador; no reescriben ventas anteriores.
- El respaldo DonWeb/MySQL no incluye esta tabla D1. Las revisiones completas se conservan en D1; su recuperación administrativa debe usar esa base, no restaurar únicamente MySQL. La exportación CSV sirve para etiquetas, no sustituye una copia integral de D1.

## Verificación

`npm run test:catalog`: ejecuta validaciones y el endpoint real contra SQLite con identidad simulada: sesión, roles, CSRF, migración, conservación de precios, persistencia, alias y conflictos.

`node tests/catalog-browser.mjs`: copia aislada solo en 127.0.0.1:8971. No usa operaciones reales. Permite probar alta/edición y ver el catálogo en Ventas, Pedido y Stock con `?role=vendedora`.

Construcción y pruebas de catálogo, seguridad, estructura y ayuda verificadas. El chequeo global TypeScript mantiene errores previos en MRP y la lectura de diagnóstico de la página; no están introducidos por el catálogo.

## Incidente de conexión del 29/09/2026

- Corregido `redirect: "error"`, no soportado por workerd: se usa `manual` y no se siguen redirecciones con cookies.
- Agregada una prueba de la ruta compilada dentro de workerd/Miniflare y D1, además de SQLite. Son pruebas aisladas, no acreditan acceso autenticado a producción.
- El servidor publicado devolvió HTTP 526 al consultar el `auth/me` de DonWeb. El navegador/local IPv4 sí obtiene respuesta; esto no demuestra que todos los destinos o cadenas TLS del hosting estén correctos. El dominio raíz alternativo también fue probado y no solucionó el problema.
- Se mantiene la validación TLS y la autorización: no se usan HTTP, certificados ignorados ni una identidad proporcionada por el navegador. El mensaje del catálogo distingue ahora la falla del certificado.
- Pendiente: revisar certificado/cadena y configuración IPv4/IPv6 en DonWeb. La sesión del panel estaba vencida; se solicitó al propietario iniciar sesión. Después se debe verificar GET autenticado, revisión inicial y apertura de edición sin modificar precios reales para pruebas.
- La tabla central estaba vacía durante el diagnóstico. No se cambió stock, no se cobraron ventas y no se agregaron productos de prueba en producción.
