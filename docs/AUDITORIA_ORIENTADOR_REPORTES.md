# Auditoría del orientador de reportes — 08/09/2026

## Alcance y resultado

Se contrastaron los 28 bloques administrativos realmente renderizados y Reportes de Andrea con su código, no solo con los títulos del menú. Se amplió la guía gratuita con 288 frases de consulta de referencia, sinónimos, normalización de mayúsculas/tildes y tolerancia limitada a errores de escritura. No se afirma cubrir literalmente toda posible pregunta.

Esta entrega modifica la ayuda, sus textos y la navegación voluntaria a reportes; no implementa los informes pendientes, no corrige sus cálculos, no consulta cifras en vivo y no modifica operaciones ni bases de datos.

## Perfiles y seguridad

- Administración y Gerencia comparten rol administrativo, pero el catálogo y los botones respetan reportPermissions de cada cuenta.
- Supervisión no hereda automáticamente informes administrativos. Solo la habilitación específica existente permite Reportes de Andrea.
- Betzi u otra supervisora sin esa habilitación conserva la ayuda operativa y recibe orientación para pedir un informe, no un enlace restringido.
- Vendedoras mantienen la guía operativa anterior. Una consulta explícita sobre reportes no amplía sus permisos.
- La navegación se revalida tanto al mostrar/pulsar el botón como en el componente principal. Es una protección de navegación, no sustituye la autorización del servidor.
- El motor de reportes es puro y local: sin API de IA, tokens, red, acceso a almacenamiento ni lectura financiera.
- Solo el botón preexistente y explícito “Enviar a Administración” envía una consulta. Abrir un informe no pulsa retiro, Gestión, sincronización, descarga ni otra acción de negocio.

## Hallazgos que se explican al usuario

1. Muchos informes son históricos, demostrativos o descriptivos; no se deben presentar como resultados operativos completos.
2. Los controles superiores de fechas/local no filtran todos los bloques. Horarios de venta sí aplica fechas y local; otros solo local, o ninguno.
3. Excel descarga el resumen general por local aunque cambie el nombre del reporte; no es exportación específica de todas las tablas. PDF imprime la vista.
4. El P&L diseñado conserva datos históricos; la lectura de Drive aparece en un bloque separado. Sincronizar no recalcula todas las tarjetas.
5. Auditoría muestra cinco eventos; Personal hasta 30 fichajes. No garantizan acceso al historial completo.
6. Reposición usa ocho unidades como umbral fijo y hasta ocho productos; no equivale al mínimo configurable ni a días de cobertura.
7. Productos, Rentabilidad, Control bancario y otras secciones tienen alcance previsto, no cálculo terminado.
8. Cuentas por pagar detalladas, nómina, ranking por vendedor, producción/lotes, EBITDA y capital de trabajo no se anuncian como informes completos existentes.
9. “Verde” o “subió” no significa mejora económica. Un mes parcial no es comparable sin salvedades a uno cerrado.
10. La existencia de una pestaña no demuestra que el backend, las fuentes o el historial estén completos.

## Mapa auditado

| ID | Informe | Estado |
| --- | --- | --- |
| Gerencia | Gerencia | Histórico / demostración |
| PLConsolidado | P&L consolidado | Parcial |
| Resumen | Resumen ejecutivo | Histórico / demostración |
| Ventas | Ventas | Histórico / demostración |
| DetalleVentas | Detalle de ventas | Operativo con límites |
| Rentabilidad | Rentabilidad | Pendiente |
| Productos | Productos | Pendiente |
| Evolucion | Evolución | Histórico / demostración |
| VendidoCobrado | Vendido vs. cobrado | Histórico / demostración |
| Pagos | Medios de pago | Histórico / demostración |
| Cajas | Cajas | Pendiente |
| CajaMayor | Caja Mayor | Operativo con límites |
| Bancos | Control bancario | Pendiente |
| Ajustes | Descuentos y anulaciones | Pendiente |
| Egresos | Egresos | Operativo con límites |
| Stock | Stock | Pendiente |
| Reposicion | Reposición | Operativo con límites |
| PedidosCentral | Pedidos a Central | Operativo con límites |
| Objetivos | Objetivos | Histórico / demostración |
| HorariosVenta | Horarios de venta | Operativo con límites |
| Personal | Personal | Operativo con límites |
| Clientes | Clientes | Pendiente |
| Promociones | Promociones | Pendiente |
| Calidad | Calidad de datos | Pendiente |
| Fiscal | Fiscal | Pendiente |
| Auditoria | Auditoría | Operativo con límites |
| Incidencias | Incidencias | Operativo con límites |
| Alertas | Alertas operativas | Operativo con límites |
| Supervision | Reportes de Andrea | Operativo con límites |

