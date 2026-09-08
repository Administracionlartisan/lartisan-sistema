export type DiagnosticSeverity = "error" | "warning" | "info";
export type DiagnosticContext = {
  site: string; section: string; browserOnline?: boolean;
  connectionMode: "En línea" | "Contingencia"; pendingSync: number;
  canSell: boolean; cashOpen: boolean; hasActiveShift: boolean;
  cartItems: number; customer: string; discount: number; maxDiscount: number;
  splitPayment: boolean; splitPaymentTotal: number; saleNet: number;
  countedCash: number; envelopeCash: number; expectedCash: number;
  cashVariance: number; maxCashVariance: number; lowStockCount: number;
  insufficientStockProducts: string[]; invalidInvitationProducts: string[];
  recentMessage: string;
};
export type DiagnosticFinding = { severity: DiagnosticSeverity; title: string; detail: string };

const looksLikeError = (message: string) =>
  /(no se pudo|no podés|no tenés|primero tenés|agregá|supera|debe coincidir|error|fall|inválid|incorrect)/i.test(message);

export function runOperationDiagnostics(context: DiagnosticContext): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];
  const add = (severity: DiagnosticSeverity, title: string, detail: string) => findings.push({ severity, title, detail });
  if (context.browserOnline === false)
    add("warning", "El dispositivo no tiene Internet", "Conservá esta pestaña y el mismo dispositivo. Cuando vuelva la conexión, verificá la sincronización pendiente.");
  else if (context.connectionMode === "Contingencia")
    add("warning", "El sistema está en contingencia", "Las operaciones pueden quedar guardadas localmente hasta recuperar conexión.");
  if (context.pendingSync > 0)
    add("warning", context.pendingSync + " operación" + (context.pendingSync === 1 ? "" : "es") + " sin sincronizar", "No cierres sesión ni borres los datos del navegador hasta que el contador vuelva a cero.");
  if (!context.site && context.section !== "Administración")
    add("error", "No hay un local seleccionado", "Elegí el local correcto antes de operar para que venta, caja y stock queden bien asignados.");

  if (context.section === "Ventas") {
    if (!context.canSell) add("error", "Tu usuario no tiene permiso para cobrar", "Administración debe revisar los permisos; el diagnóstico no puede cambiarlos.");
    if (!context.cashOpen) add("error", "La caja del local está cerrada", "Abrí la caja y declarale el fondo inicial antes de cobrar.");
    if (context.cashOpen && !context.hasActiveShift) add("error", "La caja no tiene un turno activo", "Volvé a Caja para iniciar correctamente el turno responsable.");
    if (context.cartItems === 0) add("info", "La venta todavía no tiene productos", "Agregá al menos un producto antes de intentar cobrar.");
    if (!context.customer.trim()) add("warning", "Falta identificar al cliente", "Completá el cliente o usá Consumidor final cuando corresponda.");
    if (context.discount > context.maxDiscount)
      add("error", "El descuento supera el límite", "Cargaste " + context.discount + "% y el máximo autorizado para " + (context.site || "este local") + " es " + context.maxDiscount + "%.");
    if (context.splitPayment && Math.round(context.splitPaymentTotal) !== Math.round(context.saleNet))
      add("error", "Los medios de pago no completan el total", "Los importes cargados deben sumar exactamente $" + Math.round(context.saleNet).toLocaleString("es-AR") + ".");
    if (context.insufficientStockProducts.length)
      add("error", "Hay cantidades sin stock disponible", "Revisá: " + context.insufficientStockProducts.join(", ") + ".");
    if (context.invalidInvitationProducts.length)
      add("error", "La invitación supera la cantidad cargada", "Corregí la cantidad invitada en: " + context.invalidInvitationProducts.join(", ") + ".");
  }

  if (context.section === "Caja") {
    if (!context.cashOpen) add("info", "No hay una caja abierta", "Si vas a comenzar a operar, registrá la apertura y el fondo inicial.");
    else if (!context.hasActiveShift) add("error", "Falta el responsable del turno", "La caja figura abierta, pero no tiene un turno activo asociado.");
    if (context.envelopeCash > context.countedCash)
      add("error", "El sobre supera el efectivo contado", "El sobre es parte del dinero físico contado y no puede ser mayor que ese total.");
    if (Math.abs(context.cashVariance) > context.maxCashVariance)
      add("warning", "La diferencia supera el máximo autorizado", "La diferencia actual es $" + Math.round(context.cashVariance).toLocaleString("es-AR") + " y debe justificarse antes del cierre.");
    if (context.countedCash > 0 && context.expectedCash >= 0)
      add("info", "Cálculo de caja verificado", "Esperado: $" + Math.round(context.expectedCash).toLocaleString("es-AR") + ". Contado: $" + Math.round(context.countedCash).toLocaleString("es-AR") + ". Diferencia: $" + Math.round(context.cashVariance).toLocaleString("es-AR") + ".");
  }
  if ((context.section === "Stock" || context.section === "Pedido") && context.lowStockCount > 0)
    add("warning", "Hay productos en nivel mínimo", context.lowStockCount + " producto" + (context.lowStockCount === 1 ? "" : "s") + " del local requieren revisión o reposición.");
  if (context.recentMessage && looksLikeError(context.recentMessage))
    add("error", "Último aviso del sistema", context.recentMessage);

  return findings.filter((finding, index, all) =>
    all.findIndex((candidate) => candidate.title === finding.title && candidate.detail === finding.detail) === index,
  ).slice(0, 6);
}

export function formatDiagnostic(findings: DiagnosticFinding[], section: string, site: string) {
  if (!findings.length)
    return "No detecté un error visible en " + section + (site ? " de " + site : "") + ". Revisé conexión, permisos y datos actuales. Si el problema continúa, enviá el caso a Administración para que vea el historial.";
  const icons: Record<DiagnosticSeverity, string> = { error: "⛔", warning: "⚠️", info: "ℹ️" };
  return ["Diagnóstico de " + section + (site ? " · " + site : "") + ":", ...findings.map((finding) => icons[finding.severity] + " " + finding.title + "\n" + finding.detail), "", "Este análisis es de solo lectura: no modificó ninguna operación."].join("\n\n");
}
