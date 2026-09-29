import { SITES } from "../shared/constants";
import type { EmployeeSchedule, Product } from "../shared/types";

export const INITIAL_SCHEDULES: EmployeeSchedule[] = SITES.flatMap((site) => [
  {
    id: `${site}-vendedora`,
    employee: "Vendedora",
    site,
    startsAt: "09:00",
    endsAt: "18:00",
    toleranceMinutes: 10,
  },
  {
    id: `${site}-franquera`,
    employee: "Franquera",
    site,
    startsAt: "12:00",
    endsAt: "21:00",
    toleranceMinutes: 10,
  },
]);
export const GUIDE_UPDATES = [
  {
    date: "Sistema nuevo",
    title: "Ingreso personal y recuperación",
    detail:
      "Ingresá con tu usuario o correo y tu contraseña. En el primer acceso deberás crear una clave personal. No compartas la contraseña; si la olvidás, usá la recuperación desde la pantalla de ingreso.",
  },
  {
    date: "Sistema nuevo",
    title: "Acceso desde el celular",
    detail:
      "Abrí ventas.lartisantaller.com en Safari o Chrome. En iPhone elegí Compartir > Agregar a inicio; en Android elegí Instalar app o Agregar a pantalla principal. Se mostrará con el logo de L’ARTISAN.",
  },
  {
    date: "Sistema nuevo",
    title: "Local y permisos asignados",
    detail:
      "Si tenés acceso a más de un local, elegí el correcto antes de fichar, abrir caja o vender. Las secciones y acciones disponibles dependen de tu usuario; si falta un local o un botón, avisá a Administración.",
  },
  {
    date: "Sistema nuevo",
    title: "Fichaje, turno y apertura de caja",
    detail:
      "Registrá tu fichaje y, antes de vender, entrá a Caja, declará el fondo inicial y abrí la caja con tu usuario. Si cambia la vendedora, cerrá el turno sin cerrar la caja del día.",
  },
  {
    date: "Sistema nuevo",
    title: "Mostrador, Online y comprobantes",
    detail:
      "Antes de cobrar, elegí la lista de precios correcta: Mostrador u Online. Luego seleccioná el medio de pago real y el tipo de comprobante correspondiente.",
  },
  {
    date: "29/09/2026",
    title: "Venta con lectora de códigos",
    detail:
      "Con Ventas abierta, escaneá la etiqueta: no hace falta seleccionar un campo. Cada lectura LART-XXX agrega una unidad del producto correcto. En Pedido, la lectura valida mercadería recibida, no una venta. La etiqueta debe incluir un código de barras Code 128. Administración gestiona productos y códigos desde Catálogo y precios; los códigos anteriores también se aceptan. Si no hay stock, cargá o confirmá primero el stock real del local.",
  },
  {
    date: "28/09/2026",
    title: "Ticket interno y factura fiscal",
    detail:
      "El ticket térmico registra la venta para el cliente, pero no reemplaza una factura fiscal. La Factura B se usa para consumidor final; la Factura A requiere razón social, CUIT de 11 dígitos, condición Responsable Inscripto y domicilio fiscal. La emisión del CAE se controla desde Administración.",
  },
  {
    date: "28/09/2026",
    title: "Si ARCA no responde",
    detail:
      "No repitas la venta ni intentes emitir nuevamente el comprobante. Conservá la referencia de la operación y avisá a Administración: el sistema la deja bloqueada para conciliación antes de cualquier nuevo intento.",
  },
  {
    date: "Sistema nuevo",
    title: "Pagos con dos medios",
    detail:
      "Para un pago mixto, activá Pago dividido y cargá cada medio con su importe. La suma debe coincidir con el total. Si registraste un medio incorrecto, no repitas la venta: en Ventas buscá la operación por cliente, importe o referencia, elegí Corregir medio y confirmá el medio realmente cobrado antes de cerrar caja. La corrección conserva productos, total y stock; queda auditada y ajusta la caja si interviene efectivo. En pagos divididos verificá primero el comprobante: la corrección los reúne en un solo medio.",
  },
  {
    date: "Sistema nuevo",
    title: "Ticket térmico de 80 mm",
    detail:
      "Después de cobrar, revisá el ticket y elegí Imprimir. Seleccioná la impresora térmica del local con papel de 80 mm. También podés reimprimirlo desde Ventas de esta sesión. Es un comprobante interno, no una factura fiscal con CAE.",
  },
  {
    date: "Sistema nuevo",
    title: "Comandas e invitaciones",
    detail:
      "Podés mantener varias comandas abiertas. La invitación se asigna por producto y cantidad, descuenta stock igualmente y queda separada del descuento comercial.",
  },
  {
    date: "Sistema nuevo",
    title: "Pedidos y recepción de mercadería",
    detail:
      "Cuando el stock esté bajo, revisá el pedido sugerido y enviá la solicitud a Central. El stock aumenta recién cuando se confirma la mercadería efectivamente recibida.",
  },
  {
    date: "Sistema nuevo",
    title: "Cierre con control de efectivo",
    detail:
      "Antes de cerrar, cobrá todas las comandas. Revisá cada medio de pago, contá el efectivo, cargá el sobre cuando corresponda y explicá cualquier diferencia o ajuste.",
  },
  {
    date: "Sistema nuevo",
    title: "Stock, anulaciones e incidencias",
    detail:
      "Cada venta descuenta stock. Una anulación devuelve las unidades y queda auditada. Registrá faltantes, productos dañados, devoluciones o problemas del local en Incidencias.",
  },
  {
    date: "28/09/2026",
    title: "Conteo físico y diferencias de stock",
    detail:
      "Al contar mercadería, cargá el stock real y explicá la diferencia. El ajuste queda pendiente de aprobación; no se corrige inventario creando ventas, compras o anulaciones ficticias.",
  },
  {
    date: "Sistema nuevo",
    title: "Contingencia sin internet",
    detail:
      "Si la pantalla sigue abierta, usá Contingencia en el mismo equipo. No cierres sesión, no borres datos del navegador ni repitas el cobro en otro dispositivo. Al volver Internet, sincronizá y verificá las operaciones antes de cerrar caja.",
  },
];
const raw: [string, string, string, number, string][] = [
  // Los primeros 28 conservan sus IDs históricos: stock, ventas y movimientos no se reasignan.
  ["Chocotorta", "Presentación estándar", "Postres", 8200, "010"], ["Tiramisú", "Presentación estándar", "Postres", 8200, "011"],
  ["Empanadas Jamón y Queso", "6 unidades", "Empanadas", 17500, "102"], ["Empanadas Roast Beef", "6 unidades", "Empanadas", 18100, "103"], ["Empanadas Humita", "6 unidades", "Empanadas", 17300, "101"],
  ["Canelón de Espinaca", "3 unidades", "Canelones", 12600, "151"], ["Canelón de Pollo", "3 unidades", "Canelones", 14100, "152"], ["Fettuccine al Huevo", "150 g", "Fettuccines", 3400, "204"],
  ["Ñoquis de Calabaza", "250 g", "Ñoquis", 4700, "302"], ["Ñoquis de Rúcula y Parmesano", "250 g", "Ñoquis", 4900, "303"], ["Lasaña Boloñesa", "500 g", "Lasañas", 23000, "352"],
  ["Ravioles de Jamón y Queso", "250 g", "Ravioles", 10800, "405"], ["Ravioles de Espinaca", "250 g", "Ravioles", 9600, "404"], ["Ravioles de Cordero", "250 g", "Ravioles", 12800, "403"],
  ["Raviolón de Trucha", "360 g", "Raviolones", 17100, "510"], ["Raviolón de Salmón", "360 g", "Raviolones", 23000, "508"], ["Raviolón de Langostinos", "360 g", "Raviolones", 22800, "506"],
  ["Pizza de Mozzarella", "6/8 porciones", "Pizzas", 14100, "601"], ["Pizza de Jamón y Mozzarella", "6/8 porciones", "Pizzas", 17900, "602"], ["Pizza de Pepperoni", "6/8 porciones", "Pizzas", 17500, "607"],
  ["Tarta de Cebolla", "350 g", "Tartas", 13100, "703"], ["Tarta de Jamón y Queso", "350 g", "Tartas", 12100, "702"], ["Salsa Fileto", "200 g", "Salsas", 6500, "803"], ["Salsa Blanca", "200 g", "Salsas", 5400, "801"], ["Salsa 4 Quesos", "Presentación estándar", "Salsas", 10700, "807"], ["Manteca de Hierbas", "Presentación estándar", "Salsas", 9600, "804"], ["Pesto de Albahaca", "Presentación estándar", "Salsas", 13200, "809"], ["Queso Rallado", "100 g", "Tercerizados", 7200, "001"],
  ["Empanadas Mix", "6 unidades", "Empanadas", 18100, "104"], ["Empanadas Pollo", "6 unidades", "Empanadas", 18100, "105"], ["Fettuccine de Hongos", "150 g", "Fettuccines", 3400, "205"], ["Fettuccine de Albahaca y Ajo", "150 g", "Fettuccines", 3400, "206"],
  ["Pasta Extruida", "500 g", "Pasta Extruida", 9000, "250"], ["Pasta Extruida", "200 g", "Pasta Extruida", 3600, "251"], ["Ñoquis al Huevo", "250 g", "Ñoquis", 4700, "301"], ["Ñoquis de Hongos", "250 g", "Ñoquis", 4900, "304"], ["Lasaña de Espinaca y Calabaza", "500 g", "Lasañas", 19300, "351"],
  ["Ravioles de Calabaza y Mascarpone", "250 g", "Ravioles", 9600, "402"], ["Ravioles de Pollo y Espinaca", "250 g", "Ravioles", 9600, "406"], ["Ravioles de Tres Carnes", "250 g", "Ravioles", 11000, "407"],
  ["Raviolón de Berenjena Ahumada", "360 g", "Raviolones", 13400, "501"], ["Raviolón de Calabaza y Mascarpone", "360 g", "Raviolones", 13400, "502"], ["Raviolón de Espinaca", "360 g", "Raviolones", 13400, "504"], ["Raviolón de Tres Carnes", "360 g", "Raviolones", 15300, "507"], ["Raviolón de Jamón y Mozzarella", "360 g", "Raviolones", 14700, "509"], ["Raviolón de Cordero", "360 g", "Raviolones", 19100, "503"],
  ["Tarta de Vegetales Asados", "350 g", "Tartas", 11100, "701"], ["Pizza de Espinaca y Sardo", "6/8 porciones", "Pizzas", 15100, "603"], ["Pizza de Cebolla Caramelizada y Queso Azul", "6/8 porciones", "Pizzas", 15100, "605"], ["Pizza de Verduras Asadas", "6/8 porciones", "Pizzas", 20100, "604"],
  ["Salsa Rosa", "200 g", "Salsas", 6100, "802"], ["Salsa de Hongos y Caldo de Cordero", "Presentación estándar", "Salsas", 10200, "805"], ["Salsa de Albóndigas", "Presentación estándar", "Salsas", 10700, "806"], ["Salsa Boloñesa", "Presentación estándar", "Salsas", 10700, "808"], ["Pesto de Tomates", "Presentación estándar", "Salsas", 13200, "810"], ["Pan", "Presentación estándar", "Salsas", 4700, "850"], ["Parmesanitas", "Presentación estándar", "Salsas", 7400, "851"],
];
export const PRODUCTS: Product[] = raw.map(([name, detail, category, price, code], i) => ({
  id: i + 1,
  name,
  detail,
  category,
  price,
  code,
  barcode: `LART-${code}`,
}));
export const METHODS: Record<string, string[]> = {
  Recoleta: [
    "Efectivo",
    "Tarjeta",
    "Open Pay",
    "Mercado Pago / QR",
    "Banco Nación",
    "Banco Provincia",
    "Banco Galicia",
    "Transferencia",
    "MP Delivery",
    "Pedidos Ya Efectivo",
    "Pedidos Ya",
    "Rappi",
  ],
  "Villa Mitre": [
    "Efectivo",
    "Tarjeta",
    "Clover",
    "Banco Frances",
    "Banco Provincia",
    "QR Galicia",
    "QR Banco Nación",
    "Mercado Pago / QR",
    "Transferencia",
    "MP Delivery",
    "Pedidos Ya Efectivo",
    "Pedidos Ya Online",
    "Rappi",
  ],
  Congreso: [
    "Efectivo",
    "Tarjeta",
    "Clover",
    "Open Pay",
    "Banco Provincia",
    "BNA + QR",
    "QR Galicia",
    "Mercado Pago / QR",
    "Transferencia",
    "MP Delivery",
    "Pedidos Ya Tarjeta",
    "Pedidos Ya Efectivo",
    "Rappi",
  ],
  Maure: [
    "Efectivo",
    "Tarjeta",
    "Clover",
    "Open Pay",
    "Banco Provincia",
    "BNA + QR",
    "QR Galicia",
    "Mercado Pago / QR",
    "Transferencia",
    "MP Delivery",
    "Pedidos Ya Tarjeta",
    "Pedidos Ya Efectivo",
    "Rappi",
  ],
  "Novo Pacheco": [
    "Efectivo",
    "Tarjeta",
    "Mercado Pago / QR",
    "Rappi",
    "Banco Francia QR",
    "QR Galicia",
    "Transferencia",
  ],
};
export const SHEET_CONFIG: Record<
  string,
  { sheet: string; fields: Record<string, string> }