## Catálogo de preguntas, filtros y límites

Las frases siguientes son intenciones, no textos obligatorios. La respuesta incluye ruta, alcance, estado, filtros y límites. Una coincidencia dudosa solicita precisión y ofrece hasta tres destinos autorizados; no inventa una respuesta ni cifras.

### Gerencia

- Ruta: Menú → Administración → Panel central → Gerencia.
- Estado: Histórico / demostración.
- Alcance: Vista breve de facturación neta, tickets, proyección y alertas.
- Filtros: El selector Local sí cambia este bloque. Desde/Hasta no filtran sus datos en esta versión; comprobá las fechas en la fuente.
- Límites: La facturación usa filas de referencia; la proyección aplica un factor fijo y el avance de metas es ilustrativo. Las alertas usan el estado cargado y no siguen ese filtro. No es un pronóstico validado.
- Evidencia: app/page.tsx · adminReport === Gerencia.

Consultas de referencia:

- resumen para gerencia
- tablero gerencial
- panorama del negocio
- indicadores principales
- dashboard gerencia
- como va el negocio

### P&L consolidado

- Ruta: Menú → Administración → Panel central → P&L consolidado.
- Estado: Parcial.
- Alcance: Consulta del resultado financiero/económico, ingresos, egresos, márgenes, caja, deuda e inventario de la hoja consolidada.
- Filtros: Revisá los meses de la hoja. En Detalle completo elegí Financiero/Económico y uno de los cuatro bloques: Ingresos y canales de cobro; Egresos fijos, variables y retiros; Resultados, caja y punto de equilibrio; Rentabilidad, deuda e inventario. No usa Desde/Hasta/Local como filtro.
- Límites: Las tarjetas y el detalle diseñado conservan referencias históricas. La lectura sincronizada aparece aparte en ‘Lectura completa recibida desde Drive’, con su fecha. Actualizar Drive no recalcula automáticamente todas las tarjetas. Si una línea no tiene base económica se muestra la financiera. Verde/rojo indica aumento/baja, no necesariamente mejora/empeoramiento; no compares un mes parcial como cerrado. No es un balance contable certificado ni detalle de proveedores.
- Evidencia: app/page.tsx · adminReport === PLConsolidado.

Consultas de referencia:

- resultado del mes
- cuanto ganamos este mes
- ganancia mensual
- perdida mensual
- estado de resultados
- p&l
- pnl consolidado
- ingresos y egresos del mes
- costos fijos variables y retiros
- gastos fijos y variables
- punto de equilibrio
- deuda al cierre
- stock valorizado
- inventario valorizado
- flujo de caja mensual
- resultado financiero economico
- rentabilidad deuda inventario
- ver todos los datos de drive
- balance mensual consolidado
- retiros de socios
- retiros adolfo cata
- gastos de equipamiento
- gasto mensual de personal
- impuestos mensuales
- gastos alquileres
- gastos logistica
- gastos servicios
- gastos cocina
- gastos descartables
- gastos limpieza
- gastos tercerizados
- gastos reparaciones
- costo mercaderia vendida
- resultado antes de retiros
- resultado despues de retiros
- caja inicial mensual
- caja final teorica
- deuda neta estimada
- rotacion mensual inventario
- dias inventario
- compras sobre facturacion
- meta compras ventas
- desviacion compras meta
- personal sobre facturacion neta
- ventas canal franquicia
- ingresos restaurantes
- ingresos almacenes
- ingresos rappi pedidos ya
- financiero o economico
- colores aumento baja pnl
- variacion mensual pnl

