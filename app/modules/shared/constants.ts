import type { CashFields, ManagedUser, Role } from "./types";

// Producción usa la API de DonWeb. Un entorno de pruebas puede apuntar a otra
// API definiendo VITE_LARTISAN_API_BASE al compilar o levantar el servidor.
// Como resguardo, una interfaz abierta desde IPv4 local conserva ese mismo
// host para la API: evita mezclar localhost/IPv6 con 127.0.0.1 y perder la
// sesión de demostración por una cookie de otro origen.
const localApiBase =
  typeof window !== "undefined" &&
  ["127.0.0.1", "localhost"].includes(window.location.hostname)
    ? `http://${window.location.hostname}:8081/sistema-api`
    : undefined;

export const API_BASE =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_LARTISAN_API_BASE ||
  localApiBase ||
  "https://www.lartisantaller.com/sistema-api";

export const EMPTY_CASH_FIELDS: CashFields = {
  fund: 0,
  expenses: 0,
  withdrawals: 0,
  counted: 0,
  envelope: 0,
  closed: false,
};

export const SITES = ["Recoleta", "Villa Mitre", "Congreso", "Maure", "Novo Pacheco"];

export const ACTION_PERMISSIONS = [
  { id: "cobrar", label: "Cobrar ventas" },
  { id: "anular", label: "Anular ventas" },
  { id: "egresos", label: "Cargar egresos" },
  { id: "pedidos", label: "Crear y recibir pedidos" },
  { id: "incidencias", label: "Registrar incidencias" },
  { id: "stock", label: "Ajustar / aprobar stock" },
  { id: "gestionarStockIdeal", label: "Editar stock ideal por local (solo Supervisión)" },
  { id: "autoaprobarStockPropio", label: "Aplicar automáticamente ajustes propios de stock (solo Supervisión)" },
  { id: "aprobarAjustesStock", label: "Aprobar ajustes de stock de otras supervisoras (solo Supervisión)" },
  { id: "aprobarEgresoMercaderia", label: "Autorizar egresos de mercadería solicitados por el local (solo Supervisión)" },
  { id: "gestionarPromociones", label: "Crear promociones (solo Supervisión)" },
  { id: "transferirCaja", label: "Transferir efectivo entre cajas" },
  { id: "exportar", label: "Exportar informes" },
  { id: "mrp", label: "Operar compras y MRP" },
  { id: "editarRecetas", label: "Editar recetas y costos" },
  { id: "comprasProduccion", label: "Cargar compras de producción" },
  { id: "stockMrp", label: "Contar stock de insumos (MRP)" },
];

export const defaultActionPermissions = (role: Role) =>
  role === "administracion"
    ? ACTION_PERMISSIONS.map((permission) => permission.id)
    : role === "compras"
      ? ["mrp"]
    : role === "supervisora"
      ? ["cobrar", "anular", "egresos", "pedidos", "incidencias", "stock", "transferirCaja", "exportar"]
      : ["cobrar", "anular", "egresos", "pedidos", "incidencias", "transferirCaja"];

// Las identidades se obtienen de la API después de autenticar.
export const INITIAL_MANAGED_USERS: ManagedUser[] = [];

export const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export const money2 = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
