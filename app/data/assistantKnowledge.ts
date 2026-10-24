/** Source-reviewed help, not generative AI. Update the guide and its tests with each workflow change. */
export type AssistantRole = "vendedora" | "supervisora" | "compras" | "administracion" | "personal";
export type HelpCapability = "central" | "minimumStock" | "countStock" | "approveStock" | "supervisorReports" | "schedules";
export type HelpAccess = { role: AssistantRole; capabilities?: Partial<Record<HelpCapability, boolean>> };
export type AssistantTopic = {
  id: string; category: string; question: string; keywords: string[];
  roles: AssistantRole[]; requires?: HelpCapability; source: string;
  answers: [string, string, string]; diagnostic?: "Ventas" | "Caja" | "Conexión";
};
export const HELP_REVIEW_DATE = "2026-10-13";
const ALL: AssistantRole[] = ["vendedora", "supervisora", "administracion"];
const ADMIN: AssistantRole[] = ["administracion"];
const ADMIN_AND_PURCHASES: AssistantRole[] = ["administracion", "compras"];
const page = (functionName: string) => `app/page.tsx · ${functionName}`;
// All three presentations share the same reviewed instructions: variation must not change a procedure.
function topic(id: string, category: string, question: string, keywords: string[], body: string,
  source: string, extra: Partial<Pick<AssistantTopic, "roles" | "requires" | "diagnostic">> = {}): AssistantTopic {
  return { id, category, question, keywords, source, roles: ALL,
    answers: [body, `Te explico cómo funciona en L’ARTISAN:\n\n${body}`, `Tené en cuenta estas indicaciones:\n\n${body}`], ...extra };
}