### Resumen ejecutivo

- Ruta: Menú → Administración → Panel central → Resumen ejecutivo.
- Estado: Histórico / demostración.
- Alcance: Bruto, neto, cantidad de tickets, ticket promedio y comparación por local.
- Filtros: El selector Local sí cambia este bloque. Desde/Hasta no filtran sus datos en esta versión; comprobá las fechas en la fuente.
- Límites: Usa la copia de prueba de Recoleta y datos de demostración de otros locales. Las alertas breves de esta vista también tienen texto fijo. No representa ventas actuales del día por cambiar la fecha.
- Evidencia: app/page.tsx · adminReport === Resumen.

Consultas de referencia:

- resumen ejecutivo
- comparar ventas de locales
- cuanto vendio cada local
- comparar sucursales
- ticket promedio por local
- facturacion por sucursal
- bruto neto tickets
- que sucursal vendio mas

### Ventas

- Ruta: Menú → Administración → Panel central → Ventas.
- Estado: Histórico / demostración.
- Alcance: Facturación total, tickets y promedio por ticket.
- Filtros: El selector Local sí cambia este bloque. Desde/Hasta no filtran sus datos en esta versión; comprobá las fechas en la fuente.
- Límites: Estos totales salen de referencias de prueba/demostración, no del historial completo de ventas por fecha. Para operaciones cargadas consultá Detalle de ventas; no equipares facturación con utilidad.
- Evidencia: app/page.tsx · adminReport === Ventas.

Consultas de referencia:

- cuanto vendimos
- total vendido
- total de ventas
- facturacion total
- numero de tickets
- cantidad de ventas
- venta bruta
- reporte ventas
- informe ventas
- cuanto facturamos hoy

### Detalle de ventas

- Ruta: Menú → Administración → Panel central → Detalle de ventas.
- Estado: Operativo con límites.
- Alcance: Filas de operaciones cargadas: fecha, local, cliente, comprobante, medio de cobro y total.
- Filtros: El selector Local sí cambia este bloque. Desde/Hasta no filtran sus datos en esta versión; comprobá las fechas en la fuente.
- Límites: Muestra ventas cargadas en el estado disponible, sin filtro por fecha o estado de venta, ni buscador específico por cliente en este bloque. No garantiza historial completo; revisar una fila no prueba acreditación bancaria.
- Evidencia: app/page.tsx · adminReport === DetalleVentas.

Consultas de referencia:

- detalle de ventas
- buscar una venta
- venta por cliente
- listar operaciones
- ver comprobante de venta
- ticket de un cliente
- ventas una por una
- buscar importe de un ticket
- quien compro
- venta cobrada tarjeta

### Rentabilidad

- Ruta: Menú → Administración → Panel central → Rentabilidad.
- Estado: Pendiente.
- Alcance: Sección prevista para margen bruto y contribución por producto/categoría/local.
- Filtros: Todavía no hay un cálculo o listado que esos filtros puedan segmentar.
- Límites: Hoy contiene explicaciones, no un ranking de márgenes calculado. Falta completar costos vigentes. Para el resultado mensual de la hoja, el destino es P&L consolidado, no esta pantalla.
- Evidencia: app/page.tsx · adminReport === Rentabilidad.

Consultas de referencia:

- margen por producto
- que producto deja mas ganancia
- rentabilidad por producto
- utilidad por producto
- contribucion de categoria
- costo del producto vendido
- margen bruto producto
- producto mas rentable

### Productos

- Ruta: Menú → Administración → Panel central → Productos.
- Estado: Pendiente.
- Alcance: Sección prevista para más/menos vendidos, participación por categoría y productos sin movimiento.
- Filtros: Todavía no hay un cálculo o listado que esos filtros puedan segmentar.
- Límites: El botón existe, pero actualmente muestra descripciones: todavía no presenta ranking ni cantidades calculadas. No puedo decir qué producto lidera. La solicitud debe quedar pendiente de completar ese reporte.
- Evidencia: app/page.tsx · adminReport === Productos.

Consultas de referencia:

- que productos se venden mas
- productos mas vendidos
- productos menos vendidos
- ranking de productos
- unidades vendidas por producto
- cuantos ravioles vendimos
- ventas por categoria
- productos sin ventas
- productos sin movimiento
- que producto sale mas
- productos que no se venden
- que productos vendemos mas
- articulos con mayor venta

### Evolución

- Ruta: Menú → Administración → Panel central → Evolución.
- Estado: Histórico / demostración.
- Alcance: Comparación de períodos y proyección mensual de referencia.
- Filtros: Los filtros superiores Desde/Hasta/Local no se aplican a este bloque. No los uses como prueba de que estás viendo ese período o sucursal.
- Límites: La tabla de proyección y comparación contiene valores fijos del cuadro compartido. No calcula actualmente ayer/semana/mes desde las operaciones. Para variación histórica de la hoja, revisá P&L y distinguí meses parciales.
- Evidencia: app/page.tsx · adminReport === Evolucion.

Consultas de referencia:

- comparar mes anterior
- crecimiento de ventas
- bajaron las ventas
- evolucion ventas
- proyeccion cierre mes
- ventas semana anterior
- comparar ayer
- variacion de ventas
- subieron las ventas
- como venimos contra mes pasado

### Vendido vs. cobrado

- Ruta: Menú → Administración → Panel central → Vendido vs. cobrado.
- Estado: Histórico / demostración.
- Alcance: Cuadro mensual que compara importes vendidos y cobrados por local.
- Filtros: Los filtros superiores Desde/Hasta/Local no se aplican a este bloque. No los uses como prueba de que estás viendo ese período o sucursal.
- Límites: Usa un cuadro histórico fijo; algunos locales figuran pendientes. No es una conciliación bancaria en vivo ni responde automáticamente a rango/año. No confundas saldo pendiente de ese cuadro con una deuda real confirmada.
- Evidencia: app/page.tsx · adminReport === VendidoCobrado.

Consultas de referencia:

- vendido vs cobrado
- vendido coincide cobrado
- diferencia vendido cobrado
- vendi mas de lo que cobre
- ventas contra cobros
- lo vendido coincide con lo cobrado
- comparar ventas y cobros
- faltan cobros de ventas

### Medios de pago

- Ruta: Menú → Administración → Panel central → Medios de pago.
- Estado: Histórico / demostración.
- Alcance: Distribución por efectivo, tarjeta, QR, banco y otros medios de una copia de cierre.
- Filtros: Los filtros superiores Desde/Hasta/Local no se aplican a este bloque. No los uses como prueba de que estás viendo ese período o sucursal.
- Límites: Los importes son una referencia de Recoleta del 25/08, no el total actual de todos los locales. Para ver el medio de una operación cargada usá Detalle de ventas. No prueba cobros acreditados.
- Evidencia: app/page.tsx · adminReport === Pagos.

Consultas de referencia:

- cuanto cobramos en efectivo
- cuanto por tarjeta
- cobros por medio de pago
- total mercado pago
- ventas por forma de pago
- cobros qr
- distribucion medios de pago
- reporte medios de pago

### Cajas

- Ruta: Menú → Administración → Panel central → Cajas.
- Estado: Pendiente.
- Alcance: Sección prevista para cierres, diferencias, efectivo físico, gastos, retiros y sobres.
- Filtros: Todavía no hay un cálculo o listado que esos filtros puedan segmentar.
- Límites: El aviso de dos cierres pendientes de esta vista es fijo. Para cajas abiertas actuales consultá Alertas operativas, si tenés ese reporte, o el panel de Supervisión habilitado. Para arqueo completo hace falta revisar el circuito de Caja; este bloque no es un historial consolidado.
- Evidencia: app/page.tsx · adminReport === Cajas.

Consultas de referencia:

- informe cierres de caja
- diferencias de caja por local
- quien cerro caja
- historial de cierres
- control de arqueos
- sobrantes y faltantes de caja
- reporte cajas

### Caja Mayor

