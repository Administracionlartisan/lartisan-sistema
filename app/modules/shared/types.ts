export type Product = {
  id: number;
  name: string;
  detail: string;
  category: string;
  price: number;
  code: string;
  barcode: string;
  barcodeAliases?: string[];
  onlinePrice?: number;
  /** Un producto retirado no se ofrece ni se solicita, pero conserva historial. */
  active?: boolean;
};

export type Role = "vendedora" | "supervisora" | "compras" | "administracion" | "personal";

export type User = {
  name: string;
  role: Role;
  location?: string;
  locations?: string[];
  accessAllLocations?: boolean;
  jobTitle?: string | null;
};

export type ManagedUser = User & {
  id: string;
  active: boolean;
  username: string;
  email?: string;
  password: string;
  mfaRequired: boolean;
  reportPermissions: string[];
  actionPermissions: string[];
  primary?: boolean;
  mustChangePassword?: boolean;
};

export type Sale = {
  id: string;
  site: string;
  createdAt: string;
  createdAtISO: string;
  items: Product[];
  gross: number;
  discount: number;
  /** Nombre de la promoción seleccionado al cobrar, si corresponde. */
  promotion?: string;
  promotionId?: string;
  net: number;
  method: string;
  invoiceType: "Factura B" | "Factura B electrónica" | "Factura B fiscal" | "Factura A" | "Remito interno" | "Ticket";
  customer: string;
  customerId?: string;
  /** Grupo vigente al momento de vender; no cambia si luego se reclasifica el cliente. */
  customerGroup?: CustomerGroup;
  customerDocumentType?: "Consumidor final" | "DNI" | "CUIT";
  customerDocumentNumber?: string;
  customerTaxCondition?: string;
  customerAddress?: string;
  invitation: boolean;
  invitedQuantities?: Record<number, number>;
  channel: "Mostrador" | "Online";
  status: "activa" | "anulada";
  paymentStatus?: "Pagada" | "Pendiente";
  dueAtISO?: string;
  paidAtISO?: string;
};

export type SavedOrder = {
  id: string;
  site: string;
  createdAt: string;
  customer: string;
  customerId?: string;
  items: Product[];
  discount: number;
  promotion?: string;
  payment: string;
  invoiceType: Sale["invoiceType"];
  customerDocumentType?: Sale["customerDocumentType"];
  customerDocumentNumber?: string;
  customerTaxCondition?: string;
  customerAddress?: string;
  invitation: boolean;
  invitedQuantities?: Record<number, number>;
  channel: "Mostrador" | "Online";
};

export type CashAdjustment = { id: string; site: string; kind: "Ingreso de caja" | "Ajuste de caja" | "Retiro de caja"; amount: number; detail: string; at: string; atISO?: string; createdBy: string; impact?: "Ingreso" | "Egreso" };
/**
 * Compensación remota de una venta anulada luego de que su turno ya fue
 * cerrado. Vive en el estado operativo para que un corte de red no pierda la
 * identidad idempotente ni fuerce a recrear la anulación.
 */
export type PostCloseCancellationAdjustment = {
  id: string;
  saleId: string;
  closeId: string;
  site: string;
  businessDate: string;
  amount: number;
  paymentMethod: string;
  reason: string;
  auditReference: string;
  status: "pending" | "synced";
  attempts: number;
  lastError?: string;
  createdAtISO: string;
  syncedAtISO?: string;
};
export type CashLedgerEntry = { id: string; site: string; shiftId?: string; kind: string; direction: "Ingreso" | "Egreso" | "Informativo"; amount: number; cashImpact: number; paymentMethod?: string; reference?: string; detail: string; at: string; atISO?: string; createdBy: string };
export type CashCloseSnapshot = { closedAt: string; closedAtISO?: string; closedBy: string; expectedCash: number; countedCash: number; differenceAmount: number; envelopeAmount: number; differenceReason?: string };
// Un cierre puede reabrirse únicamente el mismo día. El historial conserva
// cada arqueo previo para auditoría; el turno y su fondo inicial no cambian.
export type CashShift = { id: string; site: string; openedAt: string; openedAtISO?: string; openedBy: string; initialFund: number; closedAt?: string; closedAtISO?: string; closedBy?: string; expectedCash?: number; countedCash?: number; differenceAmount?: number; envelopeAmount?: number; differenceReason?: string; closeHistory?: CashCloseSnapshot[]; reopenedAt?: string; reopenedAtISO?: string; reopenedBy?: string; reopenReason?: string };
export type OperationalLimits = { maxDiscount: number; maxExpense: number; maxCashDifference: number };
export type PasswordResetRequest = { id: string; userId: string; username: string; site?: string; requestedAt: string; status: "Pendiente" | "Restablecida" };