export const assistantTopics: AssistantTopic[] = [
  topic("overview", "Ayuda", "¿Qué puedo hacer en L’ARTISAN?", ["como funciona el sistema", "que tiene el sistema", "guia del proyecto", "ayuda general"],
    "L’ARTISAN reúne ventas, caja, stock, pedidos, devoluciones, egresos, clientes y fichaje. Administración agrega usuarios, precios, límites, reportes e integraciones. Las secciones dependen de tu perfil, permisos y locales. Elegí un tema en ‘Ver preguntas’ para consultar los pasos.", page("tabs / roleTasks")),
  topic("first-login", "Acceso", "¿Cómo ingreso por primera vez?", ["primer ingreso", "primera vez", "clave provisoria", "contraseña temporal", "primer acceso"],
    "Ingresá con el usuario asignado y la contraseña temporal que te entregó Administración. El sistema pide cambiarla por una personal antes de continuar. No compartas las claves ni las escribas en esta ayuda.", page("enter / changeOwnPassword")),
  topic("forgot-password", "Acceso", "¿Qué hago si olvidé mi contraseña?", ["olvide clave", "recuperar contraseña", "olvide mi contraseña", "perdi clave", "no recuerdo contraseña"],
    "En el acceso tocá ‘Olvidé mi contraseña’ e indicá tu usuario. Para vendedoras y supervisoras se registra una solicitud a Administración; después recibirás una clave temporal por un canal validado. En las cuentas administrativas, la recuperación usa un código al correo configurado. No se muestra tu contraseña anterior.", "donweb-api/index.php · password recovery routes"),
  topic("login-problem", "Acceso", "¿Por qué no puedo ingresar?", ["no puedo entrar", "no me deja ingresar", "error al ingresar", "usuario incorrecto", "clave incorrecta", "login falla", "contraseña no funciona"],
    "Revisá tu usuario, espacios al copiar y la contraseña: las mayúsculas sí importan en la clave. Si era temporal y ya la cambiaste, usá la nueva. Si no la recordás, elegí ‘Olvidé mi contraseña’. Si informa que la cuenta está inactiva o sin acceso, Administración debe revisarla. No me envíes tu clave.", page("enter")),
  topic("username", "Acceso", "¿El usuario distingue mayúsculas y minúsculas?", ["nombre apellido punto", "usuario mayuscula minuscula", "usuario con dni", "como escribo usuario"],
    "Escribí el identificador que te asignaron, por ejemplo nombre.apellido; el acceso normaliza las mayúsculas del usuario. El punto forma parte del identificador: no lo reemplaces por un espacio. La contraseña sí distingue mayúsculas y minúsculas.", "donweb-api/index.php · auth/login"),
  topic("password-rules", "Acceso", "¿Qué requisitos tiene mi contraseña nueva?", ["ocho caracteres", "8 caracteres", "clave ocho digitos", "requisitos contraseña", "contraseña invalida", "cambiar contraseña"],
    "La contraseña nueva debe tener al menos 8 caracteres e incluir mayúscula, minúscula, número y símbolo. No son solo 8 dígitos. Elegí una clave única y guardala de forma segura; esta ayuda no puede verla ni cambiarla.", "donweb-api/index.php · password validation"),
  topic("show-password", "Acceso", "¿Cómo veo la contraseña que estoy escribiendo?", ["mostrar contraseña", "ocultar clave", "ver clave al escribir", "ojito contraseña"],
    "En el ingreso, el botón Mostrar permite revisar la contraseña escrita; Ocultar vuelve a taparla. Usalo solo cuando nadie pueda verla. No recupera contraseñas guardadas de otras personas.", page("showPassword")),
  topic("mfa", "Acceso", "¿Está activo el doble factor?", ["doble factor", "dos factores", "2fa", "codigo autenticador"],
    "El doble factor agrega una segunda verificación además de la contraseña. En esta versión el acceso lo anuncia para una etapa posterior; no debo darlo por activo. El código de recuperación por correo no equivale a tener doble factor en cada inicio de sesión.", page("login screen")),
  topic("location", "Acceso", "¿Cómo elijo el local donde voy a trabajar?", ["cambiar local", "elegir sucursal", "seleccionar local", "vender otro local", "no aparece mi local", "local equivocado"],
    "Si tenés varios locales asignados, elegí el correcto en el selector superior antes de operar y verificá el nombre en pantalla. Si no aparece, pedí a Administración que revise tus locales. Cambiar el selector no traslada una venta ya registrada: si cargaste algo en otro local, avisá con el número de operación.", page("site / allowedSites")),
  topic("permissions", "Acceso", "¿Por qué no veo una sección o un botón?", ["no tengo permiso", "acceso denegado", "no aparece boton", "no veo seccion", "permisos de mi usuario"],
    "Las opciones dependen del rol, los locales y los permisos de acción. Algunas funciones de Central, stock y reportes también tienen habilitaciones específicas. Indicá a Administración qué sección falta y tu local, sin compartir la contraseña. La ayuda no puede habilitar accesos.", page("can / tabs")),

  topic("cash-overview", "Caja", "¿Cómo funciona la caja?", ["como hago caja", "usar caja", "manejar caja", "hacer caja"],
    "Primero elegí el local y abrí Caja con el fondo inicial contado. Durante la operación revisá cobros y movimientos. Al final contá el efectivo total, declaralo y separá el sobre si corresponde antes de ‘Confirmar cierre’. El cierre diario y ‘Cerrar turno’ son acciones distintas.", page("openCash / confirmClose")),
  topic("open-cash", "Caja", "¿Cómo hago la apertura de caja?", ["abrir caja", "abro caja", "iniciar caja", "empezar caja", "fondo inicial", "arqueo inicial", "abrir cajaa"],
    "Entrá en Caja del local correcto, contá el dinero físico recibido como fondo inicial, cargá ese importe y tocá ‘Abrir caja’. La apertura queda asociada al local, usuario y horario. Después volvé a Ventas para cobrar. No incluyas en el fondo ventas que todavía no hiciste.", page("openCash")),
  topic("open-cash-problem", "Caja", "¿Por qué no puedo abrir caja?", ["no puedo abrir caja", "no me deja abrir caja", "error apertura caja", "caja ya abierta"],
    "Si informa que la caja ya está abierta, no se puede abrir otra en ese local. Revisá el local y el nombre de la responsable que muestra Caja. El relevo exige cierre completo con arqueo de la responsable saliente; recién entonces puede abrir la siguiente. No abras, modifiques ni cierres una caja ajena, y no hagas un cierre ficticio: avisá a Supervisión o Administración con el aviso y la hora.", page("openCash / confirmClose"), { diagnostic: "Caja" }),
  topic("close-cash", "Caja", "¿Cómo hago el cierre diario de caja?", ["cerrar caja", "cierro caja", "cierre diario", "terminar dia", "cierre de caja"],
    "Entrá en Caja y resolvé las comandas abiertas. Contá todo el efectivo físico y cargalo en ‘Efectivo contado en caja’; el sobre, si corresponde, es una parte de ese total. Revisá diferencia y movimientos y tocá ‘Confirmar cierre’. No inventes ajustes para hacer coincidir los importes.", page("confirmClose")),
  topic("close-cash-problem", "Caja", "¿Por qué no puedo cerrar caja?", ["no puedo cerrar caja", "no me deja cerrar caja", "error cierre", "cierre bloqueado", "comandas abiertas pendientes"],
    "El cierre requiere caja abierta y ninguna comanda pendiente del local. Además, cuando corresponde sobre, no puede superar el contado; la diferencia absoluta tampoco puede superar el límite configurado. Revisá el aviso y los importes reales. Si no podés resolverlo, pedí revisión a Administración sin alterar el conteo.", page("confirmClose"), { diagnostic: "Caja" }),
  topic("close-shift", "Caja", "¿Cómo cierro mi turno?", ["cerrar turno", "cierro turno", "cerrar turno de caja", "cambio vendedora", "relevo turno", "terminar turno"],
    "No hay cierre de turno. La caja permanece abierta durante la jornada y puede atenderla otra usuaria. Si se confirmó un cierre por error, solo el mismo día aparece ‘Reabrir último cierre de hoy’: pide motivo, conserva el fondo, ventas y auditoría, y el cierre final actualiza la misma fila diaria de Drive. Para otro día pedí una corrección a Administración.", page("confirmClose / reopenTodayCash")),
  topic("cash-single-responsible", "Caja", "¿Puede haber dos cajas abiertas en el mismo local?", ["solo una caja abierta", "solo puede haber una caja abierta", "dos cajas abiertas", "quien es responsable de caja", "caja abierta por otra vendedora", "otra vendedora abre caja", "caja responsable"],
    "No. El servidor permite una sola caja abierta por local y una única responsable activa. Si dos dispositivos intentan abrirla, solo queda confirmada la primera y el otro recibe el aviso con responsable y hora. No abras otra, no cargues otro fondo y no operes una caja ajena. Para relevo, la responsable saliente debe cerrar con arqueo y luego la entrante abre su propia caja.", page("openCash / confirmClose"), { diagnostic: "Caja" }),
  topic("cash-difference", "Caja", "¿Cómo se calcula la diferencia de caja?", ["diferencia caja", "efectivo esperado contado", "caja no cuadra", "sobra efectivo", "falta efectivo", "67000 67100 60000", "7100 diferencia"],
    "Diferencia = efectivo contado − efectivo esperado. Dinero que queda = contado − sobre. Si esperabas $67.000, contaste $67.100 y entregás $60.000: sobran $100 frente al esperado y quedan $7.100 en caja. No sumes el sobre al contado otra vez.", page("expected / cashVariance / cashRemaining")),
  topic("envelope", "Caja", "¿Cómo registro el sobre de efectivo?", ["sobre efectivo", "entregar sobre", "dinero queda caja", "sobre supera contado", "60000 sobre"],
    "Contá primero todo el efectivo, incluido lo que vas a entregar. En ‘Sobre en efectivo’ indicá solo la parte que separás: nunca más que lo contado. Si el local requiere sobre, al confirmar el cierre se registra su entrega a Caja Mayor. No todos los locales usan sobre; seguí los campos visibles.", page("requiresEnvelope / confirmClose")),
  topic("cash-movement", "Caja", "¿Cómo registro un movimiento de caja?", ["ajuste caja", "ingreso caja", "retirar dinero", "retiro caja", "movimiento caja"],
    "En Caja, ‘Ajuste / movimiento de caja’, elegí Ingreso, Ajuste o Retiro. Cargá importe positivo y motivo; para Ajuste elegí si suma o resta efectivo. Revisá y tocá ‘Registrar movimiento’. Solo registrá movimientos reales; esta ayuda no los carga por vos.", page("registerCashAdjustment")),
  topic("cash-transfer", "Caja", "¿Cómo transfiero efectivo entre cajas?", ["transferir efectivo", "transferencia entre cajas", "enviar dinero otro local", "pasar dinero caja mayor"],
    "Con permiso para transferir y caja abierta, elegí un destino distinto, indicá importe y motivo. No puede superar el efectivo registrado. Al crear la transferencia sale del origen y queda pendiente de recepción; destino o Central debe confirmar la llegada física. No es una transferencia bancaria automática.", page("createCashTransfer / receiveCashTransfer")),
  topic("cash-ledger", "Caja", "¿Dónde veo el historial de movimientos de caja?", ["libro mayor caja", "historial caja", "movimientos efectivo", "saldo libro mayor"],
    "Revisá el libro de movimientos de Caja: distingue ingresos, egresos y registros informativos con referencia y responsable. Un cobro no efectivo no aumenta el efectivo físico. Para una diferencia, compará cada movimiento con lo ocurrido antes de pedir una corrección.", page("cashLedger")),

  topic("sale", "Ventas", "¿Cómo registro una venta?", ["hacer venta", "registrar venta", "cobrar producto", "como cobro", "como cobro una venta", "vender productos"],
    "Elegí local, abrí su caja y entrá en Ventas. Seleccioná la lista Mostrador u Online, productos y cantidades. Revisá invitaciones, descuento, cliente, comprobante y medio de pago. Confirmá el total con ‘Cobrar venta’ solo una vez. El registro impacta en ventas, cobros y stock.", page("pay")),
  topic("cannot-charge", "Ventas", "¿Por qué no puedo cobrar una venta?", ["no puedo cobrar", "no me deja cobrar", "no logro cobrar", "no me permite cobrar", "boton cobrar bloqueado", "error al cobrar", "problema cobro", "no puedo vender", "no puedo cobrar si caja esta abierta", "no puedo cobrar caja cerrada", "no me deja cobrar productos cargados"],
    "Revisá cinco puntos: permiso para cobrar, caja abierta, productos en la venta, descuento dentro del máximo y pagos positivos que completen el total. Con caja cerrada el botón dice ‘Abrí caja para cobrar’. La revisión de esta ayuda solo ve la pantalla actual; no puede comprobar una transacción bancaria ni garantizar que el servidor guardó la venta.", page("pay"), { diagnostic: "Ventas" }),
  topic("cart", "Ventas", "¿Cómo cambio productos o cantidades antes de cobrar?", ["quitar producto", "sacar producto carrito", "cambiar cantidad", "agregar producto venta", "cinco raviolones"],
    "Armá la venta con los productos y cantidades correctos y usá ‘Quitar’ para retirar una línea equivocada antes de cobrar. Revisá siempre el resumen. Si ya cobraste, cambiar el carrito no corrige esa venta: consultá por anulación o devolución según el caso y tus permisos.", page("cart / lines")),
  topic("invitation", "Ventas", "¿Cómo envío solo una unidad de invitación?", ["invitacion", "producto gratis", "regalar producto", "una unidad gratis", "invitar uno de cinco", "regalar uno de cinco raviolones", "5 raviolones 1 invitacion", "invitacion descuenta stock"],
    "Cargá la cantidad total del producto y en esa línea indicá cuántas unidades son invitación. Ejemplo: 5 raviolones, 1 invitado → se cobran 4 y salen 5 del stock. La invitación no debe superar la cantidad cargada y no pone en cero los otros productos.", page("invitedQuantities / pay")),
  topic("discount", "Ventas", "¿Cómo aplico un descuento?", ["aplicar descuento", "porcentaje descuento", "descuento supera limite", "descuento venta", "descuento no funciona"],
    "Elegí si el descuento se carga como porcentaje o como importe en pesos y revisá el total. Se aplica después de las invitaciones. El sistema convierte un importe fijo a su porcentaje equivalente y bloquea cualquier descuento que supere el máximo del local; no existe una aprobación automática desde el chat.", page("discountTotal / pay")),
  topic("payment", "Ventas", "¿Cómo elijo el medio de pago?", ["medio de pago", "forma cobro", "efectivo tarjeta", "mercado pago", "pagar transferencia"],
    "Antes de cobrar seleccioná el medio real en el formulario. Si el cliente pagó por transferencia o billetera, no marques Efectivo. El sistema registra el cobro, pero elegir un medio no prueba que el dinero llegó al banco: comprobalo por el canal habitual autorizado.", page("payment / pay")),
  topic("split-payment", "Ventas", "¿Puedo cobrar una venta con dos medios de pago?", ["pago dividido", "pago mixto", "dos medios", "mitad efectivo mitad tarjeta", "parte efectivo parte transferencia", "pagos no suman total"],
    "Activá el pago dividido, agregá cada medio y su importe positivo. La suma debe completar el total para poder cobrar. Revisá que no haya importes faltantes o repetidos. Ejemplo: $10.000 pueden cobrarse con $4.000 en efectivo y $6.000 por transferencia.", page("splitPayments / pay")),
  topic("payment-correction", "Ventas", "¿Qué hago si registré mal el medio de pago?", ["me equivoque medio pago", "corregir cobro", "cambiar medio pago venta cobrada", "cobre efectivo era tarjeta", "buscar venta para corregir medio pago", "buscar venta medio pago"],
    "Buscá la venta por cliente, importe o referencia y elegí ‘Corregir medio’. Indicá los medios y montos realmente cobrados; deben sumar el total. La corrección no crea otra venta ni modifica productos, stock o factura/CAE, y queda auditada en el turno original. Si hay un conflicto, conservá la operación pendiente y avisá a Administración. No hagas una venta compensatoria.", page("saleSearch / changeSalePayment")),
  topic("print-ticket", "Comprobantes", "¿Cómo imprimo el ticket de una venta?", ["imprimir ticket", "imprimir tiket", "impresora termica", "impresora 3nstar", "ticket cliente", "reimprimir ticket", "no imprime ticket", "usar impresora termica 3nstar"],
    "Después de cobrar se abre la vista previa del ticket. También podés elegir ‘Ticket’ en una venta de la sesión o ‘Imprimir último ticket’. Tocá ‘Imprimir ticket’, seleccioná la impresora térmica de 80 mm y verificá papel, orientación vertical, escala 100 % y márgenes mínimos. Es un comprobante interno: no reemplaza una factura fiscal con CAE.", page("receiptSale / printReceipt")),
  topic("saved-order", "Ventas", "¿Cómo guardo una venta para cobrarla después?", ["guardar comanda", "venta pendiente", "borrador venta", "pausar venta", "cobrar despues", "guardar pedido sin cobrar"],
    "Con productos cargados, tocá ‘Guardar comanda abierta’. Podés continuar otra venta y recuperar luego la comanda para cobrarla. Guardarla no es cobrarla ni descontar stock. Las comandas abiertas del local deben resolverse antes del cierre diario.", page("saveOrder / loadOrder / confirmClose")),
  topic("cancel-sale", "Ventas", "¿Cómo anulo una venta equivocada?", ["anular venta", "cancelar venta", "venta duplicada", "borro venta", "venta equivocada"],
    "Buscá la venta y revisá cuidadosamente su referencia. ‘Anular’ requiere el permiso correspondiente; revierte cobros y repone stock, dejando auditoría. No uses la anulación para una devolución parcial ni vuelvas a anular una venta ya anulada. Si ya hubo devoluciones o tenés dudas, pedí revisión previa a Administración.", page("cancelSale")),
  topic("returns", "Ventas", "¿Cómo registro una devolución o un cambio?", ["devolver producto", "devolucion parcial", "cambio producto", "nota credito interna", "reembolso cliente"],
    "En Devoluciones seleccioná una venta del local, tipo de operación, productos y cantidades y motivo. Revisá el medio de reintegro y si el producto vuelve al stock; no repongas mercadería no apta. Requiere permiso para anular/devolver y no permite superar lo que resta de la venta. La nota generada es interna, no fiscal.", page("registerReturn")),
  topic("price-channel", "Productos", "¿Qué diferencia hay entre Mostrador y Online?", ["lista mostrador online", "precios diferentes", "tarifa aplicada", "precio incorrecto producto", "canal venta"],
    "Son listas de precios para distintos canales. Elegí la que corresponde antes de armar y cobrar la venta y revisá el total. El medio de pago y el canal no son lo mismo. Si un precio está mal, informá producto, local y canal a Administración.", page("saleChannel / channelPrices")),
  topic("mobile-products", "Productos", "¿Por qué no veo todos los productos en el celular?", ["no veo productos", "faltan productos celular", "productos movil", "filtro categoria", "solo sale un producto", "catalogo incompleto"],
    "Tocá ‘Todos’ para quitar el filtro de categoría y revisá Mostrador/Online y el local activo. Una categoría muestra solo sus productos. Si todavía falta alguno, indicá nombre del producto, local y canal a Administración; no puedo concluir que fue eliminado por ver un filtro.", page("filtered / category / saleChannel")),
  topic("fiscal", "Comprobantes", "¿Ya está activa la facturación electrónica con ARCA?", ["arca", "afip", "cae", "facturacion electronica", "factura b", "factura a", "comprobante fiscal"],
    "La emisión fiscal ARCA está preparada en producción para los puntos configurados. Administración prepara la venta y confirma explícitamente antes de pedir el CAE. Factura B corresponde a consumidor final; Factura A requiere razón social, CUIT de 11 dígitos, condición Responsable Inscripto y domicilio fiscal. Una venta autorizada muestra CAE y permite preparar una nota de crédito fiscal asociada. Si ARCA no confirma una respuesta, no reintentes: queda marcada para conciliación.", page("Protección de datos / Emisión fiscal ARCA")),
  topic("fiscal-contingency", "Comprobantes", "¿Qué hago si ARCA no confirma una factura?", ["arca no responde", "arca no confirma", "error cae", "error al emitir cae", "factura pendiente arca", "factura bloqueada conciliacion", "no reintentar factura"],
    "No repitas la venta ni solicites otro CAE. Conservá la referencia de la operación y avisá a Administración. El sistema debe dejar el comprobante bloqueado para conciliación, porque una respuesta incierta puede haber sido recibida por ARCA aunque no se vea aún en pantalla. Administración revisa el estado antes de decidir el siguiente paso.", page("Protección de datos / Emisión fiscal ARCA")),
  topic("ticket-vs-fiscal", "Comprobantes", "¿El ticket térmico reemplaza un comprobante ARCA?", ["ticket reemplaza arca", "ticket fiscal cae", "ticket comprobante interno", "diferencia ticket cae", "comprobante interno arca"],
    "No. El ticket térmico es un comprobante interno de la venta y no reemplaza una factura fiscal con CAE. La factura fiscal se emite en el circuito ARCA autorizado y conserva su numeración y CAE. No prometas al cliente una factura fiscal si todavía no fue autorizada.", page("receiptSale / Protección de datos / Emisión fiscal ARCA")),
  topic("fiscal-print", "Comprobantes", "¿Qué hago si no puedo imprimir una factura fiscal?", ["no puedo imprimir factura", "factura fiscal no imprime", "reimprimir factura cae", "descargar factura cae"],
    "No emitas otro comprobante para resolver una impresión. Confirmá primero en Administración si la venta tiene CAE y número autorizado. El ticket térmico no reemplaza esa factura. Si falta el documento para el cliente, Administración debe recuperar la representación del comprobante autorizado siguiendo el procedimiento fiscal, sin volver a solicitar el CAE.", page("Protección de datos / Emisión fiscal ARCA")),
  topic("barcode-status", "Productos", "¿Cómo vendo con lector de código de barras?", ["lector codigo barras", "scanner venta", "escaner venta", "barcode", "codigo producto etiqueta zebra"],
    "El lector USB funciona como teclado. En Ventas, ubicá el cursor en ‘Escanear código’ y leé el código de barras Code 128 de la etiqueta: cada lectura LART-XXX agrega una unidad. El texto visual ‘COD: 501’ no es escaneable si no tiene barras. Si el código no se reconoce, verificá que la etiqueta sea la vigente; si indica falta de stock, cargá o confirmá primero el stock del local. El descuento de stock sucede al cobrar la venta.", page("Ventas / catálogo de productos")),
  topic("customers", "Clientes", "¿Dónde registro o consulto un cliente?", ["nuevo cliente", "datos cliente", "consumidor final", "clientes contacto", "identificar cliente"],
    "Consultá la sección Clientes disponible en tu perfil y verificá los datos antes de usarlo en una venta. En Ventas revisá el campo Cliente; usá ‘Consumidor final’ cuando corresponda al procedimiento del local. No pegues documentos ni datos bancarios en el chat.", page("Clientes / customer")),

  topic("offline", "Conexión", "¿Qué hago si se corta Internet?", ["sin internet", "sin conexion", "offline", "modo contingencia", "se cayo internet"],
    "Si la aplicación sigue disponible en el equipo, el modo Contingencia permite conservar operaciones localmente. Conservá la pestaña, el dispositivo y los datos del navegador; no cierres sesión ni trabajes el mismo pendiente en otro equipo. No se garantiza abrir la app desde cero sin conexión. Al recuperar Internet revisá la sincronización y que las operaciones realmente estén guardadas.", page("connectionMode / operational persistence"), { diagnostic: "Conexión" }),
  topic("sync", "Conexión", "¿Cómo reviso las ventas pendientes de sincronización?", ["sincronizar ventas", "pendientes sincronizacion", "volver en linea", "contador sincronizacion", "datos no aparecen otro equipo"],
    "Las operaciones pendientes quedan en una bandeja segura del mismo equipo con identificador único. Volvé a estar En línea y usá el reintento de sincronización; esperá la confirmación antes de recargar. Mientras exista el aviso, no repitas el cobro, no hagas una venta compensatoria, no anules por intuición ni borres datos del navegador. Si persiste, informá local, hora y referencia a Supervisión o Administración.", page("syncContingency / operational outbox"), { diagnostic: "Conexión" }),
  topic("mobile-access", "Conexión", "¿Puedo ingresar desde el celular?", ["entrar celular", "usar telefono", "acceso movil", "link vendedores", "direccion ventas", "puedo entrar desde mi telefono", "link para vendedoras en celular"],
    "Sí: abrí https://ventas.lartisantaller.com/ desde el navegador e ingresá con tu usuario personal. Elegí el local autorizado correcto. El teléfono requiere conexión para acceder al servicio; no supone tener las operaciones pendientes de otro equipo que estuvo sin Internet.", page("login / operational persistence")),
  topic("install-app", "Conexión", "¿Cómo agrego L’ARTISAN como app en el celular?", ["instalar app celular", "poner app en inicio", "agregar pantalla principal", "guardar web escritorio celular", "icono lartisan celular", "logo lartisan inicio", "instalar ventas iphone", "instalar ventas android", "como instalo la app en iphone", "quiero el icono de lartisan en android", "guardar la web en el escritorio del celular"],
    "Primero abrí https://ventas.lartisantaller.com/ en el navegador. En iPhone usá Safari: tocá Compartir y después ‘Agregar a inicio’. En Android abrí el menú de Chrome y elegí ‘Instalar app’ o ‘Agregar a pantalla principal’. Confirmá el nombre y aparecerá con el logo de L’ARTISAN. Esto crea un acceso directo; para operar seguís necesitando conexión.", "app/layout.tsx · metadata/icons; public/manifest.webmanifest"),
  topic("lost-data", "Conexión", "¿Qué hago si faltan datos o la página no carga?", ["perdi datos", "no carga pagina", "pantalla blanca", "error servidor", "faltan ventas", "datos desaparecieron"],
    "Anotá el aviso, hora, local y última operación. Verificá conexión y el local seleccionado. Si puede haber operaciones locales pendientes, no borres caché/datos, no reinstales ni cierres sesión; pedí revisión a Administración. Esta ayuda no puede restaurar datos ni confirmar su pérdida.", page("operational persistence"), { diagnostic: "Conexión" }),

  topic("low-stock", "Stock", "¿Dónde veo los productos con stock bajo?", ["stock bajo", "poco stock", "alerta stock", "sin existencias", "me quedo sin producto"],
    "En Stock se marcan productos cuyo mínimo configurado es mayor que cero y cuya existencia es igual o inferior a ese mínimo. Un mínimo en cero no genera esa alerta. Si llegaste exactamente al mínimo puede haber alerta sin cantidad sugerida, porque el pedido actual repone hasta el mínimo.", page("lowStockProducts / suggestedOrderItems")),
  topic("stock-history", "Stock", "¿Cómo sé por qué cambió el stock?", ["historial stock", "movimientos stock", "porque bajo inventario", "rastrear stock", "venta descuenta stock"],
    "Revisá el historial de movimientos del producto y local: ventas, anulaciones, devoluciones con reposición, ingresos, mermas, ajustes y recepciones explican variaciones. Compará referencia y cantidad, no solo el saldo. Las unidades invitadas también salen del stock.", page("recordStockMovement")),
  topic("stock-minimum", "Stock", "¿Cómo configuro el stock mínimo?", ["cambiar minimo stock", "configurar minimo", "minimo producto", "establecer stock minimo"],
    "En Stock, los perfiles autorizados pueden editar el mínimo por producto y local. El valor se compara con las existencias para alertas y pedido sugerido. No es una previsión de demanda: revisá la cantidad con criterio operativo. Si no ves el campo editable, no tenés esa habilitación.", page("canAdjustStock / minimumStock"), { requires: "minimumStock" }),
  topic("stock-count", "Stock", "¿Cómo cargo un conteo físico de stock?", ["conteo fisico", "stock real", "contar inventario", "diferencia stock", "solicitar ajuste stock"],
    "Un perfil con permiso de stock registra el conteo real y el motivo. La solicitud queda pendiente de aprobación y no modifica existencias hasta que se confirma. Si no tenés el campo habilitado, informá la diferencia sin inventar un ingreso o una venta.", page("canCountRealStock / submitStockAdjustment"), { requires: "countStock" }),
  topic("stock-approval", "Stock", "¿Cómo apruebo un ajuste de stock?", ["aprobar ajuste stock", "rechazar ajuste stock", "ajuste pendiente", "autorizar inventario"],
    "El perfil autorizado revisa local, producto, cantidad contada y motivo. Al aprobar se actualiza el stock al conteo y se registra el movimiento por la diferencia; también puede rechazarse. El cargo por sí solo no habilita esta acción.", page("approveStockAdjustment"), { requires: "approveStock" }),
  topic("stock-movement", "Stock", "¿Cómo registro un ingreso por remito o una merma?", ["ingreso remito", "cargar remito", "registrar merma", "producto vencido", "producto roto", "ingreso mercaderia"],
    "Si tu pantalla de Stock habilita movimientos, elegí producto, tipo, cantidad y detalle; agregá la referencia de remito cuando corresponda. Una merma reduce existencias: no es una venta ni una devolución apta. Si no tenés la opción, informá a la responsable de stock para que lo registre.", page("registerStockMovement")),
  topic("suggested-order", "Pedidos", "¿Cómo funciona el pedido sugerido?", ["pedido sugerido", "sugerencia pedido", "reponer stock", "cantidad sugerida", "no sugiere pedido"],
    "La cantidad sugerida actual es máximo(mínimo − stock actual, 0), por producto y local. No calcula demanda futura ni un stock deseado separado. Revisá y ajustá cantidades antes de enviarlas. Si stock y mínimo son iguales puede haber alerta, pero la sugerencia será cero.", page("suggestedOrderItems")),
  topic("send-order", "Pedidos", "¿Cómo envío un pedido de mercadería a Central?", ["hacer pedido", "enviar pedido", "pedir mercaderia", "solicitud mercaderia", "ordenar productos central"],
    "En Pedido / Solicitud de mercadería elegí productos y cantidades, o cargá el sugerido y revisalo. Enviá solo después de confirmar; requiere permiso para pedidos y al menos una cantidad positiva. Los perfiles que centralizan pedidos no tienen este circuito de solicitud para su propia Central.", page("submitStockRequest")),
  topic("central-access", "Pedidos", "¿Por qué Villa Mitre no tiene la opción de hacer pedido?", ["villa mitre pedido", "no veo pedido", "central no pide", "quien centraliza pedidos"],
    "Villa Mitre es Central. Los perfiles habilitados gestionan ‘Central de pedidos’ para recibir y preparar solicitudes del resto de los locales. No tienen la opción normal de solicitar mercadería a la propia Central. Si tu acceso no coincide con tu función, pedí revisión de perfil.", page("managesCentralOrders / tabs")),
  topic("central-order", "Pedidos", "¿Cómo gestiono un pedido que llegó a Central?", ["recibir pedido central", "gestionar pedido central", "confirmar pedido central", "preparar pedido", "despachar pedido"],
    "En Central de pedidos revisá la solicitud del local y las cantidades por producto. Registrá cuánto se prepara y los motivos de faltantes antes de confirmar el despacho. Si se prepara menos de lo solicitado queda como entrega parcial; el local debe confirmar después su recepción.", page("updateRequestStatus / confirmCentralDispatch"), { requires: "central" }),
  topic("order-shortage", "Pedidos", "¿Cómo indico que falta un producto del pedido?", ["faltante pedido", "falta producto pedido", "entrega parcial", "pedido incompleto central", "cantidad preparada menor"],
    "En Central de pedidos ajustá la cantidad preparada de cada línea, sin superar lo pedido, y detallá el faltante. Al despachar con cantidades menores el pedido queda parcial. Conservá lo solicitado como referencia; no prometas que el faltante se enviará automáticamente en otro pedido.", page("preparedQuantity / confirmCentralDispatch"), { requires: "central" }),
  topic("receive-order", "Pedidos", "¿Cómo confirmo que recibí un pedido en el local?", ["recibir pedido", "recepcionar pedido", "confirmar recepcion", "llego mercaderia", "pedido recibido"],
    "Buscá el pedido despachado o parcial y compará físicamente lo recibido con las cantidades preparadas. Usá «Recibir con lectora» para escanear cada unidad. Si la lectora falla, tocá «Recepción manual» y cargá el conteo con los botones − y +. Confirmá solo cuando cada renglón coincida con el despacho: recién entonces se suma al stock. Ante diferencias, avisá a Central antes de confirmar.", page("confirmRequestReception")),
  topic("order-status", "Pedidos", "¿Dónde veo en qué estado está mi pedido?", ["estado pedido", "seguir pedido", "pedido pendiente", "cuando llega pedido"],
    "Consultá el listado de pedidos del local: muestra la solicitud y su avance de preparación, despacho o recepción. La ayuda no conoce una hora estimada de entrega ni consulta transporte en vivo; para coordinarla contactá a Central o enviá una incidencia.", page("requests / Pedido")),

  topic("expenses", "Operación", "¿Cómo registro un gasto del local?", ["registrar egreso", "cargar gasto", "gasto local", "egreso supera limite", "gasto caja"],
    "En Egresos elegí categoría, importe positivo y detalle. Requiere permiso de egresos y respetar el máximo del local. Revisá el comprobante y registrá solo el gasto real. Si supera el límite, pedí revisión a Administración, sin dividirlo artificialmente.", page("submitExpense")),
  topic("receipt", "Operación", "¿Queda guardado el archivo del comprobante de un egreso?", ["adjuntar comprobante", "subir factura gasto", "archivo comprobante", "egreso sin comprobante"],
    "Atención: el selector de comprobante actual conserva el nombre del archivo, no una copia verificable del documento completo en el servidor. Conservá el original por el canal autorizado y avisá a Administración. Ver un nombre en la lista no garantiza que la imagen o PDF tenga respaldo.", page("expenseReceipt / submitExpense")),
  topic("incidents", "Operación", "¿Cómo aviso un problema del local?", ["registrar incidencia", "reportar error", "avisar problema", "incidencia producto", "reclamo operativo"],
    "En Incidencias elegí tipo y describí qué ocurrió, local y operación o producto involucrado. No incluyas contraseñas ni datos sensibles. Para una duda de uso podés usar ‘Enviar a Administración’ desde esta ayuda: son circuitos distintos y ninguno corrige operaciones automáticamente.", page("submitIncident / Incidencias")),
  topic("tasks", "Tareas", "¿Dónde veo lo que tengo pendiente?", ["mis tareas", "pendientes", "bandeja tareas", "que tengo que hacer", "alertas tareas"],
    "Abrí Tareas: muestra pendientes según el perfil y el local, como abrir caja, resolver comandas, revisar stock o recibir pedidos. Administración también puede atender consultas de ayuda y recuperaciones. Una tarea es un aviso; su presencia no demuestra que un respaldo o integración ya funcione.", page("roleTasks")),
  topic("task-alert", "Tareas", "¿Qué significa el número de alerta en Tareas?", ["numero tareas", "contador tareas", "notificacion administracion", "punto rojo tareas"],
    "En Administración el contador destaca consultas de ayuda y solicitudes de recuperación pendientes. No representa necesariamente todas las tareas operativas. Entrá a revisar el detalle y resolvé cada caso por su circuito.", page("adminTaskAlertCount"), { roles: ADMIN }),
  topic("attendance", "Personal", "¿Cómo registro mi entrada y salida?", ["fichar entrada", "fichar salida", "marcar asistencia", "como ficho", "fichaje", "entrada duplicada", "salida sin entrada"],
    "En Fichaje, verificá el local correcto y tocá ‘Marcar entrada’ o ‘Marcar salida’. El navegador pide ubicación para validar geocerca, distancia y precisión; el servidor decide el resultado. No permite otra entrada si ya hay una abierta ni una salida sin entrada previa. Si la ubicación es denegada, no disponible, fuera de zona o imprecisa, no se registra automáticamente: se crea una excepción para Administración. No intentes fichar de nuevo con otra ubicación ni pidas a otra persona que fiche por vos.", page("markAttendance / attendance/clock")),
  topic("schedules", "Personal", "¿Cómo gestiono los horarios del personal?", ["editar horarios", "cargar horario personal", "programar turnos", "tolerancia tardanza"],
    "El perfil autorizado dispone de la sección Horarios. Revisá persona, local, entrada y tolerancia antes de guardar. El fichaje usa esa programación para señalar tardanzas; no reemplaza la revisión de situaciones particulares.", page("schedules / markAttendance"), { requires: "schedules" }),
  topic("supervisor-reports", "Reportes", "¿Qué reportes puede consultar Supervisión?", ["reportes supervisora", "informes supervisor", "reporte locales"],
    "Los perfiles autorizados tienen la sección Reportes para seguimiento operativo. El rol Supervisión no la recibe automáticamente: confirmá tus locales y opciones habilitadas. La configuración administrativa completa corresponde a Administración/Gerencia.", page("Reportes"), { requires: "supervisorReports" }),

  topic("sales-history", "Ventas", "¿Dónde veo el historial de ventas?", ["historial ventas", "ver ventas del dia", "ventas por fecha", "buscar venta anterior", "buscar una venta por fecha", "ventas de ayer", "revisar comprobante venta"],
    "Abrí ‘Historial de ventas’ en el menú de Ventas. Elegí Desde y Hasta, o tocá ‘Hoy’, y buscá por cliente, comprobante, medio u operación. La lista muestra también las anuladas para conservar trazabilidad; ‘Ver’ abre el detalle. Solo consultá el local que tenés asignado: no borres historiales ni uses un dato del historial para repetir un cobro.", page("Historial de ventas / salesHistory")),
  topic("stock-consult", "Stock", "¿Dónde veo el stock de un producto?", ["donde veo stock", "ver existencias", "consultar inventario", "cuanto stock hay", "producto sin stock", "no hay stock"],
    "Entrá en Stock y verificá primero el local seleccionado; luego buscá el producto y revisá existencias y alertas. En Ventas, una tarjeta también indica la disponibilidad para el local y canal elegidos. Si no hay stock, no fuerces la venta ni cargues un movimiento ficticio: revisá si corresponde Pedido o avisá a la responsable de stock.", page("Stock / lowStockProducts / saleChannel")),
  topic("customer-duplicate", "Clientes", "¿Cómo evito crear un cliente duplicado?", ["cliente duplicado", "ya existe cliente", "buscar cliente antes alta", "repeti cliente", "editar datos cliente", "historial comercial cliente"],
    "Antes de dar de alta, abrí Clientes y buscá por tipo y número de documento o por los datos disponibles. Si ya existe, usá el registro existente en la venta y editá solo los datos que tu pantalla permita verificar. No crees un segundo cliente para corregir un dato ni compartas documentos por Chat. Si detectás duplicados o datos incompatibles, informá a Supervisión o Administración con la referencia para que lo revisen.", page("Clientes / CustomerPanel")),
  topic("pending-sync-safety", "Conexión", "¿Qué hago si aparece sincronización pendiente?", ["aviso sincronizacion pendiente", "no repito cobro", "operacion pendiente internet", "sincronizacion no termina"],
    "Mantené abierta la misma sesión y comprobá conexión y el aviso de sincronización. Usá el reintento del sistema solo con la misma operación; la identidad idempotente evita duplicados cuando el servidor la recibe. No cobres otra vez, no anules, no hagas una venta compensatoria, no cierres ni borres la cola hasta ver confirmación. Si no se resuelve, escalá con local, hora y referencia de la operación.", page("syncContingency / operational outbox"), { diagnostic: "Conexión" }),
  topic("chat-contact", "Chat interno", "¿Cómo hablo con Administración o Supervisión?", ["hablar con administracion", "como hablo con administracion", "hablar con supervisora", "mandar mensaje supervision", "contactar encargado ventas", "chat interno"],
    "Tocá el botón flotante ‘Chat’. Buscá una conversación, elegí un chat individual autorizado o el grupo operativo o de tu local, escribí y enviá. La lista identifica el local cuando corresponde. Solo aparecen contactos y conversaciones autorizados para tu perfil; si no ves a quien necesitás, no intentes acceder con otra cuenta: pedí a Administración que revise el permiso.", "app/modules/chat/InternalChatPanel.tsx · threads / contacts"),
  topic("chat-files-notifications", "Chat interno", "¿Qué archivos y notificaciones admite el Chat interno?", ["adjuntar foto chat", "archivo chat permitido", "notificaciones chat", "mensaje no leido", "sonido chat", "aviso escritorio", "pdf chat"],
    "En Chat podés adjuntar JPG, PNG, WEBP o PDF de hasta 4 MB por archivo. Revisá la vista previa o descarga solo dentro de una conversación autorizada y no envíes contraseñas, claves ni datos bancarios. El botón Chat mantiene el contador de no leídos; desde las preferencias del panel podés activar o silenciar sonido y avisos. La notificación de escritorio o celular depende además del permiso concedido al navegador; si no está permitido, el aviso visual sigue funcionando.", "app/modules/chat/InternalChatPanel.tsx · allowed / preferences; app/modules/chat/ChatUnreadIndicator.tsx"),
  topic("training-repeat", "Capacitación", "¿Cómo vuelvo a ver un tutorial de capacitación?", ["volver a ver capacitacion", "repetir tutorial", "capitulo capacitacion", "capitulo obligatorio", "video obligatorio", "progreso capacitacion", "curso ventas"],
    "Abrí ‘Capacitación’ en el menú y elegí el capítulo. Podés reproducir, pausar, retroceder y volver a verlo; el avance queda asociado a tu usuario. Los capítulos obligatorios aparecen señalados y una actualización puede pedir volver a revisarlos. Si un video no carga, verificá conexión y avisá qué capítulo y aviso aparece; no marques el avance como completado por fuera del sistema.", "app/modules/capacitacion/SalesTrainingPanel.tsx · chapters / progress"),
  topic("attendance-exception", "Fichaje", "¿Por qué no me deja fichar por ubicación?", ["no me deja fichar", "fichaje fuera de zona", "ubicacion denegada fichaje", "gps no disponible", "precision insuficiente", "geocerca", "excepcion fichaje"],
    "En Fichaje aceptá el permiso de ubicación y esperá la lectura. Si estás fuera de la geocerca, la precisión es insuficiente, el GPS no está disponible o el permiso fue denegado, el fichaje no se confirma y queda una solicitud de excepción auditada. Revisá que elegiste el local correcto y que el navegador tiene permiso; no alteres la ubicación ni repitas fichajes. Solo Administración puede aprobar o rechazar la excepción y deja constancia del motivo.", page("markAttendance / admin attendance exceptions")),
  topic("supervisor-cash-control", "Supervisión", "¿Cómo controla Supervisión una caja abierta, arqueo o diferencia?", ["control caja supervisora", "responsable caja", "arqueo supervisar", "diferencia caja vendedora", "caja abierta por quien", "relevo vendedoras"],
    "En Reportes de Supervisión revisá el estado de caja por local junto con ventas, stock y pedidos. La apertura y el cierre son de la responsable de la caja: Supervisión no debe modificar ni cerrar una caja ajena. Ante relevo, verificá que la saliente complete arqueo y cierre antes de que la entrante abra. Si hay diferencia o bloqueo, registrá local, responsable, hora y aviso y escalalo a Administración; nunca tapes una diferencia con un movimiento ficticio.", page("Reportes / Caja / confirmClose"), { roles: ["supervisora", "administracion"], requires: "supervisorReports" }),
  topic("supervisor-operational-report", "Supervisión", "¿Cómo uso los reportes de Supervisión?", ["filtrar reportes supervision", "exportar reporte supervisora", "indicadores locales", "ventas stock pedidos cajas locales", "reporte por sucursal"],
    "Abrí Reportes y revisá los indicadores por sucursal: ventas de sesión, stock bajo, pedidos pendientes y estado de caja. Confirmá el local y el período que muestra la pantalla antes de comparar datos; un indicador operativo no reemplaza la auditoría ni una conciliación bancaria. Si no aparece Reportes, tu perfil no tiene esa habilitación y Administración debe asignarla. Exportaciones y reportes administrativos completos dependen de los permisos visibles en tu cuenta.", page("Reportes / canViewSupervisorReports"), { roles: ["supervisora", "administracion"], requires: "supervisorReports" }),
  topic("supervisor-stock-orders", "Supervisión", "¿Cómo sigue Supervisión stock, pedidos y transferencias?", ["supervisar stock pedidos", "transferencia entre locales", "recepcion pedido supervisora", "seguimiento pedido local", "stock bajo locales"],
    "Usá Reportes para detectar stock bajo y pedidos pendientes por local, y revisá Pedido para el detalle operativo disponible a tu perfil. Un pedido no suma stock hasta que el local confirma la recepción; una entrega parcial debe conservar el faltante y su motivo. Las transferencias y ajustes requieren sus permisos específicos: no cambies existencias para ‘acomodar’ un reporte. Si hay diferencia física, reuní local, producto, cantidad y referencia y escalá el caso.", page("Reportes / Pedido / confirmRequestReception"), { roles: ["supervisora", "administracion"] }),
  topic("supervisor-attendance", "Supervisión", "¿Cómo sigue Supervisión un fichaje rechazado?", ["supervision fichaje rechazado", "ver excepcion fichaje", "aprobar geocerca", "rechazar fichaje", "auditoria asistencia"],
    "La excepción no crea el fichaje por sí sola. Betzi o Andrea deben entrar a Supervisión > Asistencia, revisar persona, local, tipo y motivo, y elegir Aprobar o Rechazar. La decisión queda auditada; al aprobar se registra el fichaje como excepción aprobada. Administración puede consultarla, pero no resolverla. Nunca inventes una entrada o salida.", "donweb-api/index.php · attendance/exceptions; app/modules/asistencia/ScheduleManager.tsx", { roles: ["supervisora", "administracion"] }),
  topic("supervisor-chat-followup", "Supervisión", "¿Cómo hace Supervisión el seguimiento en Chat interno?", ["supervisar conversaciones chat", "grupos locales supervision", "leer mensajes vendedoras", "adjuntos chat supervision", "mensaje entregado leido"],
    "Abrí Chat y elegí solo los grupos de local, operativos o chats individuales que el perfil autoriza. Podés buscar conversaciones y mensajes, y el estado del mensaje muestra enviado, entregado o leído cuando hay destinatarios que lo recibieron o leyeron. No uses otra cuenta para ver un chat ajeno ni descargues adjuntos fuera de una conversación permitida. Para un tema sensible, registrá una incidencia o escalalo a Administración con la referencia del mensaje.", "app/modules/chat/InternalChatPanel.tsx · threads / messages / read"),
  topic("supervisor-customer-history", "Supervisión", "¿Cómo revisa Supervisión clientes e historial comercial?", ["historial cliente supervision", "ventas de cliente", "cliente duplicado supervisora", "revisar cliente venta"],
    "En Clientes revisá el registro y los datos permitidos; en Historial de ventas filtrá por fecha y buscá por cliente, comprobante, medio u operación del local autorizado. Las anuladas se mantienen visibles por trazabilidad. No borres ni alteres historiales para corregir un dato; si hay duplicidad, devolución o anulación sensible, verificá la referencia y escalá según el permiso correspondiente.", page("Clientes / Historial de ventas"), { roles: ["supervisora", "administracion"] }),
  topic("supervisor-permissions-audit", "Supervisión", "¿Cuándo debe escalar Supervisión a Administración?", ["escalar administracion supervisora", "permiso restringido", "auditoria acciones", "no puedo modificar caja ajena", "accion sensible supervision"],
    "Escalá cuando falte un permiso, haya una caja ajena abierta, una diferencia sin explicación, una anulación o devolución sensible, un dato duplicado o una sincronización que no confirma. Conservá la evidencia: local, hora, referencia y aviso. Betzi y Andrea resuelven excepciones de geocerca desde Asistencia; Supervisión no cambia permisos, no borra historiales ni debe anular o modificar una operación sin la autorización que la pantalla exige.", page("Asistencia / excepciones de fichaje"), { roles: ["supervisora", "administracion"] }),
  topic("supervisor-training", "Capacitación", "¿Cómo sigue Supervisión los capítulos obligatorios de capacitación?", ["capacitacion pendiente supervisora", "capitulo obligatorio vendedora", "seguimiento progreso capacitacion", "curso obligatorio ventas"],
    "Cada persona ve los capítulos destinados a su rol y su avance queda ligado a su usuario. Supervisión puede pedir que la vendedora abra Capacitación y complete o repita el capítulo indicado, pero no debe marcar avance en nombre de otra persona. La publicación, obligatoriedad y gestión de contenidos son funciones de Administración; si falta un capítulo o no corresponde al rol, escalalo con el título y la versión.", "app/modules/capacitacion/SalesTrainingPanel.tsx · role / progress", { roles: ["supervisora", "administracion"] }),

  topic("create-user", "Usuarios", "¿Cómo creo un usuario y su clave temporal?", ["crear usuario", "nuevo usuario", "alta usuario", "clave primer acceso usuario nuevo"],
    "En Usuarios completá nombre, identificador, rol, locales y la contraseña temporal requerida por el formulario; no se genera sola en el alta. Respetá los requisitos de seguridad. Al crear el usuario revisá la tarjeta de credenciales para copiar y entregar la clave por un canal validado; deberá cambiarla al ingresar.", page("createManagedUser"), { roles: ADMIN }),
  topic("assign-locations", "Usuarios", "¿Cómo asigno uno, varios o todos los locales?", ["asignar locales", "varios locales", "todos los locales", "local asignado", "habilitar sucursales usuario"],
    "En Usuarios seleccioná el usuario y marcá los locales permitidos, o Todos si corresponde. Revisá también permisos de acción y guardá. Pedile que vuelva a ingresar para comprobar el alcance actualizado. No compartas una sola cuenta entre personas.", page("Usuarios / locationPermissions"), { roles: ADMIN }),
  topic("roles", "Usuarios", "¿Qué diferencia hay entre los cargos y sus permisos?", ["roles permisos", "diferencia usuarios", "vendedora supervisora administracion", "rol gerencia"],
    "Vendedora opera sus locales; Supervisión coordina y puede vender según permisos; Administración/Gerencia gestiona configuración y reportes habilitados. Central, conteo, aprobación de stock y horarios tienen habilitaciones específicas: el nombre del rol no garantiza todas las funciones. Asigná solo los accesos necesarios.", page("can / tabs / managesCentralOrders"), { roles: ADMIN }),
  topic("reset-request", "Usuarios", "¿Dónde llegan las solicitudes de recuperación?", ["solicitud contraseña", "notificacion recuperar", "recuperacion pendiente", "restablecer usuario", "generar clave temporal"],
    "Revisá la alerta de Tareas y la sección de recuperación en Usuarios. ‘Generar contraseña temporal’ devuelve una tarjeta para verla y copiarla: entregala por un canal validado. Si la persona todavía no hizo una solicitud, también podés usar ‘Restablecer contraseña’ directamente en su fila. La clave anterior y sus sesiones abiertas dejan de funcionar, y deberá cambiar la temporal en el próximo ingreso.", page("loadAdminSecurityData / resetPassword / resetManagedUserPassword"), { roles: ADMIN }),
  topic("direct-password-reset", "Usuarios", "¿Cómo restablezco la contraseña de un usuario sin esperar una solicitud?", ["restablecer contraseña usuario", "resetear clave empleado", "dar clave nueva personal", "cambiar clave vendedora", "reiniciar contraseña sin solicitud"],
    "En Administración > Usuarios buscá a la persona y tocá ‘Restablecer contraseña’. Confirmá la acción y copiá la clave temporal que aparece. Entregala por un canal validado: la clave anterior y todas sus sesiones quedan invalidadas, y deberá crear una contraseña personal al ingresar. La cuenta principal de Administración se recupera desde el acceso administrativo.", page("resetManagedUserPassword"), { roles: ADMIN }),
  topic("temp-not-visible", "Usuarios", "¿Qué hago si no aparece o no se copia la clave temporal?", ["no copia clave temporal", "no aparece contraseña temporal", "no veo clave generada", "boton copiar clave"],
    "Buscá la tarjeta de credenciales que aparece después de generar la clave; el estado ‘Restablecida’ no contiene la contraseña. Si falló copiar, podés seleccionarla manualmente en esa tarjeta. Si ya no está disponible, verificá el usuario antes de generar otra: la nueva invalida la anterior. No se recupera la clave personal actual.", page("generatedTemporaryPassword / createdUserCredentials"), { roles: ADMIN }),
  topic("admin-recovery", "Usuarios", "¿Cómo recupera Administración su propia contraseña?", ["olvide clave administracion", "recuperar gerencia", "codigo correo administracion", "no llega codigo recuperacion"],
    "Desde ‘Olvidé mi contraseña’ usá el identificador de tu cuenta administrativa. El código se envía al correo configurado; revisá spam y que sea el mensaje más reciente. No lo compartas en el chat. Si el correo no llega, hace falta revisar la configuración de recuperación con el responsable técnico; la ayuda no puede enviarlo por su cuenta.", "donweb-api/index.php · password recovery codes", { roles: ADMIN }),
  topic("limits", "Configuración", "¿Cómo configuro los límites de cada local?", ["configurar limites", "maximo descuento", "maximo egreso", "diferencia caja permitida", "cambiar limite"],
    "En Límites definí por local el descuento máximo, el importe máximo de egreso y la diferencia máxima de caja. Es una función administrativa. Los circuitos actuales bloquean operaciones que superan el tope; no hay autorización automática del chat. No cambies el límite para ocultar una diferencia sin investigar.", page("Límites / siteLimits"), { roles: ADMIN }),
  topic("prices", "Configuración", "¿Cómo actualizo precios?", ["cambiar precios", "cambiar precio producto", "actualizar precios", "aumento precios", "restaurar lista precios"],
    "En Catálogo y precios usá Agregar producto o Editar para cambiar nombre, presentación, categoría, precios Mostrador y Online y código de barras. Guardar producto actualiza el catálogo de todos los locales. Usá LART- y tres dígitos en Code 128; los códigos anteriores siguen funcionando y no se pueden reutilizar en otro producto. Los productos nuevos comienzan sin stock. Exportar para Excel descarga la lista de códigos. Los aumentos y Restaurar anterior cambian solo los precios de mostrador, no el stock ni las ventas anteriores.", page("Catálogo y precios / catalog"), { roles: ADMIN }),
  topic("reports", "Reportes", "¿Qué información puedo obtener de los reportes?", ["que reportes", "informes disponibles", "panel central", "exportar reporte", "ver informes"],
    "En la ayuda usá ‘Encontrar un informe’ o describí qué querés conocer. El catálogo muestra solo reportes habilitados, su ruta, fuente, filtros reales y limitaciones. Los reportes operativos usan ventas, cobros, cajas y movimientos guardados; los módulos que aún dicen Pendiente no inventan resultados. No todos los filtros superiores actúan sobre todos los reportes; Exportar CSV descarga el resumen del rango seleccionado.", page("ADMIN_REPORTS / reportGuide"), { roles: ADMIN }),
  topic("report-difference", "Reportes", "¿Por qué un reporte no coincide con otro?", ["reporte no coincide", "diferencia reportes", "totales distintos", "datos demostracion", "datos reales reportes"],
    "Compará el mismo local, período, estado de las ventas y fuente. Ventas, cobros registrados, efectivo y acreditaciones bancarias no representan lo mismo. Vendido vs. cobrado detecta pagos faltantes, duplicados o sin asociación dentro del sistema, pero no certifica el banco. Enviá los filtros y referencias a Administración si la diferencia continúa.", page("reports / VendidoCobrado"), { roles: ADMIN }),
  topic("sales-collected", "Reportes", "¿Cuál es la diferencia entre vendido y cobrado?", ["vendido vs cobrado", "ventas cobros diferencia", "conciliar cobros"],
    "Vendido refleja las ventas registradas y cobrado sus cobros registrados por medio. El efectivo físico solo cambia por la parte en efectivo y otros movimientos de caja. Revisá anulaciones, devoluciones y pagos divididos; un registro de transferencia no certifica su acreditación bancaria.", page("sales / payments / cashLedger"), { roles: ADMIN }),
  topic("pnl", "P&L", "¿Cómo sincronizo el P&L con Google Drive?", ["sincronizar pnl", "actualizar pnl", "google sheets", "drive consolidado", "sincronizar p&l"],
    "En P&L consolidado usá el control de actualización desde Drive y verificá el resultado y la fecha de última sincronización. Requiere una cuenta autorizada con lectura de la hoja configurada. Si falla, se conserva la última copia válida; no significa que esté actualizada. Esta ayuda no ejecuta la sincronización.", "donweb-api/index.php · admin/pnl sync; app/page.tsx · syncPnlFromGoogle", { roles: ADMIN }),
  topic("pnl-source", "P&L", "¿De dónde salen los datos del P&L?", ["fuente pnl", "p&l consolidado", "hoja pnl", "pnl automatico", "alimenta solo hoja", "todos datos consolidado"],
    "El P&L muestra únicamente la lectura autenticada más reciente de Google Sheets, con fecha de actualización; ya no completa tarjetas con importes precargados. Gastos y cuentas por pagar se consultan aparte en Egresos, desde GASTOS OPERATIVOS. Ambas conexiones son de solo lectura: editar el sistema no cambia las hojas.", "donweb-api/pnl_sync.php; app/page.tsx · P&L", { roles: ADMIN }),
  topic("accounts-payable", "Egresos", "¿Dónde veo cuentas por pagar o saldo de proveedores?", ["cuentas por pagar", "proveedores pendientes", "saldo proveedores", "deuda proveedores", "facturas pendientes pago", "que debemos a proveedores"],
    "En Administración > Panel central > Egresos, la copia se actualiza automáticamente al abrir si pasaron más de 15 minutos; ‘Actualizar ahora’ permite forzar la lectura. Toma GASTOS OPERATIVOS en modo solo lectura y suma la columna A PAGAR por proveedor. Revisá la fecha de última lectura, el proveedor y el comprobante antes de tomar una decisión: no calcula vencimientos, antigüedad ni modifica la hoja o un pago.", "donweb-api/index.php · admin/expenses/latest; app/page.tsx · Egresos", { roles: ADMIN }),
  topic("pnl-change", "P&L", "¿Rentabilidad es lo mismo que variación mensual?", ["rentabilidad variacion", "formato condicional", "aumento bajo mes", "porcentaje mes anterior", "rentabilidad pnl"],
    "No. La variación mensual compara un valor con el mes anterior; la rentabilidad relaciona un resultado con una base de ingresos o inversión según la línea. Revisá el concepto y la fórmula de la hoja. Un gasto que sube no se interpreta igual que un ingreso, y un mes parcial no debe compararse como si estuviera cerrado.", page("P&L detail / monthly variation"), { roles: ADMIN }),
  topic("backups", "Protección", "¿Cómo funcionan los respaldos?", ["backup", "respaldo", "copia drive", "dos veces semana", "21 horas respaldo"],
    "La política solicitada es dos respaldos semanales a las 21:00, con copia externa en Drive. Una política mostrada en pantalla no prueba que el trabajo se ejecutó: hay que verificar fecha, resultado y archivo de cada copia y una prueba de restauración. La ayuda no comprueba por sí misma el respaldo de DonWeb ni el contenido de Drive.", "donweb-api/backup.php; app/page.tsx · Protección de datos", { roles: ADMIN }),
  topic("restore", "Protección", "¿Cómo recupero datos de un respaldo?", ["restaurar respaldo", "recuperar datos copia", "restauracion backup", "rollback", "volver version anterior"],
    "Pedí una restauración controlada al responsable técnico: identificar la copia, preservar el estado actual y probar primero en un entorno separado. Una copia solo recupera lo que realmente contiene hasta su fecha; operaciones locales no sincronizadas pueden no estar allí. Volver a una versión de código no equivale a restaurar la base de datos.", "deploy/ACTUALIZACIONES_SEGURAS.md; donweb-api/backup.php", { roles: ADMIN }),
  topic("health", "Protección", "¿Dónde reviso la salud del sistema?", ["salud sistema", "health check", "chequeo tecnico", "base no responde", "espacio disponible", "diagnostico servidor"],
    "Revisá Protección de datos y su fecha. Mientras algún usuario utiliza el sistema, un chequeo periódico controla sincronizaciones, respaldo y espacio; si encuentra una condición nueva, envía un correo a Administración y evita repetir la misma alerta durante el intervalo configurado. Si el envío falla, queda indicado en esta pantalla.", page("systemHealth / monitoring heartbeat"), { roles: ADMIN }),
  topic("audit", "Protección", "¿Dónde veo quién hizo un cambio?", ["auditoria", "quien cambio", "historial cambios", "registro inalterable"],
    "En Administración > Auditoría elegí fechas y local, y filtrá por Usuario o Acción. La tabla consulta el historial del servidor y se puede exportar a CSV. Los eventos anteriores a esta mejora pueden tener menos detalle, pero los nuevos guardan responsable, local, acción y descripción.", page("admin/audit / Auditoría"), { roles: ADMIN }),
  topic("google", "Integraciones", "¿Qué hago si falla la conexión con Google?", ["conexion google", "drive desconectado", "autorizar google", "permiso google", "integraciones google"],
    "Revisá qué conexión falló: lectura de Sheets para P&L y escritura de respaldos en Drive son permisos y procesos distintos. Autorizar uno no habilita necesariamente el otro. Verificá cuenta, acceso al archivo y último error sin compartir códigos ni credenciales. La ayuda no cambia permisos ni accede a tu Google.", "donweb-api/pnl_sync.php; donweb-api/backup.php", { roles: ADMIN }),
  topic("updates", "Protección", "¿Cómo se publica una actualización segura?", ["actualizar sistema", "publicar version", "actualizacion segura", "version anterior sistema"],
    "El responsable técnico debe revisar cambios, pruebas y respaldo previo, publicar una versión identificada y comprobar el resultado. Si falla, evalúa volver al código anterior sin sobrescribir operaciones nuevas. La pantalla Actualizaciones no sustituye esas verificaciones; el chat no publica ni restaura nada.", "deploy/ACTUALIZACIONES_SEGURAS.md; app/page.tsx · Actualizaciones", { roles: ADMIN }),
  topic("history-import", "Reportes", "¿Cómo importo ventas o cajas anteriores?", ["importar historial", "cargar ventas antiguas", "subir cierres anteriores", "migrar datos viejos", "plantilla historial"],
    "En Administración > Panel central abrí ‘Importar historial anterior’. Elegí Ventas o Cierres de caja, descargá la plantilla y completala sin cambiar los encabezados. La carga valida fechas y locales, no reemplaza registros con el mismo identificador y deja constancia en Auditoría.", page("admin/history/import"), { roles: ADMIN }),
  topic("cash-history", "Caja", "¿Dónde veo el historial completo de cajas?", ["historial cajas", "cierres anteriores", "diferencias de caja por fecha", "quien abrio caja", "arqueos historicos"],
    "Entrá en Administración > Cajas. El cuadro superior muestra el estado actual y el inferior lista aperturas y cierres del rango, responsables, fondo, esperado, contado, diferencia y sobre. También podés exportar ese historial a CSV.", page("admin/cash-history"), { roles: ADMIN }),
  topic("upcoming", "Próximamente", "¿Qué significan MRP y Recetas y costos (Próximamente)?", ["mrp", "recetas", "proximamente", "produccion futura"],
    "MRP está en preparación con una conexión de solo lectura a la planilla operativa: la web no debe cambiar ninguna celda. Recetas y costos continúa como módulo próximo. Legajos ya permite a Administración consultar la ficha básica creada automáticamente al dar de alta personal. Hasta completar y validar la migración, el cálculo oficial sigue siendo el de la planilla MRP autorizada.", page("MRP / Recetas y costos / Legajos"), { roles: ADMIN_AND_PURCHASES }),
  topic("purchases-access", "MRP", "¿Qué puede consultar Compras en MRP?", ["acceso compras", "usuario compras", "que puede consultar compras", "web modifica planilla mrp", "solo lectura mrp"],
    "El perfil Compras entra desde admin.lartisantaller.com y únicamente accede a MRP. La integración utilizará la planilla operativa como fuente de solo lectura: no editará celdas, fórmulas, protecciones ni Apps Script. A medida que se habiliten las etapas podrá trabajar con listas de compra, órdenes, recepciones y control semanal dentro de los permisos definidos.", page("baseTabs / MRP / defaultActionPermissions"), { roles: ["compras", "administracion"] }),

  topic("free-help", "Ayuda", "¿Esta ayuda consume tokens o tiene costo?", ["consume tokens", "costo ia", "ayuda gratis", "usa api", "inteligencia artificial", "es gratuita"],
    "La ayuda actual busca en un catálogo local de respuestas verificadas, sin enviar consultas a una API de IA ni consumir tokens. Reconoce variantes y errores de escritura, pero no sabe todo ni aprende automáticamente. La guía debe actualizarse cuando cambia el sistema.", "app/components/AiHelpChat.tsx · ask"),
  topic("help-readonly", "Ayuda", "¿La ayuda puede modificar datos o hacer operaciones?", ["puedes modificar datos", "cambiar datos chat", "hazlo por mi", "asistente modifica operaciones"],
    "No. Solo puedo explicar procedimientos y revisar algunos datos visibles de la pantalla. No cobro, abro o cierro cajas, cambio contraseñas, modifico stock ni ejecuto instrucciones. Únicamente si tocás ‘Enviar a Administración’ se crea una consulta de soporte; eso no modifica ventas ni caja.", "app/components/AiHelpChat.tsx · ask / diagnose / escalate"),
  topic("help-diagnosis", "Ayuda", "¿Podés detectar qué hice mal?", ["revisar error", "que hice mal", "detectar error", "revisar que falla", "diagnostico pantalla"],
    "Usá ‘Revisar qué está fallando’. Comparo algunas condiciones de la pantalla actual, como caja abierta, productos, pagos y límites. No inspecciono todo el historial ni puedo atribuirte un error con certeza. Te indico observaciones y qué revisar, sin corregir operaciones ni leer datos de otros usuarios.", "app/data/operationDiagnostics.ts"),
  topic("help-escalation", "Ayuda", "¿Dónde llega Enviar a Administración?", ["enviar administracion", "consulta sin respuesta", "duda no resuelta", "soporte ayuda", "aprende respuestas"],
    "Solo al tocar ‘Enviar a Administración’ se envía la consulta con tu perfil, local y sección a su bandeja. Si aparece error, no des por enviado el mensaje. No manda WhatsApp, no genera una respuesta instantánea y no enseña automáticamente un tema nuevo a la guía.", "app/components/AiHelpChat.tsx · escalate; donweb-api/index.php · assistant/escalate"),
];

