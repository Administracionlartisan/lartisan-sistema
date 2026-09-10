/** Audited against the rendered branches in app/page.tsx, 2026-09-08.
 * This is a read-only report locator, not a query engine. Never infer data availability from a tab title.
 */
export type ReportAccess = {
  role: "vendedora" | "supervisora" | "administracion";
  reportPermissions: string[];
  supervisorReports: boolean;
};
export type ReportStatus = "Operativo con límites" | "Histórico / demostración" | "Parcial" | "Pendiente";
export type ReportGuide = {
  id: string; title: string; detail: string; status: ReportStatus;
  questions: string[]; filters: string; limits: string; source: string;
};
const noFilters = "Los filtros superiores Desde/Hasta/Local no se aplican a este bloque. No los uses como prueba de que estás viendo ese período o sucursal.";
const localOnly = "El selector Local sí cambia este bloque. Desde/Hasta no filtran sus datos en esta versión; comprobá las fechas en la fuente.";
const pendingFilters = "Todavía no hay un cálculo o listado que esos filtros puedan segmentar.";
const report = (id: string, title: string, detail: string, status: ReportStatus, questions: string[], filters: string, limits: string, source = `app/page.tsx · adminReport === ${id}`): ReportGuide => ({ id, title, detail, status, questions, filters, limits, source });