- Ruta: Menú → Administración → Panel central → Caja Mayor.
- Estado: Operativo con límites.
- Alcance: Sobres registrados, importes retirados y disponible por sobre/local.
- Filtros: Los filtros superiores Desde/Hasta/Local no se aplican a este bloque. No los uses como prueba de que estás viendo ese período o sucursal.
- Límites: Calcula con sobres cargados en el estado disponible. Ver el informe no mueve dinero: ‘Registrar retiro’ es una acción distinta que no debés usar solo para consultar. El disponible no es un saldo bancario.
- Evidencia: app/page.tsx · adminReport === CajaMayor.

Consultas de referencia:

- cuanto hay en caja mayor
- sobres entregados
- disponible en caja mayor
- retiros de oscar
- cuanto retiro oscar
- saldo sobres
- dinero de los sobres
- sobre retirado disponible

### Control bancario

- Ruta: Menú → Administración → Panel central → Control bancario.
- Estado: Pendiente.
- Alcance: Sección prevista para comparar declarado/acreditado, comisiones y diferencias por entidad.
- Filtros: Todavía no hay un cálculo o listado que esos filtros puedan segmentar.
- Límites: Actualmente contiene descripciones; no importa extractos ni concilia bancos automáticamente. Para confirmar una acreditación hace falta la fuente bancaria autorizada. No se puede obtener ese resultado real de esta pantalla aún.
- Evidencia: app/page.tsx · adminReport === Bancos.

Consultas de referencia:

- acreditaciones bancarias
- conciliacion bancaria
- comisiones tarjeta
- contracargos
- transferencia no acreditada
- banco no coincide
- cuanto desconto el banco
- saldo bancario real
- control bancario

### Descuentos y anulaciones

- Ruta: Menú → Administración → Panel central → Descuentos y anulaciones.
- Estado: Pendiente.
- Alcance: Sección prevista para impacto de descuentos, anulaciones y controles por responsable.
- Filtros: Todavía no hay un cálculo o listado que esos filtros puedan segmentar.
- Límites: Hoy muestra descripciones y no una tabla consolidada de anulaciones/descuentos/invitaciones. Auditoría puede mostrar algunos eventos recientes si está habilitada, pero no sustituye el informe completo ni garantiza identificar al responsable.
- Evidencia: app/page.tsx · adminReport === Ajustes.

Consultas de referencia:

- reporte descuentos
- ventas anuladas
- cuanto dimos en descuentos
- descuentos y anulaciones
- quien anulo venta
- control descuentos por vendedor
- invitaciones otorgadas
- cuanto regalamos

### Egresos

- Ruta: Menú → Administración → Panel central → Egresos.
- Estado: Operativo con límites.
- Alcance: Gastos cargados: local, categoría, detalle, importe, responsable y referencia de comprobante; totales y devoluciones.
- Filtros: Los filtros superiores Desde/Hasta/Local no se aplican a este bloque. No los uses como prueba de que estás viendo ese período o sucursal.
- Límites: El resultado operativo mezcla ventas de referencia y egresos/devoluciones cargados: no es utilidad conciliada. El comprobante es solo el nombre de archivo, no un adjunto recuperable garantizado. No hay filtro efectivo por fechas/local en esta tabla.
- Evidencia: app/page.tsx · adminReport === Egresos.

Consultas de referencia:

- cuanto gastamos
- gastos por local
- egresos sin comprobante
- egresos por categoria
- detalle de gastos
- quien cargo gasto
- factura de un gasto
- total devoluciones
- gastos sin factura
- comprobantes faltantes

### Stock

- Ruta: Menú → Administración → Panel central → Stock.
- Estado: Pendiente.
- Alcance: Sección administrativa prevista para conteo físico, movimientos y mínimos.
- Filtros: Todavía no hay un cálculo o listado que esos filtros puedan segmentar.
- Límites: Este bloque administrativo contiene descripciones. Para consulta operativa usá Stock desde el perfil habilitado o Alertas operativas para mínimos. No promete un historial consolidado ni traslada permisos operativos al usuario administrativo.
- Evidencia: app/page.tsx · adminReport === Stock.

Consultas de referencia:

- informe stock
- reporte inventario
- stock teorico contra real
- comparar conteo fisico
- diferencias inventario
- historial stock consolidado

### Reposición