export function normalizeAssistantText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/p\s*&\s*l/g, "pnl").replace(/[^a-z0-9%]+/g, " ").trim().replace(/\s+/g, " ");
}
const STOP = new Set("a al algo algun alguna ante asi como con cual cuales de del donde el ella en es esa ese eso esta este estoy hacer hago hay la las lo los me mi mis para por porque puedo puedes que se si su sus tengo tener tu un una uno unos usar yo y ya favor porfa necesito quiero saber quisiera podria podrias podre funciona funciona".split(" "));
const ALIASES: Record<string, string> = {};
for (const group of [
  "abrir abro abri abrimos abriendo apertura iniciar comienzo empezar habro abir",
  "caja cja", "como cmo cm", "que q ke", "porque xq pq",
  "cerrar cierro cerre cerramos cierre cerrando", "cobrar cobro cobre cobramos cobrando cobrarla",
  "vender vendo vendiendo", "clave claves contrasena contrasenas password",
  "local locales sucursal sucursales tienda tiendas", "venta ventas venderla",
  "producto productos articulo articulos mercaderia", "pago pagos pagar pague",
  "stock inventario existencias", "pedido pedidos", "comanda comandas borrador borradores",
  "devolucion devoluciones devolver devuelvo", "anular anulo anulacion cancelar borro borrar",
  "entrada entradas", "salida salidas", "invitacion invitaciones invitar invito invitado regalar regalo",
  "descuento descuentos", "minimo minimos minima", "maximo maxima maximos",
  "seleccionar selecciono elegir elijo escoger", "cambiar cambio modificar modifico editar",
  "usuario usuarios", "temporal temporales provisoria provisorio provisional",
  "administracion admin administrador administrativa", "supervisora supervisor supervision",
  "reporte reportes informe informes", "celular telefono movil", "egreso egresos gasto gastos",
  "fichar fichaje ficha fichada asistencia", "ubicacion geolocalizacion gps geocerca",
  "chat chats mensaje mensajes conversacion conversaciones comunicar comunicacion",
  "adjunto adjuntar adjuntos archivo archivos imagen imagenes foto fotos pdf",
  "notificacion notificaciones aviso avisos", "capacitacion capacitaciones tutorial tutoriales capitulo capitulos",
  "historial historiales historico historicos", "arqueo arqueos contado contar",
  "relevo relevar reemplazo responsable responsables",
  "sincronizar sincronizacion sincroniza sincronizo", "recibir recibido recibida recepcion recepcionar llego",
  "crear creo creacion alta", "actualizar actualizo actualizacion", "configurar configuro configuracion",
  "respaldo respaldos backup backups", "faltante faltantes", "faltan falta", "cantidad cantidades",
  "precio precios", "confirmar confirmo", "recibir recibo recibido recibida recepcion recepcionar llego",
  "error errores falla fallo fallando", "bloqueado bloqueada bloquea bloqueados",
]) {
  const [canonical, ...variants] = group.split(" ");
  ALIASES[canonical] = canonical;
  for (const variant of variants) ALIASES[variant] = canonical;
}
function tokens(value: string): string[] {
  const text = normalizeAssistantText(value).replace(/no (?:me )?(?:deja|permite|puedo|puede|logro)/g, "bloqueado");
  return [...new Set(text.split(" ").map((word) => {
    if (ALIASES[word]) return ALIASES[word];
    // Correct a spelling error only if every near alias refers to the same concept.
    const near = new Set(Object.keys(ALIASES).filter((alias) => tokenSimilarity(word, alias) > 0).map((alias) => ALIASES[alias]));
    return near.size === 1 ? [...near][0] : word;
  }).filter((word) => word.length > 1 && !STOP.has(word)))];
}
// Bounded single-edit matching, including adjacent transposition. Never fuzzy-match tiny words.
function tokenSimilarity(a: string, b: string) {
  if (a === b) return 1;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return 0;
  if (a.length === b.length) {
    const differences = [...a].flatMap((char, i) => char === b[i] ? [] : [i]);
    if (differences.length === 1) return 0.88;
    if (differences.length === 2 && differences[1] === differences[0] + 1 && a[differences[0]] === b[differences[1]] && a[differences[1]] === b[differences[0]]) return 0.88;
    return 0;
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0; i < long.length; i++) if (long.slice(0, i) + long.slice(i + 1) === short) return 0.88;
  return 0;
}
export function topicsForRole(role: AssistantRole, capabilities: HelpAccess["capabilities"] = {}) {
  return assistantTopics.filter((item) => item.roles.includes(role) && (!item.requires || capabilities[item.requires] === true));
}
type Ranked = { topic: AssistantTopic; score: number; coverage: number; matched: number };
export type HelpSearchResult =
  | { kind: "answer"; topic: AssistantTopic }
  | { kind: "clarify"; choices: AssistantTopic[]; message: string }
  | { kind: "restricted"; message: string }
  | { kind: "unknown"; message: string };
