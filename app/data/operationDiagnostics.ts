export type DiagnosticSeverity = "error" | "warning" | "info";
export type DiagnosticContext = {
  site: string; section: string; browserOnline?: boolean;
  connectionMode: "En línea" | "Contingencia"; pendingSync: number;
  canSell: boolean; cashOpen: boolean; hasActiveShift: boolean;
  cartItems: number; customer: string; discount: number; maxDiscount: number;
  splitPayment: boolean; splitPaymentTotal: number; saleNet: number;
  positivePaymentsCount?: number; openOrdersCount?: number; requiresEnvelope?: boolean;
  countedCash: number; envelopeCash: number; expectedCash: number;
  cashVariance: number; maxCashVariance: number; lowStockCount: number;
  insufficientStockProducts: string[]; invalidInvitationProducts: string[];
  recentMessage: string;
};
export type DiagnosticFinding = { severity: DiagnosticSeverity; title: string; detail: string };

export function runOperationDiagnostics(context: DiagnosticContext, scope?: "Ventas" | "Caja" | "Conexión"): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];
  const add = (severity: DiagnosticSeverity, title: string, detail: string) => findings.push({ severity, title, detail });
  if (context.browserOnline === false)
    add("warning", "El navegador informa que está sin conexión", "Conservá esta pestaña y el mismo dispositivo. Cuando vuelva la conexión, verificá la sincronización pendiente. Este indicador no es una prueba del servidor.");
  else if (context.connectionMode === "Contingencia")
    add("warning", "El sistema está en contingencia", "Las operaciones pueden quedar guardadas localmente hasta recuperar conexión.");
  if (context.pendingSync > 0)
    add("warning", context.pendingSync + " operación" + (context.pendingSync === 1 ? "" : "es") + " marcada como pendiente", "No cierres sesión ni borres datos. Al recuperar conexión verificá el guardado de las operaciones; el contador en cero, por sí solo, no confirma su recepción en el servidor.");
  if (!context.site && ["Ventas", "Caja", "Stock", "Pedido"].includes(context.section) && scope !== "Conexión")
    add("error", "No hay un local seleccionado", "Elegí el local correcto antes de operar para que venta, caja y stock queden bien asignados.");

  if (context.section === "Ventas" && (!scope || scope === "Ventas")) {
    if (!context.canSell) add("error", "Tu usuario no tiene permiso para cobrar", "Administración debe revisar los permisos; el diagnóstico no puede cambiarlos.");
    if (!context.cashOpen) add("error", "La caja del local está cerrada", "Abrí la caja y declarale el fondo inicial antes de cobrar.");
    if (context.cashOpen && !context.hasActiveShift) add("warning", "La caja no tiene un turno activo", "No es un bloqueo del botón Cobrar en esta versión, pero falta la asociación de turno. Avisá a Administración: el relevo sobre una caja abierta necesita revisión.");
    if (context.cartItems === 0) add("error", "La venta todavía no tiene productos", "Agregá al menos un producto antes de intentar cobrar.");
    if (!context.customer.trim()) add("warning", "Falta identificar al cliente", "Completá el cliente o usá Consumidor final cuando corresponda.");
    if (context.discount > context.maxDiscount)
      add("error", "El descuento supera el límite", "Cargaste " + context.discount + "% y el máximo autorizado para " + (context.site || "este local") + " es " + context.maxDiscount + "%.");
    if (context.splitPayment && (context.positivePaymentsCount === 0 || Math.round(context.splitPaymentTotal) !== context.saleNet))
      add("error", "Los medios de pago no completan el total", "Los importes cargados deben sumar exactamente $" + Math.round(context.saleNet).toLocaleString("es-AR") + ".");
    if (context.insufficientStockProducts.length)
      add("warning", "Hay cantidades superiores al stock visible", "Revisá: " + context.insufficientStockProducts.join(", ") + ". No puedo atribuir a esto un bloqueo de cobro: es una inconsistencia a revisar.");
    if (context.invalidInvitationProducts.length)
      add("error", "La invitación supera la cantidad cargada", "Corregí la cantidad invitada en: " + context.invalidInvitationProducts.join(", ") + ".");
  }

  if (context.section === "Caja" && (!scope || scope === "Caja")) {
    if (!context.cashOpen) add("info", "No hay una caja abierta", "Si vas a comenzar a operar, registrá la apertura y el fondo inicial.");
    else if (!context.hasActiveShift) add("warning", "Falta el responsable del turno", "La caja figura abierta, pero no tiene un turno activo asociado. Consultá a Administración antes del relevo; no inventes un cierre diario.");
    if (context.cashOpen && (context.openOrdersCount || 0) > 0)
      add("error", "Hay comandas abiertas pendientes", "Resolvé las comandas del local antes de confirmar el cierre diario.");
    if (context.requiresEnvelope !== false && context.envelopeCash > context.countedCash)
      add("error", "El sobre supera el efectivo contado", "El sobre es parte del dinero físico contado y no puede ser mayor que ese total.");
    if (Math.abs(context.cashVariance) > context.maxCashVariance)
      add("error", "La diferencia supera el máximo autorizado", "La diferencia actual es $" + Math.round(context.cashVariance).toLocaleString("es-AR") + ". El cierre la bloquea; pedí revisión a Administración sin alterar el conteo real.");
    if (context.countedCash > 0 && context.expectedCash >= 0)
      add("info", "Cálculo de caja verificado", "Esperado: $" + Math.round(context.expectedCash).toLocaleString("es-AR") + ". Contado: $" + Math.round(context.countedCash).toLocaleString("es-AR") + ". Diferencia: $" + Math.round(context.cashVariance).toLocaleString("es-AR") + ".");
  }
  if (!scope && (context.section === "Stock" || context.section === "Pedido") && context.lowStockCount > 0)
    add("warning", "Hay productos en nivel mínimo", context.lowStockCount + " producto" + (context.lowStockCount === 1 ? "" : "s") + " del local requieren revisión o reposición.");
  // Do not echo arbitrary recentMessage: it may be stale, unrelated, or contain a temporary credential.

  return findings.filter((finding, index, all) =>
    all.findIndex((candidate) => candidate.title === finding.title && candidate.detail === finding.detail) === index,
  );
}

export function formatDiagnostic(findings: DiagnosticFinding[], section: string, site: string) {
  if (!findings.length)
    return "No encontré un bloqueo entre las condiciones visibles revisadas en " + section + (site ? " de " + site : "") + ". Esto no certifica que todo funcione ni consulta el historial, el banco o el servidor. Contame qué botón usaste y qué aviso apareció, o enviá el caso a Administración. No modifiqué operaciones.";
  const icons: Record<DiagnosticSeverity, string> = { error: "⛔", warning: "⚠️", info: "ℹ️" };
  return ["Observaciones de la pantalla actual · " + section + (site ? " · " + site : "") + ":", ...findings.map((finding) => icons[finding.severity] + " " + finding.title + "\n" + finding.detail), "Este análisis es de solo lectura y no prueba el estado del servidor ni atribuye un error a una persona."].join("\n\n");
}
