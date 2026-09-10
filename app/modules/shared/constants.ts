import type { CashFields, ManagedUser, Role } from "./types";

export const API_BASE = "https://www.lartisantaller.com/sistema-api";

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
  { id: "transferirCaja", label: "Transferir efectivo entre cajas" },
  { id: "exportar", label: "Exportar informes" },
];

export const defaultActionPermissions = (role: Role) =>
  role === "administracion"
    ? ACTION_PERMISSIONS.map((permission) => permission.id)
    : role === "supervisora"
      ? ["cobrar", "anular", "egresos", "pedidos", "incidencias", "stock", "transferirCaja", "exportar"]
      : ["cobrar", "egresos", "pedidos", "incidencias", "transferirCaja"];

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