const indexed = assistantTopics.map((item) => ({ topic: item, phrases: [item.question, ...item.keywords].map(tokens) }));
const frequency = new Map<string, number>();
for (const item of indexed) for (const token of new Set(item.phrases.flat())) frequency.set(token, (frequency.get(token) || 0) + 1);
const weight = (token: string) => 1 + Math.log(1 + assistantTopics.length / (1 + (frequency.get(token) || 0)));

function rank(question: string): Ranked[] {
  const normalized = normalizeAssistantText(question);
  const query = tokens(question);
  const queryWeight = query.reduce((sum, token) => sum + weight(token), 0);
  if (!query.length) return [];
  return indexed.map(({ topic: item, phrases }) => {
    if ([item.question, ...item.keywords].some((phrase) => normalizeAssistantText(phrase) === normalized))
      return { topic: item, score: 200, coverage: 1, matched: query.length };
    let best = { topic: item, score: 0, coverage: 0, matched: 0 };
    for (const phrase of phrases) {
      const used = new Set<number>();
      let overlap = 0, matched = 0, phraseOverlap = 0;
      for (const word of query) {
        let strength = 0, index = -1;
        phrase.forEach((candidate, i) => {
          const similarity = tokenSimilarity(word, candidate);
          if (!used.has(i) && similarity > strength) { strength = similarity; index = i; }
        });
        if (index >= 0) { used.add(index); matched++; overlap += weight(word) * strength; phraseOverlap += weight(phrase[index]) * strength; }
      }
      const coverage = overlap / queryWeight;
      const completeness = phraseOverlap / (phrase.reduce((sum, word) => sum + weight(word), 0) || 1);
      const score = 75 * coverage + 25 * completeness;
      if (score > best.score) best = { topic: item, score, coverage, matched };
    }
    return best;
  }).filter((item) => item.matched > 0).sort((a, b) => b.score - a.score);
}

