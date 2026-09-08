# Auditoría de la ayuda L’ARTISAN

Fecha: 8 de septiembre de 2026. Alcance: código local del portal, guía, búsqueda y diagnóstico de pantalla. No es una auditoría de producción, penetración, base de datos ni comprobación de respaldos reales. Las mejoras quedan preparadas; la publicación se verifica por separado.

## Resultado

- 86 temas, cada uno con tres presentaciones que conservan las mismas instrucciones verificadas. No se pretende cubrir todas las preguntas imaginables.
- Búsqueda por palabras completas, sin tildes ni distinción de mayúsculas, conjugaciones y sinónimos explícitos; tolerancia limitada a una edición o transposición, con precauciones para palabras cortas.
- Las consultas ambiguas ofrecen hasta tres temas, en vez de seleccionar uno arbitrariamente. Las desconocidas piden sección, acción y aviso; no inventan procedimientos.
- Seguimiento de preguntas breves como “no entendí” sobre el último tema permitido; se descarta si cambió el usuario/local, el tema o los permisos.
- Diagnóstico automático para errores de cobro/cierre/conexión solo cuando corresponde a la pantalla disponible. No consulta historial, banco, Drive ni estado completo del servidor.
- Búsqueda gratuita y sin red. El único envío del chat es la solicitud de soporte explícita, mediante “Enviar a Administración”. No hay aprendizaje automático ni notificación por WhatsApp.

## Acceso al catálogo

| Perfil | Temas disponibles |
| --- | ---: |
| Vendedora | 57 |
| Ventas de Central | 59 |
| Andrea (con sus habilitaciones actuales) | 62 |
| Betzi (con sus habilitaciones actuales) | 62 |
| Administración/Gerencia | 79 |

El filtro utiliza los booleanos reales del portal: Central, mínimos, conteo, aprobación de stock, reportes y horarios. No concede permisos. El catálogo está en el código cliente y no contiene información confidencial: ocultar preguntas no es una barrera de seguridad. La autorización de operaciones y datos debe aplicarse en el servidor.

## Hallazgos y correcciones de la ayuda

| Hallazgo | Respuesta/diagnóstico corregido | Fuente |
| --- | --- | --- |
| Frases cotidianas no encontraban respuesta | Preguntas de caja/cobro, conjugaciones, sinónimos, errores de escritura y opciones ante ambigüedad | assistantKnowledge.ts |
| Se prometía abrir otro turno después de cerrarlo | Se explica que cerrar turno mantiene caja abierta, pero openCash impide reabrirla | page.tsx: openCash / closeShift |
| Diagnóstico confundía observación con bloqueo | Falta de turno y stock insuficiente se marcan como advertencias, no como guardas existentes de pay | page.tsx: pay; operationDiagnostics.ts |
| Faltaba explicar cierre bloqueado por comandas | Se verifica comandas, sobre según local y diferencia máxima | page.tsx: confirmClose |
| Se decía que el sugerido usa mínimo y deseado | Se documenta max(mínimo − actual, 0); alerta en igualdad no implica cantidad positiva | page.tsx: suggestedOrderItems / lowStockProducts |
| Recepción y Central mezcladas, incluida la vendedora de Villa Mitre | Se separan pedido del local, preparación/faltantes y recepción | page.tsx: managesCentralOrders / confirmRequestReception |
| Recepción no tiene cantidad real editable | Se indica contar y avisar a Central antes de confirmar si no coincide | page.tsx: confirmRequestReception |
| Alta de usuario afirmaba contraseña autogenerada | Se documenta contraseña completada en el formulario de alta y tarjeta resultante | page.tsx: createManagedUser |
| Recibo de egreso parecía equivaler a archivo guardado | Se avisa que solo se conserva el nombre del archivo, no un adjunto verificable | page.tsx: expenseReceipt / submitExpense |
| Cero pendientes se interpretaba como persistencia probada | Se requiere comprobar operaciones guardadas, no solo el contador | page.tsx: syncContingency |
| Se prometían aprobaciones automáticas de límites | Se explica el bloqueo y la revisión humana; el chat no aprueba | page.tsx: pay / submitExpense / confirmClose |
| Respaldo, fiscal y MFA se daban por activos | Se distingue política, configuración, maqueta y prueba efectiva | Protección de datos / Integraciones / acceso |
| Un aviso previo se copiaba al diagnóstico como causa actual | No se repite recentMessage: puede ser ajeno al caso o contener una clave temporal | operationDiagnostics.ts |

