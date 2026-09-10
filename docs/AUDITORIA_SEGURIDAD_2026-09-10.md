# Auditoría y corrección de seguridad — 10/09/2026

## Alcance real

El repositorio no es una aplicación de Google Apps Script: no contiene archivos `.gs`, `appsscript.json`, scriptlets ni llamadas `google.script.run`. La interfaz real es React/Vinext y la API es PHP/MySQL en DonWeb. Por eso las correcciones equivalentes se aplicaron en `app/` y `donweb-api/`; no se inventaron archivos de Apps Script ni Script Properties.

## Reporte de Fase 1

| Archivo | Línea original aproximada | Hallazgo | Qué se exponía / riesgo | Severidad |
| --- | ---: | --- | --- | --- |
| `app/page.tsx` | 590–623 | Nómina fija en el cliente | Nombres, cargos, locales, identificadores de acceso y reglas especiales podían leerse en el JavaScript público. | Alta |
| `app/page.tsx` | 740–860, 6962 | Enlaces e IDs de Drive en el cliente | La aplicación entregaba identificadores de hojas y enlaces internos a cualquier navegador que descargara el bundle. | Alta |
| `app/page.tsx` | 3293, 3331 | Cuenta administrativa visible | El placeholder y el mensaje de recuperación revelaban un identificador válido. | Alta |
| `app/page.tsx` y ayuda | varias | Autorización ligada a nombres propios | Algunas funciones especiales dependían del nombre de una persona, dato manipulable y además visible en el cliente. | Alta |
| `donweb-api/index.php` | 437–491 | Estado operativo modificable sin permiso por acción | La API comprobaba sesión y local, pero aceptaba el estado completo enviado por el navegador. Ocultar botones no impedía forjar cambios. | Alta |
| `donweb-api/index.php` | 408–435 | Respuesta operativa demasiado amplia | Un usuario recibía campos del local que no necesitaba para sus permisos. | Media |
| `donweb-api/index.php`, `pnl_sync.php`, `config.example.php` | 102, 130, 28 | ID financiero versionado | El identificador de la hoja P&L estaba dentro del código del servidor y del ejemplo de configuración. | Media |
| `donweb-api/config.local.php` | local | Configuración privada sin regla de exclusión específica | Aunque el archivo nunca fue versionado, era fácil agregarlo por error a Git o a un paquete. | Alta |
| administración de usuarios | varias | Doble factor presentado como requerido sin flujo real | La bandera no agregaba una segunda verificación al inicio de sesión y podía dar una falsa sensación de protección. | Alta |

No encontrado: Apps Script, `appsscript.json`, contraseñas en texto plano, hashes/salts enviados al navegador, API keys reales versionadas, tokens OAuth versionados, claves privadas o login que diferencie “usuario inexistente” de “contraseña incorrecta”. Las contraseñas usan `password_hash`/`password_verify` y las sesiones usan tokens aleatorios almacenados como hash, con expiración y cookie `HttpOnly`, `Secure` y `SameSite=Lax`.

## Cambios realizados

- `.gitignore`: excluye configuración local, archivos `*.local.php`, paquetes de publicación y artefactos generados.
- `app/page.tsx`: eliminó la nómina fija, correos, links/IDs de Drive y excepciones por nombre. Los usuarios se cargan solo después de autenticar contra la API. El login queda vacío y los mensajes no identifican cuentas. El control de doble factor queda deshabilitado y marcado como pendiente hasta que exista una verificación real.
- `app/data/assistantKnowledge.ts`, `app/data/reportGuide.ts` y documentación: reemplazaron nombres personales por cargos y permisos explícitos.
- `donweb-api/config.example.php`: contiene únicamente marcadores de configuración; no incluye IDs, correos ni nombres reales de base de datos.
- `donweb-api/config.local.php`: conserva la configuración real fuera de Git. La fuente P&L se trasladó allí sin publicar su valor.
- `donweb-api/bootstrap.php`: identifica la cuenta principal desde configuración privada, aplica permisos de acción del servidor, filtra la lectura por mínimo privilegio y acepta únicamente las partes del estado que el usuario puede modificar.
- `donweb-api/index.php`: ignora el tipo y detalle de auditoría enviados por el navegador, genera el evento en el servidor, filtra estados antes de responder, protege la cuenta principal por configuración y devuelve usuarios mediante una lista segura de campos.
- `donweb-api/pnl_sync.php`: exige que el ID financiero exista en configuración privada y ya no tiene un valor real de respaldo en el código.
- `tests/security.test.mjs`: impide regresiones de enlaces internos, correos, directorios de usuarios, IDs financieros, eventos confiados al cliente y material de contraseñas.

## Explicación sencilla

Antes, una persona podía abrir las herramientas del navegador y leer información interna que venía incluida en la página. Además, aunque un botón estuviera oculto, era posible fabricar una petición directa a la API con cambios que el perfil no debía realizar.

Ahora el navegador no recibe una agenda de usuarios ni conoce las direcciones de las hojas. La API consulta quién inició sesión, qué local tiene asignado y qué permiso posee antes de aceptar cada parte del cambio. Los campos no autorizados se conservan sin modificación y los eventos de auditoría los construye el servidor, no el navegador.

## ACCIÓN MANUAL REQUERIDA

1. Publicar conjuntamente la nueva interfaz y la nueva API; publicar solo una de las dos partes puede dejar incompatibilidades. Esta auditoría no realizó ningún despliegue.
2. Antes de publicar, confirmar que `donweb-api/config.local.php` existe en el servidor y mantiene la configuración de base, recuperación y P&L. Nunca subirlo a Git ni incluirlo en un archivo público.
3. Revisar en Google Drive que las hojas estén restringidas únicamente a las cuentas necesarias. Un ID no es una contraseña, pero dejar el archivo como “cualquiera con el enlace” anularía parte de esta protección.
4. Implementar y probar un segundo factor real antes de volver a habilitar esa opción. La casilla quedó desactivada para no prometer una protección inexistente.
5. Si el repositorio remoto fue público o compartido ampliamente, limpiar su historial o crear un repositorio nuevo y limpio. La versión actual no contiene los identificadores, pero los commits anteriores pueden conservar nombres e IDs (no credenciales).
6. No reutilizar los paquetes `.zip`/`.tar.gz` antiguos para publicar: contienen versiones anteriores. Generar un paquete nuevo únicamente después de aprobar estos cambios.

## Verificación final

- Sin IDs o URLs de Drive en el código cliente actual: **cumple**.
- Sin secretos en JavaScript del cliente: **cumple**.
- Sin hashes, salts o contraseñas en respuestas públicas: **cumple**.
- Sin lista fija de usuarios en el cliente: **cumple**.
- Login sin enumeración y con campos vacíos: **cumple**.
- Sesión y autorización validadas por el servidor: **cumple**.
- Respuestas operativas filtradas por permisos: **cumple**.
- Configuración privada fuera de Git: **cumple**; el archivo nunca apareció en los 65 commits revisados.
- Segundo factor real: **pendiente**, y la interfaz ya no afirma que esté activo.
- Historial remoto sin identificadores antiguos: **requiere acción manual** si el repositorio fue compartido.
- Deploy realizado: **no**.

Pruebas ejecutadas: 1.520 pruebas de ayuda/reportes, 4 pruebas de seguridad, ESLint, sintaxis PHP y compilación de producción; todas finalizaron correctamente.