> = {
  Recoleta: {
    sheet: "INGRESOS",
    fields: {
      Efectivo: "EFECT",
      Tarjeta: "TRJE",
      "Open Pay": "Open Pay",
      "Mercado Pago / QR": "MP/QR",
      "Banco Nación": "Banco Nación",
      "Banco Provincia": "Banco Provincia",
      "Banco Galicia": "Banco Galicia",
      Transferencia: "TRANSFERENCIA",
      "MP Delivery": "MP Delivery",
      "Pedidos Ya Efectivo": "PEDIDOS YA EFECTIVO",
      "Pedidos Ya": "PEDIDOS YA",
      Rappi: "RAPPI",
    },
  },
  "Villa Mitre": {
    sheet: "INGRESOS",
    fields: {
      Efectivo: "EFECT",
      Tarjeta: "TRJE",
      Clover: "Clover",
      "Banco Frances": "Banco Frances",
      "Banco Provincia": "banco provincia",
      "QR Galicia": "QR GALICIA",
      "QR Banco Nación": "QR BANCO NACION",
      "Mercado Pago / QR": "MP/QR",
      Transferencia: "Transferencia",
      "MP Delivery": "MP DELIVERY",
      "Pedidos Ya Efectivo": "Pedidos Ya Efectivo",
      "Pedidos Ya Online": "Pedidos Ya online",
      Rappi: "RAPPI",
    },
  },
  Congreso: {
    sheet: "ingresos",
    fields: {
      Efectivo: "EFECT",
      Tarjeta: "TRJE",
      Clover: "Clover",
      "Open Pay": "Open Pay( Banco Frances)",
      "Banco Provincia": "BANCO PROVINCIA",
      "BNA + QR": "BNA+QR",
      "QR Galicia": "QR Galicia",
      "Mercado Pago / QR": "MP",
      Transferencia: "TRANSFERENCIA",
      "MP Delivery": "MP DELIVERY",
      "Pedidos Ya Tarjeta": "PEDIDOS YA tarjeta",
      "Pedidos Ya Efectivo": "Pedidos Ya Efectivo",
      Rappi: "RAPPI",
    },
  },
  Maure: {
    sheet: "ingresos",
    fields: {
      Efectivo: "EFECT",
      Tarjeta: "TRJE",
      Clover: "Clover",
      "Open Pay": "Open Pay( Banco Frances)",
      "Banco Provincia": "BANCO PROVINCIA",
      "BNA + QR": "BNA+QR",
      "QR Galicia": "QR Galicia",
      "Mercado Pago / QR": "MP",
      Transferencia: "TRANSFERENCIA",
      "MP Delivery": "MP DELIVERY",
      "Pedidos Ya Tarjeta": "PEDIDOS YA tarjeta",
      "Pedidos Ya Efectivo": "Pedidos Ya Efectivo",
      Rappi: "RAPPI",
    },
  },
  "Novo Pacheco": {
    sheet: "INGRESOS",
    fields: {
      Efectivo: "EFECT",
      Tarjeta: "TRJE",
      "Mercado Pago / QR": "MP",
      Rappi: "RAPPI",
      "Banco Frances QR": "BANCO FRANCES QR",
      "QR Galicia": "GALICIA QR",
      Transferencia: "TRANSFERENCIA",
    },
  },
};
export const DRIVE_INTEGRATIONS = [
  {
    site: "Recoleta",
    incomeSheet: "INGRESOS",
    expenseSheet: "GASTOS OPERATIVOS",
    incomeStatus: "Encabezados verificados",
  },
  {
    site: "Villa Mitre",
    incomeSheet: "INGRESOS",
    expenseSheet: "GASTOS OPERATIVOS",
    incomeStatus: "Encabezados verificados",
  },
  {
    site: "Congreso",
    incomeSheet: "ingresos",
    expenseSheet: "GASTOS OPERATIVOS",
    incomeStatus: "Encabezados verificados",
  },
  {
    site: "Maure",
    incomeSheet: "ingresos",
    expenseSheet: "GASTOS OPERATIVOS",
    incomeStatus: "Encabezados verificados",
  },
  {
    site: "Novo Pacheco",
    incomeSheet: "INGRESOS",
    expenseSheet: "GASTOS OPERATIVOS",
    incomeStatus: "Encabezados verificados",
  },
];