- Ruta: Menú → Administración → Panel central → Reposición.
- Estado: Operativo con límites.
- Alcance: Productos con existencias bajas y el local de menor stock.
- Filtros: Los filtros superiores Desde/Hasta/Local no se aplican a este bloque. No los uses como prueba de que estás viendo ese período o sucursal.
- Límites: Este reporte usa el umbral fijo de 8 unidades y muestra hasta ocho productos; no es el mismo cálculo de mínimos configurables ni el pedido sugerido, y no calcula días de cobertura. Para alertas por mínimo configurado consultá Alertas operativas.
- Evidencia: app/page.tsx · adminReport === Reposicion.

Consultas de referencia:

- que productos reponer
- local con menos stock
- quiebres stock
- priorizar reposicion
- falta mercaderia locales
- informe reposicion
- cobertura de stock
- stock menor ocho

### Pedidos a Central

- Ruta: Menú → Administración → Panel central → Pedidos a Central.
- Estado: Operativo con límites.
- Alcance: Solicitudes por local, solicitante, unidades pedidas, estado y fecha.
- Filtros: Los filtros superiores Desde/Hasta/Local no se aplican a este bloque. No los uses como prueba de que estás viendo ese período o sucursal.
- Límites: Los contadores de despachados no incluyen automáticamente el estado ‘Despachado parcial’; revisá la tabla. Esta vista no calcula tiempos de entrega ni cantidad física recibida. Para preparación/faltantes está Central de pedidos, solo en los perfiles operativos habilitados.
- Evidencia: app/page.tsx · adminReport === PedidosCentral.

Consultas de referencia:

- informe pedidos central
- pedidos pendientes
- pedidos en preparacion
- pedidos despachados
- seguir solicitudes de locales
- quien pidio mercaderia
- estado de pedidos
- cuantas unidades pidieron
- entregas parciales pedidos

### Objetivos

- Ruta: Menú → Administración → Panel central → Objetivos.
- Estado: Histórico / demostración.
- Alcance: Tabla prevista de meta mensual, venta, avance y faltante por local.
- Filtros: Los filtros superiores Desde/Hasta/Local no se aplican a este bloque. No los uses como prueba de que estás viendo ese período o sucursal.
- Límites: Las metas son demostrativas y se calculan con un factor fijo sobre valores de referencia. No son metas reales configuradas por Gerencia.
- Evidencia: app/page.tsx · adminReport === Objetivos.

Consultas de referencia:

- cumplimiento metas
- cuanto falta para objetivo
- meta mensual
- objetivos por local
- porcentaje cumplimiento
- alcanzamos objetivo
- cuota de ventas

### Horarios de venta

- Ruta: Menú → Administración → Panel central → Horarios de venta.
- Estado: Operativo con límites.
- Alcance: Ventas, tickets, promedio y mejor intervalo por franja horaria.
- Filtros: Aquí sí se usan Desde, Hasta y Local. Elegí un rango y sucursal (o Todos los locales), y ‘Agrupar cada’ 1, 2 o 3 horas. Las fechas delimitan ventas cargadas; no cambia horarios de empleados.
- Límites: Trabaja con ventas activas disponibles, fecha/hora de la operación. No garantiza que todo el historial esté cargado; las horas se interpretan en el entorno del navegador. Una franja con cero no prueba ausencia real de ventas si faltan datos.
- Evidencia: app/page.tsx · adminReport === HorariosVenta.

Consultas de referencia:

- a que hora vendemos mas
- horas pico
- ventas por hora
- mejor horario
- franja horaria
- cuando reforzar personal
- tickets por horario
- ventas hoy
- ventas de ayer
- ventas entre fechas
- ventas por dia actual

### Personal

- Ruta: Menú → Administración → Panel central → Personal.
- Estado: Operativo con límites.
- Alcance: Últimos fichajes disponibles: persona, local, entrada/salida, fecha/hora y tardanza registrada.
- Filtros: El selector Local sí filtra. Se muestran hasta 30 registros; no hay filtro de fechas/persona ni cálculo completo de horas o ausencias en este bloque.
- Límites: Las tarjetas sobre horas/ausencias describen el alcance previsto. La tabla muestra movimientos y tardanza, no liquidación de sueldos ni prueba automática de una ausencia.
- Evidencia: app/page.tsx · adminReport === Personal.