export const adminReportGuides: ReportGuide[] = [
  report("Gerencia", "Gerencia", "Vista breve de facturación neta, tickets, proyección y alertas.", "Histórico / demostración",
    ["resumen para gerencia", "tablero gerencial", "panorama del negocio", "indicadores principales", "dashboard gerencia", "como va el negocio"], localOnly,
    "La facturación usa filas de referencia; la proyección aplica un factor fijo y el avance de metas es ilustrativo. Las alertas usan el estado cargado y no siguen ese filtro. No es un pronóstico validado."),
  report("PLConsolidado", "P&L consolidado", "Consulta del resultado financiero/económico, ingresos, egresos, márgenes, caja, deuda e inventario de la hoja consolidada.", "Parcial",
    ["resultado del mes", "cuanto ganamos este mes", "ganancia mensual", "perdida mensual", "estado de resultados", "p&l", "pnl consolidado", "ingresos y egresos del mes", "costos fijos variables y retiros", "gastos fijos y variables", "punto de equilibrio", "deuda al cierre", "stock valorizado", "inventario valorizado", "flujo de caja mensual", "resultado financiero economico", "rentabilidad deuda inventario", "ver todos los datos de drive", "balance mensual consolidado", "retiros de socios", "retiros adolfo cata", "gastos de equipamiento", "gasto mensual de personal", "impuestos mensuales", "gastos alquileres", "gastos logistica", "gastos servicios", "gastos cocina", "gastos descartables", "gastos limpieza", "gastos tercerizados", "gastos reparaciones", "costo mercaderia vendida", "resultado antes de retiros", "resultado despues de retiros", "caja inicial mensual", "caja final teorica", "deuda neta estimada", "rotacion mensual inventario", "dias inventario", "compras sobre facturacion", "meta compras ventas", "desviacion compras meta", "personal sobre facturacion neta", "ventas canal franquicia", "ingresos restaurantes", "ingresos almacenes", "ingresos rappi pedidos ya", "financiero o economico", "colores aumento baja pnl", "variacion mensual pnl"],
    "Revisá los meses de la hoja. En Detalle completo elegí Financiero/Económico y uno de los cuatro bloques: Ingresos y canales de cobro; Egresos fijos, variables y retiros; Resultados, caja y punto de equilibrio; Rentabilidad, deuda e inventario. No usa Desde/Hasta/Local como filtro.",
    "Las tarjetas y el detalle diseñado conservan referencias históricas. La lectura sincronizada aparece aparte en ‘Lectura completa recibida desde Drive’, con su fecha. Actualizar Drive no recalcula automáticamente todas las tarjetas. Si una línea no tiene base económica se muestra la financiera. Verde/rojo indica aumento/baja, no necesariamente mejora/empeoramiento; no compares un mes parcial como cerrado. No es un balance contable certificado ni detalle de proveedores."),
  report("Resumen", "Resumen ejecutivo", "Bruto, neto, cantidad de tickets, ticket promedio y comparación por local.", "Histórico / demostración",
    ["resumen ejecutivo", "comparar ventas de locales", "cuanto vendio cada local", "comparar sucursales", "ticket promedio por local", "facturacion por sucursal", "bruto neto tickets", "que sucursal vendio mas"], localOnly,
    "Usa la copia de prueba de Recoleta y datos de demostración de otros locales. Las alertas breves de esta vista también tienen texto fijo. No representa ventas actuales del día por cambiar la fecha."),
  report("Ventas", "Ventas", "Facturación total, tickets y promedio por ticket.", "Histórico / demostración",
    ["cuanto vendimos", "total vendido", "total de ventas", "facturacion total", "numero de tickets", "cantidad de ventas", "venta bruta", "reporte ventas", "informe ventas", "cuanto facturamos hoy"], localOnly,
    "Estos totales salen de referencias de prueba/demostración, no del historial completo de ventas por fecha. Para operaciones cargadas consultá Detalle de ventas; no equipares facturación con utilidad."),
  report("DetalleVentas", "Detalle de ventas", "Filas de operaciones cargadas: fecha, local, cliente, comprobante, medio de cobro y total.", "Operativo con límites",
    ["detalle de ventas", "buscar una venta", "venta por cliente", "listar operaciones", "ver comprobante de venta", "ticket de un cliente", "ventas una por una", "buscar importe de un ticket", "quien compro", "venta cobrada tarjeta"], localOnly,
    "Muestra ventas cargadas en el estado disponible, sin filtro por fecha o estado de venta, ni buscador específico por cliente en este bloque. No garantiza historial completo; revisar una fila no prueba acreditación bancaria."),
  report("Rentabilidad", "Rentabilidad", "Sección prevista para margen bruto y contribución por producto/categoría/local.", "Pendiente",
    ["margen por producto", "que producto deja mas ganancia", "rentabilidad por producto", "utilidad por producto", "contribucion de categoria", "costo del producto vendido", "margen bruto producto", "producto mas rentable"], pendingFilters,
    "Hoy contiene explicaciones, no un ranking de márgenes calculado. Falta completar costos vigentes. Para el resultado mensual de la hoja, el destino es P&L consolidado, no esta pantalla."),
  report("Productos", "Productos", "Sección prevista para más/menos vendidos, participación por categoría y productos sin movimiento.", "Pendiente",
    ["que productos se venden mas", "productos mas vendidos", "productos menos vendidos", "ranking de productos", "unidades vendidas por producto", "cuantos ravioles vendimos", "ventas por categoria", "productos sin ventas", "productos sin movimiento", "que producto sale mas", "productos que no se venden", "que productos vendemos mas", "articulos con mayor venta"], pendingFilters,
    "El botón existe, pero actualmente muestra descripciones: todavía no presenta ranking ni cantidades calculadas. No puedo decir qué producto lidera. La solicitud debe quedar pendiente de completar ese reporte."),
  report("Evolucion", "Evolución", "Comparación de períodos y proyección mensual de referencia.", "Histórico / demostración",
    ["comparar mes anterior", "crecimiento de ventas", "bajaron las ventas", "evolucion ventas", "proyeccion cierre mes", "ventas semana anterior", "comparar ayer", "variacion de ventas", "subieron las ventas", "como venimos contra mes pasado"], noFilters,
    "La tabla de proyección y comparación contiene valores fijos del cuadro compartido. No calcula actualmente ayer/semana/mes desde las operaciones. Para variación histórica de la hoja, revisá P&L y distinguí meses parciales."),
  report("VendidoCobrado", "Vendido vs. cobrado", "Cuadro mensual que compara importes vendidos y cobrados por local.", "Histórico / demostración",
    ["vendido vs cobrado", "vendido coincide cobrado", "diferencia vendido cobrado", "vendi mas de lo que cobre", "ventas contra cobros", "lo vendido coincide con lo cobrado", "comparar ventas y cobros", "faltan cobros de ventas"], noFilters,
    "Usa un cuadro histórico fijo; algunos locales figuran pendientes. No es una conciliación bancaria en vivo ni responde automáticamente a rango/año. No confundas saldo pendiente de ese cuadro con una deuda real confirmada."),
  report("Pagos", "Medios de pago", "Distribución por efectivo, tarjeta, QR, banco y otros medios de una copia de cierre.", "Histórico / demostración",
    ["cuanto cobramos en efectivo", "cuanto por tarjeta", "cobros por medio de pago", "total mercado pago", "ventas por forma de pago", "cobros qr", "distribucion medios de pago", "reporte medios de pago"], noFilters,
    "Los importes son una referencia de Recoleta del 25/08, no el total actual de todos los locales. Para ver el medio de una operación cargada usá Detalle de ventas. No prueba cobros acreditados."),
  report("Cajas", "Cajas", "Sección prevista para cierres, diferencias, efectivo físico, gastos, retiros y sobres.", "Pendiente",
    ["informe cierres de caja", "diferencias de caja por local", "quien cerro caja", "historial de cierres", "control de arqueos", "sobrantes y faltantes de caja", "reporte cajas"], pendingFilters,
    "El aviso de dos cierres pendientes de esta vista es fijo. Para cajas abiertas actuales consultá Alertas operativas, si tenés ese reporte, o el panel de Supervisión habilitado. Para arqueo completo hace falta revisar el circuito de Caja; este bloque no es un historial consolidado."),
  report("CajaMayor", "Caja Mayor", "Sobres registrados, importes retirados y disponible por sobre/local.", "Operativo con límites",
    ["cuanto hay en caja mayor", "sobres entregados", "disponible en caja mayor", "retiros de oscar", "cuanto retiro oscar", "saldo sobres", "dinero de los sobres", "sobre retirado disponible"], noFilters,
    "Calcula con sobres cargados en el estado disponible. Ver el informe no mueve dinero: ‘Registrar retiro’ es una acción distinta que no debés usar solo para consultar. El disponible no es un saldo bancario."),
  report("Bancos", "Control bancario", "Sección prevista para comparar declarado/acreditado, comisiones y diferencias por entidad.", "Pendiente",
    ["acreditaciones bancarias", "conciliacion bancaria", "comisiones tarjeta", "contracargos", "transferencia no acreditada", "banco no coincide", "cuanto desconto el banco", "saldo bancario real", "control bancario"], pendingFilters,
    "Actualmente contiene descripciones; no importa extractos ni concilia bancos automáticamente. Para confirmar una acreditación hace falta la fuente bancaria autorizada. No se puede obtener ese resultado real de esta pantalla aún."),
  report("Ajustes", "Descuentos y anulaciones", "Sección prevista para impacto de descuentos, anulaciones y controles por responsable.", "Pendiente",
    ["reporte descuentos", "ventas anuladas", "cuanto dimos en descuentos", "descuentos y anulaciones", "quien anulo venta", "control descuentos por vendedor", "invitaciones otorgadas", "cuanto regalamos"], pendingFilters,
    "Hoy muestra descripciones y no una tabla consolidada de anulaciones/descuentos/invitaciones. Auditoría puede mostrar algunos eventos recientes si está habilitada, pero no sustituye el informe completo ni garantiza identificar al responsable."),
  report("Egresos", "Egresos", "Gastos cargados, devoluciones y consulta de cuentas por pagar de la hoja GASTOS OPERATIVOS: proveedor, concepto, total y saldo informado.", "Operativo con límites",
    ["cuanto gastamos", "gastos por local", "egresos sin comprobante", "egresos por categoria", "detalle de gastos", "quien cargo gasto", "factura de un gasto", "total devoluciones", "gastos sin factura", "comprobantes faltantes", "cuentas por pagar", "saldo proveedores", "proveedores pendientes", "deuda proveedores", "facturas pendientes de pago"], noFilters,
    "La copia de ‘Gastos y cuentas por pagar de Drive’ se actualiza al abrir Egresos si tiene más de 15 minutos; también podés tocar ‘Actualizar ahora’. El saldo surge de la columna A PAGAR de la hoja, no vence ni concilia pagos por sí solo. El resultado operativo mezcla ventas de referencia y egresos/devoluciones cargados: no es utilidad conciliada. El comprobante local es solo el nombre de archivo, no un adjunto recuperable garantizado."),
  report("Stock", "Stock", "Sección administrativa prevista para conteo físico, movimientos y mínimos.", "Pendiente",
    ["informe stock", "reporte inventario", "stock teorico contra real", "comparar conteo fisico", "diferencias inventario", "historial stock consolidado"], pendingFilters,
    "Este bloque administrativo contiene descripciones. Para consulta operativa usá Stock desde el perfil habilitado o Alertas operativas para mínimos. No promete un historial consolidado ni traslada permisos operativos al usuario administrativo."),
  report("Reposicion", "Reposición", "Productos con existencias bajas y el local de menor stock.", "Operativo con límites",
    ["que productos reponer", "local con menos stock", "quiebres stock", "priorizar reposicion", "falta mercaderia locales", "informe reposicion", "cobertura de stock", "stock menor ocho"], noFilters,
    "Este reporte usa el umbral fijo de 8 unidades y muestra hasta ocho productos; no es el mismo cálculo de mínimos configurables ni el pedido sugerido, y no calcula días de cobertura. Para alertas por mínimo configurado consultá Alertas operativas."),
  report("PedidosCentral", "Pedidos a Central", "Solicitudes por local, solicitante, unidades pedidas, estado y fecha.", "Operativo con límites",
    ["informe pedidos central", "pedidos pendientes", "pedidos en preparacion", "pedidos despachados", "seguir solicitudes de locales", "quien pidio mercaderia", "estado de pedidos", "cuantas unidades pidieron", "entregas parciales pedidos"], noFilters,
    "Los contadores de despachados no incluyen automáticamente el estado ‘Despachado parcial’; revisá la tabla. Esta vista no calcula tiempos de entrega ni cantidad física recibida. Para preparación/faltantes está Central de pedidos, solo en los perfiles operativos habilitados."),
  report("Objetivos", "Objetivos", "Tabla prevista de meta mensual, venta, avance y faltante por local.", "Histórico / demostración",
    ["cumplimiento metas", "cuanto falta para objetivo", "meta mensual", "objetivos por local", "porcentaje cumplimiento", "alcanzamos objetivo", "cuota de ventas"], noFilters,
    "Las metas son demostrativas y se calculan con un factor fijo sobre valores de referencia. No son metas reales configuradas por Gerencia."),
  report("HorariosVenta", "Horarios de venta", "Ventas, tickets, promedio y mejor intervalo por franja horaria.", "Operativo con límites",
    ["a que hora vendemos mas", "horas pico", "ventas por hora", "mejor horario", "franja horaria", "cuando reforzar personal", "tickets por horario", "ventas hoy", "ventas de ayer", "ventas entre fechas", "ventas por dia actual"],
    "Aquí sí se usan Desde, Hasta y Local. Elegí un rango y sucursal (o Todos los locales), y ‘Agrupar cada’ 1, 2 o 3 horas. Las fechas delimitan ventas cargadas; no cambia horarios de empleados.",
    "Trabaja con ventas activas disponibles, fecha/hora de la operación. No garantiza que todo el historial esté cargado; las horas se interpretan en el entorno del navegador. Una franja con cero no prueba ausencia real de ventas si faltan datos."),
  report("Personal", "Personal", "Últimos fichajes disponibles: persona, local, entrada/salida, fecha/hora y tardanza registrada.", "Operativo con límites",
    ["reporte asistencia", "quien llego tarde", "entradas y salidas personal", "informe fichajes", "horas trabajadas", "ausencias empleados", "asistencia por persona", "tardanzas por local"],
    "El selector Local sí filtra. Se muestran hasta 30 registros; no hay filtro de fechas/persona ni cálculo completo de horas o ausencias en este bloque.",
    "Las tarjetas sobre horas/ausencias describen el alcance previsto. La tabla muestra movimientos y tardanza, no liquidación de sueldos ni prueba automática de una ausencia."),
  report("Clientes", "Clientes", "Sección prevista para base activa, recurrencia y segmentación con consentimiento.", "Pendiente",
    ["clientes frecuentes", "quien compra mas", "frecuencia de compra", "ultima visita cliente", "recurrencia clientes", "informe clientes", "clientes inactivos", "segmentar clientes"], pendingFilters,
    "Actualmente son descripciones, sin ranking/segmentación calculada. Para ubicar operaciones de un cliente existe Detalle de ventas, si está habilitado; no entregues datos personales por el chat."),
  report("Promociones", "Promociones", "Sección prevista para uso de beneficios, ventas, descuentos y margen de promociones.", "Pendiente",
    ["que promocion funciona", "resultado promociones", "ventas con promociones", "uso de beneficios", "rentabilidad promocion", "promocion mas usada", "impacto campana"], pendingFilters,
    "No hay todavía métricas calculadas por promoción. El margen requiere costos y vinculación de ventas; no puedo afirmar que una campaña resultó rentable."),
  report("Calidad", "Calidad de datos", "Sección prevista para duplicados, cargas incompletas y diferencias de consistencia.", "Pendiente",
    ["informe calidad datos", "detectar duplicados", "registros incompletos", "errores de datos", "faltan fechas cargadas", "fallos sincronizacion reporte", "calidad de datos"], pendingFilters,
    "No ejecuta una auditoría automática: hoy describe controles. Si una operación falla, usá el diagnóstico de pantalla o derivá el caso; no concluyas que no hay errores porque este bloque no lista ninguno."),
  report("Fiscal", "Fiscal", "Sección reservada para comprobantes y conciliación fiscal.", "Pendiente",
    ["informe fiscal", "reporte cae", "facturas autorizadas arca", "notas credito fiscales", "iva ventas", "libro iva", "facturas pendientes afip", "comprobantes fiscales emitidos"], pendingFilters,
    "La integración ARCA/AFIP quedó para la última etapa. Esta pantalla no emite CAE, no entrega libro IVA validado ni convierte comprobantes internos en fiscales. Consultá el circuito fiscal autorizado fuera de esta guía."),
  report("Auditoria", "Auditoría", "Eventos recientes: acción, local, fecha y detalle.", "Operativo con límites",
    ["quien hizo modificacion", "quien cambio datos", "quien hizo un cambio", "historial de cambios", "reporte auditoria", "rastreo acciones", "quien hizo ajuste", "usuario que modifico"], noFilters,
    "Esta vista muestra solo cinco eventos y no imprime explícitamente un usuario en todas las filas. No permite una búsqueda histórica completa por responsable. Si no alcanza, Administración debe solicitar revisión del registro backend; el chat no lo consulta."),
  report("Incidencias", "Incidencias", "Problemas cargados: local, tipo, detalle, persona que informó y estado.", "Operativo con límites",
    ["reclamos de locales", "problemas abiertos", "informe incidencias", "reclamos pendientes", "quien reporto problema", "incidencias resueltas", "faltantes reclamados"], noFilters,
    "El listado usa los registros disponibles, sin filtros efectivos por estado/fecha/local. Ver el estado no cambia el caso: el selector Gestión sí lo modifica y debe usarse solo cuando corresponda, no para consultar."),
  report("Alertas", "Alertas operativas", "Alertas del estado disponible: cajas abiertas, pedidos, recepción, mínimos de stock, egresos y ajustes pendientes.", "Operativo con límites",
    ["que debo revisar", "alertas operativas", "cajas abiertas", "que locales no cerraron", "stock bajo por minimo", "recepciones pendientes", "que esta pendiente hoy", "ajustes de stock pendientes", "pendientes operativos", "quien falta cerrar caja"], noFilters,
    "Es un listado de condiciones del estado cargado, no un registro histórico por fecha. No certifica sincronización completa ni atribuye responsabilidades por sí solo. El contador de Tareas administrativas corresponde a consultas/recuperaciones, no a todas estas alertas."),
];