## Pendientes del producto detectados, no modificados en esta tarea

1. **Relevo de caja/turnos:** completar el inicio de un turno nuevo sobre una caja abierta, con pruebas de responsables y arqueos.
2. **Corrección de medio de pago:** changeSalePayment cambia venta/pagos, pero no reconstruye todo el libro de caja; revisar también pagos divididos antes de prometer conciliación automática.
3. **Comprobantes de egresos:** falta verificar/implementar carga del contenido, almacenamiento privado y recuperación, no solo el nombre.
4. **Sincronización:** syncContingency pone el contador en cero antes de demostrar confirmación durable del servidor. Debe ligarse a un acuse real y verificarse ante desconexiones/conflictos.
5. **Permisos por nombre:** isAndrea/isBetzi y parte de Central dependen del nombre/perfil principal. Migrar a permisos explícitos del servidor es una mejora pendiente, no realizada aquí.
6. **Respaldos y salud:** la pantalla mezcla indicadores calculados con mensajes fijos o pendientes. Verificar planificador, última copia externa, restauración y pruebas efectivas; esta tarea no los certifica.
7. **Ruta antigua de IA paga:** donweb-api/index.php todavía define POST assistant/chat, que puede llamar assistant_openai_response si su configuración lo permite. El chat gratuito no la llama (comprobado por pruebas estáticas). Revisar su retiro/deshabilitación por separado; no se inspeccionaron secretos ni se modificó DonWeb.
8. **Otras limitaciones de operación:** el cierre y el libro de caja tienen cálculos distintos que requieren conciliación; anular una venta con devoluciones previas merece validación específica; algunas vistas administrativas incluyen datos históricos/de demostración.
9. **Longitud temporal:** resetPassword contiene un generador distinto de ocho caracteres. La guía no promete una longitud fija; revisar ese flujo frente al requerimiento previo de ocho caracteres.
10. **Fiscal y doble factor:** no afirmar activación hasta implementación y pruebas correspondientes.

## Verificación

- Comando: npm run test:help. Incluye preguntas canónicas por perfil, mayúsculas/sin tildes, variantes reales, faltas de escritura, ambigüedad, fuera de alcance, permisos, seguimiento y diagnóstico de solo lectura.
- Compilación: npm run build. La advertencia sobre tamaño del paquete ya requiere una tarea separada de optimización.
- Comprobación local: HTTP 200 en el servidor de desarrollo. No se registraron ventas, cierres, usuarios ni pruebas de soporte reales y no se alteró la base.
- El chequeo TypeScript general no está limpio: hay errores en el endpoint piloto (Env.DB) y en el portal (respuestas JSON y nulabilidad). No confundir la compilación exitosa con un typecheck completo aprobado. El código nuevo de búsqueda/diagnóstico se valida por separado.

## Mantenimiento

Cada cambio funcional debe actualizar la respuesta afectada, su fuente, la fecha de revisión y las pruebas. Las tres presentaciones comparten el cuerpo de instrucciones deliberadamente para no dar tres procedimientos distintos. Las consultas de soporte se revisan por una persona antes de incorporar nuevos temas. No incluir claves, tokens ni datos reales de clientes en el catálogo.

## Catálogo de preguntas y fuentes

### Ayuda