Consultas de referencia:

- reporte asistencia
- quien llego tarde
- entradas y salidas personal
- informe fichajes
- horas trabajadas
- ausencias empleados
- asistencia por persona
- tardanzas por local

### Clientes

- Ruta: Menú → Administración → Panel central → Clientes.
- Estado: Pendiente.
- Alcance: Sección prevista para base activa, recurrencia y segmentación con consentimiento.
- Filtros: Todavía no hay un cálculo o listado que esos filtros puedan segmentar.
- Límites: Actualmente son descripciones, sin ranking/segmentación calculada. Para ubicar operaciones de un cliente existe Detalle de ventas, si está habilitado; no entregues datos personales por el chat.
- Evidencia: app/page.tsx · adminReport === Clientes.

Consultas de referencia:

- clientes frecuentes
- quien compra mas
- frecuencia de compra
- ultima visita cliente
- recurrencia clientes
- informe clientes
- clientes inactivos
- segmentar clientes

### Promociones

- Ruta: Menú → Administración → Panel central → Promociones.
- Estado: Pendiente.
- Alcance: Sección prevista para uso de beneficios, ventas, descuentos y margen de promociones.
- Filtros: Todavía no hay un cálculo o listado que esos filtros puedan segmentar.
- Límites: No hay todavía métricas calculadas por promoción. El margen requiere costos y vinculación de ventas; no puedo afirmar que una campaña resultó rentable.
- Evidencia: app/page.tsx · adminReport === Promociones.

Consultas de referencia:

- que promocion funciona
- resultado promociones
- ventas con promociones
- uso de beneficios
- rentabilidad promocion
- promocion mas usada
- impacto campana

### Calidad de datos

- Ruta: Menú → Administración → Panel central → Calidad de datos.
- Estado: Pendiente.
- Alcance: Sección prevista para duplicados, cargas incompletas y diferencias de consistencia.
- Filtros: Todavía no hay un cálculo o listado que esos filtros puedan segmentar.
- Límites: No ejecuta una auditoría automática: hoy describe controles. Si una operación falla, usá el diagnóstico de pantalla o derivá el caso; no concluyas que no hay errores porque este bloque no lista ninguno.
- Evidencia: app/page.tsx · adminReport === Calidad.

Consultas de referencia:

- informe calidad datos
- detectar duplicados
- registros incompletos
- errores de datos
- faltan fechas cargadas
- fallos sincronizacion reporte
- calidad de datos

### Fiscal

- Ruta: Menú → Administración → Panel central → Fiscal.
- Estado: Pendiente.
- Alcance: Sección reservada para comprobantes y conciliación fiscal.
- Filtros: Todavía no hay un cálculo o listado que esos filtros puedan segmentar.
- Límites: La integración ARCA/AFIP quedó para la última etapa. Esta pantalla no emite CAE, no entrega libro IVA validado ni convierte comprobantes internos en fiscales. Consultá el circuito fiscal autorizado fuera de esta guía.
- Evidencia: app/page.tsx · adminReport === Fiscal.

Consultas de referencia:

- informe fiscal
- reporte cae
- facturas autorizadas arca
- notas credito fiscales
- iva ventas
- libro iva
- facturas pendientes afip
- comprobantes fiscales emitidos

### Auditoría

- Ruta: Menú → Administración → Panel central → Auditoría.
- Estado: Operativo con límites.
- Alcance: Eventos recientes: acción, local, fecha y detalle.
- Filtros: Los filtros superiores Desde/Hasta/Local no se aplican a este bloque. No los uses como prueba de que estás viendo ese período o sucursal.
- Límites: Esta vista muestra solo cinco eventos y no imprime explícitamente un usuario en todas las filas. No permite una búsqueda histórica completa por responsable. Si no alcanza, Administración debe solicitar revisión del registro backend; el chat no lo consulta.
- Evidencia: app/page.tsx · adminReport === Auditoria.

Consultas de referencia:

- quien hizo modificacion
- quien cambio datos
- quien hizo un cambio
- historial de cambios
- reporte auditoria
- rastreo acciones
- quien hizo ajuste
- usuario que modifico

