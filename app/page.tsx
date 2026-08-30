"use client";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";

type Product = {
  id: number;
  name: string;
  detail: string;
  category: string;
  price: number;
};
type Role = "vendedora" | "supervisora" | "administracion";
type User = { name: string; role: Role; location?: string };
type ManagedUser = User & {
  id: string;
  active: boolean;
  email: string;
  password: string;
  mfaRequired: boolean;
  reportPermissions: string[];
  actionPermissions: string[];
  primary?: boolean;
};
type Sale = {
  id: string;
  site: string;
  createdAt: string;
  createdAtISO: string;
  items: Product[];
  gross: number;
  discount: number;
  net: number;
  method: string;
  invoiceType:
    "Factura B" | "Factura B electrónica" | "Factura A" | "Remito interno";
  customer: string;
  invitation: boolean;
  channel: "Mostrador" | "Online";
  status: "activa" | "anulada";
};
type SavedOrder = {
  id: string;
  site: string;
  createdAt: string;
  customer: string;
  items: Product[];
  discount: number;
  payment: string;
  invoiceType: Sale["invoiceType"];
  invitation: boolean;
  channel: "Mostrador" | "Online";
};
type CashAdjustment = {
  id: string;
  site: string;
  kind: "Ingreso de caja" | "Ajuste de caja" | "Retiro de caja";
  amount: number;
  detail: string;
  at: string;
  createdBy: string;
};
type StockMovement = {
  id: string;
  site: string;
  productId: number;
  kind: "Ingreso" | "Egreso";
  quantity: number;
  remito: string;
  detail: string;
  at: string;
  createdBy: string;
};
type EnvelopeRecord = {
  id: string;
  site: string;
  amount: number;
  status: "En Caja Mayor" | "Retirado por Oscar";
  at: string;
  withdrawnAmount: number;
};
type AuditEvent = {
  id: string;
  at: string;
  site: string;
  action: string;
  detail: string;
};
type Payment = { method: string; amount: number; saleId?: string };
type PriceChange = {
  id: string;
  at: string;
  percentage: number;
  category: string;
  effectiveDate: string;
  beforePrices: Record<number, number>;
  afterPrices: Record<number, number>;
};
type EmployeeSchedule = {
  id: string;
  employee: string;
  site: string;
  startsAt: string;
  endsAt: string;
  toleranceMinutes: number;
};
type StockRequest = {
  id: string;
  site: string;
  requestedBy: string;
  requestedAt: string;
  notes: string;
  status:
    | "Pendiente"
    | "En preparación"
    | "Despachado"
    | "Despachado parcial"
    | "Entregado";
  lines: {
    productId: number;
    quantity: number;
    preparedQuantity?: number;
    missingReason?: string;
  }[];
};
type Expense = {
  id: string;
  site: string;
  category: string;
  amount: number;
  detail: string;
  receiptName: string;
  createdAt: string;
  createdBy: string;
};
type ReturnTransaction = {
  id: string;
  saleId: string;
  site: string;
  kind: "Devolución" | "Cambio";
  amount: number;
  refundMethod: string;
  reason: string;
  restock: boolean;
  createdAt: string;
  createdBy: string;
};
type Incident = {
  id: string;
  site: string;
  type: string;
  detail: string;
  createdAt: string;
  createdBy: string;
  status: "Abierta" | "En revisión" | "Resuelta";
};
type StockAdjustment = {
  id: string;
  site: string;
  productId: number;
  counted: number;
  theoretical: number;
  reason: string;
  requestedAt: string;
  requestedBy: string;
  status: "Pendiente" | "Aprobado" | "Rechazado";
};
const SITES = ["Recoleta", "Villa Mitre", "Congreso", "Maure", "Novo Pacheco"];
const ACTION_PERMISSIONS = [
  { id: "cobrar", label: "Cobrar ventas" },
  { id: "anular", label: "Anular ventas" },
  { id: "egresos", label: "Cargar egresos" },
  { id: "pedidos", label: "Crear y recibir pedidos" },
  { id: "incidencias", label: "Registrar incidencias" },
  { id: "stock", label: "Ajustar / aprobar stock" },
  { id: "exportar", label: "Exportar informes" },
];
const defaultActionPermissions = (role: Role) =>
  role === "administracion"
    ? ACTION_PERMISSIONS.map((permission) => permission.id)
    : role === "supervisora"
      ? [
          "cobrar",
          "anular",
          "egresos",
          "pedidos",
          "incidencias",
          "stock",
          "exportar",
        ]
      : ["cobrar", "egresos", "pedidos", "incidencias"];
const workEmail = (name: string) =>
  `${name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "")}@lartisantaller.com`;