- **¿Qué puedo hacer en L’ARTISAN?** — General. Fuente: app/page.tsx · tabs / roleTasks.
- **¿Esta ayuda consume tokens o tiene costo?** — General. Fuente: app/components/AiHelpChat.tsx · ask.
- **¿La ayuda puede modificar datos o hacer operaciones?** — General. Fuente: app/components/AiHelpChat.tsx · ask / diagnose / escalate.
- **¿Podés detectar qué hice mal?** — General. Fuente: app/data/operationDiagnostics.ts.
- **¿Dónde llega Enviar a Administración?** — General. Fuente: app/components/AiHelpChat.tsx · escalate; donweb-api/index.php · assistant/escalate.

### Acceso

- **¿Cómo ingreso por primera vez?** — General. Fuente: app/page.tsx · enter / changeOwnPassword.
- **¿Qué hago si olvidé mi contraseña?** — General. Fuente: donweb-api/index.php · password recovery routes.
- **¿Por qué no puedo ingresar?** — General. Fuente: app/page.tsx · enter.
- **¿El usuario distingue mayúsculas y minúsculas?** — General. Fuente: donweb-api/index.php · auth/login.
- **¿Qué requisitos tiene mi contraseña nueva?** — General. Fuente: donweb-api/index.php · password validation.
- **¿Cómo veo la contraseña que estoy escribiendo?** — General. Fuente: app/page.tsx · showPassword.
- **¿Está activo el doble factor?** — General. Fuente: app/page.tsx · login screen.
- **¿Cómo elijo el local donde voy a trabajar?** — General. Fuente: app/page.tsx · site / allowedSites.
- **¿Por qué no veo una sección o un botón?** — General. Fuente: app/page.tsx · can / tabs.

### Caja

- **¿Cómo funciona la caja?** — General. Fuente: app/page.tsx · openCash / confirmClose.
- **¿Cómo hago la apertura de caja?** — General. Fuente: app/page.tsx · openCash.
- **¿Por qué no puedo abrir caja?** — General. Fuente: app/page.tsx · openCash / closeShift.
- **¿Cómo hago el cierre diario de caja?** — General. Fuente: app/page.tsx · confirmClose.
- **¿Por qué no puedo cerrar caja?** — General. Fuente: app/page.tsx · confirmClose.
- **¿Cómo cierro mi turno?** — General. Fuente: app/page.tsx · closeShift / openCash.
- **¿Cómo se calcula la diferencia de caja?** — General. Fuente: app/page.tsx · expected / cashVariance / cashRemaining.
- **¿Cómo registro el sobre de efectivo?** — General. Fuente: app/page.tsx · requiresEnvelope / confirmClose.
- **¿Cómo registro un movimiento de caja?** — General. Fuente: app/page.tsx · registerCashAdjustment.
- **¿Cómo transfiero efectivo entre cajas?** — General. Fuente: app/page.tsx · createCashTransfer / receiveCashTransfer.
- **¿Dónde veo el historial de movimientos de caja?** — General. Fuente: app/page.tsx · cashLedger.

### Ventas

- **¿Cómo registro una venta?** — General. Fuente: app/page.tsx · pay.
- **¿Por qué no puedo cobrar una venta?** — General. Fuente: app/page.tsx · pay.
- **¿Cómo cambio productos o cantidades antes de cobrar?** — General. Fuente: app/page.tsx · cart / lines.
- **¿Cómo envío solo una unidad de invitación?** — General. Fuente: app/page.tsx · invitedQuantities / pay.
- **¿Cómo aplico un descuento?** — General. Fuente: app/page.tsx · discountTotal / pay.
- **¿Cómo elijo el medio de pago?** — General. Fuente: app/page.tsx · payment / pay.
- **¿Puedo cobrar una venta con dos medios de pago?** — General. Fuente: app/page.tsx · splitPayments / pay.
- **¿Qué hago si registré mal el medio de pago?** — General. Fuente: app/page.tsx · changeSalePayment.
- **¿Cómo guardo una venta para cobrarla después?** — General. Fuente: app/page.tsx · saveOrder / loadOrder / confirmClose.
- **¿Cómo anulo una venta equivocada?** — General. Fuente: app/page.tsx · cancelSale.
- **¿Cómo registro una devolución o un cambio?** — General. Fuente: app/page.tsx · registerReturn.