export type StockMovement = {
  id: string;
  site: string;
  productId: number;
  kind: "Carga inicial de stock" | "Ingreso por remito" | "Recepción de pedido" | "Venta" | "Anulación" | "Devolución" | "Ajuste de inventario" | "Merma" | "Ingreso manual" | "Egreso manual";
  quantity: number;
  remito: string;
  detail: string;
  reference?: string;
  at: string;
  atISO?: string;
  createdBy: string;
};

export type EnvelopeRecord = { id: string; site: string; amount: number; status: "En Caja Mayor" | "Retirado por Oscar"; at: string; withdrawnAmount: number };
export type AuditEvent = { id: string; at: string; site: string; action: string; detail: string; userName?: string };
export type Payment = { method: string; amount: number; saleId?: string; site?: string; shiftId?: string; createdAtISO?: string };
/** Cliente persistido con clave documental única: los datos comerciales nunca se
 * deducen por nombre para evitar unir personas distintas. */
export type CustomerGroup = "Restaurante" | "Franquicia" | "Almacén" | "Sin grupo";
export type CustomerRecord = { id: string; site: string; name: string; documentType: "DNI" | "CUIT" | "Otro"; documentNumber: string; customerGroup?: CustomerGroup; creditTermDays?: number; email?: string; phone?: string; address?: string; consentPromotions: boolean; createdAt: string; updatedAt: string; createdBy: string; active: boolean };
export type PriceChange = { id: string; at: string; percentage: number; category: string; effectiveDate: string; beforePrices: Record<number, number>; afterPrices: Record<number, number> };
export type EmployeeSchedule = { id: string; employee: string; site: string; startsAt: string; endsAt: string; toleranceMinutes: number };

export type StockRequest = {
  id: string;
  site: string;
  requestedBy: string;
  requestedAt: string;
  requestedAtISO?: string;
  dispatchedAt?: string;
  dispatchedBy?: string;
  notes: string;
  status: "Pendiente" | "En preparación" | "Despachado" | "Despachado parcial" | "Entregado";
  lines: {
    productId: number;
    quantity: number;
    preparedQuantity?: number;
    missingReason?: string;
    /** Foto del pedido para que el PDF histórico no dependa de cambios posteriores. */
    productName?: string;
    presentation?: string;
    category?: string;
    currentStockAtRequest?: number;
    idealStockAtRequest?: number;
  }[];
};

export type Expense = { id: string; site: string; category: string; amount: number; detail: string; receiptName: string; createdAt: string; createdBy: string; paidWithCash?: boolean };
export type ExpenseSyncItem = { date: string; supplier: string; category: string; document: string; total: number; amountDue: number; paid: boolean; paymentMethod: string; status: string; responsible: string };
export type ExpenseSyncGroup = { label: string; total: number; outstanding: number; count: number };
export type ExpenseSyncSummary = { totalExpenses: number; totalPaid: number; totalPayable: number; openCount: number; byCategory: ExpenseSyncGroup[]; bySupplier: ExpenseSyncGroup[]; openItems: ExpenseSyncItem[] };
export type ExpenseSyncSnapshot = { connected: boolean; data: { sourceRows: number; summary: ExpenseSyncSummary } | null; updatedAt: string | null };
export type ReturnTransaction = { id: string; saleId: string; site: string; kind: "Devolución" | "Cambio"; amount: number; refundMethod: string; reason: string; restock: boolean; creditNoteNumber: string; lines: { productId: number; quantity: number }[]; createdAt: string; createdBy: string };
export type CashTransfer = { id: string; originSite: string; destination: string; amount: number; reason: string; status: "Pendiente de recepción" | "Recibida" | "Anulada"; createdAt: string; createdBy: string; receivedAt?: string; receivedBy?: string };
export type AttendanceRecord = { id: string; userId?: number; userName: string; site: string; kind: "Entrada" | "Salida"; at: string; atISO: string; lateMinutes?: number; presenceStatus?: "Dentro de zona" | "Excepción aprobada"; distanceMeters?: number; accuracyMeters?: number; locationCapturedAt?: string; attendanceExceptionId?: string };
export type Incident = { id: string; site: string; type: string; detail: string; createdAt: string; createdBy: string; status: "Abierta" | "En revisión" | "Resuelta" };
export type StockAdjustment = { id: string; site: string; productId: number; counted: number; theoretical: number; reason: string; requestedAt: string; requestedBy: string; status: "Pendiente" | "Aprobado" | "Rechazado" };
/** Registro inmutable de la única carga de inventario con la que inicia un local. */
export type InitialStockLoad = { site: string; completedAt: string; completedBy: string; note: string; productCount: number };
export type CashFields = { fund: number; expenses: number; withdrawals: number; counted: number; envelope: number; closed: boolean };