export const supervisionReportGuide = report("Supervision", "Reportes de supervisión", "Ventas activas de la sesión, stock bajo, pedidos pendientes y estado de cajas por sucursal.", "Operativo con límites",
  ["resumen supervision", "reportes supervisora", "ventas de cada local", "cuanto vendio cada local", "comparar sucursales", "ventas de esta sesion", "cajas abiertas", "stock bajo", "pedidos pendientes", "como van los locales"],
  "Entrá en Reportes y buscá la fila del local. No tiene Desde/Hasta ni selector propio de fecha/local: muestra un resumen de sesión por sucursal.",
  "Solo aparece con la habilitación específica de reportes; el rol Supervisión por sí solo no alcanza. No incluye P&L, márgenes ni historial mensual completo. Usá únicamente los locales autorizados y no interpretes datos cargados como una consolidación histórica certificada.",
  "app/page.tsx · permiso supervisorReports");

// Single source of names/IDs for the menu, guide, permissions and drift tests.
export const ADMIN_REPORTS = adminReportGuides.map(({ id, title, detail, status }) => ({ id, title, summary: detail, status, detail: `${detail} Estado: ${status}.` }));
export type NavigationReport = (typeof ADMIN_REPORTS)[number];
export const REPORT_AREAS = [
  { id: "direccion", title: "Dirección", reports: ["Resumen", "Gerencia", "PLConsolidado", "Evolucion", "Objetivos"] },
  { id: "ventas", title: "Ventas", reports: ["Ventas", "DetalleVentas", "Productos", "Rentabilidad", "HorariosVenta", "Promociones"] },
  { id: "caja", title: "Caja y cobros", reports: ["Pagos", "VendidoCobrado", "Cajas", "CajaMayor", "Bancos", "Egresos"] },
  { id: "stock", title: "Stock y pedidos", reports: ["Stock", "Reposicion", "PedidosCentral"] },
  { id: "personas", title: "Personas y clientes", reports: ["Personal", "Clientes"] },
  { id: "control", title: "Control", reports: ["Alertas", "Ajustes", "Calidad", "Auditoria", "Incidencias", "Fiscal"] },
] as const;
export function reportArea(id: string) {
  return REPORT_AREAS.find(area => (area.reports as readonly string[]).includes(id));
}
export function groupAvailableReports(reports: readonly NavigationReport[]) {
  return REPORT_AREAS.map(area => ({ ...area, reports: area.reports.flatMap(id => {
    const report = reports.find(item => item.id === id);
    return report ? [report] : [];
  }) })).filter(area => area.reports.length > 0);
}
export function availableReportGuides(access: ReportAccess) {
  if (access.role === "administracion") return adminReportGuides.filter(r => access.reportPermissions.includes(r.id));
  return access.role === "supervisora" && access.supervisorReports ? [supervisionReportGuide] : [];
}
export function canOpenReport(access: ReportAccess, id: string) {
  return availableReportGuides(access).some(report => report.id === id);
}
export const reportQuestion = (report: ReportGuide) => `¿Dónde encuentro el informe ${report.title}?`;
export function describeReport(report: ReportGuide, followup?: "filters" | "export" | "source") {
  const area = reportArea(report.id);
  const path = report.id === "Supervision" ? "Menú → Reportes → Reportes de supervisión" : `Menú → Administración → Panel central → ${area ? `${area.title} → ` : ""}${report.title}`;
  const intro = `Dónde: ${path}.\n\nQué encontrarás: ${report.detail}\n\nEstado: ${report.status}.`;
  const filters = `Filtros y lectura: ${report.filters}`;
  const limits = `Importante: ${report.limits}`;
  const exportNote = report.id === "Supervision"
    ? "Esta pantalla de Supervisión no tiene exportación propia. Solicitá el informe a Administración; no tiene los mismos filtros o botones que el panel administrativo."
    : "‘Exportar informe CSV’ requiere permiso de exportación y descarga un resumen por local de ventas/tickets/caja que puede abrirse con Excel; no es una exportación específica del detalle de este reporte. ‘Imprimir / Guardar PDF’ imprime la vista actual; revisá el resultado antes de compartirlo. No exporto ni envío archivos automáticamente.";
  if (followup === "export") return `${intro}\n\n${exportNote}`;
  if (followup === "filters") return `${intro}\n\n${filters}\n\n${limits}`;
  return `${intro}\n\n${filters}\n\n${limits}\n\nTe oriento dónde consultar; no estoy leyendo ni calculando las cifras del informe.`;
}