### Productos

- **¿Qué diferencia hay entre Mostrador y Online?** — General. Fuente: app/page.tsx · saleChannel / channelPrices.
- **¿Por qué no veo todos los productos en el celular?** — General. Fuente: app/page.tsx · filtered / category / saleChannel.

### Comprobantes

- **¿Ya está activa la facturación electrónica con ARCA?** — General. Fuente: app/page.tsx · Devoluciones / Integraciones.

### Clientes

- **¿Dónde registro o consulto un cliente?** — General. Fuente: app/page.tsx · Clientes / customer.

### Conexión

- **¿Qué hago si se corta Internet?** — General. Fuente: app/page.tsx · connectionMode / operational persistence.
- **¿Cómo reviso las ventas pendientes de sincronización?** — General. Fuente: app/page.tsx · syncContingency / operational persistence.
- **¿Puedo ingresar desde el celular?** — General. Fuente: app/page.tsx · login / operational persistence.
- **¿Qué hago si faltan datos o la página no carga?** — General. Fuente: app/page.tsx · operational persistence.

### Stock

- **¿Dónde veo los productos con stock bajo?** — General. Fuente: app/page.tsx · lowStockProducts / suggestedOrderItems.
- **¿Cómo sé por qué cambió el stock?** — General. Fuente: app/page.tsx · recordStockMovement.
- **¿Cómo configuro el stock mínimo?** — Habilitación: minimumStock. Fuente: app/page.tsx · canAdjustStock / minimumStock.
- **¿Cómo cargo un conteo físico de stock?** — Habilitación: countStock. Fuente: app/page.tsx · canCountRealStock / submitStockAdjustment.
- **¿Cómo apruebo un ajuste de stock?** — Habilitación: approveStock. Fuente: app/page.tsx · isBetzi / approveStockAdjustment.
- **¿Cómo registro un ingreso por remito o una merma?** — General. Fuente: app/page.tsx · registerStockMovement.

### Pedidos

- **¿Cómo funciona el pedido sugerido?** — General. Fuente: app/page.tsx · suggestedOrderItems.
- **¿Cómo envío un pedido de mercadería a Central?** — General. Fuente: app/page.tsx · submitStockRequest.
- **¿Por qué Villa Mitre no tiene la opción de hacer pedido?** — General. Fuente: app/page.tsx · managesCentralOrders / tabs.
- **¿Cómo gestiono un pedido que llegó a Central?** — Habilitación: central. Fuente: app/page.tsx · updateRequestStatus / confirmCentralDispatch.
- **¿Cómo indico que falta un producto del pedido?** — Habilitación: central. Fuente: app/page.tsx · preparedQuantity / confirmCentralDispatch.
- **¿Cómo confirmo que recibí un pedido en el local?** — General. Fuente: app/page.tsx · confirmRequestReception.
- **¿Dónde veo en qué estado está mi pedido?** — General. Fuente: app/page.tsx · requests / Pedido.

### Operación

- **¿Cómo registro un gasto del local?** — General. Fuente: app/page.tsx · submitExpense.
- **¿Queda guardado el archivo del comprobante de un egreso?** — General. Fuente: app/page.tsx · expenseReceipt / submitExpense.
- **¿Cómo aviso un problema del local?** — General. Fuente: app/page.tsx · submitIncident / Incidencias.

### Tareas

- **¿Dónde veo lo que tengo pendiente?** — General. Fuente: app/page.tsx · roleTasks.
- **¿Qué significa el número de alerta en Tareas?** — Administración/Gerencia. Fuente: app/page.tsx · adminTaskAlertCount.

### Personal