export function searchAssistant(question: string, access: HelpAccess, previousTopicId?: string): HelpSearchResult {
  const text = normalizeAssistantText(question.slice(0, 500));
  const available = topicsForRole(access.role, access.capabilities);
  const permitted = new Set(available.map((item) => item.id));
  if (/^(y )?(como lo hago|como hago eso|explicame mas|paso a paso|no entendi|otra vez)$/.test(text) && previousTopicId) {
    const previous = available.find((item) => item.id === previousTopicId);
    if (previous) return { kind: "answer", topic: previous };
  }
  // These requests have no diagnosis without knowing the operation. Do not guess a cause.
  const generic = ["caja", "ayuda", "hola", "no funciona", "no anda", "error", "que hago", "tengo un problema", "no me deja", "no puedo", "venta", "stock", "pedido"];
  if (generic.includes(text)) {
    const ids = text === "caja" ? ["open-cash", "close-cash", "cash-difference"] : text === "stock" ? ["low-stock", "stock-history", "suggested-order"] : text === "pedido" ? ["send-order", "receive-order", "central-order"] : ["cannot-charge", "open-cash", "help-diagnosis"];
    return { kind: "clarify", message: "¿Sobre qué parte necesitás ayuda? Elegí una opción o contame qué botón usaste y qué aviso apareció, sin contraseñas ni códigos.", choices: available.filter((item) => ids.includes(item.id)) };
  }
  // Explicit requests to act or bypass restrictions must not be mistaken for successful actions.
  if (/^(?:por favor )?(?:abre|abri|abrime|cierra|cerra|cerrame|borra|borrame|elimina|modifica|creame|cambia|cambiame) (?:mi |mis |la |las |el |los |un |una )/.test(text) || /(?:saltear|evadir|ignorar) (?:el |los |tus )?(?:permiso|limite|regla)/.test(text))
    return { kind: "answer", topic: assistantTopics.find((item) => item.id === "help-readonly")! };
  const ranked = rank(question.slice(0, 500));
  const best = ranked[0];
  const strong = best && best.coverage >= 0.78 && best.score >= 83;
  const eligible = ranked.filter((item) => permitted.has(item.topic.id));
  const first = eligible[0];
  if (strong && !permitted.has(best.topic.id) && (!first || best.score - first.score >= 7))
    return { kind: "restricted", message: "Ese procedimiento requiere una habilitación que no tiene tu perfil. Pedí revisión a Administración o a la responsable del circuito; la ayuda no cambia permisos ni muestra datos de otros usuarios." };
  const close = first ? eligible.filter((item) => first.score - item.score < 7 && item.coverage >= 0.65) : [];
  // A single sufficiently relevant procedure is safer and more useful than an
  // unnecessary follow-up; keep a clarification when there are alternatives.
  if (first && close.length === 1 && first.coverage >= 0.55 && first.score >= 58) return { kind: "answer", topic: first.topic };
  if (first && first.coverage >= 0.55 && first.score >= 58) {
    return { kind: "clarify", message: "Encontré temas relacionados, pero necesito distinguir el caso para darte los pasos correctos. ¿A cuál te referís?", choices: eligible.filter((item) => item.score >= Math.max(55, first.score - 18)).slice(0, 3).map((item) => item.topic) };
  }
  return { kind: "unknown", message: fallbackAnswers[0] };
}
export function matchAssistantTopic(question: string, role: AssistantRole, capabilities?: HelpAccess["capabilities"]) {
  const result = searchAssistant(question, { role, capabilities });
  return result.kind === "answer" ? result.topic : null;
}
export const fallbackAnswers: [string, string, string] = [
  "No encontré una coincidencia segura en la guía. Contame qué querías hacer, en qué sección y qué aviso apareció, sin claves ni códigos. También podés elegir un tema en ‘Ver preguntas’ o enviar la consulta a Administración.",
  "Necesito un poco más de contexto: ¿qué botón usaste y qué pasó? No voy a inventar una respuesta. Podés consultar el catálogo o enviar el caso a Administración.",
  "Ese caso no tiene una respuesta verificada en esta guía. Indicá la operación y el mensaje que ves; si no alcanza, podés derivarlo a Administración. La guía no aprende automáticamente de ese envío.",
];