export type ReportGuideResult =
  | { kind: "answer"; report: ReportGuide; content: string }
  | { kind: "clarify"; content: string; choices: ReportGuide[] }
  | { kind: "unavailable"; content: string };

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/p\s*&\s*l/g, "pnl").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const stop = new Set("a al algo alguna algun ahora aqui asi buscar busco como con cual cuales consultar consulta consulto de del donde el en entre es esta este eso estoy encontrar encuentro explicame favor hago hay indicame informe informes interesa interesaria ir la las lo los me mi mis mostrar muestra muestre necesito obtener para por porfa podria puedo puedes que quiero reporte reportes saber se su sus tener tu un una ver veo vemos fue darme conocer yo y ya exportar exporto descargar descargo imprimir imprimo guardar guardo excel pdf".split(" "));
const aliases: Record<string,string> = {};
for (const group of [
  "venta ventas vendido vendimos vendio vendi vendemos vender venden facturamos facturacion", "cobro cobros cobrado cobramos cobre cobrar",
  "producto productos articulo articulos", "local locales sucursal sucursales", "gasto gastos egreso egresos gastamos", "proveedor proveedores", "pagar pagado pendiente deuda",
  "cliente clientes", "ticket tickets", "margen margenes", "ganancia ganancias utilidad utilidades ganamos", "perdida perdidas",
  "stock inventario existencias", "caja cajas", "pedido pedidos solicitud solicitudes", "pendiente pendientes", "fichaje fichajes fichadas",
  "hora horas horario horarios", "personal empleados empleado personas persona", "tardanza tardanzas tarde", "mes mensual mensuales",
  "comparar comparacion contra versus vs coincide coinciden", "promocion promociones campana campanas", "anulacion anulaciones anuladas anulo",
  "descuento descuentos", "devolucion devoluciones", "invitacion invitaciones regalamos", "saldo saldos", "sobre sobres",
  "auditoria auditora", "cambio cambios modificacion modificaciones modifico modificaron", "estado estados", "sincronizacion sincronizar",
  "resultado resultados", "categoria categorias", "minimo minimos", "falta faltan faltantes", "efectivo cash", "supervision supervisora supervisor",
  "reporte reportes informe informes", "producto prodcutos", "ver veo vemos", "comparar coincide coinciden",
  "recurrencia frecuencia", "importe importes monto montos", "mayor mas", "menor menos", "deuda deudas", "consolidado consolidada",
]) { const [canonical,...words]=group.split(" "); aliases[canonical]=canonical; for(const word of words) aliases[word]=canonical; }
function similar(a: string,b: string) {
  if (a===b) return 1;
  if (Math.min(a.length,b.length)<5 || Math.abs(a.length-b.length)>1) return 0;
  if (a.length===b.length) { const dif=[...a].flatMap((c,i)=>c===b[i]?[]:[i]); return dif.length===1 || (dif.length===2 && dif[1]===dif[0]+1 && a[dif[0]]===b[dif[1]] && a[dif[1]]===b[dif[0]]) ? 0.87:0; }
  const [short,long]=a.length<b.length?[a,b]:[b,a];
  return [...long].some((_,i)=>long.slice(0,i)+long.slice(i+1)===short)?0.87:0;
}
function terms(value: string) {
  // Ignore requested date/local qualifiers for locating, never silently apply them as filters.
  const text=norm(value).replace(/\b(en |de |para )?(recoleta|maure|congreso|villa mitre|novo pacheco)\b/g," ")
    .replace(/\b(este mes|esta semana|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/g," ");
  return [...new Set(text.split(/\s+/).map(w=>{
    if(aliases[w])return aliases[w];
    const matches=new Set(Object.keys(aliases).filter(a=>similar(w,a)>0).map(a=>aliases[a]));
    return matches.size===1?[...matches][0]:w;
  }).filter(w=>w.length>1&&!/^\d+$/.test(w)&&!stop.has(w)))];
}
const catalog = [...adminReportGuides, supervisionReportGuide];
const index = catalog.map(r=>({report:r,phrases:[r.title,...r.questions].map(terms)}));
const df=new Map<string,number>();
for (const entry of index) for(const word of new Set(entry.phrases.flat())) df.set(word,(df.get(word)||0)+1);
const weight=(word:string)=>1+Math.log(1+catalog.length/(1+(df.get(word)||0)));
function rankedReports(query:string) {
  const normalized=norm(query); const words=terms(query); const total=words.reduce((s,w)=>s+weight(w),0);
  if(!words.length)return [];
  return index.map(({report,phrases})=>{
    if([report.title,reportQuestion(report),...report.questions].some(p=>norm(p)===normalized))return {report,score:200,coverage:1};
    let best={report,score:0,coverage:0};
    for(const phrase of phrases){const used=new Set<number>();let overlap=0,phraseOverlap=0;
      for(const word of words){let strength=0,at=-1;phrase.forEach((p,i)=>{const value=similar(word,p);if(!used.has(i)&&value>strength){strength=value;at=i;}});if(at>=0){used.add(at);overlap+=weight(word)*strength;phraseOverlap+=weight(phrase[at])*strength;}}
      const coverage=overlap/total;const score=75*coverage+25*phraseOverlap/(phrase.reduce((s,w)=>s+weight(w),0)||1);
      if(score>best.score)best={report,score,coverage};
    }return best;
  }).filter(r=>r.score>0).sort((a,b)=>b.score-a.score);
}

export function locateReport(query: string, access: ReportAccess, options: { force?: boolean; previousId?: string } = {}): ReportGuideResult | null {
  const text=norm(query.slice(0,500));
  const allowed=availableReportGuides(access);
  const previous=allowed.find(r=>r.id===options.previousId);
  if(previous && /^(y )?(como (lo )?(exporto|descargo|imprimo|guardo)|exportar|descargar|excel|pdf|en excel|en pdf|lo puedo exportar|puedo (exportarlo|descargarlo|imprimirlo))$/.test(text))
    return {kind:"answer",report:previous,content:describeReport(previous,"export")};
  if(previous && /^(y )?(que filtros uso|como lo filtro|se puede filtrar por (fecha|local)|por local|por fecha|para (maure|recoleta|congreso|villa mitre)|de donde salen (los )?datos|esta actualizado|es automatico|no entendi|explicame mas|como llego|donde entro|como lo abro)$/.test(text))
    return {kind:"answer",report:previous,content:describeReport(previous,"filters")};
  const explicit = options.force || /\b(reporte|reportes|informe|informes|tablero|estadistica|estadisticas|ranking|indicadores)\b/.test(text);
  if (access.role === "vendedora" && !explicit) return null;
  // Explanations and operational troubleshooting belong to the existing verified help.
  if (!options.force && /^(que reportes puede consultar supervision|por que un reporte no coincide con otro|cual es la diferencia entre vendido y cobrado|que significan mrp recetas y legajos proximamente)$/.test(text)) return null;
  if (!explicit && /\b(no puedo|no me deja|no funciona|como se calcula|como elijo|como selecciono|puedo cobrar)\b/.test(text)) return null;
  if (!explicit && access.role !== "administracion" && /\b(mi pedido|mis pedidos)\b/.test(text)) return null;
  const seeking = explicit || Boolean(previous) || /\b(donde|ver|consultar|cuanto|cuanta|cuantos|cuantas|quien|cual|comparar|resultado|ganancia|perdida|margen|rentabilidad|proyeccion)\b/.test(text) || /^que (producto|productos|local|locales|sucursal|sucursales)/.test(text);
  if (!seeking && access.role !== "administracion" && !access.supervisorReports) return null;
  // Instructions to perform business actions remain in the operational, read-only help.
  if(!options.force && /^(como )?(?:abro|abrir|cierro|cerrar|cobro|cobrar|registro|registrar|crear|creo|anular|anulo|fichar|ficho|cargar|cargo|modificar|modifico|cambiar|cambio|sincronizar|sincronizo|actualizar|actualizo|enviar|envio|configurar|configuro)\b/.test(text) && !explicit) return null;
  const missing=/\b(vencimientos|antiguedad de deuda|sueldos|nomina|liquidacion salarial|ranking de vendedores|venta por vendedor|ventas por vendedor|produccion|recetas|mrp|lotes|vencimiento productos|ebitda|capital de trabajo)\b/.test(text);
  if(missing) return {kind:"unavailable",content:"No hay un informe terminado para ese detalle en el catálogo actual. Egresos permite consultar saldos de cuentas por pagar ya informados por proveedor, pero no calcula vencimientos ni antigüedad de deuda. Liquidación de sueldos, ranking por vendedor y producción/lotes todavía no tienen aquí un reporte completo. Indicá período, local y dato requerido para solicitarlo a Administración."};
  if(/^(reportes?|informes?|buscar (un )?informe|necesito (un )?reporte|no se que informe|que informe uso|orientador de reportes|que informacion puedo obtener de los reportes|que reportes|informes disponibles|ver informes|panel central)$/.test(text))
    return {kind:"clarify",content:allowed.length?"Contame qué querés conocer: ventas, productos, caja, pedidos, personal o resultado mensual. También podés elegir un informe del catálogo. Te indicaré la ruta, filtros reales y lo que todavía está pendiente.":"Tu perfil no tiene reportes habilitados en este catálogo. Supervisión necesita su habilitación específica; Administración puede revisar los permisos. No se amplían accesos desde la ayuda.",choices:allowed.slice(0,3)};
  let ranking=rankedReports(query.slice(0,500));
  // Do not let the supervisor summary shadow a more specific administrative report.
  if(access.role==="administracion")ranking=ranking.filter(r=>r.report.id!=="Supervision");
  const best=ranking[0];
  if(!best || best.coverage<0.55 || best.score<58) return explicit?{kind:"unavailable",content:"No identifiqué un informe con suficiente seguridad. ¿Querés ver ventas, cobros, productos, caja, stock, pedidos, personal o resultados? Indicá también si buscás un resumen o una operación puntual. No genero cifras ni informes que todavía no existen."}:null;
  const strong=best.coverage>=0.78&&best.score>=83;
  const permitted=ranking.filter(r=>allowed.some(a=>a.id===r.report.id));
  const first=permitted[0];
  if(strong && (!first||best.score-first.score>=8))return {kind:"unavailable",content:`Ese tema corresponde a ${best.report.title}, pero no está habilitado para tu perfil. Pedí el informe a Administración/Gerencia o revisión de permisos. La ayuda no te envía a una pantalla restringida ni concede acceso.`};
  if(!first || first.score<58 || first.coverage<0.55)return explicit?{kind:"unavailable",content:"No tenés un informe habilitado que responda a esa consulta. Pedí a Administración el dato y período necesarios. El panel de Supervisión, cuando está habilitado, solo resume la operación disponible; no incluye todos los reportes administrativos."}:null;
  const choices=permitted.filter(r=>first.score-r.score<8 && r.coverage>=0.65);
  if(strong && first.score>=83 && first.coverage>=0.78 && choices.length===1)return {kind:"answer",report:first.report,content:describeReport(first.report,/\b(exportar|exporto|descargar|descargo|imprimir|imprimo|excel|pdf)\b/.test(text)?"export":undefined)};
  return {kind:"clarify",content:"Puede corresponder a más de un informe. ¿Buscás alguno de estos? Cada opción explica su alcance actual; no son cifras calculadas por el chat.",choices:permitted.filter(r=>r.score>=Math.max(55,first.score-18)).slice(0,3).map(r=>r.report)};
}