### Incidencias

- Ruta: Menú → Administración → Panel central → Incidencias.
- Estado: Operativo con límites.
- Alcance: Problemas cargados: local, tipo, detalle, persona que informó y estado.
- Filtros: Los filtros superiores Desde/Hasta/Local no se aplican a este bloque. No los uses como prueba de que estás viendo ese período o sucursal.
- Límites: El listado usa los registros disponibles, sin filtros efectivos por estado/fecha/local. Ver el estado no cambia el caso: el selector Gestión sí lo modifica y debe usarse solo cuando corresponda, no para consultar.
- Evidencia: app/page.tsx · adminReport === Incidencias.

Consultas de referencia:

- reclamos de locales
- problemas abiertos
- informe incidencias
- reclamos pendientes
- quien reporto problema
- incidencias resueltas
- faltantes reclamados

### Alertas operativas

- Ruta: Menú → Administración → Panel central → Alertas operativas.
- Estado: Operativo con límites.
- Alcance: Alertas del estado disponible: cajas abiertas, pedidos, recepción, mínimos de stock, egresos y ajustes pendientes.
- Filtros: Los filtros superiores Desde/Hasta/Local no se aplican a este bloque. No los uses como prueba de que estás viendo ese período o sucursal.
- Límites: Es un listado de condiciones del estado cargado, no un registro histórico por fecha. No certifica sincronización completa ni atribuye responsabilidades por sí solo. El contador de Tareas administrativas corresponde a consultas/recuperaciones, no a todas estas alertas.
- Evidencia: app/page.tsx · adminReport === Alertas.

Consultas de referencia:

- que debo revisar
- alertas operativas
- cajas abiertas
- que locales no cerraron
- stock bajo por minimo
- recepciones pendientes
- que esta pendiente hoy
- ajustes de stock pendientes
- pendientes operativos
- quien falta cerrar caja

### Reportes de Andrea

- Ruta: Menú → Reportes → Reportes de Andrea.
- Estado: Operativo con límites.
- Alcance: Ventas activas de la sesión, stock bajo, pedidos pendientes y estado de cajas por sucursal.
- Filtros: Entrá en Reportes y buscá la fila del local. No tiene Desde/Hasta ni selector propio de fecha/local: muestra un resumen de sesión por sucursal.
- Límites: Solo aparece con la habilitación específica de Reportes de Andrea; el rol Supervisión por sí solo no alcanza. No incluye P&L, márgenes ni historial mensual completo. Usá únicamente los locales autorizados y no interpretes datos cargados como una consolidación histórica certificada.
- Evidencia: app/page.tsx · tab === Reportes && isAndrea.

Consultas de referencia:

- resumen supervision
- reportes andrea
- ventas de cada local
- cuanto vendio cada local
- comparar sucursales
- ventas de esta sesion
- cajas abiertas
- stock bajo
- pedidos pendientes
- como van los locales

## Verificación y mantenimiento

- 1.489 pruebas automáticas aprobadas en `npm run test:help`, combinando la guía anterior y `tests/report-guide.test.mjs`.
- Se verifica correspondencia exacta entre todos los IDs renderizados y el catálogo, evitando reportes ficticios o sin documentar.
- Pruebas de consultas naturales independientes de los alias, mayúsculas/tildes, errores de escritura, ambigüedad, exportación, seguimiento y denegación de permisos.
- Pruebas de preservación de consultas operativas: abrir/cerrar caja, cobrar, pago dividido, cálculo de diferencias y seguimiento del propio pedido.
- No se hicieron operaciones de venta, caja, stock, restablecimiento de contraseñas ni cambios de datos reales para probar la guía.
- La auditoría fue de código y pruebas programáticas; no certifica que todas las fuentes de producción estén completas ni sustituye pruebas con cada usuario real.
- Fuente única del catálogo y textos: `app/data/reportGuide.ts`; integración: `app/components/AiHelpChat.tsx` y `app/page.tsx`.
- Al completar un reporte, actualizar su estado, filtros, límites, preguntas y pruebas en la misma entrega. Si cambian permisos, revisar ambos puntos de autorización de la navegación.