const INITIAL_SCHEDULES: EmployeeSchedule[] = SITES.flatMap((site) => [
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
const GUIDE_UPDATES = [
  {
    date: "Prueba actual",
    title: "Apertura obligatoria de caja",
    detail:
      "Antes de vender, entrá a Caja, cargá el fondo inicial y presioná Abrir caja.",
  },
  {
    date: "Prueba actual",
    title: "Cierre con control de efectivo",
    detail:
      "Al finalizar, revisá cada medio de pago, contá el efectivo y cargá el sobre cuando corresponda.",
  },
  {
    date: "Prueba actual",
    title: "Stock y anulaciones",
    detail:
      "Una venta descuenta stock. Si anulás una venta, el sistema devuelve su stock y registra la operación.",
  },
];
const ADMIN_DEMO_ROWS = [
  {
    site: "Recoleta",
    gross: 23788260,
    net: 23788260,
    tickets: 608,
    status: "Pendiente",
    source: "Copia de prueba · INGRESOS · 01/08 al 25/08",
  },
  {
    site: "Villa Mitre",
    gross: 984000,
    net: 941000,
    tickets: 51,
    status: "Cerrada",
    source: "Demostración",
  },
  {
    site: "Congreso",
    gross: 1112000,
    net: 1067000,
    tickets: 58,
    status: "Cerrada",
    source: "Demostración",
  },
  {
    site: "Maure",
    gross: 875000,
    net: 846000,
    tickets: 44,
    status: "Pendiente",
    source: "Demostración",
  },
  {
    site: "Novo Pacheco",
    gross: 702000,
    net: 691000,
    tickets: 37,
    status: "Cerrada",
    source: "Demostración",
  },
];
const ADMIN_REPORTS = [
  {
    id: "Gerencia",
    title: "Gerencia",
    detail:
      "Tablero breve con facturación, proyección, metas y alertas críticas.",
  },
  {
    id: "Resumen",
    title: "Resumen ejecutivo",
    detail: "Ventas, tickets, cierres y alertas por local.",
  },
  {
    id: "Ventas",
    title: "Ventas",
    detail: "Facturación bruta/neta, tickets y evolución diaria.",
  },
  {
    id: "DetalleVentas",
    title: "Detalle de ventas",
    detail: "Ventas por día, cliente, comprobante y forma de cobro.",
  },
  {
    id: "Rentabilidad",
    title: "Rentabilidad",
    detail: "Costo, margen y contribución por producto, categoría y local.",
  },
  {
    id: "Productos",
    title: "Productos",
    detail: "Unidades, ranking, categorías y productos sin movimiento.",
  },
  {
    id: "Evolucion",
    title: "Evolución",
    detail: "Comparativos diarios, semanales, mensuales y proyección.",
  },
  {
    id: "VendidoCobrado",
    title: "Vendido vs. cobrado",
    detail: "Comparación mensual consolidada para todos los locales.",
  },
  {
    id: "Pagos",
    title: "Medios de pago",
    detail: "Efectivo, tarjetas, QR, transferencias y delivery.",
  },
  {
    id: "Cajas",
    title: "Cajas",
    detail: "Aperturas, cierres, diferencias, gastos y sobres.",
  },
  {
    id: "CajaMayor",
    title: "Caja Mayor",
    detail: "Sobres enviados por cada local y retiros realizados por Oscar.",
  },
  {
    id: "Bancos",
    title: "Control bancario",
    detail: "Ventas electrónicas, acreditaciones, comisiones y diferencias.",
  },
  {
    id: "Ajustes",
    title: "Descuentos y anulaciones",
    detail: "Control de impacto, motivo y responsable.",
  },
  {
    id: "Egresos",
    title: "Egresos",
    detail: "Gastos por local, categoría, comprobante y responsable.",
  },
  {
    id: "Stock",
    title: "Stock",
    detail: "Teórico vs. real, mínimos, ingresos y ajustes.",
  },
  {
    id: "Reposicion",
    title: "Reposición",
    detail:
      "Quiebres, cobertura estimada y sugerencias de reposición por local.",
  },
  {
    id: "PedidosCentral",
    title: "Pedidos a Central",
    detail:
      "Solicitudes, preparación, despacho, entregas y tiempos de respuesta.",
  },
  {
    id: "Objetivos",
    title: "Objetivos",
    detail: "Meta mensual, avance, proyección y faltante por local.",
  },
  {
    id: "HorariosVenta",
    title: "Horarios de venta",
    detail:
      "Ventas y tickets por día y franja horaria para organizar operación.",
  },
  {
    id: "Personal",
    title: "Personal",
    detail: "Fichajes, tardanzas, horas y ausencias.",
  },
  {
    id: "Clientes",
    title: "Clientes",
    detail: "Altas con consentimiento y recurrencia de compra.",
  },
  {
    id: "Promociones",
    title: "Promociones",
    detail: "Uso, ventas generadas, impacto y margen posterior.",
  },
  {
    id: "Calidad",
    title: "Calidad de datos",
    detail:
      "Cierres faltantes, duplicados, errores y fallos de sincronización.",
  },
  {
    id: "Fiscal",
    title: "Fiscal",
    detail: "Facturas ARCA, comprobantes internos y notas de crédito.",
  },
  {
    id: "Auditoria",
    title: "Auditoría",
    detail: "Trazabilidad de cada acción sensible.",
  },
  {
    id: "Incidencias",
    title: "Incidencias",
    detail:
      "Faltantes, problemas operativos, devoluciones y reclamos por local.",
  },
  {
    id: "Alertas",
    title: "Alertas operativas",
    detail: "Caja, stock, pedidos, devoluciones, egresos y novedades que requieren acción.",
  },
];
const SOLD_COLLECTED_REFERENCE = [
  ["enero 2026", "Vendido", 14835562, 9727642, 16083441],
  ["enero 2026", "Cobrado", 2821740, 1608927, 4085981],
  ["febrero 2026", "Vendido", 17249272, 10885253, 16143760],
  ["febrero 2026", "Cobrado", 2501335, 2154695, 3501880],
  ["marzo 2026", "Vendido", 26542586, 18635365, 22797365],
  ["marzo 2026", "Cobrado", 3473603, 3537330, 5402925],
  ["abril 2026", "Vendido", 27465380, 21202197, 24990033],
  ["abril 2026", "Cobrado", 3922250, 3964220, 5594140],
  ["mayo 2026", "Vendido", 31295097, 25493016, 28461278],
  ["mayo 2026", "Cobrado", 4044882, 4252900, 5632102],
  ["junio 2026", "Vendido", 33082626, 25781877, 24898427],
  ["junio 2026", "Cobrado", 5143359, 4829290, 5706426],
  ["julio 2026", "Vendido", 30689998, 24353422, 24578793],
  ["julio 2026", "Cobrado", 4966885, 4285087, 5619751],
  ["agosto 2026", "Vendido", 29206980, 24382090, 23992415],
  ["agosto 2026", "Cobrado", 4551142, 4594701, 5526605],
] as const;
const USERS: Record<string, User> = {
  "Vendedora Recoleta": {
    name: "Vendedora Recoleta",
    role: "vendedora",
    location: "Recoleta",
  },
  "Vendedora Villa Mitre": {
    name: "Vendedora Villa Mitre",
    role: "vendedora",
    location: "Villa Mitre",
  },
  "Vendedora Congreso": {
    name: "Vendedora Congreso",
    role: "vendedora",
    location: "Congreso",
  },
  "Vendedora Maure": {
    name: "Vendedora Maure",
    role: "vendedora",
    location: "Maure",
  },
  "Vendedora Novo Pacheco": {
    name: "Vendedora Novo Pacheco",
    role: "vendedora",
    location: "Novo Pacheco",
  },
  Andrea: { name: "Andrea", role: "supervisora" },
  Betzi: { name: "Betzi", role: "supervisora" },
  Administración: { name: "Administración", role: "administracion" },
};
const INITIAL_MANAGED_USERS: ManagedUser[] = Object.values(USERS).map(
  (profile, index) => ({
    ...profile,
    id: profile.role === "administracion" ? "primary-admin" : `demo-${index}`,
    active: true,
    email: workEmail(profile.name),
    password: "Lartisan2026!",
    mfaRequired:
      profile.role === "administracion" ||
      profile.name === "Andrea" ||
      profile.name === "Betzi",
    reportPermissions:
      profile.role === "administracion"
        ? ADMIN_REPORTS.map((report) => report.id)
        : [],
    actionPermissions: defaultActionPermissions(profile.role),
    primary: profile.role === "administracion",
  }),
);
const raw: [string, string, string, number][] = [
  ["Chocotorta", "250 g", "Postres", 8000],
  ["Tiramisú", "250 g", "Postres", 8000],
  ["Empanadas Jamón y Queso", "6 unidades", "Empanadas", 17200],
  ["Empanadas Roast Beef", "6 unidades", "Empanadas", 17800],
  ["Empanadas Humita", "6 unidades", "Empanadas", 17000],
  ["Canelón de Espinaca", "3 unidades", "Canelones", 12400],
  ["Canelón de Pollo", "3 unidades", "Canelones", 13800],
  ["Fettuccine al Huevo", "150 g", "Fettuccines", 3300],
  ["Ñoquis de Calabaza", "250 g", "Ñoquis", 4800],
  ["Ñoquis de Rúcula y Parmesano", "250 g", "Ñoquis", 5000],
  ["Lasaña Boloñesa", "500 g", "Lasañas", 22600],
  ["Ravioles de Jamón y Queso", "250 g", "Ravioles", 10600],
  ["Ravioles de Espinaca", "250 g", "Ravioles", 9400],
  ["Ravioles de Cordero", "250 g", "Ravioles", 12600],
  ["Raviolón de Trucha", "360 g", "Raviolones", 16800],
  ["Raviolón de Salmón", "360 g", "Raviolones", 22600],
  ["Raviolón de Langostinos", "360 g", "Raviolones", 22400],
  ["Pizza de Mozzarella", "6/8 porciones", "Pizzas", 13800],
  ["Pizza de Jamón y Mozzarella", "6/8 porciones", "Pizzas", 17600],
  ["Pizza de Pepperoni", "6/8 porciones", "Pizzas", 17200],
  ["Tarta de Cebolla", "350 g", "Tartas", 13000],
  ["Tarta de Jamón y Queso", "350 g", "Tartas", 12000],
  ["Salsa Fileto", "200 g", "Salsas", 6400],
  ["Salsa Blanca", "200 g", "Salsas", 5300],
  ["Salsa 4 Quesos", "Presentación estándar", "Salsas", 10500],
  ["Manteca de Hierbas", "Presentación estándar", "Salsas", 9400],
  ["Pesto de Albahaca", "Presentación estándar", "Salsas", 13000],
  ["Queso Rallado", "100 g", "Tercerizados", 7000],
];
const PRODUCTS: Product[] = raw.map(([name, detail, category, price], i) => ({
  id: i + 1,
  name,
  detail,
  category,
  price,
}));
const METHODS: Record<string, string[]> = {
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
const SHEET_CONFIG: Record<
  string,
  { sheet: string; testUrl?: string; fields: Record<string, string> }
> = {
  Recoleta: {
    sheet: "INGRESOS",
    testUrl:
      "https://docs.google.com/spreadsheets/d/1IBPVCNqquO1LsE19oiMq8x6gNyD5_VEfYV2pNhoZ5Hg/edit",
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
const DRIVE_INTEGRATIONS = [
  {
    site: "Recoleta",
    url: "https://docs.google.com/spreadsheets/d/131eexo3o0ALWmrOhu0HfUnTLTVH33aHTGQ2sEMlwHtk/edit",
    incomeSheet: "INGRESOS",
    expenseSheet: "GASTOS OPERATIVOS",
    incomeStatus: "Encabezados verificados",
  },
  {
    site: "Villa Mitre",
    url: "https://docs.google.com/spreadsheets/d/1Tkd2Mhe28OsCzOl9-TAEEFyFAczFrCbe3b08Vf2oF2k/edit",
    incomeSheet: "INGRESOS",
    expenseSheet: "GASTOS OPERATIVOS",
    incomeStatus: "Encabezados verificados",
  },
  {
    site: "Congreso",
    url: "https://docs.google.com/spreadsheets/d/14BEXikqLBuiGeBKyIqwSRkCRAFfopPYM7ZhnjKdrPBk/edit",
    incomeSheet: "ingresos",
    expenseSheet: "GASTOS OPERATIVOS",
    incomeStatus: "Encabezados verificados",
  },
  {
    site: "Maure",
    url: "https://docs.google.com/spreadsheets/d/10RKMEItTwD1Dw_T671cLT1QcS1qCUvm1ZhcjlsoYGU0/edit",
    incomeSheet: "ingresos",
    expenseSheet: "GASTOS OPERATIVOS",
    incomeStatus: "Encabezados verificados",
  },
  {
    site: "Novo Pacheco",
    url: "https://docs.google.com/spreadsheets/d/1hdJVqIgwAGMcIu_peu6TSYvPg2JapUt2romE9mTzR2o/edit",
    incomeSheet: "INGRESOS",
    expenseSheet: "GASTOS OPERATIVOS",
    incomeStatus: "Encabezados verificados",
  },
];
const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});
const money2 = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
function Heading({ k, h, p }: { k: string; h: string; p: string }) {
  return (
    <div className="mb-6">
      <p className="text-sm font-bold text-[#ec3a35]">{k}</p>
      <h1 className="mt-1 text-3xl font-bold">{h}</h1>
      <p className="mt-1 text-slate-500">{p}</p>
    </div>
  );
}
export default function Home() {
  // En producción el portal se determina por el subdominio. El parámetro
  // ?portal=admin o ?portal=ventas permite revisar ambos accesos localmente.
  const portal = (() => {
    if (typeof window === "undefined") return "ventas" as const;
    const host = window.location.hostname.toLowerCase();
    const selectedPortal = new URLSearchParams(window.location.search).get(
      "portal",
    );
    if (host.startsWith("admin.") || selectedPortal === "admin") return "admin" as const;
    return "ventas" as const;
  })();
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>(
      INITIAL_MANAGED_USERS,
    ),
    [login, setLogin] = useState(
      portal === "admin" ? workEmail("Administración") : workEmail("Vendedora Recoleta"),
    ),
    [password, setPassword] = useState(""),
    [user, setUser] = useState<ManagedUser | null>(null),
    [site, setSite] = useState("Recoleta"),
    [tab, setTab] = useState("Ventas"),
    [cart, setCart] = useState<Product[]>([]),
    [discount, setDiscount] = useState(0),
    [payment, setPayment] = useState("Efectivo"),
    [saleChannel, setSaleChannel] = useState<"Mostrador" | "Online">(
      "Mostrador",
    ),
    [invoiceType, setInvoiceType] = useState<Sale["invoiceType"]>("Factura B"),
    [customer, setCustomer] = useState("Consumidor final"),
    [invitation, setInvitation] = useState(false),
    [message, setMessage] = useState(""),
    [fund, setFund] = useState(0),
    [expenses, setExpenses] = useState(0),
    [withdrawals, setWithdrawals] = useState(0),
    [counted, setCounted] = useState(0),
    [envelope, setEnvelope] = useState(0),
    [cashAdjustmentKind, setCashAdjustmentKind] =
      useState<CashAdjustment["kind"]>("Ajuste de caja"),
    [cashAdjustmentAmount, setCashAdjustmentAmount] = useState(0),
    [cashAdjustmentDetail, setCashAdjustmentDetail] = useState(""),
    [closed, setClosed] = useState(false),
    [cashOpenBySite, setCashOpenBySite] = useState<Record<string, boolean>>({}),
    [sales, setSales] = useState<Sale[]>([]),
    [audit, setAudit] = useState<AuditEvent[]>([]),
    [syncStatus, setSyncStatus] = useState("Sin cierre enviado"),
    [schedules, setSchedules] = useState<EmployeeSchedule[]>(INITIAL_SCHEDULES),
    [guideUpdates, setGuideUpdates] = useState(GUIDE_UPDATES),
    [reportSite, setReportSite] = useState("Recoleta"),
    [reportFrom, setReportFrom] = useState("2026-08-01"),
    [reportTo, setReportTo] = useState("2026-08-25"),
    [newGuideTitle, setNewGuideTitle] = useState(""),
    [newGuideDetail, setNewGuideDetail] = useState(""),
    [adminReport, setAdminReport] = useState("Resumen"),
    [hourInterval, setHourInterval] = useState(1),
    [newUserName, setNewUserName] = useState(""),
    [newUserRole, setNewUserRole] = useState<Role>("vendedora"),
    [newUserSite, setNewUserSite] = useState("Recoleta"),
    [newUserEmail, setNewUserEmail] = useState(""),
    [newUserPassword, setNewUserPassword] = useState(""),
    [newUserMfaRequired, setNewUserMfaRequired] = useState(false),
    [priceIncrease, setPriceIncrease] = useState(0),
    [priceRounding, setPriceRounding] = useState(100),
    [priceCategory, setPriceCategory] = useState("Todos"),
    [priceEffectiveDate, setPriceEffectiveDate] = useState("2026-08-27"),
    [priceChanges, setPriceChanges] = useState<PriceChange[]>([]),
    [expandedPriceChange, setExpandedPriceChange] = useState<string | null>(
      null,
    ),
    [clock, setClock] = useState(""),
    [drive, setDrive] = useState("");
  const [stockRequests, setStockRequests] = useState<StockRequest[]>([]);
  const [savedOrders, setSavedOrders] = useState<SavedOrder[]>([]);
  const [cashAdjustments, setCashAdjustments] = useState<CashAdjustment[]>([]);
  const [envelopeRecords, setEnvelopeRecords] = useState<EnvelopeRecord[]>([]);
  const [oscarWithdrawal, setOscarWithdrawal] = useState(0);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [movementProductId, setMovementProductId] = useState(PRODUCTS[0].id);
  const [movementKind, setMovementKind] =
    useState<StockMovement["kind"]>("Ingreso");
  const [movementQuantity, setMovementQuantity] = useState(0);
  const [movementRemito, setMovementRemito] = useState("");
  const [movementDetail, setMovementDetail] = useState("");
  const [requestQuantities, setRequestQuantities] = useState<
    Record<number, number>
  >({});
  const [requestNotes, setRequestNotes] = useState("");
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(
    null,
  );
  const [expensesLog, setExpensesLog] = useState<Expense[]>([]);
  const [returnsLog, setReturnsLog] = useState<ReturnTransaction[]>([]);
  const [returnSaleId, setReturnSaleId] = useState("");
  const [returnKind, setReturnKind] = useState<ReturnTransaction["kind"]>("Devolución");
  const [returnReason, setReturnReason] = useState("");
  const [returnRefundMethod, setReturnRefundMethod] = useState("Efectivo");
  const [returnRestock, setReturnRestock] = useState(true);
  const [expenseCategory, setExpenseCategory] = useState("Insumos");
  const [expenseAmount, setExpenseAmount] = useState(0);
  const [expenseDetail, setExpenseDetail] = useState("");
  const [expenseReceipt, setExpenseReceipt] = useState("");
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [incidentType, setIncidentType] = useState("Faltante de mercadería");
  const [incidentDetail, setIncidentDetail] = useState("");
  const [stockAdjustments, setStockAdjustments] = useState<StockAdjustment[]>(
    [],
  );
  const [adjustProductId, setAdjustProductId] = useState(PRODUCTS[0].id);
  const [adjustReason, setAdjustReason] = useState("");
  const [prices, setPrices] = useState<Record<number, number>>(
    Object.fromEntries(PRODUCTS.map((product) => [product.id, product.price])),
  );
  const [onlinePrices, setOnlinePrices] = useState<Record<number, number>>(
    Object.fromEntries(
      PRODUCTS.map((product) => [product.id, Math.round(product.price * 1.25)]),
    ),
  );
  const [stock, setStock] = useState<Record<string, Record<number, number>>>(
    Object.fromEntries(
      SITES.map((s, n) => [
        s,
        Object.fromEntries(
          PRODUCTS.map((p, i) => [p.id, 8 + ((i + n * 3) % 18)]),
        ),
      ]),
    ),
  );
  const [minimumStock, setMinimumStock] = useState<
    Record<string, Record<number, number>>
  >(() =>
    Object.fromEntries(
      SITES.map((s) => [
        s,
        Object.fromEntries(PRODUCTS.map((product) => [product.id, 0])),
      ]),
    ),
  );
  const [realStock, setRealStock] = useState<
    Record<string, Record<number, string>>
  >(() =>
    Object.fromEntries(
      SITES.map((s) => [
        s,
        Object.fromEntries(PRODUCTS.map((p) => [p.id, ""])),
      ]),
    ),
  );
  const [payments, setPayments] = useState<Payment[]>([
    { method: "Efectivo", amount: 62000 },
    { method: "Tarjeta", amount: 75500 },
    { method: "Mercado Pago / QR", amount: 43000 },
    { method: "Transferencia", amount: 12000 },
  ]);
  const methods = METHODS[site],
    cats = ["Todos", ...Array.from(new Set(PRODUCTS.map((p) => p.category)))],
    [cat, setCat] = useState("Todos");
  const visible =
    cat === "Todos" ? PRODUCTS : PRODUCTS.filter((p) => p.category === cat);
  const total = cart.reduce((a, p) => a + p.price, 0),
    discountedNet = total - Math.round((total * discount) / 100),
    net = invitation ? 0 : discountedNet;
  const isOnlineChannel = saleChannel === "Online";
  const selectedPrice = (product: Product) =>
    isOnlineChannel ? onlinePrices[product.id] : prices[product.id];
  const lines = useMemo(
    () =>
      Array.from(
        new Map(
          cart.map((p) => [
            p.id,
            { p, q: cart.filter((x) => x.id === p.id).length },
          ]),
        ).values(),
      ),
    [cart],
  );
  const totals = methods.map((method) => ({
    method,
    amount: payments
      .filter((p) => p.method === method)
      .reduce((a, p) => a + p.amount, 0),
  }));
  const requiresEnvelope = site !== "Novo Pacheco";
  const cashIsOpen = Boolean(cashOpenBySite[site]);
  const canAdjustStock = user?.name === "Andrea" || user?.name === "Betzi";
  const canCountRealStock = user?.name === "Andrea";
  const managesCentralOrders = ["Vendedora Villa Mitre", "Andrea", "Betzi"].includes(
    user?.name || "",
  );
  const can = (permission: string) =>
    Boolean(user?.actionPermissions.includes(permission));
  const currentRequestLines = PRODUCTS.filter(
    (product) => (requestQuantities[product.id] || 0) > 0,
  ).map((product) => ({
    productId: product.id,
    quantity: requestQuantities[product.id],
  }));
  const lowStockProducts = PRODUCTS.map((product) => ({
    product,
    current: stock[site][product.id] || 0,
    minimum: minimumStock[site][product.id] || 0,
  })).filter(({ current, minimum }) => minimum > 0 && current <= minimum);
  const suggestedOrderLines = lowStockProducts
    .map(({ product, current, minimum }) => ({
      product,
      quantity: Math.max(minimum - current, 0),
      current,
      minimum,
    }))
    .filter((line) => line.quantity > 0);
  const siteRequests = stockRequests.filter((request) => request.site === site);
  const siteReturns = returnsLog.filter((transaction) => transaction.site === site);
  const totalExpenses = expensesLog.reduce(
    (total, expense) => total + expense.amount,
    0,
  );
  const totalReturns = returnsLog.reduce(
    (total, transaction) => total + transaction.amount,
    0,
  );
  const lowStockAlerts = SITES.flatMap((local) =>
    PRODUCTS.filter((product) => {
      const minimum = minimumStock[local][product.id] || 0;
      return minimum > 0 && (stock[local][product.id] || 0) <= minimum;
    }).map((product) => ({
      site: local,
      product,
      current: stock[local][product.id] || 0,
      minimum: minimumStock[local][product.id] || 0,
    })),
  );
  const selectedRequest = stockRequests.find(
    (request) => request.id === selectedRequestId,
  );
  const adminRows = ADMIN_DEMO_ROWS.filter(
    (row) => reportSite === "Todos los locales" || row.site === reportSite,
  );
  const adminTotals = adminRows.reduce(
    (total, row) => ({
      gross: total.gross + row.gross,
      net: total.net + row.net,
      tickets: total.tickets + row.tickets,
    }),
    { gross: 0, net: 0, tickets: 0 },
  );
  const hasDemoData = adminRows.some((row) => row.source === "Demostración");
  const operationalAlerts = [
    ...SITES.filter((local) => cashOpenBySite[local]).map((local) => ({
      label: `Caja abierta en ${local}`,
      detail: "Revisar cierre de caja.",
      tone: "bg-[#fff5d8]",
    })),
    ...stockRequests
      .filter((request) => request.status === "Pendiente")
      .map((request) => ({
        label: `Pedido pendiente · ${request.site}`,
        detail: "Central debe iniciar la preparación.",
        tone: "bg-[#fff5d8]",
      })),
    ...stockRequests
      .filter(
        (request) =>
          request.status === "Despachado" || request.status === "Despachado parcial",
      )
      .map((request) => ({
        label: `Recepción pendiente · ${request.site}`,
        detail: "El local debe confirmar la mercadería recibida para actualizar stock.",
        tone: "bg-[#e8f1fb]",
      })),
    ...lowStockAlerts.map((alert) => ({
      label: `Stock crítico · ${alert.site}`,
      detail: `${alert.product.name}: ${alert.current} en stock / mínimo ${alert.minimum}.`,
      tone: "bg-[#fff1ec]",
    })),
    ...expensesLog
      .filter((expense) => !expense.receiptName)
      .map((expense) => ({
        label: `Egreso sin comprobante · ${expense.site}`,
        detail: `${expense.category} · ${money.format(expense.amount)}.`,
        tone: "bg-[#fff5d8]",
      })),
    ...stockAdjustments
      .filter((adjustment) => adjustment.status === "Pendiente")
      .map((adjustment) => ({
        label: `Ajuste de stock pendiente · ${adjustment.site}`,
        detail: "Requiere aprobación de Betzi.",
        tone: "bg-[#fff1ec]",
      })),
    ...incidents
      .filter((incident) => incident.status !== "Resuelta")
      .map((incident) => ({
        label: `Incidencia abierta · ${incident.site}`,
        detail: incident.type,
        tone: "bg-[#fff1ec]",
      })),
  ];
  const hourlySales = useMemo(() => {
    const intervals = Array.from(
      { length: Math.ceil(24 / hourInterval) },
      (_, index) => {
        const start = index * hourInterval;
        const end = Math.min(start + hourInterval, 24);
        const matching = sales.filter((sale) => {
          const date = new Date(sale.createdAtISO);
          const saleDate = date.toISOString().slice(0, 10);
          return (
            sale.status === "activa" &&
            (reportSite === "Todos los locales" || sale.site === reportSite) &&
            saleDate >= reportFrom &&
            saleDate <= reportTo &&
            date.getHours() >= start &&
            date.getHours() < end
          );
        });
        const net = matching.reduce((total, sale) => total + sale.net, 0);
        return {
          label: `${String(start).padStart(2, "0")}:00–${String(end).padStart(2, "0")}:00`,
          tickets: matching.length,
          net,
        };
      },
    );
    return intervals;
  }, [hourInterval, reportFrom, reportSite, reportTo, sales]);
  const expected =
      fund +
      (totals.find((x) => x.method === "Efectivo")?.amount || 0) -
      expenses -
      withdrawals,
    diff = counted + (requiresEnvelope ? envelope : 0) - expected;
  const enter = () => {
    const next = managedUsers.find(
      (profile) => profile.email.toLowerCase() === login.trim().toLowerCase(),
    );
    if (!next || !next.active)
      return setMessage("Este usuario está bloqueado o no existe.");
    if (password !== next.password)
      return setMessage("Contraseña incorrecta.");
    if (portal === "admin" && next.role !== "administracion")
      return setMessage("Este acceso es exclusivo para Administración.");
    if (portal === "ventas" && next.role === "administracion")
      return setMessage("Administración debe ingresar desde admin.lartisantaller.com.");
    setUser(next);
    setSite(next.location || "Recoleta");
    setPayment(METHODS[next.location || "Recoleta"][0]);
    setTab(next.role === "administracion" ? "Administración" : "Ventas");
    if (next.role === "administracion")
      setAdminReport(
        next.reportPermissions.includes("Resumen")
          ? "Resumen"
          : next.reportPermissions[0] || "Resumen",
      );
    setMessage("");
  };
  const createManagedUser = () => {
    const cleanName = newUserName.trim();
    if (!cleanName) return setMessage("Ingresá el nombre del nuevo usuario.");
    const cleanEmail = newUserEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail))
      return setMessage("Ingresá un correo laboral válido.");
    if (newUserPassword.length < 10)
      return setMessage("La contraseña temporal debe tener al menos 10 caracteres.");
    if (
      managedUsers.some(
        (profile) =>
          profile.name.toLowerCase() === cleanName.toLowerCase() ||
          profile.email.toLowerCase() === cleanEmail,
      )
    )
      return setMessage("Ya existe un usuario con ese nombre.");
    const created: ManagedUser = {
      id: crypto.randomUUID(),
      name: cleanName,
      role: newUserRole,
      location: newUserRole === "vendedora" ? newUserSite : undefined,
      active: true,
      email: cleanEmail,
      password: newUserPassword,
      mfaRequired:
        newUserMfaRequired || newUserRole === "administracion",
      reportPermissions: newUserRole === "administracion" ? ["Resumen"] : [],
      actionPermissions: defaultActionPermissions(newUserRole),
    };
    setManagedUsers((profiles) => [...profiles, created]);
    recordAudit(
      "Usuario creado",
      `${created.name} · ${created.role}${created.location ? ` · ${created.location}` : ""}`,
    );
    setNewUserName("");
    setNewUserEmail("");
    setNewUserPassword("");
    setNewUserMfaRequired(false);
    setMessage(`Usuario ${created.name} creado y habilitado.`);
  };
  const updateManagedUser = (id: string, changes: Partial<ManagedUser>) => {
    setManagedUsers((profiles) =>
      profiles.map((profile) =>
        profile.id === id ? { ...profile, ...changes } : profile,
      ),
    );
  };
  const increasedPrice = (productId: number) => {
    const increased = prices[productId] * (1 + priceIncrease / 100);
    return priceRounding <= 1
      ? Math.round(increased)
      : Math.ceil(increased / priceRounding) * priceRounding;
  };
  const applyPriceIncrease = () => {
    if (priceIncrease <= 0 || priceIncrease > 100)
      return setMessage(
        "Ingresá un porcentaje mayor a 0 y menor o igual a 100.",
      );
    const affected = PRODUCTS.filter(
      (product) =>
        priceCategory === "Todos" || product.category === priceCategory,
    );
    if (!affected.length) return;
    if (
      !window.confirm(
        `¿Confirmás el aumento del ${priceIncrease}% para ${affected.length} productos en los cinco locales?`,
      )
    )
      return;
    const beforePrices = { ...prices };
    const afterPrices = {
      ...beforePrices,
      ...Object.fromEntries(
        affected.map((product) => [product.id, increasedPrice(product.id)]),
      ),
    };
    setPrices(afterPrices);
    const change: PriceChange = {
      id: crypto.randomUUID(),
      at: new Date().toLocaleString("es-AR"),
      percentage: priceIncrease,
      category: priceCategory,
      effectiveDate: priceEffectiveDate,
      beforePrices,
      afterPrices,
    };
    setPriceChanges((changes) => [change, ...changes]);
    recordAudit(
      "Aumento de precios",
      `${priceIncrease}% · ${priceCategory} · ${affected.length} productos · vigencia ${priceEffectiveDate}`,
    );
    setMessage(
      `Aumento aplicado a ${affected.length} productos para los cinco locales.`,
    );
  };
  const recordAudit = (action: string, detail: string) =>
    setAudit((events) => [
      {
        id: crypto.randomUUID(),
        at: new Date().toLocaleString("es-AR"),
        site,
        action,
        detail,
      },
      ...events,
    ]);
  const submitStockRequest = () => {
    if (managesCentralOrders)
      return setMessage(
        "Central no realiza pedidos: revisá las solicitudes recibidas en Central de pedidos.",
      );
    if (!can("pedidos"))
      return setMessage("Tu usuario no tiene permiso para crear pedidos.");
    if (!currentRequestLines.length)
      return setMessage("Indicá al menos un producto y su cantidad.");
    const request: StockRequest = {
      id: crypto.randomUUID(),
      site,
      requestedBy: user.name,
      requestedAt: new Date().toLocaleString("es-AR"),
      notes: requestNotes.trim(),
      status: "Pendiente",
      lines: currentRequestLines,
    };
    setStockRequests((items) => [request, ...items]);
    setSelectedRequestId(request.id);
    setRequestQuantities({});
    setRequestNotes("");
    recordAudit(
      "Pedido de mercadería enviado",
      `${site} · ${request.lines.reduce((total, line) => total + line.quantity, 0)} unidades · ${request.id.slice(0, 8)}`,
    );
    setMessage("Solicitud enviada a Betzi para su preparación.");
  };
  const updateRequestStatus = (
    request: StockRequest,
    status: StockRequest["status"],
  ) => {
    if (!managesCentralOrders)
      return setMessage("Solo Central puede actualizar el estado de un pedido.");
    setStockRequests((items) =>
      items.map((item) =>
        item.id === request.id ? { ...item, status } : item,
      ),
    );
    recordAudit(
      "Estado de pedido actualizado",
      `${request.site} · ${request.id.slice(0, 8)} · ${status}`,
    );
  };
  const updatePreparedQuantity = (
    requestId: string,
    productId: number,
    preparedQuantity: number,
  ) => {
    setStockRequests((items) =>
      items.map((request) =>
        request.id === requestId
          ? {
              ...request,
              lines: request.lines.map((line) =>
                line.productId === productId
                  ? {
                      ...line,
                      preparedQuantity: Math.min(
                        line.quantity,
                        Math.max(0, preparedQuantity),
                      ),
                    }
                  : line,
              ),
            }
          : request,
      ),
    );
  };
  const updateMissingReason = (
    requestId: string,
    productId: number,
    missingReason: string,
  ) => {
    setStockRequests((items) =>
      items.map((request) =>
        request.id === requestId
          ? {
              ...request,
              lines: request.lines.map((line) =>
                line.productId === productId ? { ...line, missingReason } : line,
              ),
            }
          : request,
      ),
    );
  };
  const confirmCentralDispatch = (request: StockRequest) => {
    if (!managesCentralOrders) return;
    const hasShortage = request.lines.some(
      (line) => (line.preparedQuantity ?? line.quantity) < line.quantity,
    );
    updateRequestStatus(
      request,
      hasShortage ? "Despachado parcial" : "Despachado",
    );
    setMessage(
      hasShortage
        ? "Despacho parcial confirmado. El local verá los faltantes."
        : "Despacho completo confirmado.",
    );
  };
  const confirmRequestReception = (request: StockRequest) => {
    if (
      request.status !== "Despachado" &&
      request.status !== "Despachado parcial"
    )
      return;
    setStock((items) => {
      const nextSiteStock = { ...items[request.site] };
      request.lines.forEach((line) => {
        nextSiteStock[line.productId] =
          (nextSiteStock[line.productId] || 0) +
          (line.preparedQuantity ?? line.quantity);
      });
      return { ...items, [request.site]: nextSiteStock };
    });
    setStockRequests((items) =>
      items.map((item) =>
        item.id === request.id ? { ...item, status: "Entregado" } : item,
      ),
    );
    setStockMovements((items) => [
      ...request.lines
        .filter((line) => (line.preparedQuantity ?? line.quantity) > 0)
        .map((line) => ({
          id: crypto.randomUUID(),
          site: request.site,
          productId: line.productId,
          kind: "Ingreso" as const,
          quantity: line.preparedQuantity ?? line.quantity,
          remito: `Pedido ${request.id.slice(0, 8)}`,
          detail: "Recepción confirmada por el local",
          at: new Date().toLocaleString("es-AR"),
          createdBy: user.name,
        })),
      ...items,
    ]);
    recordAudit(
      "Mercadería recibida",
      `${request.site} · ${request.id.slice(0, 8)} · stock actualizado`,
    );
    setMessage("Recepción confirmada: se actualizó el stock y quedó registrado el ingreso de mercadería.");
  };
  const submitExpense = () => {
    if (expenseAmount <= 0 || !expenseDetail.trim())
      return setMessage("Completá importe y detalle del egreso.");
    const expense: Expense = {
      id: crypto.randomUUID(),
      site,
      category: expenseCategory,
      amount: expenseAmount,
      detail: expenseDetail.trim(),
      receiptName: expenseReceipt,
      createdAt: new Date().toLocaleString("es-AR"),
      createdBy: user.name,
    };
    setExpensesLog((items) => [expense, ...items]);
    recordAudit(
      "Egreso registrado",
      `${site} · ${money.format(expense.amount)} · ${expense.category}`,
    );
    setExpenseAmount(0);
    setExpenseDetail("");
    setExpenseReceipt("");
    setMessage("Egreso registrado para control administrativo.");
  };
  const submitIncident = () => {
    if (!incidentDetail.trim()) return setMessage("Describí la incidencia.");
    const incident: Incident = {
      id: crypto.randomUUID(),
      site,
      type: incidentType,
      detail: incidentDetail.trim(),
      createdAt: new Date().toLocaleString("es-AR"),
      createdBy: user.name,
      status: "Abierta",
    };
    setIncidents((items) => [incident, ...items]);
    recordAudit("Incidencia registrada", `${site} · ${incident.type}`);
    setIncidentDetail("");
    setMessage("Incidencia enviada a Administración.");
  };
  const submitStockAdjustment = () => {
    if (!can("stock"))
      return setMessage("Tu usuario no tiene permiso para ajustar stock.");
    const countedValue = realStock[site][adjustProductId];
    if (countedValue === "" || !adjustReason.trim())
      return setMessage("Cargá el conteo real y el motivo del ajuste.");
    const adjustment: StockAdjustment = {
      id: crypto.randomUUID(),
      site,
      productId: adjustProductId,
      counted: Number(countedValue),
      theoretical: stock[site][adjustProductId],
      reason: adjustReason.trim(),
      requestedAt: new Date().toLocaleString("es-AR"),
      requestedBy: user.name,
      status: "Pendiente",
    };
    setStockAdjustments((items) => [adjustment, ...items]);
    setAdjustReason("");
    recordAudit("Ajuste de stock solicitado", `${site} · ${adjustment.reason}`);
    setMessage("Ajuste enviado a Betzi para aprobación.");
  };
  const approveStockAdjustment = (
    adjustment: StockAdjustment,
    approve: boolean,
  ) => {
    if (user?.name !== "Betzi")
      return setMessage("Solo Betzi puede aprobar o rechazar ajustes de stock.");
    setStockAdjustments((items) =>
      items.map((item) =>
        item.id === adjustment.id
          ? { ...item, status: approve ? "Aprobado" : "Rechazado" }
          : item,
      ),
    );
    if (approve)
      setStock((items) => ({
        ...items,
        [adjustment.site]: {
          ...items[adjustment.site],
          [adjustment.productId]: adjustment.counted,
        },
      }));
    recordAudit(
      approve ? "Ajuste de stock aprobado" : "Ajuste de stock rechazado",
      `${adjustment.site} · ${adjustment.id.slice(0, 8)}`,
    );
  };
  const exportAdminReport = () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["L'ARTISAN · INFORME ADMINISTRATIVO"],
      [
        "Reporte",
        ADMIN_REPORTS.find((report) => report.id === adminReport)?.title ||
          adminReport,
      ],
      ["Desde", reportFrom, "Hasta", reportTo],
      ["Local", reportSite],
      [],
      ["Local", "Venta neta", "Tickets", "Ticket promedio", "Estado caja"],
      ...adminRows.map((row) => [
        row.site,
        row.net,
        row.tickets,
        row.tickets ? Math.round(row.net / row.tickets) : 0,
        row.status,
      ]),
    ]);
    sheet["!merges"] = [XLSX.utils.decode_range("A1:E1")];
    sheet["!cols"] = [
      { wch: 24 },
      { wch: 18 },
      { wch: 12 },
      { wch: 18 },
      { wch: 18 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Informe");
    XLSX.writeFile(
      workbook,
      `Informe_${adminReport}_${reportFrom}_${reportTo}.xlsx`,
    );
  };
  const saveOrder = () => {
    if (!cart.length)
      return setMessage("Agregá productos antes de guardar la comanda.");
    const order: SavedOrder = {
      id: crypto.randomUUID(),
      site,
      createdAt: new Date().toLocaleString("es-AR"),
      customer,
      items: [...cart],
      discount,
      payment,
      invoiceType,
      invitation,
      channel: saleChannel,
    };
    setSavedOrders((items) => [order, ...items]);
    setCart([]);
    setDiscount(0);
    setInvitation(false);
    setMessage("Comanda guardada. Podés continuar otra venta.");
  };
  const loadOrder = (order: SavedOrder) => {
    setCart(order.items);
    setCustomer(order.customer);
    setDiscount(order.discount);
    setPayment(order.payment);
    setInvoiceType(order.invoiceType);
    setInvitation(order.invitation);
    setSaleChannel(order.channel);
    setSavedOrders((items) => items.filter((item) => item.id !== order.id));
    setMessage("Comanda recuperada para continuar el cobro.");
  };
  const registerCashAdjustment = () => {
    if (cashAdjustmentAmount <= 0 || !cashAdjustmentDetail.trim())
      return setMessage("Completá importe y motivo del movimiento de caja.");
    const adjustment: CashAdjustment = {
      id: crypto.randomUUID(),
      site,
      kind: cashAdjustmentKind,
      amount: cashAdjustmentAmount,
      detail: cashAdjustmentDetail.trim(),
      at: new Date().toLocaleString("es-AR"),
      createdBy: user.name,
    };
    setCashAdjustments((items) => [adjustment, ...items]);
    setCashAdjustmentAmount(0);
    setCashAdjustmentDetail("");
    recordAudit(
      "Movimiento de caja",
      `${site} · ${adjustment.kind} · ${money.format(adjustment.amount)}`,
    );
    setMessage("Movimiento de caja registrado.");
  };
  const registerStockMovement = () => {
    if (movementQuantity <= 0 || !movementDetail.trim())
      return setMessage("Completá cantidad y detalle del movimiento de stock.");
    const movement: StockMovement = {
      id: crypto.randomUUID(),
      site,
      productId: movementProductId,
      kind: movementKind,
      quantity: movementQuantity,
      remito: movementRemito.trim(),
      detail: movementDetail.trim(),
      at: new Date().toLocaleString("es-AR"),
      createdBy: user.name,
    };
    setStock((items) => ({
      ...items,
      [site]: {
        ...items[site],
        [movementProductId]: Math.max(
          0,
          items[site][movementProductId] +
            (movementKind === "Ingreso" ? movementQuantity : -movementQuantity),
        ),
      },
    }));
    setStockMovements((items) => [movement, ...items]);
    setMovementQuantity(0);
    setMovementRemito("");
    setMovementDetail("");
    recordAudit(
      "Movimiento de stock",
      `${site} · ${movement.kind} · ${movement.remito || "sin remito"}`,
    );
    setMessage("Movimiento de stock registrado.");
  };
  const withdrawEnvelopes = () => {
    if (oscarWithdrawal <= 0)
      return setMessage("Ingresá el importe que retira Oscar.");
    let remaining = oscarWithdrawal;
    setEnvelopeRecords((items) =>
      items.map((record) => {
        if (record.status !== "En Caja Mayor" || remaining <= 0) return record;
        const available = record.amount - record.withdrawnAmount;
        const take = Math.min(available, remaining);
        remaining -= take;
        return {
          ...record,
          withdrawnAmount: record.withdrawnAmount + take,
          status: take === available ? "Retirado por Oscar" : "En Caja Mayor",
        };
      }),
    );
    recordAudit(
      "Retiro de sobres",
      `Oscar retiró ${money.format(oscarWithdrawal - remaining)} de Caja Mayor.`,
    );
    setMessage(
      remaining
        ? `Se registró un retiro parcial de ${money.format(oscarWithdrawal - remaining)}.`
        : "Retiro de sobres registrado.",
    );
    setOscarWithdrawal(0);
  };
  const exportRequestExcel = (request: StockRequest) => {
    const rows = request.lines.map((line) => {
      const product = PRODUCTS.find((item) => item.id === line.productId);
      return [
        product?.category || "",
        product?.name || "",
        product?.detail || "",
        line.quantity,
      ];
    });
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["L'ARTISAN · SOLICITUD DE MERCADERÍA"],
      ["Local", request.site, "Estado", request.status],
      ["Solicitó", request.requestedBy, "Fecha", request.requestedAt],
      ["Observaciones", request.notes || "Sin observaciones"],
      [],
      ["Categoría", "Producto", "Presentación", "Cantidad"],
      ...rows,
    ]);
    worksheet["!merges"] = [XLSX.utils.decode_range("A1:D1")];
    worksheet["!cols"] = [{ wch: 18 }, { wch: 32 }, { wch: 26 }, { wch: 12 }];
    ["A1", "A6", "B6", "C6", "D6"].forEach((cell) => {
      if (worksheet[cell])
        worksheet[cell].s = {
          fill: { fgColor: { rgb: "183A67" } },
          font: { bold: true, color: { rgb: "FFFFFF" } },
          alignment: { horizontal: "center" },
        };
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Pedido");
    XLSX.writeFile(
      workbook,
      `Pedido_${request.site.replaceAll(" ", "_")}_${request.id.slice(0, 8)}.xlsx`,
    );
  };
  const pay = () => {
    if (!can("cobrar"))
      return setMessage("Tu usuario no tiene permiso para cobrar ventas.");
    if (!cashIsOpen)
      return setMessage("Primero tenés que abrir la caja de este local.");
    if (!cart.length) return setMessage("Agregá productos a la venta.");
    const sale: Sale = {
      id: crypto.randomUUID(),
      site,
      createdAt: new Date().toLocaleString("es-AR"),
      createdAtISO: new Date().toISOString(),
      items: [...cart],
      gross: total,
      discount: total - net,
      net,
      method: payment,
      invoiceType,
      customer,
      invitation,
      channel: saleChannel,
      status: "activa",
    };
    setPayments((x) => [
      ...x,
      { method: payment, amount: net, saleId: sale.id },
    ]);
    setSales((x) => [sale, ...x]);
    setStock((x) => {
      const a = { ...x[site] };
      cart.forEach((p) => (a[p.id] = Math.max(0, a[p.id] - 1)));
      return { ...x, [site]: a };
    });
    setMessage(
      `${invitation ? "Invitación registrada" : "Venta registrada"}: ${money.format(net)} · ${invoiceType} · ${payment}.`,
    );
    recordAudit(
      "Venta registrada",
      `${sale.id.slice(0, 8)} · ${money.format(net)} · ${payment}`,
    );
    setCart([]);
    setDiscount(0);
    setInvitation(false);
    setCustomer("Consumidor final");
  };
  const cancelSale = (sale: Sale) => {
    if (!can("anular"))
      return setMessage("Tu usuario no tiene permiso para anular ventas.");
    if (sale.status === "anulada") return;
    setSales((items) =>
      items.map((x) => (x.id === sale.id ? { ...x, status: "anulada" } : x)),
    );
    setPayments((items) => items.filter((x) => x.saleId !== sale.id));
    setStock((x) => {
      const next = { ...x[site] };
      sale.items.forEach((p) => (next[p.id] += 1));
      return { ...x, [site]: next };
    });
    recordAudit(
      "Venta anulada",
      `${sale.id.slice(0, 8)} · ${money.format(sale.net)} · ${sale.method}`,
    );
    setMessage(
      "Venta anulada: se restituyó el stock y se descontó del cierre.",
    );
  };
  const registerReturn = () => {
    if (!can("anular"))
      return setMessage("Tu usuario no tiene permiso para registrar devoluciones o cambios.");
    const sale = sales.find((item) => item.id === returnSaleId && item.site === site);
    if (!sale) return setMessage("Elegí una venta activa del local.");
    if (!returnReason.trim()) return setMessage("Indicá el motivo de la devolución o cambio.");
    if (returnsLog.some((transaction) => transaction.saleId === sale.id))
      return setMessage("Esta venta ya tiene una devolución o cambio registrado.");
    const transaction: ReturnTransaction = {
      id: crypto.randomUUID(),
      saleId: sale.id,
      site,
      kind: returnKind,
      amount: sale.net,
      refundMethod: returnRefundMethod,
      reason: returnReason.trim(),
      restock: returnRestock,
      createdAt: new Date().toLocaleString("es-AR"),
      createdBy: user.name,
    };
    setReturnsLog((items) => [transaction, ...items]);
    if (returnRestock) {
      setStock((items) => {
        const next = { ...items[site] };
        sale.items.forEach((product) => {
          next[product.id] = (next[product.id] || 0) + 1;
        });
        return { ...items, [site]: next };
      });
    }
    if (returnKind === "Devolución") {
      setPayments((items) => items.filter((item) => item.saleId !== sale.id));
    }
    recordAudit(
      `${returnKind} registrada`,
      `${sale.id.slice(0, 8)} · ${money.format(sale.net)} · ${returnRefundMethod}`,
    );
    setReturnSaleId("");
    setReturnReason("");
    setReturnRestock(true);
    setMessage(
      `${returnKind} registrada${returnRestock ? "; se repuso el stock" : ""}.`,
    );
  };
  const changeSalePayment = (sale: Sale, method: string) => {
    setSales((items) =>
      items.map((item) => (item.id === sale.id ? { ...item, method } : item)),
    );
    setPayments((items) =>
      items.map((item) =>
        item.saleId === sale.id ? { ...item, method } : item,
      ),
    );
    recordAudit(
      "Forma de cobro modificada",
      `${sale.id.slice(0, 8)} · ${sale.method} a ${method}`,
    );
  };
  const changeSaleInvoice = (
    sale: Sale,
    nextInvoiceType: Sale["invoiceType"],
  ) => {
    setSales((items) =>
      items.map((item) =>
        item.id === sale.id ? { ...item, invoiceType: nextInvoiceType } : item,
      ),
    );
    recordAudit(
      "Comprobante modificado",
      `${sale.id.slice(0, 8)} · ${nextInvoiceType}`,
    );
  };
  const confirmClose = () => {
    if (!cashIsOpen) return setMessage("No hay una caja abierta para cerrar.");
    const openOrders = savedOrders.filter((order) => order.site === site);
    if (openOrders.length)
      return setMessage(
        `No se puede cerrar la caja: hay ${openOrders.length} comanda${openOrders.length === 1 ? "" : "s"} abierta${openOrders.length === 1 ? "" : "s"} en ${site}. Cobralas o recuperalas desde Ventas.`,
      );
    if (diff !== 0)
      return setMessage(
        "No se puede cerrar: la diferencia de caja debe ser $ 0.",
      );
    setClosed(true);
    setCashOpenBySite((items) => ({ ...items, [site]: false }));
    if (requiresEnvelope && envelope > 0)
      setEnvelopeRecords((items) => [
        {
          id: crypto.randomUUID(),
          site,
          amount: envelope,
          status: "En Caja Mayor",
          at: new Date().toLocaleString("es-AR"),
          withdrawnAmount: 0,
        },
        ...items,
      ]);
    const test = SHEET_CONFIG[site]?.testUrl;
    setSyncStatus(
      test
        ? "Prueba lista para Recoleta: el envío quedará habilitado al conectar el backend seguro."
        : "Pendiente: primero se creará la copia de prueba de este local.",
    );
    recordAudit(
      "Cierre confirmado",
      `Cobros ${money.format(totals.reduce((a, x) => a + x.amount, 0))} · Sobre ${money.format(envelope)}`,
    );
  };
  const openCash = () => {
    setCashOpenBySite((items) => ({ ...items, [site]: true }));
    setClosed(false);
    recordAudit("Caja abierta", `Fondo inicial ${money.format(fund)}`);
    setMessage(`Caja abierta para ${site}. Ya se pueden registrar cobros.`);
  };
  if (!user)
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f3eb] p-5 text-[#183a67]">
        <section className="w-full max-w-md rounded-2xl border border-[#d9d4c9] bg-[#fffdf8] p-7 shadow-lg">
          <p className="font-serif text-3xl font-bold tracking-[.15em]">
            L'ARTISAN
          </p>
          <p className="mt-2 text-sm font-bold text-[#ec3a35]">
            {portal === "admin"
              ? "ADMINISTRACIÓN CENTRAL"
              : "VENTAS Y OPERACIÓN DE LOCALES"}
          </p>
          <h1 className="mt-6 text-2xl font-bold">
            {portal === "admin" ? "Acceso administrativo" : "Ingresar"}
          </h1>
          <label className="mt-5 block text-sm font-bold">Correo laboral</label>
          <input
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && enter()}
            type="email"
            placeholder="nombre.apellido@lartisantaller.com"
            className="mt-1 w-full rounded-lg border p-3"
          />
          <label className="mt-4 block text-sm font-bold">Contraseña</label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && enter()}
            type="password"
            placeholder="Tu contraseña"
            className="mt-1 w-full rounded-lg border p-3"
          />
          <p className="mt-3 text-xs text-slate-500">
            Administración, Betzi y Andrea tendrán doble factor al activar la autenticación segura.
          </p>
          <button
            onClick={enter}
            className="mt-5 w-full rounded-lg bg-[#183a67] py-3 font-bold text-white"
          >
            Ingresar
          </button>
          {message && (
            <p className="mt-3 rounded-lg bg-[#fff1ec] p-3 text-sm">
              {message}
            </p>
          )}
        </section>
      </main>
    );
  const baseTabs =
    user.role === "administracion"
      ? [
          "Administración",
          "Usuarios",
          "Precios",
          "Recetas y costos",
          "Legajos",
          "Integraciones",
        ]
      : [
          "Ventas",
          "Caja",
          "Stock",
          ...(managesCentralOrders ? [] : ["Pedido"]),
          "Devoluciones",
          "Egresos",
          "Incidencias",
          "Fichaje",
          "Clientes",
          "Guía",
        ];
  const tabs = [
    ...baseTabs,
    ...(managesCentralOrders ? ["Central de pedidos"] : []),
    ...(user.name === "Betzi" ? ["Horarios"] : []),
  ];
  const availableAdminReports =
    user.role === "administracion"
      ? ADMIN_REPORTS.filter((report) =>
          user.reportPermissions.includes(report.id),
        )
      : ADMIN_REPORTS;
  return (
    <main className="min-h-screen bg-[#f7f3eb] text-[#183a67]">
      <header className="flex flex-col gap-2 border-b bg-[#fffdf8] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <b className="font-serif text-xl tracking-[.15em] sm:text-2xl">
          L'ARTISAN
        </b>
        <span className="text-sm sm:text-right">
          {user.name} ·{" "}
          <button onClick={() => setUser(null)} className="underline">
            Salir
          </button>
        </span>
      </header>
      <div className="grid lg:grid-cols-[230px_1fr]">
        <aside className="border-b bg-[#fffdf8] p-4 lg:min-h-[calc(100vh-73px)] lg:border-r">
          {user.role !== "administracion" && (
            <>
              <label className="text-xs font-bold text-slate-500">
                SUCURSAL ACTIVA
              </label>
              {user.role === "vendedora" ? (
                <p className="mt-2 rounded bg-[#eef2f6] p-2 font-bold">
                  {site}
                </p>
              ) : (
                <select
                  value={site}
                  onChange={(e) => {
                    setSite(e.target.value);
                    setPayment(METHODS[e.target.value][0]);
                  }}
                  className="mt-2 w-full rounded border p-2"
                >
                  {SITES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              )}
            </>
          )}
          <nav className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded p-2 text-left text-sm font-bold ${tab === t ? "bg-[#183a67] text-white" : "hover:bg-[#eef2f6]"}`}
              >
                {t}
              </button>
            ))}
          </nav>
        </aside>
        <section className="p-4 sm:p-5 md:p-8">
          {tab === "Ventas" ? (
            <>
              <Heading
                k={`PUNTO DE VENTA · ${site.toUpperCase()}`}
                h="Nueva venta"
                p="Productos, descuentos, comprobante interno y cobro."
              />
              {!cashIsOpen && (
                <div className="mb-5 rounded-xl border border-[#e7c26a] bg-[#fff5d8] p-4 text-sm">
                  <b>Caja cerrada.</b> Abrí la caja desde el módulo Caja antes
                  de cobrar ventas.
                </div>
              )}
              <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
                <div>
                  <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3">
                    <span className="mr-1 text-sm font-bold">
                      Lista de precios
                    </span>
                    {(["Mostrador", "Online"] as const).map((channel) => (
                      <button
                        key={channel}
                        onClick={() => {
                          if (cart.length && saleChannel !== channel)
                            return setMessage(
                              "Guardá, cobrá o vaciá la comanda actual antes de cambiar de lista de precios.",
                            );
                          setSaleChannel(channel);
                        }}
                        className={`rounded-full px-4 py-2 text-sm font-bold ${saleChannel === channel ? "bg-[#183a67] text-white" : "bg-[#eef2f6]"}`}
                      >
                        {channel}
                      </button>
                    ))}
                    <span className="text-xs text-slate-500">
                      {saleChannel === "Online"
                        ? "Precios aplicativo"
                        : "Precios de salón"}
                    </span>
                  </div>
                  <div className="mb-4 flex flex-wrap gap-2">
                    {cats.map((c) => (
                      <button
                        key={c}
                        onClick={() => setCat(c)}
                        className={`rounded-full px-3 py-2 text-sm ${cat === c ? "bg-[#ec3a35] text-white" : "bg-white ring-1 ring-[#d9d4c9]"}`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {visible.map((p) => (
                      <button
                        key={p.id}
                        disabled={!cashIsOpen || !stock[site][p.id]}
                        onClick={() =>
                          setCart((c) => [
                            ...c,
                            { ...p, price: selectedPrice(p) },
                          ])
                        }
                        className="rounded-xl border bg-white p-4 text-left shadow-sm disabled:opacity-30"
                      >
                        <b>{p.name}</b>
                        <p className="text-sm text-slate-500">
                          {p.detail} · Stock {stock[site][p.id]}
                        </p>
                        <p className="mt-2 font-bold">
                          {money.format(selectedPrice(p))}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
                <aside className="h-fit rounded-2xl border bg-white p-5 shadow-sm">
                  <h2 className="font-bold">Venta actual</h2>
                  <div className="my-3 divide-y">
                    {lines.length ? (
                      lines.map(({ p, q }) => (
                        <div className="flex justify-between py-3" key={p.id}>
                          <span>
                            <b>{p.name}</b> × {q}
                          </span>
                          <button
                            onClick={() =>
                              setCart((c) => {
                                const i = c.findIndex((x) => x.id === p.id);
                                return c.filter((_, n) => n !== i);
                              })
                            }
                            className="text-sm underline"
                          >
                            Quitar
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="py-5 text-sm text-slate-500">
                        Sin productos.
                      </p>
                    )}
                  </div>
                  <label className="text-sm font-bold">Descuento (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={discount}
                    onChange={(e) => setDiscount(Number(e.target.value))}
                    className="mt-1 w-full rounded border p-2"
                  />
                  <p className="mt-2 text-sm">
                    Bruto {money.format(total)} · Descuento{" "}
                    {money.format(total - net)}
                  </p>
                  <p className="mt-2 text-xl font-bold">
                    Total {money.format(net)}
                  </p>
                  <label className="mt-4 block text-sm font-bold">
                    Medio de pago
                  </label>
                  <select
                    value={payment}
                    onChange={(e) => setPayment(e.target.value)}
                    className="mt-1 w-full rounded border p-2"
                  >
                    {methods.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    Tarifa aplicada: {isOnlineChannel ? "online" : "local"}.
                  </p>
                  <label className="mt-3 block text-sm font-bold">
                    Tipo de comprobante
                    <select
                      value={invoiceType}
                      onChange={(event) =>
                        setInvoiceType(
                          event.target.value as Sale["invoiceType"],
                        )
                      }
                      className="mt-1 w-full rounded border p-2 font-normal"
                    >
                      <option>Factura B</option>
                      <option>Factura B electrónica</option>
                      <option>Factura A</option>
                      <option>Remito interno</option>
                    </select>
                  </label>
                  <label className="mt-3 block text-sm font-bold">
                    Cliente
                    <input
                      value={customer}
                      onChange={(event) => setCustomer(event.target.value)}
                      className="mt-1 w-full rounded border p-2 font-normal"
                      placeholder="Consumidor final o razón social"
                    />
                  </label>
                  <label className="mt-3 flex items-center gap-2 text-sm font-bold">
                    <input
                      type="checkbox"
                      checked={invitation}
                      onChange={(event) => setInvitation(event.target.checked)}
                    />
                    Invitación (se registra separada del descuento)
                  </label>
                  <button
                    onClick={pay}
                    disabled={!cashIsOpen}
                    className="mt-4 w-full rounded bg-[#183a67] py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {cashIsOpen ? "Cobrar venta" : "Abrí caja para cobrar"}
                  </button>
                  <button
                    onClick={() =>
                      setMessage(
                        "Comprobante interno listo para imprimir o enviar.",
                      )
                    }
                    className="mt-2 w-full rounded border py-2 font-bold"
                  >
                    Vista previa del comprobante
                  </button>
                  <button
                    onClick={saveOrder}
                    className="mt-2 w-full rounded border py-2 font-bold"
                  >
                    Guardar comanda abierta
                  </button>
                  {message && (
                    <p className="mt-3 rounded bg-[#eef5ef] p-3 text-sm">
                      {message}
                    </p>
                  )}
                  <div className="mt-5 border-t pt-4">
                    <p className="text-sm font-bold">Comandas abiertas</p>
                    {savedOrders
                      .filter((order) => order.site === site)
                      .slice(0, 3)
                      .map((order) => (
                        <button
                          key={order.id}
                          onClick={() => loadOrder(order)}
                          className="mt-2 flex w-full justify-between rounded bg-[#eef2f6] p-2 text-left text-xs"
                        >
                          <span>{order.customer}</span>
                          <span>{order.items.length} productos · Abrir</span>
                        </button>
                      ))}
                    <p className="text-sm font-bold">Ventas de esta sesión</p>
                    {sales.filter((sale) => sale.site === site).length ? (
                      sales
                        .filter((sale) => sale.site === site)
                        .slice(0, 4)
                        .map((sale) => (
                          <div
                            key={sale.id}
                            className="mt-2 flex items-center justify-between gap-2 text-xs"
                          >
                            <span>
                              {money.format(sale.net)} · {sale.customer} ·{" "}
                              {sale.method}
                              {sale.status === "anulada" && " · ANULADA"}
                            </span>
                            <span className="flex gap-2">
                              <select
                                value={sale.method}
                                onChange={(event) =>
                                  changeSalePayment(sale, event.target.value)
                                }
                                className="rounded border p-1"
                              >
                                {methods.map((method) => (
                                  <option key={method}>{method}</option>
                                ))}
                              </select>
                              <select
                                value={sale.invoiceType}
                                onChange={(event) =>
                                  changeSaleInvoice(
                                    sale,
                                    event.target.value as Sale["invoiceType"],
                                  )
                                }
                                className="rounded border p-1"
                              >
                                <option>Factura B</option>
                                <option>Factura B electrónica</option>
                                <option>Factura A</option>
                                <option>Remito interno</option>
                              </select>
                            </span>
                            {sale.status === "activa" && (
                              <button
                                onClick={() => cancelSale(sale)}
                                className="underline"
                              >
                                Anular
                              </button>
                            )}
                          </div>
                        ))
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">
                        Las ventas nuevas aparecerán aquí y quedarán auditadas.
                      </p>
                    )}
                  </div>
                </aside>
              </div>
            </>
          ) : tab === "Caja" ? (
            <>
              <Heading
                k={`CAJA · ${site.toUpperCase()}`}
                h="Cierre de caja"
                p="Los cobros se acumulan automáticamente desde las ventas."
              />
              <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
                <div className="rounded-2xl border bg-white p-5">
                  <h2 className="font-bold">Cobros del día</h2>
                  {totals.map((x) => (
                    <div
                      className="mt-3 flex justify-between border-b pb-3"
                      key={x.method}
                    >
                      <span>{x.method}</span>
                      <b>{money.format(x.amount)}</b>
                    </div>
                  ))}
                  <p className="mt-4 text-xl font-bold">
                    Total{" "}
                    {money.format(totals.reduce((a, x) => a + x.amount, 0))}
                  </p>
                </div>
                <div className="rounded-2xl border bg-white p-5">
                  <p
                    className={`mb-4 rounded p-3 text-sm font-bold ${cashIsOpen ? "bg-[#eef5ef] text-green-800" : "bg-[#fff1ec] text-[#9c302a]"}`}
                  >
                    {cashIsOpen ? "Caja abierta" : "Caja cerrada"}
                  </p>
                  <label className="block text-sm font-bold">
                    Fondo inicial
                  </label>
                  <input
                    type="number"
                    value={fund}
                    onChange={(e) => setFund(Number(e.target.value))}
                    className="mt-1 w-full rounded border p-2"
                  />
                  {!cashIsOpen && (
                    <button
                      onClick={openCash}
                      className="mt-3 w-full rounded bg-[#183a67] py-3 font-bold text-white"
                    >
                      Abrir caja
                    </button>
                  )}
                  <label className="mt-3 block text-sm font-bold">Gastos</label>
                  <input
                    type="number"
                    value={expenses}
                    onChange={(e) => setExpenses(Number(e.target.value))}
                    className="mt-1 w-full rounded border p-2"
                  />
                  <label className="mt-3 block text-sm font-bold">
                    Retiros
                  </label>
                  <input
                    type="number"
                    value={withdrawals}
                    onChange={(e) => setWithdrawals(Number(e.target.value))}
                    className="mt-1 w-full rounded border p-2"
                  />
                  <p className="mt-3 rounded bg-[#eef2f6] p-2 font-bold">
                    Efectivo esperado: {money.format(expected)}
                  </p>
                  <label className="mt-3 block text-sm font-bold">
                    Efectivo contado en caja
                  </label>
                  <input
                    type="number"
                    value={counted}
                    onChange={(e) => setCounted(Number(e.target.value))}
                    className="mt-1 w-full rounded border p-2"
                  />
                  {requiresEnvelope && (
                    <>
                      <label className="mt-3 block text-sm font-bold">
                        Sobre en efectivo
                      </label>
                      <input
                        type="number"
                        value={envelope}
                        onChange={(e) => setEnvelope(Number(e.target.value))}
                        className="mt-1 w-full rounded border p-2"
                      />
                      <p className="mt-1 text-xs text-slate-500">
                        El sobre se suma al efectivo contado para conciliar la
                        caja.
                      </p>
                    </>
                  )}
                  <p
                    className={`mt-3 rounded p-3 font-bold ${diff === 0 ? "bg-[#eef5ef]" : "bg-[#fff1ec]"}`}
                  >
                    Diferencia: {money.format(diff)}
                  </p>
                  {savedOrders.filter((order) => order.site === site).length >
                    0 && (
                    <p className="mt-3 rounded bg-[#fff1ec] p-3 text-sm font-bold text-[#9c302a]">
                      Hay{" "}
                      {
                        savedOrders.filter((order) => order.site === site)
                          .length
                      }{" "}
                      comanda(s) abierta(s). La caja no podrá cerrarse hasta
                      cobrarlas.
                    </p>
                  )}
                  <div className="mt-4 border-t pt-4">
                    <b className="text-sm">Ajuste / movimiento de caja</b>
                    <select
                      value={cashAdjustmentKind}
                      onChange={(event) =>
                        setCashAdjustmentKind(
                          event.target.value as CashAdjustment["kind"],
                        )
                      }
                      className="mt-2 w-full rounded border p-2"
                    >
                      <option>Ingreso de caja</option>
                      <option>Ajuste de caja</option>
                      <option>Retiro de caja</option>
                    </select>
                    <input
                      type="number"
                      min="0"
                      value={cashAdjustmentAmount || ""}
                      onChange={(event) =>
                        setCashAdjustmentAmount(Number(event.target.value))
                      }
                      placeholder="Importe"
                      className="mt-2 w-full rounded border p-2"
                    />
                    <input
                      value={cashAdjustmentDetail}
                      onChange={(event) =>
                        setCashAdjustmentDetail(event.target.value)
                      }
                      placeholder="Motivo"
                      className="mt-2 w-full rounded border p-2"
                    />
                    <button
                      onClick={registerCashAdjustment}
                      className="mt-2 w-full rounded border py-2 text-sm font-bold"
                    >
                      Registrar movimiento
                    </button>
                  </div>
                  <button
                    onClick={confirmClose}
                    disabled={
                      !cashIsOpen ||
                      savedOrders.some((order) => order.site === site)
                    }
                    className="mt-3 w-full rounded bg-[#183a67] py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {savedOrders.some((order) => order.site === site)
                      ? "Comandas abiertas pendientes"
                      : "Confirmar cierre"}
                  </button>
                  {closed && (
                    <p className="mt-3 rounded bg-[#eef5ef] p-3 text-sm">
                      Cierre guardado localmente. Está listo para generar su
                      resumen.
                    </p>
                  )}
                  <div className="mt-4 rounded border border-[#d9d4c9] bg-[#fffdf8] p-3 text-xs">
                    <b>Integración Google Sheets</b>
                    <p className="mt-1">
                      Hoja destino: {SHEET_CONFIG[site].sheet}. Cada medio de
                      pago se mapeará contra el encabezado propio del local.
                    </p>
                    {SHEET_CONFIG[site].testUrl ? (
                      <a
                        className="mt-2 inline-block font-bold underline"
                        href={SHEET_CONFIG[site].testUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Abrir copia de prueba de Recoleta
                      </a>
                    ) : (
                      <p className="mt-1 text-slate-500">
                        Copia de prueba pendiente para este local.
                      </p>
                    )}
                    <p className="mt-2 text-slate-500">{syncStatus}</p>
                  </div>
                </div>
              </div>
            </>
          ) : tab === "Stock" ? (
            <>
              <Heading
                k={`STOCK · ${site.toUpperCase()}`}
                h="Inventario"
                p="La venta descuenta una unidad de la presentación vendida."
              />
              {lowStockProducts.length > 0 && (
                <div className="mb-4 rounded-2xl border border-[#f0bd4e] bg-[#fff5d8] p-4">
                  <b>Alerta de stock bajo</b>
                  <p className="mt-1 text-sm text-slate-700">
                    {lowStockProducts.length} producto{lowStockProducts.length === 1 ? "" : "s"} llegó o quedó por debajo del mínimo configurado.
                    {!managesCentralOrders && " Podés usar el pedido sugerido en Solicitud de mercadería."}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-[#183a67]">
                    {lowStockProducts.map(({ product }) => product.name).join(" · ")}
                  </p>
                </div>
              )}
              {canAdjustStock && (
                <button
                  onClick={() =>
                    setStock((x) => ({
                      ...x,
                      [site]: Object.fromEntries(
                        PRODUCTS.map((p) => [p.id, x[site][p.id] + 1]),
                      ),
                    }))
                  }
                  className="mb-4 rounded bg-[#183a67] px-4 py-3 font-bold text-white"
                >
                  Simular ingreso desde Central
                </button>
              )}
              <div className="overflow-auto rounded-xl border bg-white">
                <table className="w-full min-w-[620px] text-sm">
                  <thead className="bg-[#eef2f6]">
                    <tr>
                      <th className="p-3 text-left">Producto</th>
                      <th className="p-3 text-left">Presentación</th>
                      <th className="p-3">Stock</th>
                      <th className="p-3">Mínimo</th>
                      <th className="p-3">Real</th>
                      <th className="p-3">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PRODUCTS.map((p) => (
                      <tr key={p.id} className="border-t">
                        <td className="p-3">
                          <b>{p.name}</b>
                        </td>
                        <td className="p-3">{p.detail}</td>
                        <td className="p-3 text-center">{stock[site][p.id]}</td>
                        <td className="p-3 text-center">
                          {canAdjustStock ? (
                            <input
                              type="number"
                              min="0"
                              value={minimumStock[site][p.id] || ""}
                              placeholder="0"
                              onChange={(e) =>
                                setMinimumStock((current) => ({
                                  ...current,
                                  [site]: {
                                    ...current[site],
                                    [p.id]: Math.max(0, Number(e.target.value) || 0),
                                  },
                                }))
                              }
                              aria-label={`Stock mínimo de ${p.name}`}
                              className="w-20 rounded border p-1 text-center"
                            />
                          ) : (
                            <span>{minimumStock[site][p.id] || "—"}</span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          {canCountRealStock ? (
                            <input
                              type="number"
                              min="0"
                              value={realStock[site][p.id]}
                              onChange={(e) =>
                                setRealStock((current) => ({
                                  ...current,
                                  [site]: {
                                    ...current[site],
                                    [p.id]: e.target.value,
                                  },
                                }))
                              }
                              aria-label={`Conteo real de ${p.name}`}
                              className="w-20 rounded border p-1 text-center"
                            />
                          ) : (
                            <span>{realStock[site][p.id] || "—"}</span>
                          )}
                        </td>
                        <td className="p-3 text-center font-bold">
                          {realStock[site][p.id] === ""
                            ? "—"
                            : Number(realStock[site][p.id]) - stock[site][p.id]}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-sm text-slate-500">
                El conteo real se carga únicamente con el perfil de Andrea. Los
                mínimos de reposición y ajustes de stock quedan reservados a Andrea y Betzi.
              </p>
              {canCountRealStock && (
                <div className="mt-5 rounded-2xl border bg-white p-5">
                  <b>Solicitar ajuste de inventario</b>
                  <p className="mt-1 text-sm text-slate-500">
                    Betzi debe aprobar el ajuste antes de modificar el stock
                    teórico.
                  </p>
                  <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1.5fr_auto] md:items-end">
                    <label className="text-sm font-bold">
                      Producto contado
                      <select
                        value={adjustProductId}
                        onChange={(event) =>
                          setAdjustProductId(Number(event.target.value))
                        }
                        className="mt-1 block w-full rounded border p-2 font-normal"
                      >
                        {PRODUCTS.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name} · real{" "}
                            {realStock[site][product.id] || "sin cargar"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm font-bold">
                      Motivo de la diferencia
                      <input
                        value={adjustReason}
                        onChange={(event) =>
                          setAdjustReason(event.target.value)
                        }
                        placeholder="Ej.: faltante detectado en conteo"
                        className="mt-1 block w-full rounded border p-2 font-normal"
                      />
                    </label>
                    <button
                      onClick={submitStockAdjustment}
                      className="rounded bg-[#183a67] px-4 py-2.5 font-bold text-white"
                    >
                      Enviar a Betzi
                    </button>
                  </div>
                </div>
              )}
              {canAdjustStock && (
                <div className="mt-5 rounded-2xl border bg-white p-5">
                  <b>Movimientos de stock y remitos</b>
                  <p className="mt-1 text-sm text-slate-500">
                    Registrá ingresos o egresos manuales; el stock se actualiza
                    y queda trazabilidad.
                  </p>
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[1.3fr_.8fr_.7fr_1fr_1.5fr_auto] xl:items-end">
                    <label className="text-sm font-bold">
                      Producto
                      <select
                        value={movementProductId}
                        onChange={(event) =>
                          setMovementProductId(Number(event.target.value))
                        }
                        className="mt-1 block w-full rounded border p-2 font-normal"
                      >
                        {PRODUCTS.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm font-bold">
                      Tipo
                      <select
                        value={movementKind}
                        onChange={(event) =>
                          setMovementKind(
                            event.target.value as StockMovement["kind"],
                          )
                        }
                        className="mt-1 block w-full rounded border p-2 font-normal"
                      >
                        <option>Ingreso</option>
                        <option>Egreso</option>
                      </select>
                    </label>
                    <label className="text-sm font-bold">
                      Cantidad
                      <input
                        type="number"
                        min="1"
                        value={movementQuantity || ""}
                        onChange={(event) =>
                          setMovementQuantity(Number(event.target.value))
                        }
                        className="mt-1 block w-full rounded border p-2 font-normal"
                      />
                    </label>
                    <label className="text-sm font-bold">
                      Remito
                      <input
                        value={movementRemito}
                        onChange={(event) =>
                          setMovementRemito(event.target.value)
                        }
                        placeholder="N.º remito"
                        className="mt-1 block w-full rounded border p-2 font-normal"
                      />
                    </label>
                    <label className="text-sm font-bold">
                      Detalle
                      <input
                        value={movementDetail}
                        onChange={(event) =>
                          setMovementDetail(event.target.value)
                        }
                        placeholder="Origen o motivo"
                        className="mt-1 block w-full rounded border p-2 font-normal"
                      />
                    </label>
                    <button
                      onClick={registerStockMovement}
                      className="rounded bg-[#183a67] px-4 py-2.5 font-bold text-white"
                    >
                      Registrar
                    </button>
                  </div>
                  {stockMovements.filter((movement) => movement.site === site)
                    .length > 0 && (
                    <p className="mt-3 text-sm text-slate-500">
                      Último movimiento:{" "}
                      {
                        stockMovements.find(
                          (movement) => movement.site === site,
                        )?.kind
                      }{" "}
                      ·{" "}
                      {stockMovements.find((movement) => movement.site === site)
                        ?.remito || "sin remito"}
                    </p>
                  )}
                </div>
              )}
            </>
          ) : tab === "Fichaje" ? (
            <>
              <Heading
                k={`PERSONAL · ${site.toUpperCase()}`}
                h="Fichaje"
                p="Registro personal de entrada y salida con PIN."
              />
              <div className="grid max-w-3xl gap-5 md:grid-cols-2">
                <div className="rounded-2xl border bg-white p-6">
                  <input
                    type="password"
                    placeholder="PIN personal"
                    className="w-full rounded border p-3"
                  />
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <button
                      onClick={() =>
                        setClock(
                          `Entrada registrada a las ${new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`,
                        )
                      }
                      className="rounded bg-[#183a67] py-3 font-bold text-white"
                    >
                      Marcar entrada
                    </button>
                    <button
                      onClick={() =>
                        setClock(
                          `Salida registrada a las ${new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`,
                        )
                      }
                      className="rounded border py-3 font-bold"
                    >
                      Marcar salida
                    </button>
                  </div>
                  {clock && (
                    <p className="mt-3 rounded bg-[#eef5ef] p-3 text-sm">
                      {clock}
                    </p>
                  )}
                </div>
                <div className="rounded-2xl border bg-white p-6">
                  <b>Estado actual</b>
                  <p className="mt-4">
                    Vendedora 1 ·{" "}
                    <span className="font-bold text-green-700">En turno</span>
                  </p>
                  <p className="mt-3">
                    Vendedora 2 ·{" "}
                    <span className="font-bold text-green-700">En turno</span>
                  </p>
                  <p className="mt-5 text-sm text-slate-500">
                    Administración podrá consultar asistencia e historial por
                    persona.
                  </p>
                </div>
              </div>
            </>
          ) : tab === "Pedido" ? (
            <>
              <Heading
                k={`CENTRAL · ${site.toUpperCase()}`}
                h="Solicitud de mercadería"
                p="Armá el pedido del local y envialo a Betzi para preparación y despacho."
              />
              <div className="grid gap-6 xl:grid-cols-[1fr_350px]">
                <div className="rounded-2xl border bg-white p-4 sm:p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="font-bold">Productos solicitados</h2>
                      <p className="text-sm text-slate-500">
                        Indicá las unidades que necesita el local.
                      </p>
                    </div>
                    <span className="rounded-full bg-[#eef2f6] px-3 py-1 text-sm font-bold">
                      {currentRequestLines.reduce(
                        (total, line) => total + line.quantity,
                        0,
                      )}{" "}
                      unidades
                    </span>
                  </div>
                  {lowStockProducts.length > 0 && (
                    <div className="mb-4 rounded-xl border border-[#f0bd4e] bg-[#fff5d8] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <b>Pedido sugerido por stock mínimo</b>
                          <p className="mt-1 text-sm text-slate-700">
                            El sistema propone reponer hasta el mínimo configurado. Los productos que ya están en mínimo requieren revisión, pero no agregan unidades automáticamente.
                          </p>
                        </div>
                        {suggestedOrderLines.length > 0 && (
                          <button
                            onClick={() =>
                              setRequestQuantities((items) => ({
                                ...items,
                                ...Object.fromEntries(
                                  suggestedOrderLines.map((line) => [
                                    line.product.id,
                                    Math.max(items[line.product.id] || 0, line.quantity),
                                  ]),
                                ),
                              }))
                            }
                            className="rounded bg-[#183a67] px-4 py-2 font-bold text-white"
                          >
                            Cargar pedido sugerido
                          </button>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-sm">
                        {lowStockProducts.map(({ product, current, minimum }) => {
                          const suggestion = Math.max(minimum - current, 0);
                          return (
                            <span key={product.id} className="rounded-full bg-white px-3 py-1 font-semibold">
                              {product.name}: {current}/{minimum}
                              {suggestion > 0 ? ` · sugerido ${suggestion}` : " · revisar"}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {PRODUCTS.map((product) => {
                      const quantity = requestQuantities[product.id] || 0;
                      return (
                        <div key={product.id} className="rounded-xl border p-3">
                          <p className="text-xs font-bold text-[#ec3a35]">
                            {product.category}
                          </p>
                          <b className="mt-1 block text-sm">{product.name}</b>
                          <p className="mt-1 text-xs text-slate-500">
                            {product.detail}
                          </p>
                          <div className="mt-3 flex items-center justify-between gap-2">
                            <button
                              aria-label={`Restar ${product.name}`}
                              onClick={() =>
                                setRequestQuantities((items) => ({
                                  ...items,
                                  [product.id]: Math.max(0, quantity - 1),
                                }))
                              }
                              className="grid h-9 w-9 place-items-center rounded border font-bold"
                            >
                              −
                            </button>
                            <input
                              aria-label={`Cantidad de ${product.name}`}
                              type="number"
                              min="0"
                              value={quantity || ""}
                              placeholder="0"
                              onChange={(event) =>
                                setRequestQuantities((items) => ({
                                  ...items,
                                  [product.id]: Math.max(
                                    0,
                                    Number(event.target.value) || 0,
                                  ),
                                }))
                              }
                              className="w-14 rounded border p-2 text-center font-bold"
                            />
                            <button
                              aria-label={`Sumar ${product.name}`}
                              onClick={() =>
                                setRequestQuantities((items) => ({
                                  ...items,
                                  [product.id]: quantity + 1,
                                }))
                              }
                              className="grid h-9 w-9 place-items-center rounded bg-[#183a67] font-bold text-white"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <aside className="h-fit rounded-2xl border bg-white p-5 shadow-sm">
                  <h2 className="font-bold">Confirmar solicitud</h2>
                  <p className="mt-2 text-sm text-slate-500">
                    La recibe Central de pedidos. No descuenta ni ingresa stock
                    hasta que Central realice el movimiento.
                  </p>
                  <label className="mt-4 block text-sm font-bold">
                    Observaciones
                    <textarea
                      value={requestNotes}
                      onChange={(event) => setRequestNotes(event.target.value)}
                      placeholder="Ej.: enviar antes del viernes"
                      className="mt-1 min-h-24 w-full rounded border p-3 font-normal"
                    />
                  </label>
                  <button
                    onClick={submitStockRequest}
                    className="mt-4 w-full rounded bg-[#ec3a35] py-3 font-bold text-white"
                  >
                    Enviar pedido a Central
                  </button>
                  {message && (
                    <p className="mt-3 rounded bg-[#eef5ef] p-3 text-sm">
                      {message}
                    </p>
                  )}
                  <div className="mt-5 border-t pt-4">
                    <p className="text-sm font-bold">Pedidos de {site}</p>
                    {siteRequests.length ? (
                      siteRequests.slice(0, 4).map((request) => (
                        <div
                          key={request.id}
                          className="mt-3 rounded bg-[#eef2f6] p-3 text-xs"
                        >
                          <b>{request.status}</b> · {request.requestedAt}
                          <p className="mt-1">
                            {request.lines.reduce(
                              (total, line) => total + line.quantity,
                              0,
                            )}{" "}
                            unidades solicitadas
                          </p>
                            {["Despachado", "Despachado parcial"].includes(
                              request.status,
                            ) &&
                              can("pedidos") && (
                              <button
                                onClick={() => confirmRequestReception(request)}
                                className="mt-2 rounded bg-[#183a67] px-3 py-2 font-bold text-white"
                              >
                                Confirmar recepción
                              </button>
                            )}
                        </div>
                      ))
                    ) : (
                      <p className="mt-2 text-sm text-slate-500">
                        Todavía no hay solicitudes enviadas.
                      </p>
                    )}
                  </div>
                </aside>
              </div>
            </>
          ) : tab === "Central de pedidos" && managesCentralOrders ? (
            <>
              <Heading
                k="CENTRAL · PEDIDOS DE LOCALES"
                h="Central de pedidos"
                p="Revisá los pedidos de los locales, gestioná su estado y prepará el despacho desde Villa Mitre."
              />
              <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
                <div className="overflow-hidden rounded-2xl border bg-white">
                  <div className="border-b p-4 sm:p-5">
                    <b>Pedidos recibidos</b>
                    <p className="mt-1 text-sm text-slate-500">
                      Seleccioná un pedido para ver el detalle y descargarlo.
                    </p>
                  </div>
                  {stockRequests.length ? (
                    <div className="divide-y">
                      {stockRequests.map((request) => (
                        <button
                          key={request.id}
                          onClick={() => setSelectedRequestId(request.id)}
                          className={`w-full p-4 text-left sm:p-5 ${selectedRequestId === request.id ? "bg-[#eef2f6]" : "hover:bg-[#fffdf8]"}`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <b>{request.site}</b>
                            <span className="rounded-full bg-[#fff5d8] px-2 py-1 text-xs font-bold">
                              {request.status}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-slate-600">
                            {request.requestedBy} · {request.requestedAt}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {request.lines.reduce(
                              (total, line) => total + line.quantity,
                              0,
                            )}{" "}
                            unidades · {request.notes || "Sin observaciones"}
                          </p>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="p-5 text-sm text-slate-500">
                      Cuando un local envíe su pedido, aparecerá aquí.
                    </p>
                  )}
                </div>
                <aside className="h-fit rounded-2xl border bg-white p-5 shadow-sm printable-request">
                  {selectedRequest ? (
                    <>
                      <p className="text-sm font-bold text-[#ec3a35]">
                        L&apos;ARTISAN · CENTRAL
                      </p>
                      <h2 className="mt-1 text-2xl font-bold">
                        Pedido {selectedRequest.site}
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {selectedRequest.requestedBy} ·{" "}
                        {selectedRequest.requestedAt}
                      </p>
                      <label className="mt-4 block text-sm font-bold no-print">
                        Estado del pedido
                        <select
                          value={selectedRequest.status}
                          onChange={(event) =>
                            updateRequestStatus(
                              selectedRequest,
                              event.target.value as StockRequest["status"],
                            )
                          }
                          className="mt-1 w-full rounded border p-2 font-normal"
                        >
                          <option>Pendiente</option>
                          <option>En preparación</option>
                          <option>Despachado</option>
                          <option>Despachado parcial</option>
                          <option>Entregado</option>
                        </select>
                      </label>
                      <p className="mt-4 rounded bg-[#eef2f6] p-3 text-sm">
                        <b>Observaciones:</b>{" "}
                        {selectedRequest.notes || "Sin observaciones"}
                      </p>
                      <div className="mt-4 overflow-auto border-y py-3">
                        {selectedRequest.lines.map((line) => {
                          const product = PRODUCTS.find(
                            (item) => item.id === line.productId,
                          );
                          return (
                            <div key={line.productId} className="border-b py-3 text-sm last:border-0">
                              <span>
                                <b>{product?.name}</b>
                                <span className="block text-xs text-slate-500">
                                  {product?.detail}
                                </span>
                              </span>
                              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_96px] sm:items-center">
                                <label className="text-xs font-bold">
                                  Solicitado: {line.quantity} · Enviado
                                  <input
                                    type="number"
                                    min="0"
                                    max={line.quantity}
                                    value={line.preparedQuantity ?? line.quantity}
                                    onChange={(event) =>
                                      updatePreparedQuantity(
                                        selectedRequest.id,
                                        line.productId,
                                        Number(event.target.value) || 0,
                                      )
                                    }
                                    className="mt-1 w-full rounded border p-2 text-center font-bold"
                                  />
                                </label>
                                <p className="rounded bg-[#fff5d8] p-2 text-center text-xs font-bold">
                                  Faltan {line.quantity - (line.preparedQuantity ?? line.quantity)}
                                </p>
                              </div>
                              {(line.preparedQuantity ?? line.quantity) < line.quantity && (
                                <input
                                  value={line.missingReason || ""}
                                  onChange={(event) =>
                                    updateMissingReason(
                                      selectedRequest.id,
                                      line.productId,
                                      event.target.value,
                                    )
                                  }
                                  placeholder="Motivo del faltante (opcional)"
                                  className="mt-2 w-full rounded border p-2 text-xs"
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <button
                        onClick={() => confirmCentralDispatch(selectedRequest)}
                        disabled={selectedRequest.status === "Entregado"}
                        className="no-print mt-4 w-full rounded bg-[#ec3a35] px-3 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        Confirmar despacho
                      </button>
                      <div className="no-print mt-4 grid gap-2 sm:grid-cols-2">
                        <button
                          onClick={() => exportRequestExcel(selectedRequest)}
                          className="rounded bg-[#183a67] px-3 py-3 text-sm font-bold text-white"
                        >
                          Descargar Excel
                        </button>
                        <button
                          onClick={() => window.print()}
                          className="rounded border px-3 py-3 text-sm font-bold"
                        >
                          Imprimir / Guardar PDF
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-slate-500">
                      Elegí un pedido de la lista para ver su detalle.
                    </p>
                  )}
                </aside>
              </div>
              <div className="mt-6 rounded-2xl border bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <b>Ajustes de inventario pendientes</b>
                    <p className="mt-1 text-sm text-slate-500">
                      Andrea carga el conteo y motivo; Betzi autoriza el cambio
                      definitivo.
                    </p>
                  </div>
                  <span className="rounded-full bg-[#fff5d8] px-3 py-1 text-sm font-bold">
                    {
                      stockAdjustments.filter(
                        (adjustment) => adjustment.status === "Pendiente",
                      ).length
                    }{" "}
                    pendientes
                  </span>
                </div>
                <div className="mt-4 overflow-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="bg-[#eef2f6]">
                      <tr>
                        <th className="p-3 text-left">Local</th>
                        <th className="p-3 text-left">Producto</th>
                        <th className="p-3 text-center">Teórico</th>
                        <th className="p-3 text-center">Real</th>
                        <th className="p-3 text-left">Motivo</th>
                        <th className="p-3 text-center">Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stockAdjustments.length ? (
                        stockAdjustments.map((adjustment) => (
                          <tr key={adjustment.id} className="border-t">
                            <td className="p-3 font-bold">{adjustment.site}</td>
                            <td className="p-3">
                              {
                                PRODUCTS.find(
                                  (product) =>
                                    product.id === adjustment.productId,
                                )?.name
                              }
                            </td>
                            <td className="p-3 text-center">
                              {adjustment.theoretical}
                            </td>
                            <td className="p-3 text-center font-bold">
                              {adjustment.counted}
                            </td>
                            <td className="p-3">{adjustment.reason}</td>
                            <td className="p-3 text-center">
                              {adjustment.status === "Pendiente" ? (
                                user.name === "Betzi" ? (
                                  <div className="flex justify-center gap-2">
                                    <button
                                      onClick={() =>
                                        approveStockAdjustment(adjustment, true)
                                      }
                                      className="rounded bg-[#183a67] px-3 py-2 font-bold text-white"
                                    >
                                      Aprobar
                                    </button>
                                    <button
                                      onClick={() =>
                                        approveStockAdjustment(adjustment, false)
                                      }
                                      className="rounded border px-3 py-2 font-bold"
                                    >
                                      Rechazar
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-xs text-slate-500">
                                    Revisión de Betzi
                                  </span>
                                )
                              ) : (
                                adjustment.status
                              )}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="p-4 text-slate-500">
                            No hay ajustes por aprobar.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : tab === "Devoluciones" ? (
            <>
              <Heading
                k={`LOCAL · ${site.toUpperCase()}`}
                h="Devoluciones y cambios"
                p="Registrá la operación, su motivo y el reintegro. La venta original queda auditada."
              />
              <div className="grid max-w-5xl gap-6 lg:grid-cols-[.9fr_1.1fr]">
                <div className="rounded-2xl border bg-white p-5">
                  <label className="block text-sm font-bold">
                    Venta original
                    <select
                      value={returnSaleId}
                      onChange={(event) => setReturnSaleId(event.target.value)}
                      className="mt-1 w-full rounded border p-2 font-normal"
                    >
                      <option value="">Seleccionar venta</option>
                      {sales
                        .filter(
                          (sale) => sale.site === site && sale.status === "activa" && !returnsLog.some((transaction) => transaction.saleId === sale.id),
                        )
                        .map((sale) => (
                          <option key={sale.id} value={sale.id}>
                            {sale.createdAt} · {sale.customer} · {money.format(sale.net)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-bold">
                      Operación
                      <select
                        value={returnKind}
                        onChange={(event) => setReturnKind(event.target.value as ReturnTransaction["kind"])}
                        className="mt-1 w-full rounded border p-2 font-normal"
                      >
                        <option>Devolución</option>
                        <option>Cambio</option>
                      </select>
                    </label>
                    <label className="text-sm font-bold">
                      Medio de reintegro
                      <select
                        value={returnRefundMethod}
                        onChange={(event) => setReturnRefundMethod(event.target.value)}
                        className="mt-1 w-full rounded border p-2 font-normal"
                      >
                        {methods.map((method) => <option key={method}>{method}</option>)}
                      </select>
                    </label>
                  </div>
                  <label className="mt-3 block text-sm font-bold">
                    Motivo
                    <textarea
                      value={returnReason}
                      onChange={(event) => setReturnReason(event.target.value)}
                      placeholder="Ej.: producto dañado, cliente cambió de elección"
                      className="mt-1 min-h-24 w-full rounded border p-2 font-normal"
                    />
                  </label>
                  <label className="mt-3 flex items-center gap-2 text-sm font-bold">
                    <input
                      type="checkbox"
                      checked={returnRestock}
                      onChange={(event) => setReturnRestock(event.target.checked)}
                    />
                    Reingresar la mercadería al stock
                  </label>
                  <button
                    onClick={registerReturn}
                    disabled={!can("anular")}
                    className="mt-4 w-full rounded bg-[#ec3a35] py-3 font-bold text-white disabled:opacity-40"
                  >
                    Registrar operación
                  </button>
                </div>
                <div className="rounded-2xl border bg-white p-5">
                  <b>Historial de devoluciones y cambios</b>
                  <div className="mt-3 divide-y">
                    {siteReturns.length ? (
                      siteReturns.map((transaction) => (
                        <div key={transaction.id} className="py-3 text-sm">
                          <div className="flex justify-between gap-3">
                            <b>{transaction.kind}</b>
                            <b>{money.format(transaction.amount)}</b>
                          </div>
                          <p className="mt-1">{transaction.reason}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {transaction.createdAt} · {transaction.createdBy} · {transaction.refundMethod} · {transaction.restock ? "Stock repuesto" : "Sin reingreso a stock"}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="py-4 text-sm text-slate-500">
                        No hay devoluciones ni cambios registrados.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : tab === "Egresos" ? (
            <>
              <Heading
                k={`LOCAL · ${site.toUpperCase()}`}
                h="Egresos"
                p="Registrá gastos del local con detalle, responsable y comprobante."
              />
              <div className="grid max-w-5xl gap-6 lg:grid-cols-[.9fr_1.1fr]">
                <div className="rounded-2xl border bg-white p-5">
                  <label className="block text-sm font-bold">
                    Categoría
                    <select
                      value={expenseCategory}
                      onChange={(event) =>
                        setExpenseCategory(event.target.value)
                      }
                      className="mt-1 w-full rounded border p-2 font-normal"
                    >
                      <option>Insumos</option>
                      <option>Mantenimiento</option>
                      <option>Servicios</option>
                      <option>Flete</option>
                      <option>Otros</option>
                    </select>
                  </label>
                  <label className="mt-3 block text-sm font-bold">
                    Importe
                    <input
                      type="number"
                      min="0"
                      value={expenseAmount || ""}
                      onChange={(event) =>
                        setExpenseAmount(Number(event.target.value))
                      }
                      className="mt-1 w-full rounded border p-2 font-normal"
                    />
                  </label>
                  <label className="mt-3 block text-sm font-bold">
                    Detalle
                    <textarea
                      value={expenseDetail}
                      onChange={(event) => setExpenseDetail(event.target.value)}
                      className="mt-1 min-h-24 w-full rounded border p-2 font-normal"
                      placeholder="Ej.: compra de bolsas y servilletas"
                    />
                  </label>
                  <label className="mt-3 block text-sm font-bold">
                    Comprobante opcional
                    <input
                      type="file"
                      onChange={(event) =>
                        setExpenseReceipt(event.target.files?.[0]?.name || "")
                      }
                      className="mt-1 block w-full text-sm font-normal"
                    />
                  </label>
                  <button
                    onClick={submitExpense}
                    disabled={!can("egresos")}
                    className="mt-4 w-full rounded bg-[#183a67] py-3 font-bold text-white disabled:opacity-40"
                  >
                    Registrar egreso
                  </button>
                </div>
                <div className="rounded-2xl border bg-white p-5">
                  <b>Egresos de {site}</b>
                  <div className="mt-3 divide-y">
                    {expensesLog.filter((expense) => expense.site === site)
                      .length ? (
                      expensesLog
                        .filter((expense) => expense.site === site)
                        .map((expense) => (
                          <div key={expense.id} className="py-3 text-sm">
                            <div className="flex justify-between gap-3">
                              <b>{expense.category}</b>
                              <b>{money.format(expense.amount)}</b>
                            </div>
                            <p>{expense.detail}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {expense.createdBy} ·{" "}
                              {expense.receiptName || "Sin comprobante"}
                            </p>
                          </div>
                        ))
                    ) : (
                      <p className="py-4 text-sm text-slate-500">
                        Todavía no hay egresos registrados.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : tab === "Incidencias" ? (
            <>
              <Heading
                k={`LOCAL · ${site.toUpperCase()}`}
                h="Incidencias"
                p="Informá faltantes, devoluciones, reclamos o problemas operativos a Administración."
              />
              <div className="grid max-w-5xl gap-6 lg:grid-cols-[.9fr_1.1fr]">
                <div className="rounded-2xl border bg-white p-5">
                  <label className="block text-sm font-bold">
                    Tipo
                    <select
                      value={incidentType}
                      onChange={(event) => setIncidentType(event.target.value)}
                      className="mt-1 w-full rounded border p-2 font-normal"
                    >
                      <option>Faltante de mercadería</option>
                      <option>Problema con POS</option>
                      <option>Devolución</option>
                      <option>Reclamo de cliente</option>
                      <option>Mercadería dañada</option>
                      <option>Otro</option>
                    </select>
                  </label>
                  <label className="mt-3 block text-sm font-bold">
                    Descripción
                    <textarea
                      value={incidentDetail}
                      onChange={(event) =>
                        setIncidentDetail(event.target.value)
                      }
                      className="mt-1 min-h-28 w-full rounded border p-2 font-normal"
                      placeholder="Contá qué ocurrió y qué producto o comprobante está involucrado."
                    />
                  </label>
                  <button
                    onClick={submitIncident}
                    disabled={!can("incidencias")}
                    className="mt-4 w-full rounded bg-[#ec3a35] py-3 font-bold text-white disabled:opacity-40"
                  >
                    Enviar incidencia
                  </button>
                </div>
                <div className="rounded-2xl border bg-white p-5">
                  <b>Historial del local</b>
                  <div className="mt-3 divide-y">
                    {incidents.filter((incident) => incident.site === site)
                      .length ? (
                      incidents
                        .filter((incident) => incident.site === site)
                        .map((incident) => (
                          <div key={incident.id} className="py-3 text-sm">
                            <div className="flex justify-between gap-3">
                              <b>{incident.type}</b>
                              <span className="font-bold text-[#ec3a35]">
                                {incident.status}
                              </span>
                            </div>
                            <p className="mt-1">{incident.detail}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {incident.createdAt} · {incident.createdBy}
                            </p>
                          </div>
                        ))
                    ) : (
                      <p className="py-4 text-sm text-slate-500">
                        No hay incidencias registradas.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : tab === "Guía" ? (
            <>
              <Heading
                k="AYUDA PARA EL LOCAL"
                h="Guía y novedades"
                p="Consultá aquí cómo usar el sistema y los cambios que se vayan incorporando."
              />
              <div className="grid max-w-4xl gap-5 md:grid-cols-[1fr_1.15fr]">
                <div className="rounded-2xl border bg-white p-6">
                  <h2 className="font-bold">Uso diario</h2>
                  <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-6">
                    <li>Abrí Caja y confirmá el fondo inicial.</li>
                    <li>Registrá cada venta con su medio de pago real.</li>
                    <li>Consultá Stock antes de ofrecer un producto.</li>
                    <li>
                      Al cierre, revisá los cobros, contá efectivo y completá el
                      sobre si tu local lo utiliza.
                    </li>
                    <li>
                      Confirmá el cierre solo cuando la diferencia sea cero.
                    </li>
                  </ol>
                </div>
                <div className="rounded-2xl border bg-white p-6">
                  <h2 className="font-bold">Novedades</h2>
                  <div className="mt-3 divide-y">
                    {guideUpdates.map((update) => (
                      <article key={update.title} className="py-4">
                        <p className="text-xs font-bold text-[#ec3a35]">
                          {update.date}
                        </p>
                        <h3 className="mt-1 font-bold">{update.title}</h3>
                        <p className="mt-1 text-sm text-slate-600">
                          {update.detail}
                        </p>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
              <p className="mt-5 text-sm text-slate-500">
                Esta sección se actualizará desde Administración cuando haya una
                nueva función o un cambio de procedimiento.
              </p>
            </>
          ) : tab === "Clientes" ? (
            <>
              <Heading
                k="CLIENTES"
                h="Base de clientes"
                p="Opcional en cada venta; se pedirá consentimiento antes de promociones."
              />
              <button className="rounded bg-[#183a67] px-4 py-3 font-bold text-white">
                Registrar cliente
              </button>
            </>
          ) : tab === "Recetas y costos" && user.role === "administracion" ? (
            <>
              <Heading
                k="ADMINISTRACIÓN · PRODUCCIÓN"
                h="Recetas y costos"
                p="Módulo reservado para fichas técnicas, rendimiento, insumos y costo por producto."
              />
              <div className="max-w-4xl rounded-2xl border border-[#e7c26a] bg-[#fff5d8] p-6">
                <p className="font-bold">Próximamente</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  Esta sección quedará preparada para cargar recetas, materias
                  primas, unidades, merma, rendimiento, costo teórico y margen
                  de cada producto. Se trabajará al finalizar los módulos
                  operativos de ventas, caja, stock y reportes.
                </p>
              </div>
              <div className="mt-5 grid max-w-4xl gap-4 md:grid-cols-3">
                {[
                  "Fichas técnicas y rendimientos",
                  "Costo de insumos y variación",
                  "Margen por producto y categoría",
                ].map((item) => (
                  <div key={item} className="rounded-xl border bg-white p-5">
                    <p className="font-bold">{item}</p>
                    <p className="mt-2 text-sm text-slate-500">Pendiente de configuración.</p>
                  </div>
                ))}
              </div>
            </>
          ) : tab === "Legajos" && user.role === "administracion" ? (
            <>
              <Heading
                k="ADMINISTRACIÓN · PERSONAL"
                h="Legajos"
                p="Módulo reservado para la documentación y el historial laboral del equipo."
              />
              <div className="max-w-4xl rounded-2xl border border-[#e7c26a] bg-[#fff5d8] p-6">
                <p className="font-bold">Próximamente</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  Aquí se concentrarán los datos del empleado, documentación,
                  altas y bajas, puesto, local asignado, horarios, observaciones
                  y vencimientos. El acceso quedará limitado a Administración.
                </p>
              </div>
              <div className="mt-5 grid max-w-4xl gap-4 md:grid-cols-3">
                {[
                  "Datos y documentación",
                  "Historial y observaciones",
                  "Vencimientos y alertas",
                ].map((item) => (
                  <div key={item} className="rounded-xl border bg-white p-5">
                    <p className="font-bold">{item}</p>
                    <p className="mt-2 text-sm text-slate-500">Pendiente de configuración.</p>
                  </div>
                ))}
              </div>
            </>
          ) : tab === "Integraciones" && user.role === "administracion" ? (
            <>
              <Heading
                k="ADMINISTRACIÓN · CONEXIONES"
                h="Google Drive y cierres"
                p="Control de las hojas que recibirán cierres de caja y egresos de cada sucursal."
              />
              <div className="rounded-2xl border border-[#e7c26a] bg-[#fff5d8] p-4 text-sm">
                <b>Modo seguro de preparación.</b> Las cinco estructuras fueron
                revisadas, pero todavía no se escribe en los Drive reales. La
                activación se hará con una cuenta técnica y permisos limitados,
                después de probar el envío en una copia por local.
              </div>
              <div className="mt-5 overflow-auto rounded-xl border bg-white">
                <table className="w-full min-w-[1050px] text-sm">
                  <thead className="bg-[#eef2f6]">
                    <tr>
                      <th className="p-3 text-left">Local</th>
                      <th className="p-3 text-left">Cierres</th>
                      <th className="p-3 text-left">Egresos</th>
                      <th className="p-3 text-left">Medios de pago</th>
                      <th className="p-3 text-center">Estado</th>
                      <th className="p-3 text-center">Drive</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DRIVE_INTEGRATIONS.map((integration) => (
                      <tr key={integration.site} className="border-t">
                        <td className="p-3 font-bold">{integration.site}</td>
                        <td className="p-3">{integration.incomeSheet}</td>
                        <td className="p-3">{integration.expenseSheet}</td>
                        <td className="p-3">
                          {
                            Object.keys(SHEET_CONFIG[integration.site].fields)
                              .length
                          }{" "}
                          mapeados
                        </td>
                        <td className="p-3 text-center">
                          <span className="font-bold text-green-700">
                            {integration.incomeStatus}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          <a
                            href={integration.url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-bold underline"
                          >
                            Abrir
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border bg-white p-5">
                  <b>1. Cierres</b>
                  <p className="mt-2 text-sm text-slate-600">
                    Al cerrar caja se creará o actualizará la fila del día,
                    usando los encabezados propios de cada local: efectivo, QR,
                    bancos, delivery, gastos y sobre.
                  </p>
                </div>
                <div className="rounded-xl border bg-white p-5">
                  <b>2. Egresos</b>
                  <p className="mt-2 text-sm text-slate-600">
                    Cada egreso se agregará a GASTOS OPERATIVOS con fecha,
                    rubro, comprobante, importe, medio y responsable.
                  </p>
                </div>
                <div className="rounded-xl border bg-white p-5">
                  <b>3. Respaldo</b>
                  <p className="mt-2 text-sm text-slate-600">
                    La base de datos será la fuente operativa; Drive conservará
                    copia y reportes, sin depender de fórmulas frágiles para
                    vender.
                  </p>
                </div>
              </div>
              <div className="mt-6 rounded-xl border bg-white p-5">
                <b>Antes de activar la escritura</b>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-600">
                  <li>
                    Crear una copia de prueba para Villa Mitre, Congreso, Maure
                    y Novo Pacheco, como ya existe para Recoleta.
                  </li>
                  <li>
                    Autorizar una cuenta técnica con acceso solo a esos
                    archivos, no con la cuenta personal de una vendedora.
                  </li>
                  <li>
                    Probar un cierre y un egreso por local contra la copia;
                    luego habilitar los Drive reales.
                  </li>
                  <li>
                    Definir CUIT y punto de venta de cada emisor para dejar
                    lista la etapa ARCA.
                  </li>
                </ol>
              </div>
            </>
          ) : tab === "Precios" && user.role === "administracion" ? (
            <>
              <Heading
                k="ADMINISTRACIÓN · CATÁLOGO CENTRAL"
                h="Aumentos de precios"
                p="Actualizá el catálogo compartido: el nuevo precio se aplica a los cinco locales."
              />
              <div className="rounded-2xl border bg-white p-5">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1.2fr_1.2fr_1.2fr_auto] xl:items-end">
                  <label className="text-sm font-bold">
                    Aumento (%)
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={priceIncrease}
                      onChange={(e) => setPriceIncrease(Number(e.target.value))}
                      className="mt-1 block w-full rounded border p-2 font-normal"
                    />
                  </label>
                  <label className="text-sm font-bold">
                    Productos
                    <select
                      value={priceCategory}
                      onChange={(e) => setPriceCategory(e.target.value)}
                      className="mt-1 block w-full rounded border p-2 font-normal"
                    >
                      {cats.map((category) => (
                        <option key={category}>{category}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-bold">
                    Redondeo
                    <select
                      value={priceRounding}
                      onChange={(e) => setPriceRounding(Number(e.target.value))}
                      className="mt-1 block w-full rounded border p-2 font-normal"
                    >
                      <option value={1}>Al peso</option>
                      <option value={10}>Hacia arriba a $10</option>
                      <option value={100}>Hacia arriba a $100</option>
                      <option value={500}>Hacia arriba a $500</option>
                    </select>
                  </label>
                  <label className="text-sm font-bold">
                    Vigencia
                    <input
                      type="date"
                      value={priceEffectiveDate}
                      onChange={(e) => setPriceEffectiveDate(e.target.value)}
                      className="mt-1 block w-full rounded border p-2 font-normal"
                    />
                  </label>
                  <button
                    disabled={priceIncrease <= 0}
                    onClick={applyPriceIncrease}
                    className="rounded bg-[#183a67] px-5 py-2.5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Aplicar a todos
                  </button>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  La vigencia y el porcentaje quedan en auditoría. El botón
                  solicita confirmación antes de modificar el catálogo.
                </p>
                {message && (
                  <p className="mt-3 rounded bg-[#eef5ef] p-3 text-sm">
                    {message}
                  </p>
                )}
              </div>
              <div className="mt-6 overflow-auto rounded-xl border bg-white">
                <div className="border-b p-5">
                  <b>Vista previa del aumento</b>
                  <p className="mt-1 text-sm text-slate-500">
                    Verificá los importes antes de confirmar.
                  </p>
                </div>
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-[#eef2f6]">
                    <tr>
                      <th className="p-3 text-left">Producto</th>
                      <th className="p-3 text-left">Categoría</th>
                      <th className="p-3 text-right">Precio actual</th>
                      <th className="p-3 text-right">Precio online</th>
                      <th className="p-3 text-right">Precio nuevo</th>
                      <th className="p-3 text-right">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PRODUCTS.filter(
                      (product) =>
                        priceCategory === "Todos" ||
                        product.category === priceCategory,
                    ).map((product) => {
                      const next =
                        priceIncrease > 0
                          ? increasedPrice(product.id)
                          : prices[product.id];
                      return (
                        <tr key={product.id} className="border-t">
                          <td className="p-3 font-bold">
                            {product.name}
                            <br />
                            <span className="font-normal text-slate-500">
                              {product.detail}
                            </span>
                          </td>
                          <td className="p-3">{product.category}</td>
                          <td className="p-3 text-right">
                            {money.format(prices[product.id])}
                          </td>
                          <td className="p-3 text-right">
                            <input
                              type="number"
                              min="0"
                              value={onlinePrices[product.id]}
                              onChange={(event) =>
                                setOnlinePrices((items) => ({
                                  ...items,
                                  [product.id]: Number(event.target.value),
                                }))
                              }
                              className="w-28 rounded border p-1 text-right"
                              aria-label={`Precio online de ${product.name}`}
                            />
                          </td>
                          <td className="p-3 text-right font-bold text-green-700">
                            {money.format(next)}
                          </td>
                          <td className="p-3 text-right">
                            {money.format(next - prices[product.id])}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-6 rounded-xl border bg-white p-5">
                <b>Versiones guardadas de listas de precios</b>
                <p className="mt-1 text-sm text-slate-500">
                  Cada aumento conserva una copia completa de la lista anterior
                  y de la lista resultante.
                </p>
                <div className="mt-3 space-y-3">
                  {priceChanges.length ? (
                    priceChanges.map((change, index) => (
                      <div key={change.id} className="rounded-xl border p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                          <span>
                            <b>Versión {priceChanges.length - index}</b> · +
                            {change.percentage}% · {change.category} · vigencia{" "}
                            {change.effectiveDate}
                            <br />
                            <span className="text-xs text-slate-500">
                              {change.at}
                            </span>
                          </span>
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() =>
                                setExpandedPriceChange((current) =>
                                  current === change.id ? null : change.id,
                                )
                              }
                              className="rounded border px-3 py-2 font-bold"
                            >
                              {expandedPriceChange === change.id
                                ? "Ocultar comparación"
                                : "Ver listas"}
                            </button>
                            <button
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    `¿Restaurar la lista anterior al aumento del ${change.percentage}%?`,
                                  )
                                )
                                  return;
                                setPrices({ ...change.beforePrices });
                                recordAudit(
                                  "Lista de precios restaurada",
                                  `Versión anterior al ${change.percentage}% · ${change.category}`,
                                );
                                setMessage(
                                  "Lista anterior restaurada para los cinco locales.",
                                );
                              }}
                              className="rounded bg-[#183a67] px-3 py-2 font-bold text-white"
                            >
                              Restaurar anterior
                            </button>
                          </div>
                        </div>
                        {expandedPriceChange === change.id && (
                          <div className="mt-4 overflow-auto rounded border">
                            <table className="w-full min-w-[680px] text-sm">
                              <thead className="bg-[#eef2f6]">
                                <tr>
                                  <th className="p-3 text-left">Producto</th>
                                  <th className="p-3 text-right">
                                    Lista anterior
                                  </th>
                                  <th className="p-3 text-right">
                                    Lista nueva
                                  </th>
                                  <th className="p-3 text-right">Cambio</th>
                                </tr>
                              </thead>
                              <tbody>
                                {PRODUCTS.map((product) => (
                                  <tr key={product.id} className="border-t">
                                    <td className="p-3 font-bold">
                                      {product.name}
                                    </td>
                                    <td className="p-3 text-right">
                                      {money.format(
                                        change.beforePrices[product.id],
                                      )}
                                    </td>
                                    <td className="p-3 text-right">
                                      {money.format(
                                        change.afterPrices[product.id],
                                      )}
                                    </td>
                                    <td className="p-3 text-right font-bold">
                                      {money.format(
                                        change.afterPrices[product.id] -
                                          change.beforePrices[product.id],
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="py-3 text-sm text-slate-500">
                      Todavía no se aplicaron aumentos.
                    </p>
                  )}
                </div>
              </div>
              <p className="mt-4 rounded border border-[#e7c26a] bg-[#fff5d8] p-4 text-sm">
                Prototipo local: el catálogo actualizado funciona durante esta
                sesión. La base de datos conservará versiones, vigencias y
                precios anteriores en producción.
              </p>
            </>
          ) : tab === "Usuarios" && user.role === "administracion" ? (
            <>
              <Heading
                k="ADMINISTRACIÓN · SEGURIDAD"
                h="Usuarios y permisos"
                p="Creá accesos, asigná cargos y locales, bloqueá usuarios y definí qué reportes puede consultar cada administrativo."
              />
              <p className="mb-5 rounded border border-[#e7c26a] bg-[#fff5d8] p-4 text-sm">
                Cada acceso será individual y se identificará por correo laboral. Administración, Betzi y Andrea quedan marcadas con doble factor obligatorio. La verificación real con Authenticator se activará junto con la autenticación segura y la base de datos; no se guardarán contraseñas reales en el navegador.
              </p>
              <div className="rounded-2xl border bg-white p-5">
                <h2 className="font-bold">Crear nuevo usuario</h2>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr_1.4fr_1fr_1fr_1.2fr_auto] xl:items-end">
                  <label className="text-sm font-bold">
                    Nombre
                    <input
                      value={newUserName}
                      onChange={(e) => setNewUserName(e.target.value)}
                      placeholder="Nombre y apellido"
                      className="mt-1 block w-full rounded border p-2 font-normal"
                    />
                  </label>
                  <label className="text-sm font-bold">
                    Correo laboral
                    <input
                      value={newUserEmail}
                      onChange={(e) => setNewUserEmail(e.target.value)}
                      type="email"
                      placeholder="nombre@lartisantaller.com"
                      className="mt-1 block w-full rounded border p-2 font-normal"
                    />
                  </label>
                  <label className="text-sm font-bold">
                    Cargo
                    <select
                      value={newUserRole}
                      onChange={(e) => setNewUserRole(e.target.value as Role)}
                      className="mt-1 block w-full rounded border p-2 font-normal"
                    >
                      <option value="vendedora">Vendedora</option>
                      <option value="supervisora">Supervisora</option>
                      <option value="administracion">Administración</option>
                    </select>
                  </label>
                  <label className="text-sm font-bold">
                    Local
                    <select
                      value={newUserSite}
                      onChange={(e) => setNewUserSite(e.target.value)}
                      disabled={newUserRole !== "vendedora"}
                      className="mt-1 block w-full rounded border p-2 font-normal disabled:bg-slate-100"
                    >
                      {SITES.map((local) => (
                        <option key={local}>{local}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-bold">
                    Contraseña temporal
                    <input
                      value={newUserPassword}
                      onChange={(e) => setNewUserPassword(e.target.value)}
                      type="password"
                      placeholder="Mínimo 10 caracteres"
                      className="mt-1 block w-full rounded border p-2 font-normal"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm font-bold xl:pb-3">
                    <input
                      type="checkbox"
                      checked={newUserMfaRequired || newUserRole === "administracion"}
                      disabled={newUserRole === "administracion"}
                      onChange={(e) => setNewUserMfaRequired(e.target.checked)}
                    />
                    Requiere doble factor
                  </label>
                  <button
                    onClick={createManagedUser}
                    className="rounded bg-[#183a67] px-5 py-2.5 font-bold text-white"
                  >
                    Crear usuario
                  </button>
                </div>
                {message && (
                  <p className="mt-3 rounded bg-[#eef5ef] p-3 text-sm">
                    {message}
                  </p>
                )}
              </div>
              <div className="mt-6 overflow-auto rounded-xl border bg-white">
                <div className="border-b p-5">
                  <b>Usuarios registrados</b>
                  <p className="mt-1 text-sm text-slate-500">
                    La cuenta principal de Administración está protegida contra
                    bloqueo accidental.
                  </p>
                </div>
                <table className="w-full min-w-[850px] text-sm">
                  <thead className="bg-[#eef2f6]">
                    <tr>
                      <th className="p-3 text-left">Usuario</th>
                      <th className="p-3 text-left">Correo laboral</th>
                      <th className="p-3 text-left">Cargo</th>
                      <th className="p-3 text-left">Local asignado</th>
                      <th className="p-3 text-center">Doble factor</th>
                      <th className="p-3 text-center">Estado</th>
                      <th className="p-3 text-center">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {managedUsers.map((profile) => (
                      <tr key={profile.id} className="border-t">
                        <td className="p-3">
                          <b>{profile.name}</b>
                          {profile.primary && (
                            <span className="ml-2 rounded bg-[#eef2f6] px-2 py-1 text-xs">
                              Cuenta principal
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          <input
                            value={profile.email}
                            type="email"
                            disabled={profile.primary}
                            onChange={(e) =>
                              updateManagedUser(profile.id, {
                                email: e.target.value.trim().toLowerCase(),
                              })
                            }
                            className="w-56 rounded border p-2 disabled:bg-slate-100"
                          />
                        </td>
                        <td className="p-3">
                          <select
                            value={profile.role}
                            disabled={profile.primary}
                            onChange={(e) => {
                              const role = e.target.value as Role;
                              updateManagedUser(profile.id, {
                                role,
                                location:
                                  role === "vendedora"
                                    ? profile.location || "Recoleta"
                                    : undefined,
                                reportPermissions:
                                  role === "administracion"
                                    ? profile.reportPermissions.length
                                      ? profile.reportPermissions
                                      : ["Resumen"]
                                    : [],
                                actionPermissions:
                                  defaultActionPermissions(role),
                                mfaRequired:
                                  role === "administracion"
                                    ? true
                                    : profile.mfaRequired,
                              });
                            }}
                            className="rounded border p-2 disabled:bg-slate-100"
                          >
                            <option value="vendedora">Vendedora</option>
                            <option value="supervisora">Supervisora</option>
                            <option value="administracion">
                              Administración
                            </option>
                          </select>
                        </td>
                        <td className="p-3">
                          {profile.role === "vendedora" ? (
                            <select
                              value={profile.location || "Recoleta"}
                              onChange={(e) =>
                                updateManagedUser(profile.id, {
                                  location: e.target.value,
                                })
                              }
                              className="rounded border p-2"
                            >
                              {SITES.map((local) => (
                                <option key={local}>{local}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-slate-500">
                              Todos los locales
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={profile.mfaRequired}
                              disabled={profile.primary || profile.name === "Andrea" || profile.name === "Betzi"}
                              onChange={(e) =>
                                updateManagedUser(profile.id, {
                                  mfaRequired: e.target.checked,
                                })
                              }
                            />
                            {profile.mfaRequired ? "Requerido" : "No requerido"}
                          </label>
                        </td>
                        <td className="p-3 text-center">
                          <span
                            className={
                              profile.active
                                ? "font-bold text-green-700"
                                : "font-bold text-red-700"
                            }
                          >
                            {profile.active ? "Habilitado" : "Bloqueado"}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          <button
                            disabled={profile.primary}
                            onClick={() => {
                              updateManagedUser(profile.id, {
                                active: !profile.active,
                              });
                              recordAudit(
                                profile.active
                                  ? "Usuario bloqueado"
                                  : "Usuario habilitado",
                                profile.name,
                              );
                            }}
                            className="rounded border px-3 py-2 font-bold disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {profile.active ? "Bloquear" : "Habilitar"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-6 space-y-4">
                <div>
                  <h2 className="font-bold">
                    Permisos de reportes administrativos
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Cada administrativo verá únicamente los reportes marcados en
                    su perfil.
                  </p>
                </div>
                {managedUsers
                  .filter((profile) => profile.role === "administracion")
                  .map((profile) => (
                    <div
                      key={profile.id}
                      className="rounded-xl border bg-white p-5"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <b>{profile.name}</b>
                        <span className="text-xs text-slate-500">
                          {profile.reportPermissions.length} reportes
                          habilitados
                        </span>
                      </div>
                      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {ADMIN_REPORTS.map((report) => {
                          const checked = profile.reportPermissions.includes(
                            report.id,
                          );
                          const last =
                            checked && profile.reportPermissions.length === 1;
                          return (
                            <label
                              key={report.id}
                              className="flex items-center gap-2 rounded bg-[#eef2f6] p-3 text-sm"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={profile.primary || last}
                                onChange={() =>
                                  updateManagedUser(profile.id, {
                                    reportPermissions: checked
                                      ? profile.reportPermissions.filter(
                                          (id) => id !== report.id,
                                        )
                                      : [
                                          ...profile.reportPermissions,
                                          report.id,
                                        ],
                                  })
                                }
                              />
                              {report.title}
                            </label>
                          );
                        })}
                      </div>
                      {profile.primary && (
                        <p className="mt-3 text-xs text-slate-500">
                          La cuenta principal conserva acceso completo.
                        </p>
                      )}
                    </div>
                  ))}
              </div>
              <div className="mt-6 space-y-4">
                <div>
                  <h2 className="font-bold">Permisos de acciones</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Definí qué puede realizar cada perfil, además de los
                    reportes que puede consultar.
                  </p>
                </div>
                {managedUsers.map((profile) => (
                  <div
                    key={profile.id}
                    className="rounded-xl border bg-white p-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <b>{profile.name}</b>
                      <span className="text-xs text-slate-500">
                        {profile.actionPermissions.length} acciones habilitadas
                      </span>
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {ACTION_PERMISSIONS.map((permission) => (
                        <label
                          key={permission.id}
                          className="flex items-center gap-2 rounded bg-[#eef2f6] p-3 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={profile.actionPermissions.includes(
                              permission.id,
                            )}
                            disabled={profile.primary}
                            onChange={() =>
                              updateManagedUser(profile.id, {
                                actionPermissions:
                                  profile.actionPermissions.includes(
                                    permission.id,
                                  )
                                    ? profile.actionPermissions.filter(
                                        (id) => id !== permission.id,
                                      )
                                    : [
                                        ...profile.actionPermissions,
                                        permission.id,
                                      ],
                              })
                            }
                          />
                          {permission.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : tab === "Horarios" && user.name === "Betzi" ? (
            <>
              <Heading
                k="BETZI · CONFIGURACIÓN DE PERSONAL"
                h="Horarios de empleados"
                p="Estos horarios serán la fuente de las alertas de llegada tarde y de los futuros reportes de fichaje."
              />
              <div className="overflow-auto rounded-xl border bg-white">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-[#eef2f6]">
                    <tr>
                      <th className="p-3 text-left">Empleado</th>
                      <th className="p-3 text-left">Local</th>
                      <th className="p-3">Entrada</th>
                      <th className="p-3">Salida</th>
                      <th className="p-3">Tolerancia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((schedule) => (
                      <tr key={schedule.id} className="border-t">
                        <td className="p-3 font-bold">{schedule.employee}</td>
                        <td className="p-3">{schedule.site}</td>
                        <td className="p-3 text-center">
                          <input
                            type="time"
                            value={schedule.startsAt}
                            onChange={(e) =>
                              setSchedules((items) =>
                                items.map((item) =>
                                  item.id === schedule.id
                                    ? { ...item, startsAt: e.target.value }
                                    : item,
                                ),
                              )
                            }
                            aria-label={`Horario de entrada de ${schedule.employee} ${schedule.site}`}
                            className="rounded border p-2"
                          />
                        </td>
                        <td className="p-3 text-center">
                          <input
                            type="time"
                            value={schedule.endsAt}
                            onChange={(e) =>
                              setSchedules((items) =>
                                items.map((item) =>
                                  item.id === schedule.id
                                    ? { ...item, endsAt: e.target.value }
                                    : item,
                                ),
                              )
                            }
                            aria-label={`Horario de salida de ${schedule.employee} ${schedule.site}`}
                            className="rounded border p-2"
                          />
                        </td>
                        <td className="p-3 text-center">
                          <label
                            className="sr-only"
                            htmlFor={`${schedule.id}-tolerance`}
                          >
                            Tolerancia en minutos
                          </label>
                          <input
                            id={`${schedule.id}-tolerance`}
                            type="number"
                            min="0"
                            max="120"
                            value={schedule.toleranceMinutes}
                            onChange={(e) =>
                              setSchedules((items) =>
                                items.map((item) =>
                                  item.id === schedule.id
                                    ? {
                                        ...item,
                                        toleranceMinutes: Number(
                                          e.target.value,
                                        ),
                                      }
                                    : item,
                                ),
                              )
                            }
                            className="w-20 rounded border p-2 text-center"
                          />{" "}
                          min
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 rounded bg-[#eef5ef] p-3 text-sm">
                En la versión definitiva, cada fila estará asociada a una
                persona real y el sistema comparará automáticamente el fichaje
                de entrada con este horario más su tolerancia.
              </p>
            </>
          ) : (
            <>
              <Heading
                k="ADMINISTRACIÓN"
                h="Panel central"
                p="Seguimiento consolidado de ventas, cierres, personal y stock."
              />
              <div className="mb-5 flex flex-wrap gap-2">
                {availableAdminReports.map((report) => (
                  <button
                    key={report.id}
                    onClick={() => setAdminReport(report.id)}
                    className={`rounded-full px-3 py-2 text-sm font-bold ${adminReport === report.id ? "bg-[#183a67] text-white" : "bg-white ring-1 ring-[#d9d4c9]"}`}
                  >
                    {report.title}
                  </button>
                ))}
              </div>
              <div className="rounded-2xl border bg-white p-5">
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
                  <label className="text-sm font-bold">
                    Desde
                    <input
                      type="date"
                      value={reportFrom}
                      onChange={(e) => setReportFrom(e.target.value)}
                      className="mt-1 block w-full rounded border p-2 font-normal"
                    />
                  </label>
                  <label className="text-sm font-bold">
                    Hasta
                    <input
                      type="date"
                      value={reportTo}
                      onChange={(e) => setReportTo(e.target.value)}
                      className="mt-1 block w-full rounded border p-2 font-normal"
                    />
                  </label>
                  <label className="text-sm font-bold">
                    Local
                    <select
                      value={reportSite}
                      onChange={(e) => setReportSite(e.target.value)}
                      className="mt-1 block w-full rounded border p-2 font-normal"
                    >
                      <option>Todos los locales</option>
                      {SITES.map((local) => (
                        <option key={local}>{local}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    onClick={() =>
                      setMessage(
                        `Reporte preparado: ${reportFrom} a ${reportTo}.`,
                      )
                    }
                    className="rounded bg-[#183a67] px-5 py-2.5 font-bold text-white"
                  >
                    Filtrar
                  </button>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  {hasDemoData
                    ? "Recoleta proviene de la copia de prueba; los demás locales aún se muestran como demostración."
                    : "Fuente validada: copia de prueba de Recoleta, hoja INGRESOS."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={exportAdminReport}
                    disabled={!can("exportar")}
                    className="rounded border px-3 py-2 text-sm font-bold disabled:opacity-40"
                  >
                    Exportar informe Excel
                  </button>
                  <button
                    onClick={() => window.print()}
                    disabled={!can("exportar")}
                    className="rounded border px-3 py-2 text-sm font-bold disabled:opacity-40"
                  >
                    Imprimir / Guardar PDF
                  </button>
                </div>
              </div>
              {adminReport === "Resumen" && (
                <>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl border bg-white p-5">
                      <p className="text-sm text-slate-500">Venta bruta</p>
                      <p className="mt-2 text-2xl font-bold">
                        {money.format(adminTotals.gross)}
                      </p>
                    </div>
                    <div className="rounded-xl border bg-white p-5">
                      <p className="text-sm text-slate-500">Venta neta</p>
                      <p className="mt-2 text-2xl font-bold">
                        {money.format(adminTotals.net)}
                      </p>
                    </div>
                    <div className="rounded-xl border bg-white p-5">
                      <p className="text-sm text-slate-500">Tickets</p>
                      <p className="mt-2 text-2xl font-bold">
                        {adminTotals.tickets}
                      </p>
                    </div>
                    <div className="rounded-xl border bg-white p-5">
                      <p className="text-sm text-slate-500">Ticket promedio</p>
                      <p className="mt-2 text-2xl font-bold">
                        {money.format(
                          adminTotals.tickets
                            ? Math.round(adminTotals.net / adminTotals.tickets)
                            : 0,
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_.7fr]">
                    <div className="overflow-auto rounded-xl border bg-white">
                      <div className="border-b p-5">
                        <b>Facturación por local</b>
                        <p className="mt-1 text-sm text-slate-500">
                          Resumen del período seleccionado.
                        </p>
                      </div>
                      <table className="w-full min-w-[700px] text-sm">
                        <thead className="bg-[#eef2f6]">
                          <tr>
                            <th className="p-3 text-left">Local</th>
                            <th className="p-3 text-right">Bruto</th>
                            <th className="p-3 text-right">Neto</th>
                            <th className="p-3 text-center">Tickets</th>
                            <th className="p-3 text-center">Caja</th>
                            <th className="p-3 text-left">Fuente</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminRows.map((row) => (
                            <tr key={row.site} className="border-t">
                              <td className="p-3 font-bold">{row.site}</td>
                              <td className="p-3 text-right">
                                {money.format(row.gross)}
                              </td>
                              <td className="p-3 text-right">
                                {money.format(row.net)}
                              </td>
                              <td className="p-3 text-center">{row.tickets}</td>
                              <td className="p-3 text-center">
                                <span
                                  className={
                                    row.status === "Cerrada"
                                      ? "font-bold text-green-700"
                                      : "font-bold text-amber-700"
                                  }
                                >
                                  {row.status}
                                </span>
                              </td>
                              <td className="p-3 text-xs text-slate-500">
                                {row.source}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="rounded-xl border bg-white p-5">
                      <b>Alertas operativas</b>
                      <div className="mt-4 space-y-3 text-sm">
                        <p className="rounded bg-[#fff5d8] p-3">
                          <b>2 cierres pendientes</b>
                          <br />
                          Recoleta y Maure requieren revisión.
                        </p>
                        <p className="rounded bg-[#fff1ec] p-3">
                          <b>Stock a controlar</b>
                          <br />
                          El conteo físico se completa desde Andrea.
                        </p>
                        <p className="rounded bg-[#eef2f6] p-3">
                          <b>Fichajes</b>
                          <br />
                          Las alertas de tardanza se activarán con los fichajes
                          persistentes.
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}
              {adminReport !== "Resumen" && (
                <div className="mt-6 rounded-xl border bg-white p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
                    <div>
                      <h2 className="text-xl font-bold">
                        {
                          ADMIN_REPORTS.find(
                            (report) => report.id === adminReport,
                          )?.title
                        }
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {
                          ADMIN_REPORTS.find(
                            (report) => report.id === adminReport,
                          )?.detail
                        }
                      </p>
                    </div>
                    <span className="rounded bg-[#eef2f6] px-3 py-1 text-xs font-bold">
                      {reportFrom} al {reportTo}
                    </span>
                  </div>
                  {adminReport === "Gerencia" && (
                    <div className="mt-5">
                      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded bg-[#183a67] p-4 text-white">
                          <p className="text-sm">Facturación neta</p>
                          <b className="mt-2 block text-2xl">
                            {money.format(adminTotals.net)}
                          </b>
                        </div>
                        <div className="rounded bg-[#eef5ef] p-4">
                          <p className="text-sm">Proyección de cierre</p>
                          <b className="mt-2 block text-2xl">
                            {money.format(Math.round(adminTotals.net * 1.12))}
                          </b>
                        </div>
                        <div className="rounded bg-[#eef2f6] p-4">
                          <p className="text-sm">Avance de metas</p>
                          <b className="mt-2 block text-2xl">89%</b>
                        </div>
                        <div className="rounded bg-[#fff5d8] p-4">
                          <p className="text-sm">Alertas críticas</p>
                          <b className="mt-2 block text-2xl">
                            {operationalAlerts.length}
                          </b>
                        </div>
                      </div>
                      <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
                        <div className="overflow-auto rounded border">
                          <table className="w-full min-w-[500px] text-sm">
                            <thead className="bg-[#eef2f6]">
                              <tr>
                                <th className="p-3 text-left">Local</th>
                                <th className="p-3 text-right">Venta neta</th>
                                <th className="p-3 text-right">Tickets</th>
                                <th className="p-3 text-right">Proyección</th>
                              </tr>
                            </thead>
                            <tbody>
                              {adminRows.map((row) => (
                                <tr key={row.site} className="border-t">
                                  <td className="p-3 font-bold">{row.site}</td>
                                  <td className="p-3 text-right">
                                    {money.format(row.net)}
                                  </td>
                                  <td className="p-3 text-right">
                                    {row.tickets}
                                  </td>
                                  <td className="p-3 text-right">
                                    {money.format(Math.round(row.net * 1.12))}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="rounded border p-4">
                          <b>Alertas operativas</b>
                          <div className="mt-3 space-y-2 text-sm">
                            {operationalAlerts.length ? (
                              operationalAlerts
                                .slice(0, 5)
                                .map((alert, index) => (
                                  <div
                                    key={`${alert.label}-${index}`}
                                    className={`rounded p-3 ${alert.tone}`}
                                  >
                                    <b>{alert.label}</b>
                                    <p className="mt-1">{alert.detail}</p>
                                  </div>
                                ))
                            ) : (
                              <p className="rounded bg-[#eef5ef] p-3">
                                Sin alertas operativas en esta sesión.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {adminReport === "Alertas" && (
                    <div className="mt-5">
                      <div className="grid gap-4 sm:grid-cols-3">
                        <div className="rounded bg-[#fff1ec] p-4">
                          <p className="text-sm">Alertas activas</p>
                          <b className="mt-2 block text-2xl">{operationalAlerts.length}</b>
                        </div>
                        <div className="rounded bg-[#fff5d8] p-4">
                          <p className="text-sm">Stock crítico</p>
                          <b className="mt-2 block text-2xl">{lowStockAlerts.length}</b>
                        </div>
                        <div className="rounded bg-[#e8f1fb] p-4">
                          <p className="text-sm">Recepciones pendientes</p>
                          <b className="mt-2 block text-2xl">
                            {stockRequests.filter((request) => request.status === "Despachado" || request.status === "Despachado parcial").length}
                          </b>
                        </div>
                      </div>
                      <div className="mt-4 space-y-2">
                        {operationalAlerts.length ? operationalAlerts.map((alert, index) => (
                          <div key={`${alert.label}-${index}`} className={`rounded border p-4 ${alert.tone}`}>
                            <b>{alert.label}</b>
                            <p className="mt-1 text-sm">{alert.detail}</p>
                          </div>
                        )) : (
                          <p className="rounded bg-[#eef5ef] p-4 text-sm">No hay alertas operativas activas.</p>
                        )}
                      </div>
                    </div>
                  )}
                  {adminReport === "Ventas" && (
                    <div className="mt-5 grid gap-4 md:grid-cols-3">
                      <div className="rounded bg-[#eef2f6] p-4">
                        <p className="text-sm">Facturación</p>
                        <b className="text-xl">
                          {money.format(adminTotals.gross)}
                        </b>
                      </div>
                      <div className="rounded bg-[#eef2f6] p-4">
                        <p className="text-sm">Tickets</p>
                        <b className="text-xl">{adminTotals.tickets}</b>
                      </div>
                      <div className="rounded bg-[#eef2f6] p-4">
                        <p className="text-sm">Promedio por ticket</p>
                        <b className="text-xl">
                          {money.format(
                            adminTotals.tickets
                              ? Math.round(
                                  adminTotals.net / adminTotals.tickets,
                                )
                              : 0,
                          )}
                        </b>
                      </div>
                      <p className="md:col-span-3 text-sm text-slate-500">
                        Cuando los cinco locales estén vinculados, este reporte
                        sumará comparación contra período anterior, día de la
                        semana, franja horaria y categoría de producto.
                      </p>
                    </div>
                  )}
                  {adminReport === "DetalleVentas" && (
                    <div className="mt-5 overflow-auto rounded border">
                      <table className="w-full min-w-[800px] text-sm">
                        <thead className="bg-[#eef2f6]">
                          <tr>
                            <th className="p-3 text-left">Fecha</th>
                            <th className="p-3 text-left">Local</th>
                            <th className="p-3 text-left">Cliente</th>
                            <th className="p-3 text-left">Comprobante</th>
                            <th className="p-3 text-left">Cobro</th>
                            <th className="p-3 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sales.filter(
                            (sale) =>
                              reportSite === "Todos los locales" ||
                              sale.site === reportSite,
                          ).length ? (
                            sales
                              .filter(
                                (sale) =>
                                  reportSite === "Todos los locales" ||
                                  sale.site === reportSite,
                              )
                              .map((sale) => (
                                <tr key={sale.id} className="border-t">
                                  <td className="p-3">{sale.createdAt}</td>
                                  <td className="p-3">{sale.site}</td>
                                  <td className="p-3">{sale.customer}</td>
                                  <td className="p-3">{sale.invoiceType}</td>
                                  <td className="p-3">{sale.method}</td>
                                  <td className="p-3 text-right font-bold">
                                    {money.format(sale.net)}
                                  </td>
                                </tr>
                              ))
                          ) : (
                            <tr>
                              <td colSpan={6} className="p-4 text-slate-500">
                                No hay ventas de esta sesión para el local
                                seleccionado.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {adminReport === "Rentabilidad" && (
                    <div className="mt-5 grid gap-4 md:grid-cols-3">
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Margen bruto</b>
                        <p className="mt-2 text-sm">
                          Venta neta menos costo del producto vendido.
                        </p>
                      </div>
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Contribución</b>
                        <p className="mt-2 text-sm">
                          Productos y categorías que más aportan al resultado.
                        </p>
                      </div>
                      <div className="rounded bg-[#fff5d8] p-4">
                        <b>Dato requerido</b>
                        <p className="mt-2 text-sm">
                          Falta cargar el costo vigente de cada producto.
                        </p>
                      </div>
                    </div>
                  )}
                  {adminReport === "Productos" && (
                    <div className="mt-5 grid gap-4 md:grid-cols-3">
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Ranking</b>
                        <p className="mt-2 text-sm">
                          Más y menos vendidos por unidades y facturación.
                        </p>
                      </div>
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Categorías</b>
                        <p className="mt-2 text-sm">
                          Participación de pastas, salsas, pizzas, postres y
                          demás grupos.
                        </p>
                      </div>
                      <div className="rounded bg-[#fff5d8] p-4">
                        <b>Sin movimiento</b>
                        <p className="mt-2 text-sm">
                          Productos sin ventas dentro del período elegido.
                        </p>
                      </div>
                    </div>
                  )}
                  {adminReport === "Evolucion" && (
                    <>
                      <div className="mt-5 grid gap-4 md:grid-cols-4">
                        <div className="rounded bg-[#eef2f6] p-4">
                          <b>Día anterior</b>
                          <p className="mt-2 text-sm">
                            Variación de venta y tickets.
                          </p>
                        </div>
                        <div className="rounded bg-[#eef2f6] p-4">
                          <b>Semana anterior</b>
                          <p className="mt-2 text-sm">
                            Comparación de días equivalentes.
                          </p>
                        </div>
                        <div className="rounded bg-[#eef2f6] p-4">
                          <b>Mes anterior</b>
                          <p className="mt-2 text-sm">Crecimiento por local.</p>
                        </div>
                        <div className="rounded bg-[#fff5d8] p-4">
                          <b>Proyección</b>
                          <p className="mt-2 text-sm">
                            Estimación del cierre mensual.
                          </p>
                        </div>
                      </div>
                      <div className="mt-5 overflow-auto rounded-xl border">
                        <div className="border-b bg-[#fff5d8] p-4">
                          <b>Proyección mensual vs. mes anterior</b>
                          <p className="mt-1 text-xs text-slate-600">
                            Los valores actuales son la referencia compartida;
                            luego se calcularán automáticamente con los datos de
                            cada local.
                          </p>
                        </div>
                        <table className="w-full min-w-[820px] text-sm">
                          <thead className="bg-[#eef2f6]">
                            <tr>
                              <th className="p-3 text-left">Indicador</th>
                              {[
                                "Congreso",
                                "Recoleta",
                                "Villa Mitre",
                                "Maure",
                                "Novo Pacheco",
                              ].map((local) => (
                                <th key={local} className="p-3 text-right">
                                  {local}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="border-t">
                              <td className="p-3 font-bold">Proyección</td>
                              {[
                                34823706.92,
                                29070953.46,
                                28606340.96,
                                0,
                                null,
                              ].map((value, index) => (
                                <td
                                  key={index}
                                  className="p-3 text-right font-bold"
                                >
                                  {value === null
                                    ? "Pendiente"
                                    : money2.format(value)}
                                </td>
                              ))}
                            </tr>
                            <tr className="border-t bg-[#eef5ef]">
                              <td className="p-3 font-bold">Vs. mes pasado</td>
                              {[13.5, 19.4, 16.4, 0, null].map(
                                (value, index) => (
                                  <td
                                    key={index}
                                    className={`p-3 text-right font-bold ${value !== null && value > 0 ? "text-green-700" : "text-slate-600"}`}
                                  >
                                    {value === null
                                      ? "Pendiente"
                                      : `${value.toFixed(1)}%`}
                                  </td>
                                ),
                              )}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  {adminReport === "VendidoCobrado" && (
                    <div className="mt-5 overflow-auto rounded-xl border">
                      <div className="border-b bg-[#eef2f6] p-4">
                        <b>Informe mensual por local</b>
                        <p className="mt-1 text-xs text-slate-600">
                          Compara el total vendido con el total cobrado. Maure y
                          Novo Pacheco se completarán al validar sus fuentes.
                        </p>
                      </div>
                      <table className="w-full min-w-[980px] text-sm">
                        <thead className="bg-[#183a67] text-white">
                          <tr>
                            <th className="p-3 text-left">Fecha</th>
                            <th className="p-3 text-left">Concepto</th>
                            <th className="p-3 text-right">Congreso</th>
                            <th className="p-3 text-right">Recoleta</th>
                            <th className="p-3 text-right">Villa Mitre</th>
                            <th className="p-3 text-right">Maure</th>
                            <th className="p-3 text-right">Novo Pacheco</th>
                          </tr>
                        </thead>
                        <tbody>
                          {SOLD_COLLECTED_REFERENCE.map(
                            ([month, concept, congreso, recoleta, villa]) => (
                              <tr
                                key={`${month}-${concept}`}
                                className={`border-t ${concept === "Cobrado" ? "bg-[#eef5ef]" : "bg-white"}`}
                              >
                                <td className="p-3 capitalize">{month}</td>
                                <td className="p-3 font-bold">{concept}</td>
                                <td className="p-3 text-right">
                                  {money2.format(congreso)}
                                </td>
                                <td className="p-3 text-right">
                                  {money2.format(recoleta)}
                                </td>
                                <td className="p-3 text-right">
                                  {money2.format(villa)}
                                </td>
                                <td className="p-3 text-right text-slate-500">
                                  Pendiente
                                </td>
                                <td className="p-3 text-right text-slate-500">
                                  Pendiente
                                </td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                      <p className="border-t p-3 text-xs text-slate-500">
                        Valores de referencia tomados del cuadro compartido. En
                        la versión conectada se podrá elegir año, rango y
                        concepto.
                      </p>
                    </div>
                  )}
                  {adminReport === "Pagos" && (
                    <div className="mt-5 overflow-auto">
                      <table className="w-full min-w-[580px] text-sm">
                        <thead className="bg-[#eef2f6]">
                          <tr>
                            <th className="p-3 text-left">Medio</th>
                            <th className="p-3 text-right">Recoleta · 25/08</th>
                            <th className="p-3 text-left">Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            ["Efectivo", 50840],
                            ["Tarjeta", 328380],
                            ["Open Pay", 54400],
                            ["Mercado Pago / QR", 207600],
                            ["Banco Provincia", 218980],
                            ["Pedidos Ya efectivo", 50200],
                          ].map(([method, amount]) => (
                            <tr key={String(method)} className="border-t">
                              <td className="p-3">{method}</td>
                              <td className="p-3 text-right font-bold">
                                {money.format(Number(amount))}
                              </td>
                              <td className="p-3 text-green-700">
                                Validado en copia
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="mt-3 text-xs text-slate-500">
                        Estos importes corresponden al cierre de Recoleta del
                        25/08; los medios dependen de las columnas específicas
                        de cada local.
                      </p>
                    </div>
                  )}
                  {adminReport === "Cajas" && (
                    <div className="mt-5 grid gap-4 md:grid-cols-3">
                      <div className="rounded bg-[#fff5d8] p-4">
                        <b>Cierres pendientes</b>
                        <p className="mt-2 text-2xl font-bold">2</p>
                        <p className="text-sm">Recoleta y Maure</p>
                      </div>
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Control requerido</b>
                        <p className="mt-2 text-sm">
                          Diferencia, total físico, gastos, retiros y sobre.
                        </p>
                      </div>
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Seguimiento</b>
                        <p className="mt-2 text-sm">
                          Fecha, responsable y estado de control.
                        </p>
                      </div>
                    </div>
                  )}
                  {adminReport === "CajaMayor" && (
                    <div className="mt-5 grid gap-4 lg:grid-cols-[.8fr_1.2fr]">
                      <div className="rounded bg-[#fff5d8] p-4">
                        <b>Disponible en Caja Mayor</b>
                        <p className="mt-2 text-2xl font-bold">
                          {money.format(
                            envelopeRecords.reduce(
                              (total, record) =>
                                total +
                                (record.amount - record.withdrawnAmount),
                              0,
                            ),
                          )}
                        </p>
                        <label className="mt-4 block text-sm font-bold">
                          Retiro de Oscar
                          <input
                            type="number"
                            min="0"
                            value={oscarWithdrawal || ""}
                            onChange={(event) =>
                              setOscarWithdrawal(Number(event.target.value))
                            }
                            className="mt-1 w-full rounded border bg-white p-2 font-normal"
                          />
                        </label>
                        <button
                          onClick={withdrawEnvelopes}
                          className="mt-2 w-full rounded bg-[#183a67] py-2 font-bold text-white"
                        >
                          Registrar retiro
                        </button>
                      </div>
                      <div className="overflow-auto rounded border">
                        <table className="w-full min-w-[540px] text-sm">
                          <thead className="bg-[#eef2f6]">
                            <tr>
                              <th className="p-3 text-left">Local</th>
                              <th className="p-3 text-right">Sobre</th>
                              <th className="p-3 text-right">Retirado</th>
                              <th className="p-3 text-right">Disponible</th>
                              <th className="p-3 text-left">Estado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {envelopeRecords.length ? (
                              envelopeRecords.map((record) => (
                                <tr key={record.id} className="border-t">
                                  <td className="p-3 font-bold">
                                    {record.site}
                                  </td>
                                  <td className="p-3 text-right">
                                    {money.format(record.amount)}
                                  </td>
                                  <td className="p-3 text-right">
                                    {money.format(record.withdrawnAmount)}
                                  </td>
                                  <td className="p-3 text-right">
                                    {money.format(
                                      record.amount - record.withdrawnAmount,
                                    )}
                                  </td>
                                  <td className="p-3">{record.status}</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={5} className="p-4 text-slate-500">
                                  Los sobres se cargarán al confirmar cierres
                                  con efectivo.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {adminReport === "Bancos" && (
                    <div className="mt-5 grid gap-4 md:grid-cols-3">
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Declarado</b>
                        <p className="mt-2 text-sm">
                          Tarjetas, QR, transferencias y plataformas informadas
                          por caja.
                        </p>
                      </div>
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Acreditado</b>
                        <p className="mt-2 text-sm">
                          Importe recibido, fecha, comisión y plazo de
                          liquidación.
                        </p>
                      </div>
                      <div className="rounded bg-[#fff5d8] p-4">
                        <b>Conciliación</b>
                        <p className="mt-2 text-sm">
                          Pendientes, contracargos y diferencias por entidad.
                        </p>
                      </div>
                    </div>
                  )}
                  {adminReport === "Ajustes" && (
                    <div className="mt-5 grid gap-4 md:grid-cols-3">
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Descuentos</b>
                        <p className="mt-2 text-sm">
                          Por producto y globales, con responsable.
                        </p>
                      </div>
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Anulaciones</b>
                        <p className="mt-2 text-sm">
                          Venta original, motivo, hora y quien anuló.
                        </p>
                      </div>
                      <div className="rounded bg-[#fff5d8] p-4">
                        <b>Control</b>
                        <p className="mt-2 text-sm">
                          Alertar si supera un porcentaje definido por local.
                        </p>
                      </div>
                    </div>
                  )}
                  {adminReport === "Egresos" && (
                    <div className="mt-5">
                      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded bg-[#183a67] p-4 text-white">
                          <p className="text-sm">Resultado operativo</p>
                          <b className="mt-2 block text-2xl">
                            {money.format(adminTotals.net - totalExpenses - totalReturns)}
                          </b>
                          <p className="mt-1 text-xs">Venta neta - egresos - devoluciones</p>
                        </div>
                        <div className="rounded bg-[#fff5d8] p-4">
                          <p className="text-sm">Total egresos</p>
                          <b className="mt-2 block text-2xl">
                            {money.format(totalExpenses)}
                          </b>
                        </div>
                        <div className="rounded bg-[#fff1ec] p-4">
                          <p className="text-sm">Devoluciones</p>
                          <b className="mt-2 block text-2xl">
                            {money.format(totalReturns)}
                          </b>
                        </div>
                        <div className="rounded bg-[#eef2f6] p-4">
                          <p className="text-sm">Comprobantes cargados</p>
                          <b className="mt-2 block text-2xl">
                            {
                              expensesLog.filter(
                                (expense) => expense.receiptName,
                              ).length
                            }
                          </b>
                        </div>
                        <div className="rounded bg-[#fff1ec] p-4">
                          <p className="text-sm">Sin comprobante</p>
                          <b className="mt-2 block text-2xl">
                            {
                              expensesLog.filter(
                                (expense) => !expense.receiptName,
                              ).length
                            }
                          </b>
                        </div>
                      </div>
                      <div className="mt-4 overflow-auto rounded border">
                        <table className="w-full min-w-[720px] text-sm">
                          <thead className="bg-[#eef2f6]">
                            <tr>
                              <th className="p-3 text-left">Local</th>
                              <th className="p-3 text-left">Categoría</th>
                              <th className="p-3 text-left">Detalle</th>
                              <th className="p-3 text-right">Importe</th>
                              <th className="p-3 text-left">Responsable</th>
                              <th className="p-3 text-left">Comprobante</th>
                            </tr>
                          </thead>
                          <tbody>
                            {expensesLog.length ? (
                              expensesLog.map((expense) => (
                                <tr key={expense.id} className="border-t">
                                  <td className="p-3 font-bold">
                                    {expense.site}
                                  </td>
                                  <td className="p-3">{expense.category}</td>
                                  <td className="p-3">{expense.detail}</td>
                                  <td className="p-3 text-right">
                                    {money.format(expense.amount)}
                                  </td>
                                  <td className="p-3">{expense.createdBy}</td>
                                  <td className="p-3">
                                    {expense.receiptName || "Pendiente"}
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={6} className="p-4 text-slate-500">
                                  Todavía no hay egresos registrados.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {adminReport === "Stock" && (
                    <div className="mt-5 grid gap-4 md:grid-cols-3">
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Conteo físico</b>
                        <p className="mt-2 text-sm">
                          Comparativo entre stock teórico y real cargado por
                          Andrea.
                        </p>
                      </div>
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Movimientos</b>
                        <p className="mt-2 text-sm">
                          Ingresos desde Central, ventas, ajustes y
                          transferencias excepcionales.
                        </p>
                      </div>
                      <div className="rounded bg-[#fff5d8] p-4">
                        <b>Mínimos</b>
                        <p className="mt-2 text-sm">
                          Listado de productos a reponer por local.
                        </p>
                      </div>
                    </div>
                  )}
                  {adminReport === "Reposicion" && (
                    <div className="mt-5 grid gap-4 lg:grid-cols-[.8fr_1.2fr]">
                      <div className="rounded bg-[#fff5d8] p-4">
                        <b>Control de reposición</b>
                        <p className="mt-2 text-sm">
                          Se priorizan productos en mínimo o sin cobertura
                          suficiente para la próxima entrega.
                        </p>
                        <p className="mt-4 text-2xl font-bold">
                          {
                            PRODUCTS.filter((product) =>
                              SITES.some(
                                (local) => stock[local][product.id] <= 8,
                              ),
                            ).length
                          }
                        </p>
                        <p className="text-sm">productos a revisar</p>
                      </div>
                      <div className="overflow-auto rounded border">
                        <table className="w-full min-w-[520px] text-sm">
                          <thead className="bg-[#eef2f6]">
                            <tr>
                              <th className="p-3 text-left">Producto</th>
                              <th className="p-3 text-left">Local más bajo</th>
                              <th className="p-3 text-center">Stock</th>
                              <th className="p-3 text-left">Acción</th>
                            </tr>
                          </thead>
                          <tbody>
                            {PRODUCTS.filter((product) =>
                              SITES.some(
                                (local) => stock[local][product.id] <= 8,
                              ),
                            )
                              .slice(0, 8)
                              .map((product) => {
                                const lowestSite = SITES.reduce(
                                  (lowest, local) =>
                                    stock[local][product.id] <
                                    stock[lowest][product.id]
                                      ? local
                                      : lowest,
                                );
                                return (
                                  <tr key={product.id} className="border-t">
                                    <td className="p-3 font-bold">
                                      {product.name}
                                    </td>
                                    <td className="p-3">{lowestSite}</td>
                                    <td className="p-3 text-center font-bold text-[#ec3a35]">
                                      {stock[lowestSite][product.id]}
                                    </td>
                                    <td className="p-3">
                                      Sugerir reposición a Central
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {adminReport === "PedidosCentral" && (
                    <div className="mt-5 grid gap-4 md:grid-cols-3">
                      {[
                        ["Pendientes", "Pendiente", "bg-[#fff5d8]"],
                        ["En preparación", "En preparación", "bg-[#eef2f6]"],
                        ["Despachados", "Despachado", "bg-[#eef5ef]"],
                      ].map(([label, status, color]) => (
                        <div key={status} className={`rounded p-4 ${color}`}>
                          <b>{label}</b>
                          <p className="mt-2 text-2xl font-bold">
                            {
                              stockRequests.filter(
                                (request) => request.status === status,
                              ).length
                            }
                          </p>
                          <p className="text-sm">solicitudes</p>
                        </div>
                      ))}
                      <div className="md:col-span-3 overflow-auto rounded border">
                        <table className="w-full min-w-[650px] text-sm">
                          <thead className="bg-[#eef2f6]">
                            <tr>
                              <th className="p-3 text-left">Local</th>
                              <th className="p-3 text-left">Solicitó</th>
                              <th className="p-3 text-center">Unidades</th>
                              <th className="p-3 text-left">Estado</th>
                              <th className="p-3 text-left">Fecha</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stockRequests.length ? (
                              stockRequests.map((request) => (
                                <tr key={request.id} className="border-t">
                                  <td className="p-3 font-bold">
                                    {request.site}
                                  </td>
                                  <td className="p-3">{request.requestedBy}</td>
                                  <td className="p-3 text-center">
                                    {request.lines.reduce(
                                      (total, line) => total + line.quantity,
                                      0,
                                    )}
                                  </td>
                                  <td className="p-3">{request.status}</td>
                                  <td className="p-3">{request.requestedAt}</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={5} className="p-4 text-slate-500">
                                  Sin solicitudes en esta sesión.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {adminReport === "Objetivos" && (
                    <div className="mt-5 overflow-auto rounded border">
                      <table className="w-full min-w-[700px] text-sm">
                        <thead className="bg-[#eef2f6]">
                          <tr>
                            <th className="p-3 text-left">Local</th>
                            <th className="p-3 text-right">Meta mensual</th>
                            <th className="p-3 text-right">Venta actual</th>
                            <th className="p-3 text-right">Avance</th>
                            <th className="p-3 text-right">Faltante</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ADMIN_DEMO_ROWS.map((row) => {
                            const target = Math.round(row.net * 1.12);
                            return (
                              <tr key={row.site} className="border-t">
                                <td className="p-3 font-bold">{row.site}</td>
                                <td className="p-3 text-right">
                                  {money.format(target)}
                                </td>
                                <td className="p-3 text-right">
                                  {money.format(row.net)}
                                </td>
                                <td className="p-3 text-right font-bold text-green-700">
                                  {Math.round((row.net / target) * 100)}%
                                </td>
                                <td className="p-3 text-right">
                                  {money.format(target - row.net)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <p className="border-t p-3 text-xs text-slate-500">
                        Metas de demostración. En Administración se configurará
                        una meta mensual real por local.
                      </p>
                    </div>
                  )}
                  {adminReport === "HorariosVenta" && (
                    <div className="mt-5">
                      <div className="flex flex-wrap items-end justify-between gap-3 rounded bg-[#eef2f6] p-4">
                        <div>
                          <b>Intervalo horario</b>
                          <p className="mt-1 text-sm text-slate-600">
                            El rango de fechas y local se toma del filtro
                            superior.
                          </p>
                        </div>
                        <label className="text-sm font-bold">
                          Agrupar cada
                          <select
                            value={hourInterval}
                            onChange={(event) =>
                              setHourInterval(Number(event.target.value))
                            }
                            className="ml-2 rounded border bg-white p-2 font-normal"
                          >
                            <option value={1}>1 hora</option>
                            <option value={2}>2 horas</option>
                            <option value={3}>3 horas</option>
                          </select>
                        </label>
                      </div>
                      <div className="mt-4 grid gap-4 sm:grid-cols-3">
                        <div className="rounded bg-[#fff5d8] p-4">
                          <p className="text-sm">Venta del rango</p>
                          <b className="mt-2 block text-2xl">
                            {money.format(
                              hourlySales.reduce(
                                (total, row) => total + row.net,
                                0,
                              ),
                            )}
                          </b>
                        </div>
                        <div className="rounded bg-[#eef2f6] p-4">
                          <p className="text-sm">Tickets</p>
                          <b className="mt-2 block text-2xl">
                            {hourlySales.reduce(
                              (total, row) => total + row.tickets,
                              0,
                            )}
                          </b>
                        </div>
                        <div className="rounded bg-[#eef5ef] p-4">
                          <p className="text-sm">Mejor intervalo</p>
                          <b className="mt-2 block text-lg">
                            {[...hourlySales].sort((a, b) => b.net - a.net)[0]
                              ?.label || "—"}
                          </b>
                        </div>
                      </div>
                      <div className="mt-4 overflow-auto rounded border">
                        <table className="w-full min-w-[560px] text-sm">
                          <thead className="bg-[#183a67] text-white">
                            <tr>
                              <th className="p-3 text-left">Intervalo</th>
                              <th className="p-3 text-right">Ventas</th>
                              <th className="p-3 text-right">Tickets</th>
                              <th className="p-3 text-right">
                                Ticket promedio
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {hourlySales.map((row) => (
                              <tr key={row.label} className="border-t">
                                <td className="p-3 font-bold">{row.label}</td>
                                <td className="p-3 text-right">
                                  {money.format(row.net)}
                                </td>
                                <td className="p-3 text-right">
                                  {row.tickets}
                                </td>
                                <td className="p-3 text-right">
                                  {money.format(
                                    row.tickets
                                      ? Math.round(row.net / row.tickets)
                                      : 0,
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="mt-3 text-xs text-slate-500">
                        Las ventas realizadas desde el punto de venta ya guardan
                        fecha y hora. Con la base de datos conectada, este
                        reporte incluirá el historial completo de los cinco
                        locales.
                      </p>
                    </div>
                  )}
                  {adminReport === "Personal" && (
                    <div className="mt-5 grid gap-4 md:grid-cols-3">
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Asistencia</b>
                        <p className="mt-2 text-sm">
                          Entradas, salidas y horas trabajadas por empleado.
                        </p>
                      </div>
                      <div className="rounded bg-[#fff5d8] p-4">
                        <b>Tardanzas</b>
                        <p className="mt-2 text-sm">
                          Se calcularán con los horarios y tolerancias de Betzi.
                        </p>
                      </div>
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Ausencias</b>
                        <p className="mt-2 text-sm">
                          Días sin fichaje y excepciones justificadas.
                        </p>
                      </div>
                    </div>
                  )}
                  {adminReport === "Clientes" && (
                    <div className="mt-5 grid gap-4 md:grid-cols-3">
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Base activa</b>
                        <p className="mt-2 text-sm">
                          Clientes con consentimiento de contacto.
                        </p>
                      </div>
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Recurrencia</b>
                        <p className="mt-2 text-sm">
                          Frecuencia de compra, última visita y ticket promedio.
                        </p>
                      </div>
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Campañas</b>
                        <p className="mt-2 text-sm">
                          Segmentos para promociones sin exponer datos
                          innecesarios.
                        </p>
                      </div>
                    </div>
                  )}
                  {adminReport === "Promociones" && (
                    <div className="mt-5 grid gap-4 md:grid-cols-3">
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Uso</b>
                        <p className="mt-2 text-sm">
                          Cantidad de operaciones por promoción o beneficio.
                        </p>
                      </div>
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Resultado</b>
                        <p className="mt-2 text-sm">
                          Venta generada, descuento aplicado y ticket promedio.
                        </p>
                      </div>
                      <div className="rounded bg-[#fff5d8] p-4">
                        <b>Rentabilidad</b>
                        <p className="mt-2 text-sm">
                          Margen posterior al beneficio, disponible al cargar
                          costos.
                        </p>
                      </div>
                    </div>
                  )}
                  {adminReport === "Calidad" && (
                    <div className="mt-5 grid gap-4 md:grid-cols-3">
                      <div className="rounded bg-[#fff5d8] p-4">
                        <b>Registros pendientes</b>
                        <p className="mt-2 text-sm">
                          Cierres incompletos, fechas sin carga y controles
                          pendientes.
                        </p>
                      </div>
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Consistencia</b>
                        <p className="mt-2 text-sm">
                          Duplicados y diferencias entre pagos, total vendido y
                          efectivo físico.
                        </p>
                      </div>
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Integraciones</b>
                        <p className="mt-2 text-sm">
                          Columnas modificadas, errores de Sheets y reintentos
                          de sincronización.
                        </p>
                      </div>
                    </div>
                  )}
                  {adminReport === "Fiscal" && (
                    <div className="mt-5 grid gap-4 md:grid-cols-3">
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Comprobantes</b>
                        <p className="mt-2 text-sm">
                          Facturas, notas de crédito y comprobantes internos por
                          local.
                        </p>
                      </div>
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Conciliación</b>
                        <p className="mt-2 text-sm">
                          Operaciones del sistema frente a comprobantes fiscales
                          emitidos.
                        </p>
                      </div>
                      <div className="rounded bg-[#fff5d8] p-4">
                        <b>Última etapa</b>
                        <p className="mt-2 text-sm">
                          Se habilitará al definir CUIT, puntos de venta e
                          integración ARCA.
                        </p>
                      </div>
                    </div>
                  )}
                  {adminReport === "Auditoria" && (
                    <div className="mt-5">
                      <p className="text-sm text-slate-500">
                        El historial conservará usuario, local, fecha, acción y
                        detalle. Ventas anuladas y ajustes nunca se eliminan.
                      </p>
                      <div className="mt-3 divide-y">
                        {audit.length ? (
                          audit.slice(0, 5).map((event) => (
                            <p key={event.id} className="py-3 text-sm">
                              <b>{event.action}</b> · {event.site} · {event.at}
                              <br />
                              <span className="text-slate-500">
                                {event.detail}
                              </span>
                            </p>
                          ))
                        ) : (
                          <p className="py-4 text-sm text-slate-500">
                            Todavía no hay operaciones de esta sesión.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  {adminReport === "Incidencias" && (
                    <div className="mt-5 overflow-auto rounded border">
                      <table className="w-full min-w-[700px] text-sm">
                        <thead className="bg-[#eef2f6]">
                          <tr>
                            <th className="p-3 text-left">Local</th>
                            <th className="p-3 text-left">Tipo</th>
                            <th className="p-3 text-left">Detalle</th>
                            <th className="p-3 text-left">Informó</th>
                            <th className="p-3 text-center">Estado</th>
                            <th className="p-3 text-center">Gestión</th>
                          </tr>
                        </thead>
                        <tbody>
                          {incidents.length ? (
                            incidents.map((incident) => (
                              <tr key={incident.id} className="border-t">
                                <td className="p-3 font-bold">
                                  {incident.site}
                                </td>
                                <td className="p-3">{incident.type}</td>
                                <td className="p-3">{incident.detail}</td>
                                <td className="p-3">{incident.createdBy}</td>
                                <td className="p-3 text-center">
                                  {incident.status}
                                </td>
                                <td className="p-3 text-center">
                                  <select
                                    value={incident.status}
                                    onChange={(event) =>
                                      setIncidents((items) =>
                                        items.map((item) =>
                                          item.id === incident.id
                                            ? {
                                                ...item,
                                                status: event.target
                                                  .value as Incident["status"],
                                              }
                                            : item,
                                        ),
                                      )
                                    }
                                    className="rounded border p-2"
                                  >
                                    <option>Abierta</option>
                                    <option>En revisión</option>
                                    <option>Resuelta</option>
                                  </select>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={6} className="p-4 text-slate-500">
                                No hay incidencias registradas.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
              {adminReport === "Resumen" && (
                <>
                  <div className="mt-6 grid gap-4 md:grid-cols-3">
                    <div className="rounded-xl border bg-white p-5">
                      <b>Fichajes y horarios</b>
                      <p className="mt-2 text-sm">
                        El futuro reporte filtrará por fecha, empleado y local,
                        usando los horarios configurados por Betzi.
                      </p>
                    </div>
                    <div className="rounded-xl border bg-white p-5">
                      <b>Cierres y auditoría</b>
                      <p className="mt-2 text-sm">
                        Cierres confirmados en esta sesión:{" "}
                        <b>{closed ? 1 : 0}</b>. Las anulaciones se conservan en
                        el historial.
                      </p>
                    </div>
                    <div className="rounded-xl border bg-white p-5">
                      <b>Drive y respaldos</b>
                      <p className="mt-2 text-sm">
                        El resumen se generará al cierre.
                      </p>
                      <button
                        onClick={() =>
                          setDrive(
                            `Resumen de ${site} preparado localmente. Cuando definamos la carpeta Drive, se subirá automáticamente.`,
                          )
                        }
                        className="mt-3 rounded bg-[#183a67] px-3 py-2 text-sm font-bold text-white"
                      >
                        Preparar resumen
                      </button>
                      {drive && (
                        <p className="mt-3 text-sm text-green-700">{drive}</p>
                      )}
                    </div>
                  </div>
                  <div className="mt-6 rounded-xl border bg-white p-5">
                    <b>Publicar novedad para vendedoras</b>
                    <div className="mt-3 grid gap-3 md:grid-cols-[1fr_2fr_auto]">
                      <input
                        value={newGuideTitle}
                        onChange={(e) => setNewGuideTitle(e.target.value)}
                        placeholder="Título del cambio"
                        className="rounded border p-2"
                      />
                      <input
                        value={newGuideDetail}
                        onChange={(e) => setNewGuideDetail(e.target.value)}
                        placeholder="Explicación breve para la guía"
                        className="rounded border p-2"
                      />
                      <button
                        onClick={() => {
                          if (!newGuideTitle.trim() || !newGuideDetail.trim())
                            return;
                          setGuideUpdates((updates) => [
                            {
                              date: "Nuevo",
                              title: newGuideTitle.trim(),
                              detail: newGuideDetail.trim(),
                            },
                            ...updates,
                          ]);
                          setNewGuideTitle("");
                          setNewGuideDetail("");
                        }}
                        className="rounded bg-[#183a67] px-4 py-2 font-bold text-white"
                      >
                        Publicar
                      </button>
                    </div>
                  </div>
                  <div className="mt-6 rounded-xl border bg-white p-5">
                    <b>Auditoría de operaciones</b>
                    <p className="mt-1 text-sm text-slate-500">
                      Toda venta, anulación y cierre queda identificado por
                      local, fecha y acción. Las anulaciones no se eliminan del
                      historial.
                    </p>
                    <div className="mt-4 divide-y">
                      {audit.length ? (
                        audit.slice(0, 8).map((event) => (
                          <div
                            key={event.id}
                            className="flex justify-between gap-3 py-3 text-sm"
                          >
                            <span>
                              <b>{event.action}</b> · {event.site}
                              <br />
                              <span className="text-slate-500">
                                {event.detail}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs text-slate-500">
                              {event.at}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="py-4 text-sm text-slate-500">
                          Aún no hay operaciones registradas en esta prueba.
                        </p>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