- **¿Cómo registro mi entrada y salida?** — General. Fuente: app/page.tsx · markAttendance.
- **¿Cómo gestiono los horarios del personal?** — Habilitación: schedules. Fuente: app/page.tsx · isBetzi / schedules / markAttendance.

### Reportes

- **¿Qué reportes puede consultar Andrea?** — Habilitación: supervisorReports. Fuente: app/page.tsx · isAndrea / Reportes.
- **¿Qué información puedo obtener de los reportes?** — Administración/Gerencia. Fuente: app/page.tsx · ADMIN_REPORTS / ADMIN_DEMO_ROWS.
- **¿Por qué un reporte no coincide con otro?** — Administración/Gerencia. Fuente: app/page.tsx · ADMIN_DEMO_ROWS / reports.
- **¿Cuál es la diferencia entre vendido y cobrado?** — Administración/Gerencia. Fuente: app/page.tsx · sales / payments / cashLedger.

### Usuarios

- **¿Cómo creo un usuario y su clave temporal?** — Administración/Gerencia. Fuente: app/page.tsx · createManagedUser.
- **¿Cómo asigno uno, varios o todos los locales?** — Administración/Gerencia. Fuente: app/page.tsx · Usuarios / locationPermissions.
- **¿Qué diferencia hay entre los cargos y sus permisos?** — Administración/Gerencia. Fuente: app/page.tsx · can / tabs / managesCentralOrders.
- **¿Dónde llegan las solicitudes de recuperación?** — Administración/Gerencia. Fuente: app/page.tsx · loadAdminSecurityData / resetPassword.
- **¿Qué hago si no aparece o no se copia la clave temporal?** — Administración/Gerencia. Fuente: app/page.tsx · generatedTemporaryPassword / createdUserCredentials.
- **¿Cómo recupera Administración su propia contraseña?** — Administración/Gerencia. Fuente: donweb-api/index.php · password recovery codes.

### Configuración

- **¿Cómo configuro los límites de cada local?** — Administración/Gerencia. Fuente: app/page.tsx · Límites / siteLimits.
- **¿Cómo actualizo precios?** — Administración/Gerencia. Fuente: app/page.tsx · Precios / priceChanges.

### P&L

- **¿Cómo sincronizo el P&L con Google Drive?** — Administración/Gerencia. Fuente: donweb-api/index.php · admin/pnl sync; app/page.tsx · syncPnlFromGoogle.
- **¿De dónde salen los datos del P&L?** — Administración/Gerencia. Fuente: donweb-api/pnl_sync.php; app/page.tsx · P&L.
- **¿Rentabilidad es lo mismo que variación mensual?** — Administración/Gerencia. Fuente: app/page.tsx · P&L detail / monthly variation.

### Protección

- **¿Cómo funcionan los respaldos?** — Administración/Gerencia. Fuente: donweb-api/backup.php; app/page.tsx · Protección de datos.
- **¿Cómo recupero datos de un respaldo?** — Administración/Gerencia. Fuente: deploy/ACTUALIZACIONES_SEGURAS.md; donweb-api/backup.php.
- **¿Dónde reviso la salud del sistema?** — Administración/Gerencia. Fuente: app/page.tsx · systemHealth / Protección de datos.
- **¿Dónde veo quién hizo un cambio?** — Administración/Gerencia. Fuente: app/page.tsx · recordAudit / Auditoría.
- **¿Cómo se publica una actualización segura?** — Administración/Gerencia. Fuente: deploy/ACTUALIZACIONES_SEGURAS.md; app/page.tsx · Actualizaciones.

### Integraciones

- **¿Qué hago si falla la conexión con Google?** — Administración/Gerencia. Fuente: donweb-api/pnl_sync.php; donweb-api/backup.php.

### Próximamente

- **¿Qué significan MRP, Recetas y Legajos (Próximamente)?** — Administración/Gerencia. Fuente: app/page.tsx · MRP / Recetas y costos / Legajos.