export type OperationalSnapshot = {
  stock?: Record<number, number>;
  minimumStock?: Record<number, number>;
  realStock?: Record<number, string>;
  stockCountComments?: Record<number, string>;
  initialStockLoad?: InitialStockLoad;
  sales?: Sale[];
  payments?: Payment[];
  customers?: CustomerRecord[];
  stockRequests?: StockRequest[];
  savedOrders?: SavedOrder[];
  cashAdjustments?: CashAdjustment[];
  postCloseAdjustments?: PostCloseCancellationAdjustment[];
  cashLedger?: CashLedgerEntry[];
  // null (no undefined) al cerrar: JSON omite undefined y el servidor conservaría el turno.
  activeShift?: CashShift | null;
  shiftLog?: CashShift[];
  envelopeRecords?: EnvelopeRecord[];
  stockMovements?: StockMovement[];
  expensesLog?: Expense[];
  returnsLog?: ReturnTransaction[];
  cashTransfers?: CashTransfer[];
  attendanceRecords?: AttendanceRecord[];
  incidents?: Incident[];
  stockAdjustments?: StockAdjustment[];
  audit?: AuditEvent[];
  cash?: CashFields;
  cashOpen?: boolean;
  priceCatalogVersion?: string;
  prices?: Record<number, number>;
  onlinePrices?: Record<number, number>;
  limitsBySite?: Record<string, OperationalLimits>;
  schedules?: EmployeeSchedule[];
  priceChanges?: PriceChange[];
  monthlyTargets?: Record<string, number>;
};

export type SystemHealth = {
  api: "Verificando" | "Disponible" | "Sin respuesta";
  checkedAt: string;
  database?: string;
  activeUsers?: number;
  totalUsers?: number;
  freeSpaceMb?: number | null;
  databaseLatencyMs?: number;
  events24h?: number;
  failedSyncs24h?: number;
  driveConnected?: boolean;
  lastBackup?: { finished_at?: string | null; status?: string | null } | null;
  alerts?: Array<{ level: "atencion" | "critico"; message: string }>;
  notification?: { status: "sent" | "failed" | "unchanged" | "disabled"; sentAt?: string | null };
};
export type CashHistoryRow = { id: string; site: string; openedAt: string; openedBy: string; initialFund: number; closedAt?: string | null; closedBy?: string | null; expectedCash?: number | null; countedCash?: number | null; differenceAmount?: number | null; envelopeAmount?: number | null; paymentTotals?: Array<{ method: string; amount: number }> };
export type AuditHistoryRow = { id: string; at: string; site: string; userName: string; action: string; detail: string };
export type AiSupportRequest = { id: string; userName: string; role: Role; site?: string; section?: string; question: string; status: "pendiente" | "resuelta"; createdAt: string };

export type ApiUser = {
  id: number | string;
  username: string;
  fullName?: string;
  full_name?: string;
  role: Role;
  assignedLocation?: string | null;
  assigned_location?: string | null;
  assignedLocations?: string[];
  assigned_locations?: string | null;
  accessAllLocations?: boolean;
  access_all_locations?: boolean | number;
  active?: boolean | number;
  mustChangePassword?: boolean;
  must_change_password?: boolean | number;
  mfaRequired?: boolean;
  mfa_required?: boolean | number;
  reportPermissions?: string[];
  report_permissions?: string | null;
  actionPermissions?: string[];
  action_permissions?: string | null;
  primary?: boolean;
};

export type ApiPayload = {
  error?: string;
  fields?: Record<string, string>;
  message?: string;
  user: ApiUser;
  users?: ApiUser[];
  connected?: boolean;
  authorizationUrl?: string;
  delivery?: string;
  username?: string;
  temporaryPassword?: string;
  snapshot?: {
    rows?: string[][];
    data?: { sourceRows: number; summary: ExpenseSyncSummary };
    updatedAt?: string | null;
    rowsImported?: number;
  };
};

export type PLRow = { label: string; financial: number[]; economic?: number[]; format?: "money" | "percent" | "times" | "days" };
