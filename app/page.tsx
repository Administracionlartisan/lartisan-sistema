"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import AiHelpChat from "./components/AiHelpChat";
import ReportNavigation from "./components/ReportNavigation";
import { ADMIN_REPORTS, canOpenReport } from "./data/reportGuide";
import Heading from "./modules/shared/components/Heading";
import { buildThermalReceipt } from "./modules/ventas/thermalReceipt";
import {
  ACTION_PERMISSIONS, API_BASE, defaultActionPermissions, EMPTY_CASH_FIELDS,
  INITIAL_MANAGED_USERS, money, SITES,
} from "./modules/shared/constants";
import { downloadCsv } from "./modules/shared/downloadCsv";
import { OperationalOutbox, latestQueuedState, type PendingOperationalWrite } from "./modules/shared/operationalOutbox";
import { managedUserFromApi } from "./modules/usuarios/apiUserMapper";
import { AccessScreen, ForcePasswordChangeScreen, SecureLoading } from "./modules/auth/AuthScreens";
import ComingSoonPanel, { type ComingSoonSection } from "./modules/administracion/ComingSoonPanel";
import MrpPanel from "./modules/administracion/MrpPanel";
import CatalogEditor from "./modules/administracion/CatalogEditor";
import { useCatalog } from "./modules/config/useCatalog";
import { findScannedProduct } from "./modules/config/catalogModel";
import PurchaseCostsPanel from "./modules/administracion/PurchaseCostsPanel";
import CustomerPanel from "./modules/clientes/CustomerPanel";
import { CASH_HISTORY_TEMPLATE, parseHistoryCsv, SALES_HISTORY_TEMPLATE } from "./modules/administracion/historyImport";
import type {
  AiSupportRequest, ApiPayload, ApiUser, AttendanceRecord, AuditEvent, AuditHistoryRow,
  CashAdjustment, CashFields, CashLedgerEntry, CashShift, CashTransfer,
  CashHistoryRow,
  EmployeeSchedule, EnvelopeRecord, Expense, Incident, ManagedUser,
  ExpenseSyncSnapshot,
  OperationalLimits, OperationalSnapshot, PasswordResetRequest, Payment,
  PriceChange, Product, ReturnTransaction, Role, Sale, SavedOrder,
  StockAdjustment, StockMovement, StockRequest, SystemHealth, CustomerRecord,
  PostCloseCancellationAdjustment,
} from "./modules/shared/types";
import {
  DRIVE_INTEGRATIONS, GUIDE_UPDATES, INITIAL_SCHEDULES,
  METHODS, SHEET_CONFIG,
} from "./modules/config/operationalCatalog";

const dateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const initialReportRange = () => {
  const today = new Date();
  return {
    from: dateKey(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: dateKey(today),
  };
};
const safeStockQuantity = (value: unknown) => {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : 0;
};
const completeStockMap = (saved: Record<number, unknown> | undefined, products: Product[]) =>
  Object.fromEntries([
    ...Object.entries(saved ?? {}).map(([id, value]) => [id, safeStockQuantity(value)]),
    ...products.map((product) => [product.id, safeStockQuantity(saved?.[product.id])]),
  ]) as Record<number, number>;
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
    // Never prefill a real account on either access page. Besides avoiding
    // accidental logins, this keeps personal usernames out of a shared screen.
    [login, setLogin] = useState(""),
    [password, setPassword] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [user, setUser] = useState<ManagedUser | null>(null),
    [authLoading, setAuthLoading] = useState(true),
    [currentPassword, setCurrentPassword] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [confirmNewPassword, setConfirmNewPassword] = useState(""),
    [recoveryStage, setRecoveryStage] = useState<"idle" | "code">("idle"),
    [recoveryCode, setRecoveryCode] = useState(""),
    [recoveryPassword, setRecoveryPassword] = useState(""),
    [recoveryPasswordConfirm, setRecoveryPasswordConfirm] = useState(""),
    [recoverySending, setRecoverySending] = useState(false),
    [site, setSite] = useState("Recoleta"),
    [tab, setTab] = useState("Ventas"),
    [navOpen, setNavOpen] = useState(false),
    [productSearch, setProductSearch] = useState(""),
    [stockSearch, setStockSearch] = useState(""),
    [stockGroup, setStockGroup] = useState("Todos los grupos"),
    [scannerResult, setScannerResult] = useState(""),
    [salesScannerValue, setSalesScannerValue] = useState(""),
    [pedidoScannerValue, setPedidoScannerValue] = useState(""),
    [cart, setCart] = useState<Product[]>([]),
    [discount, setDiscount] = useState(0),
    [payment, setPayment] = useState("Efectivo"),
    [splitPayment, setSplitPayment] = useState(false),
    [splitPayments, setSplitPayments] = useState<Payment[]>([
      { method: "Efectivo", amount: 0 },
      { method: "Transferencia", amount: 0 },
    ]),
    [saleChannel, setSaleChannel] = useState<"Mostrador" | "Online">(
      "Mostrador",
    ),
    [invoiceType, setInvoiceType] = useState<Sale["invoiceType"]>("Factura B"),
    [customer, setCustomer] = useState("Consumidor final"),
    [customerDocumentType, setCustomerDocumentType] = useState<NonNullable<Sale["customerDocumentType"]>>("Consumidor final"),
    [customerDocumentNumber, setCustomerDocumentNumber] = useState(""),
    [customerTaxCondition, setCustomerTaxCondition] = useState(""),
    [customerAddress, setCustomerAddress] = useState(""),
    [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null),
    [customers, setCustomers] = useState<CustomerRecord[]>([]),
    [invitedQuantities, setInvitedQuantities] = useState<Record<number, number>>({}),
    [message, setMessage] = useState(""),
    [cashAdjustmentKind, setCashAdjustmentKind] =
      useState<CashAdjustment["kind"]>("Ajuste de caja"),
    [cashAdjustmentImpact, setCashAdjustmentImpact] = useState<"Ingreso" | "Egreso">("Ingreso"),
    [cashAdjustmentAmount, setCashAdjustmentAmount] = useState(0),
    [cashAdjustmentDetail, setCashAdjustmentDetail] = useState(""),
    [cashOpenBySite, setCashOpenBySite] = useState<Record<string, boolean>>({}),
    [sales, setSales] = useState<Sale[]>([]),
    [receiptSale, setReceiptSale] = useState<Sale | null>(null),
    [saleSearch, setSaleSearch] = useState(""),
    [paymentCorrectionSaleId, setPaymentCorrectionSaleId] = useState<string | null>(null),
    [paymentCorrectionMethod, setPaymentCorrectionMethod] = useState("Efectivo"),
    [audit, setAudit] = useState<AuditEvent[]>([]),
    [syncStatus, setSyncStatus] = useState("Sin cierre enviado"),
    [testOperatingDate, setTestOperatingDate] = useState<{ active: boolean; site?: string; businessDate?: string; label?: string; enabledAt?: string }>({ active: false }),
    [testOperatingDateBusy, setTestOperatingDateBusy] = useState(false),
    [schedules, setSchedules] = useState<EmployeeSchedule[]>(INITIAL_SCHEDULES),
    [guideUpdates, setGuideUpdates] = useState(GUIDE_UPDATES),
    [reportSite, setReportSite] = useState("Todos los locales"),
    [reportFrom, setReportFrom] = useState(() => initialReportRange().from),
    [reportTo, setReportTo] = useState(() => initialReportRange().to),
    [newGuideTitle, setNewGuideTitle] = useState(""),
    [newGuideDetail, setNewGuideDetail] = useState(""),
    [attendanceReminder, setAttendanceReminder] = useState<"Entrada" | "Salida" | null>(null),
    [adminReport, setAdminReport] = useState("Resumen"),
    [pnlConnection, setPnlConnection] = useState<{ connected: boolean; rows: string[][]; updatedAt: string | null }>({ connected: false, rows: [], updatedAt: null }),
    [pnlSyncing, setPnlSyncing] = useState(false),
    [pnlSyncMessage, setPnlSyncMessage] = useState(""),
    [expenseSync, setExpenseSync] = useState<ExpenseSyncSnapshot>({ connected: false, data: null, updatedAt: null }),
    [expenseSyncing, setExpenseSyncing] = useState(false),
    [expenseSyncMessage, setExpenseSyncMessage] = useState(""),
    [hourInterval, setHourInterval] = useState(1),
    [newUserName, setNewUserName] = useState(""),
    [newUserRole, setNewUserRole] = useState<Role>("vendedora"),
    [newUserSites, setNewUserSites] = useState<string[]>(["Recoleta"]),
    [newUserAllLocations, setNewUserAllLocations] = useState(false),
    [newUserUsername, setNewUserUsername] = useState(""),
    [newUserPassword, setNewUserPassword] = useState(""),
    [newUserFieldErrors, setNewUserFieldErrors] = useState<Record<string, string>>({}),
    [newUserMfaRequired, setNewUserMfaRequired] = useState(false),
    [resetRequests, setResetRequests] = useState<PasswordResetRequest[]>([]),
    [createdUserCredentials, setCreatedUserCredentials] = useState<
      { name: string; username: string; password: string } | null
    >(null),
    [generatedTemporaryPassword, setGeneratedTemporaryPassword] = useState<
      { username: string; password: string } | null
    >(null),
    [resettingUserId, setResettingUserId] = useState<string | null>(null),
    [actionPermissionDrafts, setActionPermissionDrafts] = useState<Record<string, string[]>>({}),
    [savingPermissionsFor, setSavingPermissionsFor] = useState<string | null>(null),
    [actionPermissionSearch, setActionPermissionSearch] = useState(""),
    [priceIncrease, setPriceIncrease] = useState(0),
    [priceRounding, setPriceRounding] = useState(100),
    [priceCategory, setPriceCategory] = useState("Todos"),
    [priceEffectiveDate, setPriceEffectiveDate] = useState(() => dateKey(new Date())),
    [expandedPriceChange, setExpandedPriceChange] = useState<string | null>(
      null,
    ),
    [clock, setClock] = useState(""),
    [drive, setDrive] = useState("");
  // La fecha simulada nunca se toma de un campo libre ni del reloj del equipo.
  // Sólo se activa si la API la habilitó para Maure y conserva la hora real.
  const operationalNow = () => {
    if (!(testOperatingDate.active && testOperatingDate.site === "Maure" && testOperatingDate.businessDate === "2026-10-15" && site === "Maure")) return new Date();
    const current = new Date();
    return new Date(2026, 9, 15, current.getHours(), current.getMinutes(), current.getSeconds(), current.getMilliseconds());
  };
  const isValidationTest = testOperatingDate.active && testOperatingDate.site === "Maure" && testOperatingDate.businessDate === "2026-10-15" && site === "Maure";
  const catalog = useCatalog(user?.id);
  const products = catalog.document.products;
  const priceChanges = catalog.document.priceChanges;
  const prices = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p.price])), [products]);
  const onlinePrices = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p.onlinePrice ?? p.price])), [products]);
  const priceCatalogVersion = "2026-09-29";
  const productFromScannedCode = (value: string) => findScannedProduct(products, value);
  const [stockRequests, setStockRequests] = useState<StockRequest[]>([]);
  const [cashFieldsBySite, setCashFieldsBySite] = useState<
    Record<string, CashFields>
  >({});
  const [operationalReady, setOperationalReady] = useState(false);
  const [operationalVersion, setOperationalVersion] = useState(0);
  const operationalEventRef = useRef<{ action: string; detail: string } | null>(null);
  const lastPersistedSnapshot = useRef<Record<string, string>>({});
  const queuedBaseSnapshot = useRef<Record<string, string>>({});
  const serverRevision = useRef<Record<string, number>>({});
  const outboxRef = useRef<{ userId: string; ready: Promise<OperationalOutbox> } | null>(null);
  const drainingSites = useRef(new Set<string>());
  // Último estado confirmado por local en esta sesión y si el servidor tuvo que combinarlo.
  const lastAcknowledged = useRef<Record<string, { stateJson: string; merged: boolean }>>({});
  // Locales que Central ve solo para gestionar pedidos y ajustes (no los opera).
  const centralOnlySites = useRef(new Set<string>());
  const reloadAfterDrain = useRef(false);
  const pendingReceiptRef = useRef<Sale | null>(null);
  const syncingAdjustmentIds = useRef(new Set<string>());
  const salesScannerRef = useRef<HTMLInputElement | null>(null);
  const pedidoScannerRef = useRef<HTMLInputElement | null>(null);
  const receptionScannerRef = useRef<HTMLInputElement | null>(null);
  const scannerBufferRef = useRef<{ value: string; lastKeyAt: number; input: HTMLInputElement | HTMLTextAreaElement | null; originalValue: string }>({ value: "", lastKeyAt: 0, input: null, originalValue: "" });
  const [savedOrders, setSavedOrders] = useState<SavedOrder[]>([]);
  const [cashAdjustments, setCashAdjustments] = useState<CashAdjustment[]>([]);
  const [postCloseAdjustments, setPostCloseAdjustments] = useState<PostCloseCancellationAdjustment[]>([]);
  const [cashLedger, setCashLedger] = useState<CashLedgerEntry[]>([]);
  const [activeShiftBySite, setActiveShiftBySite] = useState<
    Record<string, CashShift | undefined>
  >({});
  const [shiftLog, setShiftLog] = useState<CashShift[]>([]);
  const [limitsBySite, setLimitsBySite] = useState<
    Record<string, OperationalLimits>
  >(() =>
    Object.fromEntries(
      SITES.map((local) => [
        local,
        { maxDiscount: 10, maxExpense: 100000, maxCashDifference: 0 },
      ]),
    ),
  );
  const [connectionMode, setConnectionMode] = useState<"En línea" | "Contingencia">("En línea");
  const [pendingSync, setPendingSync] = useState(0);
  const [backupFrequency, setBackupFrequency] = useState("Dos veces por semana · lunes y jueves 21:00");
  const [retentionYears, setRetentionYears] = useState(7);
  const [backupStatus, setBackupStatus] = useState("El estado del respaldo se verifica automáticamente desde el servidor.");
  const [backupRunning, setBackupRunning] = useState(false);
  const [systemHealth, setSystemHealth] = useState<SystemHealth>({ api: "Verificando", checkedAt: "" });
  const [healthRefreshKey, setHealthRefreshKey] = useState(0);
  const [arcaTesting, setArcaTesting] = useState(false);
  const [arcaTestMessage, setArcaTestMessage] = useState("Pendiente de validación en producción.");
  const [fiscalSales, setFiscalSales] = useState<Array<{ id: string; site: string; occurred_at: string; net_amount: number; invoice_type: string; customer_name: string; document_id?: number; fiscal_status?: string; voucher_number?: number; cae?: string }>>([]);
  const [fiscalBusy, setFiscalBusy] = useState<string | null>(null);
  const [fiscalMessage, setFiscalMessage] = useState("");
  const [persistedReportSales, setPersistedReportSales] = useState<Sale[] | null>(null);
  const [persistedReportPayments, setPersistedReportPayments] = useState<Payment[]>([]);
  const [auditHistory, setAuditHistory] = useState<AuditHistoryRow[]>([]);
  const [auditUserFilter, setAuditUserFilter] = useState("");
  const [auditActionFilter, setAuditActionFilter] = useState("");
  const [cashHistory, setCashHistory] = useState<CashHistoryRow[]>([]);
  const [historyImportKind, setHistoryImportKind] = useState<"sales" | "cash">("sales");
  const [historyImporting, setHistoryImporting] = useState(false);
  const [aiSupportRequests, setAiSupportRequests] = useState<AiSupportRequest[]>([]);
  const [envelopeRecords, setEnvelopeRecords] = useState<EnvelopeRecord[]>([]);
  const [oscarWithdrawal, setOscarWithdrawal] = useState(0);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [movementProductId, setMovementProductId] = useState(products[0].id);
  const [movementKind, setMovementKind] =
    useState<StockMovement["kind"]>("Ingreso por remito");
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
  const [receivingRequestId, setReceivingRequestId] = useState<string | null>(null);
  const [receivedScanCounts, setReceivedScanCounts] = useState<Record<number, number>>({});
  const [receivingScanNotice, setReceivingScanNotice] = useState("");
  const [receivingBarcodeInput, setReceivingBarcodeInput] = useState("");
  const [centralExtraProductId, setCentralExtraProductId] = useState(products[0].id);
  const [centralExtraQuantity, setCentralExtraQuantity] = useState(1);
  const [expensesLog, setExpensesLog] = useState<Expense[]>([]);
  const [returnsLog, setReturnsLog] = useState<ReturnTransaction[]>([]);
  const [cashTransfers, setCashTransfers] = useState<CashTransfer[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [returnSaleId, setReturnSaleId] = useState("");
  const [returnKind, setReturnKind] = useState<ReturnTransaction["kind"]>("Devolución");
  const [returnReason, setReturnReason] = useState("");
  const [returnRefundMethod, setReturnRefundMethod] = useState("Efectivo");
  const [returnRestock, setReturnRestock] = useState(true);
  const [returnQuantities, setReturnQuantities] = useState<Record<number, number>>({});
  const [transferDestination, setTransferDestination] = useState("Caja Mayor");
  const [transferAmount, setTransferAmount] = useState(0);
  const [transferReason, setTransferReason] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("Insumos");
  const [expenseAmount, setExpenseAmount] = useState(0);
  const [expenseDetail, setExpenseDetail] = useState("");
  const [expenseReceipt, setExpenseReceipt] = useState("");
  const [expensePaidWithCash, setExpensePaidWithCash] = useState(true);
  const [cashDifferenceReason, setCashDifferenceReason] = useState("");
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [incidentType, setIncidentType] = useState("Faltante de mercadería");
  const [incidentDetail, setIncidentDetail] = useState("");
  const [stockAdjustments, setStockAdjustments] = useState<StockAdjustment[]>(
    [],
  );
  const [monthlyTargets, setMonthlyTargets] = useState<Record<string, number>>(
    () => Object.fromEntries(SITES.map((local) => [local, 0])),
  );
  const [monthlyTargetDrafts, setMonthlyTargetDrafts] = useState<Record<string, number>>(
    () => Object.fromEntries(SITES.map((local) => [local, 0])),
  );
  const [adjustProductId, setAdjustProductId] = useState(products[0].id);
  const [adjustReason, setAdjustReason] = useState("");
  const [stock, setStock] = useState<Record<string, Record<number, number>>>(
    Object.fromEntries(
      SITES.map((s) => [
        s,
        Object.fromEntries(products.map((p) => [p.id, 0])),
      ]),
    ),
  );
  const [minimumStock, setMinimumStock] = useState<
    Record<string, Record<number, number>>
  >(() =>
    Object.fromEntries(
      SITES.map((s) => [
        s,
        Object.fromEntries(products.map((product) => [product.id, 0])),
      ]),
    ),
  );
  const [realStock, setRealStock] = useState<
    Record<string, Record<number, string>>
  >(() =>
    Object.fromEntries(
      SITES.map((s) => [
        s,
        Object.fromEntries(products.map((p) => [p.id, ""])),
      ]),
    ),
  );
  const [stockCountComments, setStockCountComments] = useState<
    Record<string, Record<number, string>>
  >(() =>
    Object.fromEntries(
      SITES.map((s) => [
        s,
        Object.fromEntries(products.map((p) => [p.id, ""])),
      ]),
    ),
  );
  const [payments, setPayments] = useState<Payment[]>([]);
  useEffect(() => {
    if (!operationalReady) return;
    // Ampliar los mapas sin tocar cantidades existentes ni identificadores históricos.
    const timer = window.setTimeout(() => {
      setStock((items) => Object.fromEntries(SITES.map((local) => [local, completeStockMap(items[local], products)])));
      setMinimumStock((items) => Object.fromEntries(SITES.map((local) => [local, completeStockMap(items[local], products)])));
      const blanks = Object.fromEntries(products.map((p) => [p.id, ""]));
      setRealStock((items) => Object.fromEntries(SITES.map((local) => [local, { ...blanks, ...items[local] }])));
      setStockCountComments((items) => Object.fromEntries(SITES.map((local) => [local, { ...blanks, ...items[local] }])));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [products, operationalReady]);
  useEffect(() => {
    // Primera migración: guarda la lista vigente completa, sin modificar stock.
    if (user?.role === "administracion" && catalog.ready && catalog.document.revision === 0) {
      void catalog.save(products).catch((error) => {
        setMessage(error instanceof Error ? error.message : "No se pudo centralizar el catálogo.");
        void catalog.reload();
      });
    }
  // La revisión 0 solo existe antes del primer guardado central.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role, catalog.ready, catalog.document.revision]);
  const cashFields = cashFieldsBySite[site] || EMPTY_CASH_FIELDS;
  const updateCashField = <K extends keyof CashFields>(
    field: K,
    value: CashFields[K],
  ) =>
    setCashFieldsBySite((items) => ({
      ...items,
      [site]: { ...EMPTY_CASH_FIELDS, ...items[site], [field]: value },
    }));
  const fund = cashFields.fund;
  const expenses = cashFields.expenses;
  const withdrawals = cashFields.withdrawals;
  const counted = cashFields.counted;
  const envelope = cashFields.envelope;
  const closed = cashFields.closed;
  const setFund = (value: number) => updateCashField("fund", value);
  const setExpenses = (value: number) => updateCashField("expenses", value);
  const setWithdrawals = (value: number) => updateCashField("withdrawals", value);
  const setCounted = (value: number) => updateCashField("counted", value);
  const setEnvelope = (value: number) => updateCashField("envelope", value);
  const setClosed = (value: boolean) => updateCashField("closed", value);
  const applyAuthenticatedUser = (profile: ApiUser) => {
    const next = managedUserFromApi(profile);
    if (portal === "admin" && !["administracion", "compras"].includes(next.role)) {
      setMessage("Este acceso es exclusivo para Administración y Compras.");
      return false;
    }
    if (portal === "ventas" && ["administracion", "compras"].includes(next.role)) {
      setMessage("Este usuario debe ingresar desde admin.lartisantaller.com.");
      return false;
    }
    setOperationalReady(false);
    setUser(next);
    const rememberedSite = window.localStorage.getItem(`lartisan:last-site:${next.id}`);
    const allowedSites = next.accessAllLocations ? SITES : next.locations || [];
    const initialSite = rememberedSite && allowedSites.includes(rememberedSite)
      ? rememberedSite
      : allowedSites[0] || next.location || "Recoleta";
    setSite(initialSite);
    setPayment(METHODS[initialSite][0]);
    setTab(next.role === "administracion" ? "Administración" : next.role === "compras" ? "MRP" : "Ventas");
    setMessage("");
    return true;
  };
  const loadAdminSecurityData = async () => {
    const [usersResponse, resetResponse, assistantResponse] = await Promise.all([
      fetch(`${API_BASE}/admin/users`, { credentials: "include" }),
      fetch(`${API_BASE}/admin/reset-requests`, { credentials: "include" }),
      fetch(`${API_BASE}/admin/assistant-requests`, { credentials: "include" }),
    ]);
    if (usersResponse.ok) {
      const data = (await usersResponse.json()) as { users: ApiUser[] };
      setManagedUsers(data.users.map(managedUserFromApi));
    }
    if (resetResponse.ok) {
      const data = (await resetResponse.json()) as { requests: Array<{
        id: number; user_id: number; username: string; assigned_location?: string | null;
        requested_at: string; status: "pendiente" | "resuelta";
      }> };
      setResetRequests(
        data.requests.map(
          (request: {
            id: number;
            user_id: number;
            username: string;
            assigned_location?: string | null;
            requested_at: string;
            status: "pendiente" | "resuelta";
          }): PasswordResetRequest => ({
            id: String(request.id),
            userId: String(request.user_id),
            username: request.username,
            site: request.assigned_location || undefined,
            requestedAt: new Date(
              request.requested_at.replace(" ", "T") + "-03:00",
            ).toLocaleString("es-AR"),
            status:
              request.status === "pendiente" ? "Pendiente" : "Restablecida",
          }),
        ),
      );
    }
    if (assistantResponse.ok) {
      const data = (await assistantResponse.json()) as { requests?: Array<{
        id: number; username_snapshot: string; role_snapshot: Role; site?: string | null;
        section_name?: string | null; question: string; status: "pendiente" | "resuelta";
        created_at: string;
      }> };
      setAiSupportRequests(
        (data.requests || []).map(
          (request: {
            id: number;
            username_snapshot: string;
            role_snapshot: Role;
            site?: string | null;
            section_name?: string | null;
            question: string;
            status: "pendiente" | "resuelta";
            created_at: string;
          }): AiSupportRequest => ({
            id: String(request.id),
            userName: request.username_snapshot,
            role: request.role_snapshot,
            site: request.site || undefined,
            section: request.section_name || undefined,
            question: request.question,
            status: request.status,
            createdAt: new Date(request.created_at.replace(" ", "T") + "-03:00").toLocaleString("es-AR"),
          }),
        ),
      );
    }
  };

  const resolveAiSupportRequest = async (id: string) => {
    const response = await fetch(`${API_BASE}/admin/assistant-requests/${id}`, {
      method: "PATCH",
      credentials: "include",
    });
    if (!response.ok) {
      setMessage("No se pudo marcar la consulta como resuelta.");
      return;
    }
    setAiSupportRequests((items) =>
      items.map((item) => (item.id === id ? { ...item, status: "resuelta" } : item)),
    );
    setMessage("Consulta marcada como resuelta.");
  };
  useEffect(() => {
    let active = true;
    const restoreSession = async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch(`${API_BASE}/auth/me`, {
            credentials: "include",
            cache: "no-store",
          });
          if (response.status === 401) return;
          if (!response.ok) throw new Error("No se pudo verificar la sesión");
          const data = (await response.json()) as { user: ApiUser };
          if (active) applyAuthenticatedUser(data.user);
          return;
        } catch {
          if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 600));
          else if (active) setMessage("No se pudo verificar tu sesión. Revisá la conexión y volvé a intentar.");
        }
      }
    };
    void restoreSession().finally(() => active && setAuthLoading(false));
    return () => {
      active = false;
    };
  // La restauración se reinicia solo cuando cambia el portal; la función usa el estado del montaje actual.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portal]);
  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    const loadTestOperatingDate = async () => {
      try {
        const response = await fetch(`${API_BASE}/operations/test-operating-date`, { credentials: "include", cache: "no-store" });
        const data = await response.json() as { testOperatingDate?: { active?: boolean; site?: string; businessDate?: string; label?: string; enabledAt?: string } };
        if (response.ok && active) setTestOperatingDate({ active: Boolean(data.testOperatingDate?.active), ...data.testOperatingDate });
      } catch { /* La operación normal continúa sin una fecha especial. */ }
    };
    void loadTestOperatingDate();
    const timer = window.setInterval(loadTestOperatingDate, 20_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [user?.id]);
  useEffect(() => {
    if (!user || (tab !== "Reportes" && !(tab === "Administración" && adminReport))) return;
    void fetch(`${API_BASE}/activity/module-opened`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ module: "Reportes" }),
    });
  }, [adminReport, tab, user]);
  useEffect(() => {
    if (user?.role !== "administracion") return;
    let active = true;
    const refreshAdminTasks = () =>
      loadAdminSecurityData().catch(() => {
        if (active) setMessage("No se pudieron actualizar usuarios, recuperaciones y consultas.");
      });
    void refreshAdminTasks();
    const timer = window.setInterval(refreshAdminTasks, 30_000);
    const refreshOnFocus = () => void refreshAdminTasks();
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [user]);
  useEffect(() => {
    if (user?.role !== "administracion") return;
    let active = true;
    const check = async () => {
      try {
        let response = await fetch(`${API_BASE}/admin/monitoring`, { credentials: "include", cache: "no-store" });
        let data: {
          api?: "Disponible";
          database?: string;
          users?: { active?: number; total?: number };
          space?: number;
          database_latency_ms?: number;
          events_24h?: number;
          failed_syncs_24h?: number;
          drive_connected?: boolean;
          last_backup?: { finished_at?: string | null; status?: string | null } | null;
          alerts?: Array<{ level: "atencion" | "critico"; message: string }>;
        };
        if (response.ok) {
          data = await response.json();
        } else {
          response = await fetch(`${API_BASE}/health`, { cache: "no-store" });
          if (!response.ok) throw new Error("health");
          await response.json();
          data = { database: "Disponible", users: { active: managedUsers.filter((item) => item.active).length, total: managedUsers.length } };
        }
        if (active) {
          setSystemHealth({
            api: "Disponible",
            database: data.database,
            activeUsers: data.users?.active,
            totalUsers: data.users?.total,
            freeSpaceMb: typeof data.space === "number" ? Math.round(data.space / 1024 / 1024) : null,
            databaseLatencyMs: data.database_latency_ms,
            events24h: data.events_24h,
            failedSyncs24h: data.failed_syncs_24h,
            driveConnected: data.drive_connected,
            lastBackup: data.last_backup,
            alerts: data.alerts || [],
            checkedAt: new Date().toLocaleString("es-AR"),
          });
          if (data.last_backup?.status === "verified") {
            setBackupStatus("Último respaldo externo verificado correctamente.");
          }
        }
      } catch {
        if (active) setSystemHealth({ api: "Sin respuesta", checkedAt: new Date().toLocaleString("es-AR") });
      }
    };
    check();
    const timer = window.setInterval(check, 5 * 60 * 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [user?.id, user?.role, healthRefreshKey, managedUsers]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    const heartbeat = async () => {
      try {
        const response = await fetch(`${API_BASE}/monitoring/heartbeat`, { method: "POST", credentials: "include", cache: "no-store" });
        if (!response.ok || !active || user.role !== "administracion") return;
        const data = (await response.json()) as { notification?: SystemHealth["notification"] };
        if (data.notification) setSystemHealth((current) => ({ ...current, notification: data.notification }));
      } catch { /* El chequeo visible informará si la API deja de responder. */ }
    };
    void heartbeat();
    const timer = window.setInterval(heartbeat, 5 * 60 * 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [user]);
  useEffect(() => {
    if (user?.role !== "administracion") return;
    let active = true;
    fetch(`${API_BASE}/admin/pnl/latest`, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as ApiPayload;
        if (!active) return;
        setPnlConnection({
          connected: Boolean(data.connected),
          rows: Array.isArray(data.snapshot?.rows) ? data.snapshot.rows : [],
          updatedAt: data.snapshot?.updatedAt || null,
        });
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [user?.id, user?.role]);
  useEffect(() => {
    if (user?.role !== "administracion") return;
    let active = true;
    fetch(`${API_BASE}/admin/expenses/latest`, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as ApiPayload;
        if (!active) return;
        setExpenseSync({
          connected: Boolean(data.connected),
          data: data.snapshot?.data || null,
          updatedAt: data.snapshot?.updatedAt || null,
        });
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [user?.id, user?.role]);
  const connectPnlGoogle = async () => {
    setPnlSyncMessage("");
    const response = await fetch(`${API_BASE}/admin/pnl/authorization-url`, { credentials: "include" });
    const data = (await response.json()) as ApiPayload;
    if (!response.ok || !data.authorizationUrl) {
      setPnlSyncMessage("No se pudo iniciar la autorización con Google.");
      return;
    }
    window.location.assign(data.authorizationUrl);
  };
  const syncPnlFromGoogle = async () => {
    setPnlSyncing(true);
    setPnlSyncMessage("");
    try {
      const response = await fetch(`${API_BASE}/admin/pnl/sync`, { method: "POST", credentials: "include" });
      const data = (await response.json()) as ApiPayload;
      if (!response.ok) throw new Error(data.error || "No se pudo actualizar el P&L.");
      if (!data.snapshot) throw new Error("Drive no devolvió una copia válida del P&L.");
      setPnlConnection({ connected: true, rows: data.snapshot.rows || [], updatedAt: data.snapshot.updatedAt || new Date().toISOString() });
      setPnlSyncMessage(`P&L actualizado desde Drive: ${data.snapshot.rowsImported || 0} filas verificadas.`);
    } catch (error) {
      setPnlSyncMessage(error instanceof Error ? error.message : "No se pudo actualizar el P&L.");
    } finally {
      setPnlSyncing(false);
    }
  };
  const syncExpensesFromGoogle = async () => {
    setExpenseSyncing(true);
    setExpenseSyncMessage("");
    try {
      const response = await fetch(`${API_BASE}/admin/expenses/sync`, { method: "POST", credentials: "include" });
      const data = (await response.json()) as ApiPayload;
      if (!response.ok) throw new Error(data.error || "No se pudieron actualizar gastos y cuentas por pagar.");
      if (!data.snapshot?.data) throw new Error("Drive no devolvió una copia válida de gastos.");
      setExpenseSync({ connected: true, data: data.snapshot.data, updatedAt: data.snapshot.updatedAt || new Date().toISOString() });
      setExpenseSyncMessage(`Gastos actualizados desde Drive: ${data.snapshot.rowsImported || 0} registros verificados.`);
    } catch (error) {
      setExpenseSyncMessage(error instanceof Error ? error.message : "No se pudieron actualizar gastos y cuentas por pagar.");
    } finally {
      setExpenseSyncing(false);
    }
  };
  const testArcaHomologation = async () => {
    setArcaTesting(true);
    setArcaTestMessage("Validando firma y acceso con ARCA…");
    try {
      const response = await fetch(`${API_BASE}/admin/arca/homologation-test`, {
        method: "POST",
        credentials: "include",
      });
      const data = (await response.json()) as {
        ok?: boolean;
        ticketExpiresAt?: string;
        checks?: Array<{ site: string; pointOfSale: number; voucherLabel: string; lastVoucherNumber: number }>;
        error?: string;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || "No se pudo validar ARCA.");
      const expiry = data.ticketExpiresAt ? new Date(data.ticketExpiresAt).toLocaleString("es-AR") : "vigencia informada por ARCA";
      const sequence = (data.checks || []).map((check) =>
        `${check.site} ${String(check.pointOfSale).padStart(5, "0")} · ${check.voucherLabel}: ${check.lastVoucherNumber}`,
      ).join(" | ");
      setArcaTestMessage(`Conexión de producción validada. Ticket vigente hasta ${expiry}.${sequence ? ` Última numeración: ${sequence}.` : ""} No se emitió ningún comprobante.`);
    } catch (error) {
      setArcaTestMessage(error instanceof Error ? error.message : "No se pudo validar ARCA en producción.");
    } finally {
      setArcaTesting(false);
    }
  };
  const loadFiscalSales = async () => {
    if (user?.role !== "administracion") return;
    try {
      const response = await fetch(`${API_BASE}/admin/arca/eligible-sales`, { credentials: "include", cache: "no-store" });
      const data = (await response.json()) as { sales?: typeof fiscalSales; error?: string; cutoverRequired?: boolean; cutover?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo cargar la cola fiscal.");
      setFiscalSales(data.sales || []);
      setFiscalMessage(data.cutoverRequired ? "La emisión fiscal está protegida hasta que se configure la fecha de corte. Las ventas anteriores nunca se enviarán nuevamente a ARCA." : data.cutover ? `Se muestran solamente ventas posteriores al corte fiscal: ${new Date(data.cutover.replace(" ", "T")).toLocaleString("es-AR")}.` : "");
    } catch (error) { setFiscalMessage(error instanceof Error ? error.message : "No se pudo cargar la cola fiscal."); }
  };
  const issueFiscalSale = async (sale: typeof fiscalSales[number]) => {
    setFiscalBusy(sale.id); setFiscalMessage("");
    try {
      let documentId = sale.document_id;
      if (!documentId || sale.fiscal_status === "rejected") {
        const prepared = await fetch(`${API_BASE}/admin/arca/fiscal-documents/prepare`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ saleReference: sale.id }) });
        const preparedData = (await prepared.json()) as { document?: { id?: number; status?: string }; error?: string };
        if (!prepared.ok || !preparedData.document?.id) throw new Error(preparedData.error || "No se pudo preparar el comprobante.");
        documentId = preparedData.document.id;
        if (preparedData.document.status === "authorized") { setFiscalMessage("Ese comprobante ya fue autorizado por ARCA."); await loadFiscalSales(); return; }
      }
      if (!window.confirm(`Vas a solicitar a ARCA el CAE de ${sale.invoice_type} por ${money.format(sale.net_amount)} para ${sale.site}. Esta acción es fiscal y no se puede deshacer. ¿Confirmás la emisión?`)) { setFiscalMessage("Emisión cancelada. El comprobante queda preparado y no se informó a ARCA."); return; }
      const issued = await fetch(`${API_BASE}/admin/arca/fiscal-documents/issue`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId }) });
      const issuedData = (await issued.json()) as { document?: { voucher_number?: number; cae?: string }; error?: string };
      if (!issued.ok || !issuedData.document?.cae) throw new Error(issuedData.error || "ARCA no autorizó el comprobante.");
      setFiscalMessage(`CAE autorizado: ${issuedData.document.cae} · comprobante ${String(issuedData.document.voucher_number).padStart(8, "0")}.`);
      await loadFiscalSales();
    } catch (error) { setFiscalMessage(error instanceof Error ? error.message : "No se pudo emitir el comprobante."); }
    finally { setFiscalBusy(null); }
  };
  const prepareCreditNote = async (sale: typeof fiscalSales[number]) => {
    if (!sale.document_id || sale.fiscal_status !== "authorized") return;
    const amountText = window.prompt("Importe total de la nota de crédito (IVA incluido):", String(sale.net_amount)); if (amountText === null) return;
    const reason = window.prompt("Motivo de la nota de crédito fiscal:"); if (!reason) return;
    setFiscalBusy(sale.id); setFiscalMessage("");
    try {
      const prepared = await fetch(`${API_BASE}/admin/arca/fiscal-documents/credit-note/prepare`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceDocumentId: sale.document_id, amount: Number(amountText.replace(",", ".")), reason }) });
      const data = (await prepared.json()) as { document?: { id?: number }; error?: string };
      if (!prepared.ok || !data.document?.id) throw new Error(data.error || "No se pudo preparar la nota de crédito.");
      if (!window.confirm(`Vas a solicitar a ARCA el CAE de una nota de crédito por ${amountText}. ¿Confirmás la emisión?`)) { setFiscalMessage("Nota de crédito preparada; no se informó a ARCA."); return; }
      const issued = await fetch(`${API_BASE}/admin/arca/fiscal-documents/issue`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId: data.document.id }) });
      const issuedData = (await issued.json()) as { document?: { cae?: string; voucher_number?: number }; error?: string };
      if (!issued.ok || !issuedData.document?.cae) throw new Error(issuedData.error || "ARCA no autorizó la nota de crédito.");
      setFiscalMessage(`Nota de crédito autorizada: CAE ${issuedData.document.cae} · comprobante ${String(issuedData.document.voucher_number).padStart(8, "0")}.`); await loadFiscalSales();
    } catch (error) { setFiscalMessage(error instanceof Error ? error.message : "No se pudo emitir la nota de crédito."); }
    finally { setFiscalBusy(null); }
  };
  useEffect(() => {
    const timer = window.setTimeout(() => void loadFiscalSales(), 0);
    return () => window.clearTimeout(timer);
  // Recarga solo al cambiar la identidad; la función usa el estado del montaje actual.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role]);
  const getOutbox = () => {
    if (!user) return null;
    const userId = String(user.id);
    if (outboxRef.current?.userId !== userId) outboxRef.current = { userId, ready: OperationalOutbox.open(userId) };
    return outboxRef.current.ready;
  };
  const loadOperationalData = async () => {
    const response = await fetch(`${API_BASE}/operations/states`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("No se pudieron cargar las operaciones.");
    const data = (await response.json()) as {
      states: Record<string, { state: OperationalSnapshot; revision: number; centralOnly?: boolean }>;
    };
    centralOnlySites.current = new Set(
      Object.entries(data.states || {}).filter(([, entry]) => entry.centralOnly).map(([local]) => local),
    );
    // Un local con operaciones sin confirmar se muestra desde su último estado
    // encolado: el servidor todavía no las tiene y la próxima operación debe
    // continuar desde ellas, no desde una versión que las omite.
    const outbox = await getOutbox();
    const pendingSites = outbox?.sites() ?? [];
    const entries = [
      ...Object.entries(data.states || {}).filter(([local]) => !pendingSites.includes(local)),
      ...pendingSites.flatMap((local) => {
        const state = latestQueuedState(outbox?.get(local));
        return state ? [[local, { state, revision: data.states?.[local]?.revision ?? 0 }] as [string, { state: OperationalSnapshot; revision: number }]] : [];
      }),
    ];
    if (entries.length) {
      const all = <K extends keyof OperationalSnapshot>(key: K) =>
        entries.flatMap(([, entry]) =>
          Array.isArray(entry.state[key]) ? (entry.state[key] as unknown[]) : [],
        );
      setStock((items) => ({
        ...items,
        ...Object.fromEntries(
          entries.map(([local, entry]) => [
            local,
            completeStockMap(entry.state.stock as Record<number, unknown> | undefined, products),
          ]),
        ),
      }));
      setMinimumStock((items) => ({
        ...items,
        ...Object.fromEntries(
          entries.map(([local, entry]) => [
            local,
            entry.state.minimumStock || items[local],
          ]),
        ),
      }));
      setRealStock((items) => ({
        ...items,
        ...Object.fromEntries(
          entries.map(([local, entry]) => [
            local,
            entry.state.realStock || items[local],
          ]),
        ),
      }));
      setStockCountComments((items) => ({
        ...items,
        ...Object.fromEntries(
          entries.map(([local, entry]) => [
            local,
            entry.state.stockCountComments || items[local],
          ]),
        ),
      }));
      setSales(all("sales") as Sale[]);
      setPayments(all("payments") as Payment[]);
      // Compatibilidad con las primeras cargas del módulo: los registros
      // previos no incluían local y se recuperan dentro del mismo estado del
      // local, sin mezclarlos con la cartera de otra sucursal.
      setCustomers(entries.flatMap(([local, entry]) =>
        Array.isArray(entry.state.customers)
          ? (entry.state.customers as CustomerRecord[]).map(customer => ({ ...customer, site: customer.site || local }))
          : [],
      ));
      setStockRequests(all("stockRequests") as StockRequest[]);
      setSavedOrders(all("savedOrders") as SavedOrder[]);
      setCashAdjustments(all("cashAdjustments") as CashAdjustment[]);
      setPostCloseAdjustments(all("postCloseAdjustments") as PostCloseCancellationAdjustment[]);
      setCashLedger(all("cashLedger") as CashLedgerEntry[]);
      setShiftLog(all("shiftLog") as CashShift[]);
      setEnvelopeRecords(all("envelopeRecords") as EnvelopeRecord[]);
      setStockMovements(all("stockMovements") as StockMovement[]);
      setExpensesLog(all("expensesLog") as Expense[]);
      setReturnsLog(all("returnsLog") as ReturnTransaction[]);
      setCashTransfers(all("cashTransfers") as CashTransfer[]);
      setAttendanceRecords(all("attendanceRecords") as AttendanceRecord[]);
      setIncidents(all("incidents") as Incident[]);
      setStockAdjustments(all("stockAdjustments") as StockAdjustment[]);
      setAudit(all("audit") as AuditEvent[]);
      setCashFieldsBySite(
        Object.fromEntries(
          entries.map(([local, entry]) => [
            local,
            { ...EMPTY_CASH_FIELDS, ...entry.state.cash },
          ]),
        ),
      );
      setCashOpenBySite(
        Object.fromEntries(
          entries.map(([local, entry]) => [local, Boolean(entry.state.cashOpen)]),
        ),
      );
      setActiveShiftBySite(
        Object.fromEntries(
          entries.map(([local, entry]) => {
            const active = entry.state.activeShift ?? undefined;
            // Un turno que ya figura cerrado en el historial no puede seguir activo.
            const closed = active && entry.state.shiftLog?.some((shift) => shift.id === active.id && (shift.closedAtISO || shift.closedAt));
            return [local, closed ? undefined : active];
          }),
        ),
      );
      lastPersistedSnapshot.current = Object.fromEntries(
        entries.map(([local, entry]) => [local, JSON.stringify(entry.state)]),
      );
      queuedBaseSnapshot.current = { ...lastPersistedSnapshot.current };
      serverRevision.current = Object.fromEntries(
        entries.map(([local, entry]) => [local, entry.revision]),
      );
      const configuration = entries.find(([, entry]) => entry.state.prices || entry.state.limitsBySite || entry.state.schedules)?.[1].state;
      // Administración recibe todos los límites; cada local solo los propios.
      // Se combinan sobre los valores por defecto para no dejar un local sin límites.
      const receivedLimits = Object.assign({}, ...entries.map(([, entry]) => entry.state.limitsBySite ?? {})) as Record<string, OperationalLimits>;
      if (Object.keys(receivedLimits).length) setLimitsBySite((current) => ({ ...current, ...receivedLimits }));
      if (configuration?.schedules) setSchedules(configuration.schedules);
      if (configuration?.monthlyTargets) {
        setMonthlyTargets((targets) => ({ ...targets, ...configuration.monthlyTargets }));
        setMonthlyTargetDrafts((targets) => ({ ...targets, ...configuration.monthlyTargets }));
      }
    }
    setOperationalReady(true);
  };
  useEffect(() => {
    if (!user) return;
    const timer = window.setTimeout(() => {
      loadOperationalData().catch(() =>
        setMessage("No se pudieron recuperar las operaciones guardadas."),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  // Cargar nuevamente solo cuando cambia la identidad autenticada.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  useEffect(() => {
    if (user?.role !== "administracion" || tab !== "Administración") return;
    let active = true;
    const start = new Date(`${reportFrom}T12:00:00`);
    const end = new Date(`${reportTo}T12:00:00`);
    const days = Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86400000) + 1);
    const previousStart = new Date(start);
    previousStart.setDate(previousStart.getDate() - days);
    const params = new URLSearchParams({ from: dateKey(previousStart), to: reportTo });
    if (reportSite !== "Todos los locales") params.set("site", reportSite);
    fetch(`${API_BASE}/admin/report-sales?${params}`, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudo cargar el historial operativo.");
        const data = (await response.json()) as { sales?: Sale[]; payments?: Payment[] };
        if (active) { setPersistedReportSales(data.sales || []); setPersistedReportPayments(data.payments || []); }
      })
      .catch(() => { if (active) setPersistedReportSales(null); });
    return () => { active = false; };
  }, [user?.id, user?.role, tab, reportFrom, reportTo, reportSite, operationalVersion]);
  useEffect(() => {
    if (user?.role !== "administracion" || tab !== "Administración" || !["Auditoria", "Cajas"].includes(adminReport)) return;
    let active = true;
    const params = new URLSearchParams({ from: reportFrom, to: reportTo });
    if (reportSite !== "Todos los locales") params.set("site", reportSite);
    if (adminReport === "Auditoria") {
      if (auditUserFilter.trim()) params.set("user", auditUserFilter.trim());
      if (auditActionFilter.trim()) params.set("action", auditActionFilter.trim());
      fetch(`${API_BASE}/admin/audit?${params}`, { credentials: "include", cache: "no-store" })
        .then(async (response) => { if (!response.ok) throw new Error(); return (await response.json()) as { events?: AuditHistoryRow[] }; })
        .then((data) => { if (active) setAuditHistory(data.events || []); })
        .catch(() => { if (active) setAuditHistory([]); });
    } else {
      fetch(`${API_BASE}/admin/cash-history?${params}`, { credentials: "include", cache: "no-store" })
        .then(async (response) => { if (!response.ok) throw new Error(); return (await response.json()) as { sessions?: CashHistoryRow[] }; })
        .then((data) => { if (active) setCashHistory(data.sessions || []); })
        .catch(() => { if (active) setCashHistory([]); });
    }
    return () => { active = false; };
  }, [user?.id, user?.role, tab, adminReport, reportFrom, reportTo, reportSite, auditUserFilter, auditActionFilter, operationalVersion]);
  const operationalSnapshot = (local: string): OperationalSnapshot => {
    const localSales = sales.filter((item) => item.site === local);
    const saleIds = new Set(localSales.map((item) => item.id));
    const filterBySite = <T extends { site: string }>(items: T[]) =>
      items.filter((item) => item.site === local);
    // De un local que Central no opera solo se envía lo que puede gestionar;
    // el servidor ignora cualquier otro dato.
    if (centralOnlySites.current.has(local))
      return { stockRequests: filterBySite(stockRequests), stockAdjustments: filterBySite(stockAdjustments) };
    return {
      stock: stock[local] || {},
      minimumStock: minimumStock[local] || {},
      realStock: realStock[local] || {},
      stockCountComments: stockCountComments[local] || {},
      sales: localSales,
      payments: payments.filter((item) => item.saleId && saleIds.has(item.saleId)),
      customers: customers.filter((item) => item.site === local),
      stockRequests: filterBySite(stockRequests),
      savedOrders: filterBySite(savedOrders),
      cashAdjustments: filterBySite(cashAdjustments),
      postCloseAdjustments: filterBySite(postCloseAdjustments),
      cashLedger: filterBySite(cashLedger),
      // null y no undefined: JSON omite undefined y el servidor conservaría el
      // turno anterior como abierto después de cerrar la caja.
      activeShift: activeShiftBySite[local] ?? null,
      shiftLog: filterBySite(shiftLog),
      envelopeRecords: filterBySite(envelopeRecords),
      stockMovements: filterBySite(stockMovements),
      expensesLog: filterBySite(expensesLog),
      returnsLog: filterBySite(returnsLog),
      cashTransfers: cashTransfers.filter(
        (item) => item.originSite === local || item.destination === local,
      ),
      attendanceRecords: filterBySite(attendanceRecords),
      incidents: filterBySite(incidents),
      stockAdjustments: filterBySite(stockAdjustments),
      audit: filterBySite(audit),
      cash: cashFieldsBySite[local] || EMPTY_CASH_FIELDS,
      cashOpen: Boolean(cashOpenBySite[local]),
      priceCatalogVersion,
      prices,
      onlinePrices,
      limitsBySite,
      schedules,
      priceChanges,
      monthlyTargets,
    };
  };
  const refreshPendingCount = () => {
    const ready = getOutbox();
    if (!ready) return setPendingSync(0);
    void ready.then((outbox) => setPendingSync(outbox.count()));
  };
  type SendResult =
    | { kind: "saved"; revision?: number; merged?: boolean }
    | { kind: "retry"; message?: string }
    | { kind: "session" }
    | { kind: "rejected"; message: string };
  const sendPendingWrite = async (write: PendingOperationalWrite): Promise<SendResult> => {
    const body = JSON.stringify(write);
    let response: Response;
    try {
      // POST /sync evita las reglas de algunos hosting compartidos que bloquean
      // PUT o la ruta /operations antes de que la operación llegue a la API.
      // El requestId mantiene el envío idempotente si el navegador reintenta.
      response = await fetch(`${API_BASE}/sync`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // No usar keepalive en escrituras interactivas. Algunos navegadores
        // pueden completar el POST pero rechazar la respuesta cuando el cuerpo
        // se acerca a su cupo interno, mostrando falsamente "Failed to fetch".
        // La bandeja persistente y requestId idempotente ya protegen un cierre
        // o corte: el próximo inicio reintenta sin duplicar la operación.
        keepalive: false,
        body,
      });
    } catch (error) {
      return { kind: "retry", message: error instanceof Error ? error.message : "No se pudo contactar a la API." };
    }
    if (response.ok) {
      const data = (await response.json().catch(() => ({}))) as { revision?: number; merged?: boolean };
      return { kind: "saved", revision: data.revision, merged: data.merged };
    }
    if (response.status === 401) return { kind: "session" };
    // Sin respuesta útil, sobrecarga o conflicto transitorio: se reintenta igual.
    if (response.status >= 500 || [408, 409, 425, 429].includes(response.status)) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      return { kind: "retry", message: data.error || `La API respondió HTTP ${response.status}.` };
    }
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    return { kind: "rejected", message: data.error || `El servidor rechazó la operación (HTTP ${response.status}).` };
  };
  /**
   * Envía la cola de un local en orden estricto: el siguiente envío sale recién
   * cuando el anterior quedó confirmado. Un corte se reintenta con el mismo
   * requestId (el servidor no lo aplica dos veces); un rechazo definitivo deja
   * el local en espera con aviso, sin perder lo guardado ni frenar otros locales.
   */
  const drainSite = async (local: string) => {
    const outbox = await getOutbox();
    if (!outbox || drainingSites.current.has(local)) return;
    drainingSites.current.add(local);
    let lastResult: SendResult["kind"] | null = null;
    try {
      while (navigator.onLine) {
        const queue = outbox.get(local);
        const write = queue.writes[0];
        if (!write || queue.blocked) break;
        await outbox.markSent(local, write.requestId);
        // Si parte exactamente de lo que el servidor acaba de confirmar sin
        // combinar, la revisión vigente es la de esa confirmación y se aplica
        // directo; si no, conserva una revisión anterior y el servidor combina.
        const acknowledged = lastAcknowledged.current[local];
        const exactBase = acknowledged && !acknowledged.merged && acknowledged.stateJson === JSON.stringify(write.baseState);
        const result = await sendPendingWrite(exactBase ? { ...write, baseRevision: serverRevision.current[local] ?? write.baseRevision } : write);
        lastResult = result.kind;
        if (result.kind === "retry") {
          setMessage(`La operación quedó pendiente en este equipo. ${result.message || "Se reintentará sola."} No repitas el cobro.`);
          break;
        }
        if (result.kind === "session") {
          setMessage("Tu sesión venció. Volvé a ingresar: las operaciones pendientes siguen guardadas en este equipo y se enviarán.");
          break;
        }
        if (result.kind === "rejected") {
          await outbox.block(local, result.message);
          setMessage(`No se pudo guardar en ${local}: ${result.message} Las operaciones siguen guardadas en este equipo; avisá a Administración antes de cerrar la sesión.`);
          break;
        }
        await outbox.acknowledge(local, write.requestId);
        if (typeof result.revision === "number") serverRevision.current[local] = result.revision;
        lastPersistedSnapshot.current[local] = JSON.stringify(write.state);
        lastAcknowledged.current[local] = { stateJson: lastPersistedSnapshot.current[local], merged: Boolean(result.merged) };
        if (result.merged) reloadAfterDrain.current = true;
        const pendingReceipt = pendingReceiptRef.current;
        if (pendingReceipt && pendingReceipt.site === local && write.state.sales?.some((sale) => sale.id === pendingReceipt.id)) {
          pendingReceiptRef.current = null;
          setReceiptSale(pendingReceipt);
          setMessage(`Venta confirmada y guardada: ${money.format(pendingReceipt.net)}. Ya podés imprimir el ticket.`);
        }
        setSyncStatus("Operación guardada en la base de datos.");
      }
    } finally {
      drainingSites.current.delete(local);
      setPendingSync(outbox.count());
      // Una operación encolada mientras terminaba este envío no debe esperar al
      // próximo reintento automático.
      const remaining = outbox.get(local);
      if (lastResult === "saved" && remaining.writes.length && !remaining.blocked) void drainSite(local);
      // Recargar reemplaza el estado de todos los locales: solo se hace cuando
      // no queda nada sin confirmar que pudiera pisarse.
      if (reloadAfterDrain.current && outbox.count() === 0 && drainingSites.current.size === 0) {
        reloadAfterDrain.current = false;
        await loadOperationalData();
        setMessage("Se combinaron cambios hechos en otro equipo sin perder operaciones.");
      }
    }
  };
  const flushPendingWrites = async () => {
    const outbox = await getOutbox();
    if (!outbox || !navigator.onLine) return;
    // Cada local conserva su orden estricto y los locales se drenan también
    // en secuencia. Así los envíos keepalive chicos no compiten por el cupo
    // global del navegador cuando hay contingencias en más de un local.
    for (const local of outbox.sites()) await drainSite(local);
    setPendingSync(outbox.count());
    if (outbox.count() > 0) throw new Error("Quedan operaciones pendientes.");
  };
  useEffect(() => {
    if (!user || !operationalReady || operationalVersion === 0) return;
    const event = operationalEventRef.current || {
      action: "Actualización operativa",
      detail: "Cambios registrados en el sistema.",
    };
    const persistenceSites = user.accessAllLocations
      ? SITES
      : [...new Set([...(user.locations || [site]), ...centralOnlySites.current])];
    persistenceSites.forEach((local) => {
      const snapshot = operationalSnapshot(local);
      const serialized = JSON.stringify(snapshot);
      const baseJson = queuedBaseSnapshot.current[local] || lastPersistedSnapshot.current[local] || "{}";
      if (baseJson === serialized) return;
      const write: PendingOperationalWrite = {
        requestId: crypto.randomUUID(),
        site: local,
        state: snapshot,
        baseState: JSON.parse(baseJson) as OperationalSnapshot,
        baseRevision: serverRevision.current[local] || 0,
        event: {
          ...event,
          recordedAt: operationalNow().toISOString(),
          ...(testOperatingDate.active && local === testOperatingDate.site ? {
            testOperatingDate: testOperatingDate.businessDate,
            testLabel: "PRUEBA DE VALIDACIÓN",
          } : {}),
        },
        queuedAt: operationalNow().toISOString(),
      };
      queuedBaseSnapshot.current[local] = serialized;
      void getOutbox()?.then(async (outbox) => {
        // Se acumula con el envío pendiente solo si esta operación parte
        // exactamente de su estado.
        const latest = latestQueuedState(outbox.get(local));
        await outbox.enqueue(write, Boolean(latest) && JSON.stringify(latest) === baseJson);
        setPendingSync(outbox.count());
        await drainSite(local);
      }).catch(() => {
        setMessage("No se pudo guardar la operación en este equipo. No cierres la pestaña y avisá a Administración.");
      });
    });
  // La lista explícita evita guardar por cambios visuales ajenos a la operación.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    operationalVersion,
    operationalReady,
    user?.id,
    site,
    stock,
    minimumStock,
    realStock,
    stockCountComments,
    sales,
    payments,
    customers,
    stockRequests,
    savedOrders,
    cashAdjustments,
    postCloseAdjustments,
    cashLedger,
    activeShiftBySite,
    shiftLog,
    envelopeRecords,
    stockMovements,
    expensesLog,
    returnsLog,
    cashTransfers,
    attendanceRecords,
    incidents,
    stockAdjustments,
    testOperatingDate.active,
    testOperatingDate.site,
    testOperatingDate.businessDate,
    audit,
    cashFieldsBySite,
    cashOpenBySite,
    priceCatalogVersion,
    prices,
    onlinePrices,
    limitsBySite,
    schedules,
    priceChanges,
    monthlyTargets,
  ]);
  useEffect(() => {
    if (!user) return;
    const handleOffline = () => setConnectionMode("Contingencia");
    const handleOnline = () => {
      setConnectionMode("En línea");
      flushPendingWrites().catch(() => setMessage("La conexión volvió, pero todavía hay operaciones pendientes. Tocá Sincronizar."));
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    const initialTimer = window.setTimeout(() => {
      refreshPendingCount();
      if (!navigator.onLine) handleOffline();
      else flushPendingWrites().catch(() => undefined);
    }, 0);
    // Un corte breve no siempre dispara el evento "online": se reintenta solo.
    const retryTimer = window.setInterval(() => {
      if (navigator.onLine) flushPendingWrites().catch(() => undefined);
    }, 20000);
    return () => { window.clearTimeout(initialTimer); window.clearInterval(retryTimer); window.removeEventListener("offline", handleOffline); window.removeEventListener("online", handleOnline); };
  // La cola se reanuda al autenticar o cuando vuelve Internet.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  useEffect(() => {
    if (user) window.localStorage.setItem(`lartisan:last-site:${user.id}`, site);
  }, [site, user]);
  const methods = METHODS[site],
    cats = ["Todos", ...Array.from(new Set(products.map((p) => p.category)))],
    [cat, setCat] = useState("Todos");
  const visible = products.filter((product) =>
    (cat === "Todos" || product.category === cat) &&
    `${product.name} ${product.detail} ${product.category} ${product.code} ${product.barcode}`.toLowerCase().includes(productSearch.trim().toLowerCase()),
  );
  const stockGroups = useMemo(
    () => Array.from(new Set(products.map((product) => product.category))).sort((a, b) => a.localeCompare(b)),
    [products],
  );
  const visibleStockProducts = products.filter((product) => {
    const query = stockSearch.trim().toLowerCase();
    const matchesGroup = stockGroup === "Todos los grupos" || product.category === stockGroup;
    const matchesSearch = !query || `${product.name} ${product.detail} ${product.category} ${product.code} ${product.barcode}`.toLowerCase().includes(query);
    return matchesGroup && matchesSearch;
  });
  const total = cart.reduce((a, p) => a + p.price, 0);
  const isOnlineChannel = saleChannel === "Online";
  const selectedPrice = (product: Product) =>
    isOnlineChannel
      ? (onlinePrices[product.id] ?? Math.round(product.price * 1.25))
      : (prices[product.id] ?? product.price);
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
  const invitation = Object.values(invitedQuantities).some((quantity) => quantity > 0);
  const invitationTotal = lines
    .reduce(
      (sum, { p, q }) =>
        sum + p.price * Math.min(q, invitedQuantities[p.id] ?? 0),
      0,
    );
  const discountableTotal = total - invitationTotal;
  const discountAmount = Math.round((discountableTotal * discount) / 100);
  const net = discountableTotal - discountAmount;
  const splitPaymentTotal = splitPayments.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const activeShift = activeShiftBySite[site];
  const totals = methods.map((method) => ({
    method,
    amount: payments
      .filter((p) =>
        p.method === method &&
        (p.site
          ? p.site === site
          : Boolean(
              p.saleId &&
                sales.some((sale) =>
                  sale.id === p.saleId &&
                  sale.site === site &&
                  sale.status === "activa" &&
                  (!activeShift?.openedAtISO || Date.parse(sale.createdAtISO) >= Date.parse(activeShift.openedAtISO)),
                ),
            )) &&
        (!activeShift || !p.shiftId || p.shiftId === activeShift.id),
      )
      .reduce((a, p) => a + p.amount, 0),
  }));
  const requiresEnvelope = site !== "Novo Pacheco";
  const cashIsOpen = Boolean(cashOpenBySite[site]);
  const addProductToCart = (product: Product) => {
    if (!catalog.ready) {
      setMessage("Esperá a que cargue el catálogo central antes de agregar productos.");
      return false;
    }
    if (!cashIsOpen) {
      setMessage("Abrí la caja antes de agregar productos a la venta.");
      return false;
    }
    if ((stock[site]?.[product.id] ?? 0) < 1) {
      setMessage(`${product.name} no tiene stock disponible en ${site}. Cargá o confirmá el stock antes de venderlo.`);
      return false;
    }
    // Mantener el precio ya acordado de una línea si Central actualiza la lista.
    setCart((items) => [...items, items.find((item) => item.id === product.id) ?? { ...product, price: selectedPrice(product) }]);
    return true;
  };
  const addScannedProduct = (rawBarcode: string) => {
    const scanned = rawBarcode.trim().toUpperCase();
    if (!scanned) return;
    // Algunas lectoras configuradas con teclado US envían el guion como apóstrofe
    // en equipos con distribución española. Aceptamos ambas lecturas sin cambiar
    // el valor oficial impreso en la etiqueta (LART-XXX).
    const product = productFromScannedCode(scanned);
    if (!product) {
      const notice = `No reconocemos el código “${rawBarcode.trim()}”. Verificá la etiqueta.`;
      setScannerResult(notice);
      setMessage(notice);
      return;
    }
    if (addProductToCart(product)) {
      setScannerResult(`Agregado: ${product.name} · ${product.detail}.`);
      return;
    }
    setScannerResult(
      !cashIsOpen
        ? "No se agregó: primero abrí la caja del local seleccionado."
        : `No se agregó: ${product.name} no tiene stock disponible en ${site}.`,
    );
  };
  const captureSalesScan = (rawBarcode: string) => {
    if (!productFromScannedCode(rawBarcode)) return;
    setSalesScannerValue("");
    addScannedProduct(rawBarcode);
    requestAnimationFrame(() => salesScannerRef.current?.focus());
  };
  const startScannedReception = (request: StockRequest) => {
    setReceivingRequestId(request.id);
    setReceivedScanCounts({});
    setReceivingScanNotice(`Pedido ${request.id.slice(0, 8)} listo para recibir. Escaneá cada unidad entregada.`);
    setReceivingBarcodeInput("");
    requestAnimationFrame(() => receptionScannerRef.current?.focus());
  };
  const startManualReception = (request: StockRequest) => {
    setReceivingRequestId(request.id);
    setReceivedScanCounts({});
    setReceivingBarcodeInput("");
    setReceivingScanNotice(`Pedido ${request.id.slice(0, 8)} listo para recepción manual. Contá cada producto y cargá las unidades entregadas.`);
  };
  const adjustManualReceptionCount = (request: StockRequest, productId: number, change: number) => {
    const line = request.lines.find((item) => item.productId === productId);
    if (!line) return;
    const expected = line.preparedQuantity ?? line.quantity;
    const current = receivedScanCounts[productId] || 0;
    const next = Math.max(0, Math.min(expected, current + change));
    if (next === current) return;
    const product = products.find((item) => item.id === productId);
    setReceivedScanCounts((items) => ({ ...items, [productId]: next }));
    setReceivingScanNotice(`Recepción manual: ${product?.name || "producto"} · ${next} de ${expected} unidad${expected === 1 ? "" : "es"}.`);
  };
  const scanReceivedProduct = (rawBarcode: string, requestOverride?: StockRequest, receivedOverride?: Record<number, number>) => {
    const scanned = rawBarcode.trim().toUpperCase();
    const product = productFromScannedCode(scanned);
    const request = requestOverride ?? stockRequests.find((item) => item.id === receivingRequestId);
    if (!request || !product) {
      setReceivingScanNotice(`Código no reconocido: ${rawBarcode}.`);
      return;
    }
    const line = request.lines.find((item) => item.productId === product.id);
    if (!line) {
      setReceivingScanNotice(`${product.name} no está incluido en este pedido. No se ingresó al stock.`);
      return;
    }
    const expected = line.preparedQuantity ?? line.quantity;
    const received = (receivedOverride ?? receivedScanCounts)[product.id] || 0;
    if (received >= expected) {
      setReceivingScanNotice(`${product.name}: ya se escanearon las ${expected} unidades esperadas.`);
      return;
    }
    const next = received + 1;
    setReceivedScanCounts((items) => ({ ...items, [product.id]: next }));
    setReceivingBarcodeInput("");
    setReceivingScanNotice(`Validado: ${product.name} · ${next} de ${expected} unidad${expected === 1 ? "" : "es"}.`);
  };
  const capturePedidoScan = (rawBarcode: string) => {
    const product = productFromScannedCode(rawBarcode);
    if (!product) return;
    const request = stockRequests.find(
      (item) => item.site === site && ["Despachado", "Despachado parcial"].includes(item.status),
    );
    if (!request) {
      setReceivingScanNotice("No hay un pedido despachado pendiente de recibir para este local.");
      return;
    }
    const startingRequest = receivingRequestId !== request.id;
    if (startingRequest) {
      setReceivingRequestId(request.id);
      setReceivedScanCounts({});
      setReceivingScanNotice(`Pedido ${request.id.slice(0, 8)} iniciado. Validando mercadería recibida.`);
    }
    setPedidoScannerValue("");
    scanReceivedProduct(rawBarcode, request, startingRequest ? {} : undefined);
    requestAnimationFrame(() => pedidoScannerRef.current?.focus());
  };
  const confirmScannedReception = (request: StockRequest) => {
    const missing = request.lines.find((line) => (receivedScanCounts[line.productId] || 0) !== (line.preparedQuantity ?? line.quantity));
    if (missing) {
      const product = products.find((item) => item.id === missing.productId);
      return setReceivingScanNotice(`Falta validar ${product?.name || "un producto"}. El stock no se modificó.`);
    }
    confirmRequestReception(request);
    setReceivingRequestId(null);
    setReceivedScanCounts({});
    setReceivingScanNotice("");
  };
  useEffect(() => {
    if (tab !== "Ventas") return;
    requestAnimationFrame(() => salesScannerRef.current?.focus());
  }, [tab]);
  useEffect(() => {
    if (tab !== "Pedido") return;
    requestAnimationFrame(() => pedidoScannerRef.current?.focus());
  }, [tab]);
  useEffect(() => {
    if (tab !== "Ventas" && tab !== "Pedido") return;
    const onScannerKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || event.key.length !== 1) return;
      const now = Date.now();
      const active = document.activeElement;
      const activeInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null;
      // Durante la recepción, el foco lo toma el capturador invisible. Su onChange
      // procesa la lectura para que no se contabilice dos veces.
      if (activeInput === receptionScannerRef.current || activeInput === salesScannerRef.current || activeInput === pedidoScannerRef.current) return;
      const buffer = scannerBufferRef.current;
      // Algunas lectoras USB envían los caracteres más despacio que otras.
      // Conservamos la lectura como una misma secuencia durante 800 ms para
      // que no se descarte un Code 128 físico aunque no tenga foco un campo.
      if (now - buffer.lastKeyAt > 800) {
        buffer.value = "";
        buffer.input = activeInput;
        buffer.originalValue = activeInput?.value ?? "";
      }
      buffer.lastKeyAt = now;
      buffer.value += event.key;
      const product = productFromScannedCode(buffer.value);
      if (!product) return;
      event.preventDefault();
      const scanned = buffer.value;
      const sourceInput = buffer.input;
      const originalValue = buffer.originalValue;
      buffer.value = "";
      buffer.input = null;
      if (sourceInput) {
        requestAnimationFrame(() => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          if (sourceInput instanceof HTMLTextAreaElement) {
            const textAreaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
            textAreaSetter?.call(sourceInput, originalValue);
          } else setter?.call(sourceInput, originalValue);
          sourceInput.dispatchEvent(new Event("input", { bubbles: true }));
        });
      }
      if (tab === "Pedido") capturePedidoScan(scanned);
      else captureSalesScan(scanned);
    };
    window.addEventListener("keydown", onScannerKey, true);
    return () => window.removeEventListener("keydown", onScannerKey, true);
  }, [tab, site, cashIsOpen, stock, prices, onlinePrices, products, catalog.ready, saleChannel, receivingRequestId, stockRequests, receivedScanCounts]);
  const siteLimits = limitsBySite[site];
  // La conciliación en pantalla corresponde exclusivamente al turno abierto.
  // Una anulación posterior conserva su asiento en el libro mayor del turno
  // original, pero no puede convertir una caja cerrada en un falso saldo.
  const currentCashLedger = activeShift?.id
    ? cashLedger.filter(
        (entry) => entry.site === site && entry.shiftId === activeShift.id,
      )
    : [];
  const siteCashLedger = cashLedger.filter((entry) => entry.site === site);
  const ledgerCashBalance = currentCashLedger.reduce(
    (total, entry) => total + entry.cashImpact,
    0,
  );
  const appendCashLedgerEntry = (
    entry: Omit<CashLedgerEntry, "id" | "site" | "at" | "createdBy">,
  ) => {
    const now = operationalNow();
    const ledgerEntry: CashLedgerEntry = {
      id: crypto.randomUUID(),
      site,
      shiftId: entry.shiftId ?? activeShift?.id,
      at: now.toLocaleString("es-AR"),
      atISO: now.toISOString(),
      createdBy: user?.name || "Sistema",
      ...entry,
    };
    setCashLedger((items) => [ledgerEntry, ...items]);
    return ledgerEntry;
  };
  const recordStockMovement = (
    movement: Omit<StockMovement, "id" | "site" | "at" | "atISO" | "createdBy"> & { site?: string },
  ) => {
    const now = operationalNow();
    const entry: StockMovement = {
      id: crypto.randomUUID(),
      site: movement.site || site,
      at: now.toLocaleString("es-AR"),
      atISO: now.toISOString(),
      createdBy: user?.name || "Sistema",
      ...movement,
    };
    setStockMovements((items) => [entry, ...items]);
    return entry;
  };
  // Administración es el rol propietario: ningún permiso agregado después de
  // iniciar sesión debe ocultarle un módulo operativo.
  const can = (permission: string) =>
    user?.role === "administracion" || Boolean(user?.actionPermissions.includes(permission));
  const canAdjustStock = can("stock");
  const canCountRealStock = can("stock");
  const canApproveStockAdjustments =
    (user?.role === "administracion" || user?.role === "supervisora") && can("stock");
  const canManageSchedules =
    user?.role === "supervisora" && user.reportPermissions.includes("Personal");
  const canViewSupervisorReports =
    user?.role === "supervisora" && user.reportPermissions.length > 0;
  const managesCentralOrders =
    can("pedidos") &&
    site === "Villa Mitre" &&
    (user?.role === "supervisora" ||
      user?.accessAllLocations ||
      user?.location === "Villa Mitre" ||
      user?.locations?.includes("Villa Mitre"));
  const pendingResetFor = (profile: ManagedUser) =>
    resetRequests.find(
      (request) =>
        request.status === "Pendiente" &&
        (request.userId === profile.id || request.username.toLowerCase() === profile.username.toLowerCase()),
    );
  const currentRequestLines = products.filter(
    (product) => (requestQuantities[product.id] || 0) > 0,
  ).map((product) => ({
    productId: product.id,
    quantity: requestQuantities[product.id],
  }));
  const lowStockProducts = products.map((product) => ({
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
    products.filter((product) => {
      const minimum = minimumStock[local][product.id] || 0;
      return minimum > 0 && (stock[local][product.id] || 0) <= minimum;
    }).map((product) => ({
      site: local,
      product,
      current: stock[local][product.id] || 0,
      minimum: minimumStock[local][product.id] || 0,
    })),
  );
  const roleTasks = [
    ...(!cashIsOpen && user?.role !== "administracion"
      ? [{ title: "Abrir caja", detail: `${site}: declarando el fondo inicial y responsable.`, action: "Caja" }]
      : []),
    ...savedOrders
      .filter((order) => order.site === site)
      .map((order) => ({ title: "Comanda abierta", detail: `${order.customer} · ${order.items.length} productos.`, action: "Ventas" })),
    ...(!managesCentralOrders
      ? lowStockProducts.map(({ product, current, minimum }) => ({ title: "Stock bajo", detail: `${product.name}: ${current}/${minimum}.`, action: "Pedido" }))
      : []),
    ...stockRequests
      .filter((request) => request.site === site && (request.status === "Despachado" || request.status === "Despachado parcial"))
      .map((request) => ({ title: "Confirmar recepción", detail: `Pedido ${request.id.slice(0, 8)} enviado por Central.`, action: "Pedido" })),
    ...(managesCentralOrders
      ? stockRequests
          .filter((request) => request.status === "Pendiente" || request.status === "En preparación")
          .map((request) => ({ title: "Preparar pedido", detail: `${request.site} · ${request.status}.`, action: "Central de pedidos" }))
      : []),
    ...(canApproveStockAdjustments
      ? stockAdjustments
          .filter((adjustment) => adjustment.status === "Pendiente")
          .map((adjustment) => ({ title: "Aprobar ajuste", detail: `${adjustment.site} · ajuste de inventario.`, action: "Central de pedidos" }))
      : []),
    ...(user?.role === "administracion"
      ? [
          ...aiSupportRequests
            .filter((request) => request.status === "pendiente")
            .map((request) => ({ title: "Consulta para Administración", detail: `${request.userName}${request.site ? ` · ${request.site}` : ""}: ${request.question}`, action: "Tareas" })),
          { title: "Activar respaldos externos", detail: "Pendiente técnico: conectar Drive, proteger la credencial y programar copias los lunes y jueves a las 21:00.", action: "Protección de datos" },
          { title: "Revisar alertas operativas", detail: "Controlá cajas, stock, pedidos y comprobantes pendientes.", action: "Administración" },
        ]
      : []),
  ];
  const selectedRequest = stockRequests.find(
    (request) => request.id === selectedRequestId,
  );
  const reportSites = SITES.filter(
    (local) => reportSite === "Todos los locales" || local === reportSite,
  );
  const reportSourceSales = persistedReportSales ?? sales;
  const reportSourcePayments = persistedReportSales === null ? payments : persistedReportPayments;
  const reportSales = reportSourceSales.filter((sale) => {
    const day = sale.createdAtISO?.slice(0, 10);
    return Boolean(
      day &&
        sale.status === "activa" &&
        reportSites.includes(sale.site) &&
        day >= reportFrom &&
        day <= reportTo,
    );
  });
  const reportSaleIds = new Set(reportSales.map((sale) => sale.id));
  const reportPayments = reportSourcePayments.filter(
    (paymentItem) => paymentItem.saleId && reportSaleIds.has(paymentItem.saleId),
  );
  const adminRows = reportSites
    .map((local) => {
      const matching = reportSales.filter((sale) => sale.site === local);
      return {
        site: local,
        gross: matching.reduce((sum, sale) => sum + sale.gross, 0),
        net: matching.reduce((sum, sale) => sum + sale.net, 0),
        tickets: matching.length,
        status: cashOpenBySite[local] ? "Abierta" : "Cerrada",
        source: "Operaciones guardadas",
      };
    });
  const adminTotals = adminRows.reduce(
    (total, row) => ({
      gross: total.gross + row.gross,
      net: total.net + row.net,
      tickets: total.tickets + row.tickets,
    }),
    { gross: 0, net: 0, tickets: 0 },
  );
  const paymentReportRows = Array.from(
    reportPayments.reduce((summary, paymentItem) => {
      summary.set(
        paymentItem.method,
        (summary.get(paymentItem.method) || 0) + paymentItem.amount,
      );
      return summary;
    }, new Map<string, number>()),
    ([method, amount]) => ({ method, amount }),
  ).sort((a, b) => b.amount - a.amount);
  const soldCollectedRows = reportSites.map((local) => {
    const localSales = reportSales.filter((sale) => sale.site === local);
    const ids = new Set(localSales.map((sale) => sale.id));
    const sold = localSales.reduce((total, sale) => total + sale.net, 0);
    const collected = reportSourcePayments
      .filter((paymentItem) => paymentItem.saleId && ids.has(paymentItem.saleId))
      .reduce((total, paymentItem) => total + paymentItem.amount, 0);
    return { site: local, sold, collected, difference: collected - sold };
  });
  const rangeStart = new Date(`${reportFrom}T12:00:00`);
  const rangeEnd = new Date(`${reportTo}T12:00:00`);
  const reportDays = Math.max(
    1,
    Math.floor((rangeEnd.getTime() - rangeStart.getTime()) / 86400000) + 1,
  );
  const previousEnd = new Date(rangeStart);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - reportDays + 1);
  const previousFrom = dateKey(previousStart);
  const previousTo = dateKey(previousEnd);
  const previousSales = reportSourceSales.filter((sale) => {
    const day = sale.createdAtISO?.slice(0, 10);
    return Boolean(
      day &&
        sale.status === "activa" &&
        reportSites.includes(sale.site) &&
        day >= previousFrom &&
        day <= previousTo,
    );
  });
  const evolutionRows = reportSites.map((local) => {
    const current = reportSales
      .filter((sale) => sale.site === local)
      .reduce((total, sale) => total + sale.net, 0);
    const previous = previousSales
      .filter((sale) => sale.site === local)
      .reduce((total, sale) => total + sale.net, 0);
    const change = previous > 0 ? ((current - previous) / previous) * 100 : null;
    return { site: local, current, previous, change };
  });
  const today = new Date();
  const currentMonthFrom = dateKey(new Date(today.getFullYear(), today.getMonth(), 1));
  const isCurrentMonthToDate = reportFrom === currentMonthFrom && reportTo === dateKey(today);
  const daysInCurrentMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const projectedNet = isCurrentMonthToDate && today.getDate() > 0
    ? Math.round((adminTotals.net / today.getDate()) * daysInCurrentMonth)
    : null;
  const selectedTarget = reportSites.reduce(
    (total, local) => total + (monthlyTargets[local] || 0),
    0,
  );
  const targetProgress = selectedTarget > 0
    ? Math.round((adminTotals.net / selectedTarget) * 100)
    : null;
  const productPerformance = Array.from(
    reportSales.reduce((summary, sale) => {
      sale.items.forEach((product) => {
        const current = summary.get(product.id) || {
          id: product.id,
          name: product.name,
          category: products.find((catalogProduct) => catalogProduct.id === product.id)?.category || product.category,
          units: 0,
          gross: 0,
        };
        current.units += 1;
        current.gross += product.price;
        summary.set(product.id, current);
      });
      return summary;
    }, new Map<number, { id: number; name: string; category: string; units: number; gross: number }>()),
    ([, row]) => row,
  ).sort((a, b) => b.units - a.units || b.gross - a.gross);
  const profitabilityRows = Array.from(
    reportSales.reduce((summary, sale) => {
      const saleGross = sale.items.reduce((total, product) => total + product.price, 0);
      sale.items.forEach((product) => {
        const current = summary.get(product.id) || {
          id: product.id,
          name: product.name,
          category: products.find((catalogProduct) => catalogProduct.id === product.id)?.category || product.category,
          units: 0,
          gross: 0,
          discount: 0,
          net: 0,
        };
        const allocatedDiscount = saleGross > 0 ? (sale.discount * product.price) / saleGross : 0;
        current.units += 1;
        current.gross += product.price;
        current.discount += allocatedDiscount;
        current.net += Math.max(0, product.price - allocatedDiscount);
        summary.set(product.id, current);
      });
      return summary;
    }, new Map<number, { id: number; name: string; category: string; units: number; gross: number; discount: number; net: number }>()),
    ([, row]) => row,
  ).sort((a, b) => b.net - a.net || b.units - a.units);
  const profitabilityByCategory = Array.from(
    profitabilityRows.reduce((summary, row) => {
      const current = summary.get(row.category) || { category: row.category, units: 0, gross: 0, discount: 0, net: 0 };
      current.units += row.units;
      current.gross += row.gross;
      current.discount += row.discount;
      current.net += row.net;
      summary.set(row.category, current);
      return summary;
    }, new Map<string, { category: string; units: number; gross: number; discount: number; net: number }>()),
    ([, row]) => row,
  ).sort((a, b) => b.net - a.net);
  const stockReportRows = products.map((product) => {
    const sites = reportSites.map((local) => ({
      site: local,
      stock: safeStockQuantity(stock[local]?.[product.id]),
      minimum: Math.max(0, Number(minimumStock[local]?.[product.id]) || 0),
    }));
    const lowest = sites.reduce((current, row) => row.stock < current.stock ? row : current, sites[0]);
    return {
      id: product.id,
      name: product.name,
      category: product.category,
      stock: sites.reduce((total, row) => total + row.stock, 0),
      minimum: sites.reduce((total, row) => total + row.minimum, 0),
      lowestSite: lowest?.site || "—",
      lowestStock: lowest?.stock || 0,
      belowMinimum: sites.some((row) => row.stock <= row.minimum),
    };
  }).sort((a, b) => Number(b.belowMinimum) - Number(a.belowMinimum) || a.lowestStock - b.lowestStock || a.name.localeCompare(b.name));
  const stockMovementsForReport = stockMovements
    .filter((movement) => {
      const day = movement.atISO?.slice(0, 10);
      return Boolean(day && reportSites.includes(movement.site) && day >= reportFrom && day <= reportTo);
    })
    .sort((a, b) => (b.atISO || "").localeCompare(a.atISO || ""));
  const pendingStockAdjustments = stockAdjustments.filter((adjustment) =>
    adjustment.status === "Pendiente" && reportSites.includes(adjustment.site),
  );
  const promotionRows = reportSites.map((local) => {
    const localSales = reportSales.filter((sale) => sale.site === local);
    const discounted = localSales.filter((sale) => sale.discount > 0);
    const invited = localSales.filter((sale) => sale.invitation || Object.values(sale.invitedQuantities || {}).some((quantity) => quantity > 0));
    const invitationUnits = invited.reduce((total, sale) => total + Object.values(sale.invitedQuantities || {}).reduce((sum, quantity) => sum + quantity, 0), 0);
    const gross = discounted.reduce((total, sale) => total + sale.gross, 0);
    const discount = discounted.reduce((total, sale) => total + sale.discount, 0);
    return { site: local, operations: localSales.filter((sale) => sale.discount > 0 || sale.invitation || Object.values(sale.invitedQuantities || {}).some((quantity) => quantity > 0)).length, discounted: discounted.length, invited: invited.length, invitationUnits, gross, discount, net: gross - discount };
  });
  const promotionTotals = promotionRows.reduce((total, row) => ({
    operations: total.operations + row.operations,
    discounted: total.discounted + row.discounted,
    invited: total.invited + row.invited,
    invitationUnits: total.invitationUnits + row.invitationUnits,
    gross: total.gross + row.gross,
    discount: total.discount + row.discount,
    net: total.net + row.net,
  }), { operations: 0, discounted: 0, invited: 0, invitationUnits: 0, gross: 0, discount: 0, net: 0 });
  const cashReportRows = reportSites.map((local) => {
    const active = activeShiftBySite[local];
    const lastClosed = shiftLog.find((shift) => shift.site === local && shift.closedAt);
    return {
      site: local,
      status: cashOpenBySite[local] ? "Abierta" : "Cerrada",
      openedBy: active?.openedBy || "—",
      openedAt: active?.openedAt || "—",
      lastClosedAt: lastClosed?.closedAt || "Sin cierre registrado",
      lastClosedBy: lastClosed?.closedBy || "—",
    };
  });
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
        detail: "Requiere aprobación de un perfil autorizado.",
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
  const cashControlIsOpen = Boolean(cashIsOpen && activeShift?.id);
  const expected = cashControlIsOpen ? ledgerCashBalance - expenses - withdrawals : 0,
    cashRemaining = cashControlIsOpen ? counted - (requiresEnvelope ? envelope : 0) : 0,
    cashVariance = cashControlIsOpen ? counted - expected : 0;
  const logout = async () => {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      credentials: "include",
    }).catch(() => undefined);
    setUser(null);
    setPassword("");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setMessage("");
  };
  useEffect(() => {
    if (!user) return;
    const inactivityMs = 30 * 60 * 1000;
    let timeout = 0;
    const closeForInactivity = () => {
      void fetch(`${API_BASE}/auth/logout`, {
        method: "POST",
        credentials: "include",
      }).catch(() => undefined);
      setUser(null);
      setPassword("");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setMessage("La sesión se cerró por 30 minutos sin actividad. Volvé a ingresar para continuar.");
    };
    const resetInactivityTimer = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(closeForInactivity, inactivityMs);
    };
    const activityEvents: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart", "scroll"];
    activityEvents.forEach((event) => window.addEventListener(event, resetInactivityTimer, { passive: true }));
    resetInactivityTimer();
    return () => {
      window.clearTimeout(timeout);
      activityEvents.forEach((event) => window.removeEventListener(event, resetInactivityTimer));
    };
  }, [user]);
  const changeOwnPassword = async () => {
    if (newPassword !== confirmNewPassword) {
      setMessage("Las nuevas contraseñas no coinciden.");
      return;
    }
    if (newPassword.length < 8) {
      setMessage("La nueva contraseña debe tener al menos 8 caracteres.");
      return;
    }
    const response = await fetch(`${API_BASE}/auth/change-password`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = (await response.json()) as ApiPayload;
    if (!response.ok) {
      setMessage(data.error || "No se pudo cambiar la contraseña.");
      return;
    }
    setUser(null);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setMessage("Contraseña actualizada. Ingresá nuevamente.");
  };
  const enter = async () => {
    if (!login.trim() || !password) {
      setMessage("Ingresá tu usuario y contraseña.");
      return;
    }
    setAuthLoading(true);
    setMessage("");
    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: login.trim(), password }),
      });
      const data = (await response.json()) as ApiPayload;
      if (!response.ok) {
        setMessage(data.error || "No se pudo iniciar sesión.");
        return;
      }
      if (!applyAuthenticatedUser(data.user)) {
        await fetch(`${API_BASE}/auth/logout`, {
          method: "POST",
          credentials: "include",
        });
        return;
      }
      setPassword("");
      if (data.user.role === "administracion") setAdminReport("Resumen");
    } catch {
      setMessage("No pudimos conectar con el acceso seguro. Intentá nuevamente.");
    } finally {
      setAuthLoading(false);
    }
  };
  const createManagedUser = async () => {
    const cleanName = newUserName.trim();
    const cleanUsername = newUserUsername.trim().toLowerCase();
    const validInternalUsername = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(cleanUsername);
    const validWorkEmail = /^[a-z0-9._%+-]+@lartisantaller\.com$/.test(cleanUsername);
    const fieldErrors: Record<string, string> = {};
    if (!cleanName) fieldErrors.fullName = "Ingresá nombre y apellido.";
    if (!validInternalUsername && !validWorkEmail) fieldErrors.username = "Usá nombre.apellido o un correo @lartisantaller.com.";
    if (!newUserAllLocations && newUserSites.length === 0) fieldErrors.locations = "Seleccioná al menos un local o Todos los locales.";
    if (newUserPassword.length < 8 || !/[a-z]/.test(newUserPassword) || !/[A-Z]/.test(newUserPassword) || !/\d/.test(newUserPassword) || !/[^a-zA-Z0-9]/.test(newUserPassword)) fieldErrors.temporaryPassword = "Usá 8 o más caracteres con mayúscula, minúscula, número y símbolo.";
    if (Object.keys(fieldErrors).length) {
      setNewUserFieldErrors(fieldErrors);
      setMessage("Revisá los campos marcados.");
      return;
    }
    if (
      managedUsers.some(
        (profile) =>
          profile.name.toLowerCase() === cleanName.toLowerCase() ||
          profile.username.toLowerCase() === cleanUsername,
      )
    )
      return setMessage("Ya existe un usuario con ese nombre.");
    const response = await fetch(`${API_BASE}/admin/users`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: cleanUsername,
        fullName: cleanName,
        role: newUserRole,
        assignedLocation: newUserAllLocations ? null : newUserSites[0] || "Recoleta",
        assignedLocations: newUserAllLocations ? SITES : newUserSites,
        accessAllLocations: newUserAllLocations,
        temporaryPassword: newUserPassword,
        mfaRequired: newUserMfaRequired,
        reportPermissions:
          newUserRole === "administracion" ? ADMIN_REPORTS.map((report) => report.id) : [],
        actionPermissions: defaultActionPermissions(newUserRole),
      }),
    });
    const data = (await response.json()) as ApiPayload;
    if (!response.ok) {
      setNewUserFieldErrors(data.fields || {});
      setMessage(data.error || "No se pudo crear el usuario.");
      return;
    }
    await loadAdminSecurityData();
    setCreatedUserCredentials({
      name: cleanName,
      username: cleanUsername,
      password: newUserPassword,
    });
    setNewUserName("");
    setNewUserUsername("");
    setNewUserPassword("");
    setNewUserFieldErrors({});
    setNewUserSites(["Recoleta"]);
    setNewUserAllLocations(false);
    setNewUserMfaRequired(false);
    setMessage(`Usuario ${cleanName} creado y habilitado.`);
  };
  const updateManagedUser = async (id: string, changes: Partial<ManagedUser>) => {
    setManagedUsers((profiles) =>
      profiles.map((profile) =>
        profile.id === id ? { ...profile, ...changes } : profile,
      ),
    );
    try {
      const response = await fetch(`${API_BASE}/admin/users/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: changes.role,
          assignedLocation: changes.location,
          assignedLocations: changes.locations,
          accessAllLocations: changes.accessAllLocations,
          active: changes.active,
          mfaRequired: changes.mfaRequired,
          reportPermissions: changes.reportPermissions,
          actionPermissions: changes.actionPermissions,
        }),
      });
      if (response.ok) return true;
      const data = (await response.json()) as ApiPayload;
      setMessage(data.error || "No se pudo guardar el cambio del usuario.");
      await loadAdminSecurityData();
      return false;
    } catch {
      setMessage("No se pudo conectar con el servicio de usuarios.");
      await loadAdminSecurityData();
      return false;
    }
  };
  const saveActionPermissions = async (profile: ManagedUser) => {
    const permissions = actionPermissionDrafts[profile.id];
    if (!permissions) return;
    setSavingPermissionsFor(profile.id);
    const saved = await updateManagedUser(profile.id, { actionPermissions: permissions });
    setSavingPermissionsFor(null);
    if (!saved) return;
    setActionPermissionDrafts((drafts) => {
      const next = { ...drafts };
      delete next[profile.id];
      return next;
    });
    setMessage(`Permisos de ${profile.name} guardados correctamente.`);
  };
  const requestPasswordReset = async () => {
    if (!login.trim()) return setMessage("Ingresá primero tu nombre de usuario.");
    setRecoverySending(true);
    try {
      const response = await fetch(`${API_BASE}/auth/request-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: login.trim() }),
      });
      const data = (await response.json()) as ApiPayload;
      if (!response.ok) {
        setMessage(data.error || "No se pudo iniciar la recuperación.");
        return;
      }
      if (portal === "admin" && data.delivery === "email_code") {
        setRecoveryStage("code");
        setRecoveryCode("");
        setRecoveryPassword("");
        setRecoveryPasswordConfirm("");
      }
      setMessage(
        data.message ||
          "Solicitud enviada a Administración. Te asignarán una contraseña temporal.",
      );
    } catch {
      setMessage("No se pudo enviar la solicitud. Intentá nuevamente.");
    } finally {
      setRecoverySending(false);
    }
  };
  const confirmEmailRecovery = async () => {
    if (!/^\d{6}$/.test(recoveryCode)) {
      return setMessage("Ingresá el código de 6 dígitos recibido por correo.");
    }
    if (recoveryPassword !== recoveryPasswordConfirm) {
      return setMessage("Las nuevas contraseñas no coinciden.");
    }
    setRecoverySending(true);
    try {
      const response = await fetch(`${API_BASE}/auth/confirm-reset-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: login.trim(),
          code: recoveryCode,
          newPassword: recoveryPassword,
        }),
      });
      const data = (await response.json()) as ApiPayload;
      if (!response.ok) {
        setMessage(data.error || "No se pudo actualizar la contraseña.");
        return;
      }
      setRecoveryStage("idle");
      setRecoveryCode("");
      setRecoveryPassword("");
      setRecoveryPasswordConfirm("");
      setPassword("");
      setMessage(data.message || "Contraseña actualizada. Ya podés ingresar.");
    } catch {
      setMessage("No se pudo validar el código. Intentá nuevamente.");
    } finally {
      setRecoverySending(false);
    }
  };
  const resetPassword = async (request: PasswordResetRequest) => {
    const temporaryPassword = `Lart@${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}9A`;
    const response = await fetch(`${API_BASE}/admin/reset-password`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: Number(request.id),
        temporaryPassword,
      }),
    });
    const data = (await response.json()) as ApiPayload;
    if (!response.ok) {
      setMessage(data.error || "No se pudo generar la contraseña temporal.");
      return;
    }
    await loadAdminSecurityData();
    setGeneratedTemporaryPassword({
      username: request.username,
      password: temporaryPassword,
    });
    setMessage(`La contraseña temporal de ${request.username} quedó lista para copiar.`);
  };
  const resetManagedUserPassword = async (profile: ManagedUser) => {
    if (
      !window.confirm(
        `¿Restablecer la contraseña de ${profile.name}? Su clave actual y sus sesiones abiertas dejarán de funcionar.`,
      )
    )
      return;
    setResettingUserId(profile.id);
    setGeneratedTemporaryPassword(null);
    setMessage("");
    try {
      const response = await fetch(
        `${API_BASE}/admin/users/${profile.id}/reset-password`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        },
      );
      const data = (await response.json()) as ApiPayload;
      if (!response.ok) {
        setMessage(data.error || "No se pudo restablecer la contraseña.");
        return;
      }
      setGeneratedTemporaryPassword({
        username: data.username || profile.username,
        password: data.temporaryPassword || "",
      });
      await loadAdminSecurityData();
      setMessage(`La contraseña temporal de ${profile.name} quedó lista para copiar.`);
      window.setTimeout(
        () =>
          document
            .getElementById("temporary-password-result")
            ?.scrollIntoView({ behavior: "smooth", block: "center" }),
        50,
      );
    } catch {
      setMessage("No se pudo conectar con el servicio de usuarios. Intentá nuevamente.");
    } finally {
      setResettingUserId(null);
    }
  };
  const increasedPrice = (productId: number) => {
    const increased = prices[productId] * (1 + priceIncrease / 100);
    return priceRounding <= 1
      ? Math.round(increased)
      : Math.ceil(increased / priceRounding) * priceRounding;
  };
  const applyPriceIncrease = async () => {
    if (priceIncrease <= 0 || priceIncrease > 100)
      return setMessage(
        "Ingresá un porcentaje mayor a 0 y menor o igual a 100.",
      );
    const affected = products.filter(
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
    const change: PriceChange = {
      id: crypto.randomUUID(),
      at: new Date().toLocaleString("es-AR"),
      percentage: priceIncrease,
      category: priceCategory,
      effectiveDate: priceEffectiveDate,
      beforePrices,
      afterPrices,
    };
    try {
      await catalog.save(products.map((p) => ({ ...p, price: afterPrices[p.id] })), [change, ...priceChanges]);
    } catch (error) {
      return setMessage(error instanceof Error ? error.message : "No se pudo guardar el aumento.");
    }
    recordAudit(
      "Aumento de precios",
      `${priceIncrease}% · ${priceCategory} · ${affected.length} productos · vigencia ${priceEffectiveDate}`,
    );
    setMessage(
      `Aumento aplicado a ${affected.length} productos para los cinco locales.`,
    );
  };
  const recordAudit = (action: string, detail: string, auditSite = site) => {
    const auditDetail = isValidationTest ? `PRUEBA DE VALIDACIÓN · fecha operativa 15/10/2026 · ${detail}` : detail;
    operationalEventRef.current = { action, detail: auditDetail };
    setAudit((events) => [
      {
        id: crypto.randomUUID(),
        at: new Date().toLocaleString("es-AR"),
        site: auditSite,
        action,
        detail: auditDetail,
      },
      ...events,
    ]);
    setOperationalVersion((version) => version + 1);
  };
  const submitStockRequest = () => {
    if (!user) return;
    if (!catalog.ready) return setMessage("Esperá a que cargue el catálogo central antes de enviar el pedido.");
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
    setMessage("Solicitud enviada a Central para su preparación.");
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
    const request = stockRequests.find((item) => item.id === requestId);
    if (!request || request.status === "Entregado") return;
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
  const addCentralExtraItem = (request: StockRequest) => {
    if (!managesCentralOrders || request.status === "Entregado" || centralExtraQuantity <= 0) return;
    const product = products.find((item) => item.id === centralExtraProductId);
    if (!product) return;
    setStockRequests((items) => items.map((item) => item.id !== request.id ? item : {
      ...item,
      lines: item.lines.some((line) => line.productId === product.id)
        ? item.lines.map((line) => line.productId === product.id ? { ...line, preparedQuantity: (line.preparedQuantity ?? line.quantity) + centralExtraQuantity } : line)
        : [...item.lines, { productId: product.id, quantity: 0, preparedQuantity: centralExtraQuantity }],
    }));
    recordAudit("Artículo agregado al despacho", `${request.site} · ${product.name} × ${centralExtraQuantity} · ${request.id.slice(0, 8)}`);
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
    if (!user) return;
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
          kind: "Recepción de pedido" as const,
          quantity: line.preparedQuantity ?? line.quantity,
          remito: `Pedido ${request.id.slice(0, 8)}`,
          detail: "Recepción confirmada por el local",
          reference: request.id,
          at: new Date().toLocaleString("es-AR"),
          atISO: new Date().toISOString(),
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
    if (!user) return;
    if (expenseAmount <= 0 || !expenseDetail.trim())
      return setMessage("Completá importe y detalle del egreso.");
    if (expenseAmount > siteLimits.maxExpense)
      return setMessage(
        `El egreso supera el límite de ${money.format(siteLimits.maxExpense)} configurado por Administración para ${site}.`,
      );
    if (expensePaidWithCash && !cashIsOpen)
      return setMessage("Abrí la caja para registrar un egreso pagado con su efectivo, o desmarcá «Pagado con efectivo de la caja».");
    const expense: Expense = {
      id: crypto.randomUUID(),
      site,
      category: expenseCategory,
      amount: expenseAmount,
      detail: expenseDetail.trim(),
      receiptName: expenseReceipt,
      createdAt: new Date().toLocaleString("es-AR"),
      createdBy: user.name,
      paidWithCash: expensePaidWithCash,
    };
    setExpensesLog((items) => [expense, ...items]);
    // Un egreso pagado con la caja sale del efectivo esperado del turno (antes
    // había que repetirlo a mano en «Gastos» al cerrar).
    if (expensePaidWithCash)
      appendCashLedgerEntry({
        kind: "Egreso",
        direction: "Egreso",
        amount: expense.amount,
        cashImpact: -expense.amount,
        paymentMethod: "Efectivo",
        reference: expense.id,
        detail: `${expense.category} · ${expense.detail}`,
      });
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
    if (!user) return;
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
    if (!user) return;
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
    setMessage("Ajuste enviado para aprobación.");
  };
  const submitStockControl = () => {
    if (!user || !can("stock"))
      return setMessage("Tu usuario no tiene permiso para cerrar un control de stock.");
    const lines = products.flatMap((product) => {
      const counted = realStock[site][product.id];
      if (counted === "") return [];
      const theoretical = stock[site][product.id] || 0;
      const difference = Number(counted) - theoretical;
      if (difference === 0) return [];
      const comment = stockCountComments[site][product.id]?.trim() || "";
      return [{ product, counted: Number(counted), theoretical, difference, comment }];
    });
    if (!lines.length)
      return setMessage("Cargá al menos una diferencia antes de cerrar el control.");
    const withoutComment = lines.find((line) => !line.comment);
    if (withoutComment)
      return setMessage(`Agregá una observación para ${withoutComment.product.name}.`);
    const now = new Date().toLocaleString("es-AR");
    const adjustments: StockAdjustment[] = lines.map((line) => ({
      id: crypto.randomUUID(),
      site,
      productId: line.product.id,
      counted: line.counted,
      theoretical: line.theoretical,
      reason: line.comment,
      requestedAt: now,
      requestedBy: user.name,
      status: "Pendiente",
    }));
    setStockAdjustments((items) => [...adjustments, ...items]);
    recordAudit("Control de stock cerrado", `${site} · ${adjustments.length} diferencia(s) informada(s)`);
    setMessage(`Control enviado: ${adjustments.length} diferencia(s) quedan en revisión y aparecen como tarea para los perfiles autorizados de Administración/stock.`);
  };
  const approveStockAdjustment = (
    adjustment: StockAdjustment,
    approve: boolean,
  ) => {
    if (!canApproveStockAdjustments)
      return setMessage("Tu perfil no puede aprobar ni rechazar ajustes de stock.");
    setStockAdjustments((items) =>
      items.map((item) =>
        item.id === adjustment.id
          ? { ...item, status: approve ? "Aprobado" : "Rechazado" }
          : item,
      ),
    );
    // Se aplica la diferencia del conteo, no el número contado: las ventas y
    // movimientos ocurridos entre el conteo y la aprobación no deben revertirse.
    if (approve)
      setStock((items) => ({
        ...items,
        [adjustment.site]: {
          ...items[adjustment.site],
          [adjustment.productId]: Math.max(
            0,
            safeStockQuantity(items[adjustment.site]?.[adjustment.productId]) +
              (adjustment.counted - adjustment.theoretical),
          ),
        },
      }));
    if (approve)
      recordStockMovement({
        site: adjustment.site,
        productId: adjustment.productId,
        kind: "Ajuste de inventario",
        quantity: adjustment.counted - adjustment.theoretical,
        remito: "",
        detail: adjustment.reason,
        reference: adjustment.id,
      });
    recordAudit(
      approve ? "Ajuste de stock aprobado" : "Ajuste de stock rechazado",
      `${adjustment.site} · ${adjustment.id.slice(0, 8)}`,
    );
  };
  const exportAdminReport = () => {
    const heading: Array<Array<string | number | null>> = [
      ["L'ARTISAN · INFORME ADMINISTRATIVO"],
      [
        "Reporte",
        ADMIN_REPORTS.find((report) => report.id === adminReport)?.title ||
          adminReport,
      ],
      ["Desde", reportFrom, "Hasta", reportTo],
      ["Local", reportSite],
      [],
    ];
    const reportRows: Record<string, Array<Array<string | number | null>>> = {
      DetalleVentas: [["Fecha", "Operación", "Local", "Cliente", "Comprobante", "Medio", "Bruto", "Descuento", "Neto", "Estado"], ...reportSales.map((sale) => [sale.createdAtISO, sale.id, sale.site, sale.customer, sale.invoiceType, sale.method, sale.gross, sale.discount, sale.net, sale.status])],
      Productos: [["Producto", "Categoría", "Unidades", "Venta bruta"], ...productPerformance.map((row) => [row.name, row.category, row.units, row.gross])],
      Rentabilidad: [["Producto", "Categoría", "Unidades", "Venta bruta", "Descuento distribuido", "Venta neta", "Costo unitario", "Margen"], ...profitabilityRows.map((row) => [row.name, row.category, row.units, Math.round(row.gross), Math.round(row.discount), Math.round(row.net), "Sin costo cargado", "No calculable"])],
      Pagos: [["Medio de pago", "Importe"], ...paymentReportRows.map((row) => [row.method, row.amount])],
      VendidoCobrado: [["Local", "Vendido", "Cobrado", "Diferencia"], ...soldCollectedRows.map((row) => [row.site, row.sold, row.collected, row.difference])],
      Cajas: [["Local", "Apertura", "Abrió", "Fondo", "Cierre", "Cerró", "Esperado", "Contado", "Diferencia", "Sobre"], ...cashHistory.map((row) => [row.site, row.openedAt, row.openedBy, row.initialFund, row.closedAt || "", row.closedBy || "", row.expectedCash ?? "", row.countedCash ?? "", row.differenceAmount ?? "", row.envelopeAmount ?? ""])],
      Auditoria: [["Fecha", "Usuario", "Local", "Acción", "Detalle"], ...auditHistory.map((row) => [row.at, row.userName, row.site, row.action, row.detail])],
      Stock: [["Producto", "Categoría", "Stock actual", "Mínimo total", "Local más bajo", "Stock más bajo", "Bajo mínimo"], ...stockReportRows.map((row) => [row.name, row.category, row.stock, row.minimum, row.lowestSite, row.lowestStock, row.belowMinimum ? "Sí" : "No"])],
      Promociones: [["Local", "Operaciones con beneficio", "Con descuento", "Con invitación", "Unidades invitadas", "Venta bruta beneficiada", "Descuento", "Venta neta"], ...promotionRows.map((row) => [row.site, row.operations, row.discounted, row.invited, row.invitationUnits, row.gross, row.discount, row.net])],
      Clientes: [["Cliente", "Documento", "Local", "Ventas", "Devoluciones", "Última compra", "Venta neta"], ...customers.filter(customer => reportSite === "Todos los locales" || customer.site === reportSite).map(customer => { const customerSales = reportSales.filter(sale => sale.customerId === customer.id); const saleIds = new Set(customerSales.map(sale => sale.id)); return [customer.name, `${customer.documentType} ${customer.documentNumber}`, customer.site, customerSales.length, returnsLog.filter(item => saleIds.has(item.saleId)).length, customerSales[0]?.createdAtISO || "", customerSales.reduce((total, sale) => total + sale.net, 0)]; })],
    };
    downloadCsv(`Informe_${adminReport}_${reportFrom}_${reportTo}.csv`, [...heading, ...(reportRows[adminReport] || [
      ["Local", "Venta neta", "Tickets", "Ticket promedio", "Estado caja"],
      ...adminRows.map((row) => [
        row.site,
        row.net,
        row.tickets,
        row.tickets ? Math.round(row.net / row.tickets) : 0,
        row.status,
      ]),
    ])]);
  };
  const importHistoricalFile = async (file: File) => {
    setHistoryImporting(true);
    try {
      const rows = parseHistoryCsv(await file.text());
      // Shared hosting can terminate long JSON requests before returning a
      // response. Small batches keep every transaction short, while using a
      // simple content type avoids an unnecessary CORS preflight per batch.
      const batchSize = 25;
      let imported = 0;
      let rejected = 0;
      setMessage(`Preparando ${rows.length} filas para importar…`);
      for (let start = 0; start < rows.length; start += batchSize) {
        const batch = rows.slice(start, start + batchSize);
        let data: { imported?: number; rejected?: number; error?: string } | null = null;
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const response = await fetch(`${API_BASE}/admin/history/import`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "text/plain;charset=UTF-8" },
              body: JSON.stringify({ kind: historyImportKind, rows: batch }),
            });
            data = (await response.json()) as { imported?: number; rejected?: number; error?: string };
            if (!response.ok) throw new Error(data.error || "No se pudo importar el historial.");
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 800));
          }
        }
        if (lastError || !data) throw lastError instanceof Error ? lastError : new Error("No se pudo importar el historial.");
        imported += data.imported || 0;
        rejected += data.rejected || 0;
        setMessage(`Importando historial: ${Math.min(start + batch.length, rows.length)} de ${rows.length} filas procesadas.`);
      }
      setMessage(`Historial importado: ${imported} filas aceptadas y ${rejected} rechazadas.`);
      setOperationalVersion((version) => version + 1);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo importar el historial.");
    } finally { setHistoryImporting(false); }
  };
  const saveMonthlyTarget = (local: string) => {
    const value = Math.max(0, Number(monthlyTargetDrafts[local]) || 0);
    setMonthlyTargets((targets) => ({ ...targets, [local]: value }));
    setMonthlyTargetDrafts((targets) => ({ ...targets, [local]: value }));
    recordAudit(
      "Meta mensual actualizada",
      `${local} · ${value > 0 ? money.format(value) : "sin meta configurada"}`,
    );
    setMessage(`Meta mensual de ${local} guardada.`);
  };
  const saveOrder = () => {
    if (!cart.length)
      return setMessage("Agregá productos antes de guardar la comanda.");
    const order: SavedOrder = {
      id: crypto.randomUUID(),
      site,
      createdAt: new Date().toLocaleString("es-AR"),
      customer,
      customerId: selectedCustomerId || undefined,
      items: [...cart],
      discount,
      payment,
      invoiceType,
      customerDocumentType,
      customerDocumentNumber,
      customerTaxCondition,
      customerAddress,
      invitation,
      invitedQuantities,
      channel: saleChannel,
    };
    setSavedOrders((items) => [order, ...items]);
    setCart([]);
    setDiscount(0);
    setInvitedQuantities({});
    recordAudit("Comanda guardada", `${site} · ${order.id.slice(0, 8)}`);
    setMessage("Comanda guardada. Podés continuar otra venta.");
  };
  const loadOrder = (order: SavedOrder) => {
    setCart(order.items);
    setCustomer(order.customer);
    setDiscount(order.discount);
    setPayment(order.payment);
    setInvoiceType(order.invoiceType);
    setCustomerDocumentType(order.customerDocumentType || "Consumidor final");
    setCustomerDocumentNumber(order.customerDocumentNumber || "");
    setCustomerTaxCondition(order.customerTaxCondition || "");
    setCustomerAddress(order.customerAddress || "");
    setInvitedQuantities(order.invitedQuantities ?? {});
    setSaleChannel(order.channel);
    setSavedOrders((items) => items.filter((item) => item.id !== order.id));
    recordAudit("Comanda recuperada", `${site} · ${order.id.slice(0, 8)}`);
    setMessage("Comanda recuperada para continuar el cobro.");
  };
  const registerCashAdjustment = () => {
    if (!user) return;
    if (cashAdjustmentAmount <= 0 || !cashAdjustmentDetail.trim())
      return setMessage("Completá importe y motivo del movimiento de caja.");
    const adjustment: CashAdjustment = {
      id: crypto.randomUUID(),
      site,
      kind: cashAdjustmentKind,
      amount: cashAdjustmentAmount,
      detail: cashAdjustmentDetail.trim(),
      at: new Date().toLocaleString("es-AR"),
      atISO: new Date().toISOString(),
      createdBy: user.name,
      impact: cashAdjustmentKind === "Ajuste de caja" ? cashAdjustmentImpact : cashAdjustmentKind === "Retiro de caja" ? "Egreso" : "Ingreso",
    };
    setCashAdjustments((items) => [adjustment, ...items]);
    const direction = adjustment.impact || "Ingreso";
    appendCashLedgerEntry({
      kind: adjustment.kind,
      direction,
      amount: adjustment.amount,
      cashImpact: direction === "Ingreso" ? adjustment.amount : -adjustment.amount,
      detail: adjustment.detail,
    });
    setCashAdjustmentAmount(0);
    setCashAdjustmentDetail("");
    recordAudit(
      "Movimiento de caja",
      `${site} · ${adjustment.kind} · ${money.format(adjustment.amount)}`,
    );
    setMessage("Movimiento de caja registrado.");
  };
  const registerStockMovement = () => {
    if (!user) return;
    if (movementQuantity <= 0 || !movementDetail.trim())
      return setMessage("Completá cantidad y detalle del movimiento de stock.");
    const isEntry = ["Ingreso por remito", "Recepción de pedido", "Ingreso manual"].includes(movementKind);
    const available = stock[site]?.[movementProductId] || 0;
    if (!isEntry && movementQuantity > available)
      return setMessage(`No se puede retirar ${movementQuantity}: solo hay ${available} unidades disponibles.`);
    const signedQuantity = isEntry ? movementQuantity : -movementQuantity;
    const movement: StockMovement = {
      id: crypto.randomUUID(),
      site,
      productId: movementProductId,
      kind: movementKind,
      quantity: signedQuantity,
      remito: movementRemito.trim(),
      detail: movementDetail.trim(),
      at: new Date().toLocaleString("es-AR"),
      atISO: new Date().toISOString(),
      createdBy: user.name,
    };
    setStock((items) => ({
      ...items,
      [site]: {
        ...items[site],
        [movementProductId]: Math.max(
          0,
          safeStockQuantity(items[site]?.[movementProductId]) + signedQuantity,
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
  const exportRequestCsv = (request: StockRequest) => {
    const rows = request.lines.map((line) => {
      const product = products.find((item) => item.id === line.productId);
      return [
        product?.category || "",
        product?.name || "",
        product?.detail || "",
        line.quantity,
      ];
    });
    downloadCsv(`Pedido_${request.site.replaceAll(" ", "_")}_${request.id.slice(0, 8)}.csv`, [
      ["L'ARTISAN · SOLICITUD DE MERCADERÍA"],
      ["Local", request.site, "Estado", request.status],
      ["Solicitó", request.requestedBy, "Fecha", request.requestedAt],
      ["Observaciones", request.notes || "Sin observaciones"],
      [],
      ["Categoría", "Producto", "Presentación", "Cantidad"],
      ...rows,
    ]);
  };
  const pay = () => {
    if (!can("cobrar"))
      return setMessage("Tu usuario no tiene permiso para cobrar ventas.");
    if (!operationalReady)
      return setMessage("Esperá a que termine la carga de datos antes de cobrar.");
    if (!cashIsOpen)
      return setMessage("Primero tenés que abrir la caja de este local.");
    if (!cart.length) return setMessage("Agregá productos a la venta.");
    const rawPayments = splitPayment
      ? splitPayments.filter((item) => item.amount > 0)
      : [{ method: payment, amount: net }];
    const currentPayments = Object.values(
      rawPayments.reduce<Record<string, Payment>>((grouped, item) => {
        grouped[item.method] = {
          method: item.method,
          amount: (grouped[item.method]?.amount || 0) + item.amount,
        };
        return grouped;
      }, {}),
    );
    if (!currentPayments.length || Math.round(currentPayments.reduce((sum, item) => sum + item.amount, 0)) !== net)
      return setMessage("El total de los medios de pago debe coincidir con el total de la venta.");
    if (discount > siteLimits.maxDiscount)
      return setMessage(
        `El descuento supera el máximo autorizado de ${siteLimits.maxDiscount}% para ${site}.`,
      );
    if (invoiceType === "Factura A") {
      if (customer.trim().length < 3) return setMessage("Factura A requiere razón social.");
      if (customerDocumentType !== "CUIT" || !/^\d{11}$/.test(customerDocumentNumber.replace(/\D/g, ""))) return setMessage("Factura A requiere CUIT de 11 dígitos.");
      if (customerTaxCondition !== "Responsable Inscripto") return setMessage("Factura A requiere condición fiscal Responsable Inscripto.");
      if (!customerAddress.trim()) return setMessage("Factura A requiere domicilio fiscal.");
    }
    const quantities = cart.reduce<Record<number, number>>((result, product) => {
      result[product.id] = (result[product.id] || 0) + 1;
      return result;
    }, {});
    const unavailable = Object.entries(quantities).find(
      ([productId, quantity]) => (stock[site]?.[Number(productId)] || 0) < quantity,
    );
    if (unavailable) {
      const product = products.find((item) => item.id === Number(unavailable[0]));
      return setMessage(`No hay stock suficiente de ${product?.name || "ese producto"}. Actualizá la venta.`);
    }
    const saleNow = operationalNow();
    const sale: Sale = {
      id: crypto.randomUUID(),
      site,
      createdAt: saleNow.toLocaleString("es-AR"),
      createdAtISO: saleNow.toISOString(),
      items: [...cart],
      gross: total,
      discount: total - net,
      net,
      method: splitPayment ? "Múltiple" : payment,
      invoiceType,
      customer: isValidationTest ? `PRUEBA DE VALIDACIÓN · ${customer}` : customer,
      customerId: selectedCustomerId || undefined,
      customerDocumentType,
      customerDocumentNumber: customerDocumentNumber.replace(/\D/g, ""),
      customerTaxCondition,
      customerAddress,
      invitation,
      invitedQuantities,
      channel: saleChannel,
      status: "activa",
    };
    setPayments((x) => [
      ...x,
      ...currentPayments.map((item) => ({
        ...item,
        saleId: sale.id,
        site,
        shiftId: activeShift?.id,
        createdAtISO: sale.createdAtISO,
      })),
    ]);
    setSales((x) => [sale, ...x]);
    pendingReceiptRef.current = sale;
    setReceiptSale(null);
    currentPayments.forEach((item) =>
      appendCashLedgerEntry({
        kind: invitation ? "Invitación" : "Venta",
        direction: item.method === "Efectivo" ? "Ingreso" : "Informativo",
        amount: item.amount,
        cashImpact: item.method === "Efectivo" ? item.amount : 0,
        paymentMethod: item.method,
        reference: sale.id,
        detail: `${invoiceType} · ${customer}`,
      }),
    );
    setPendingSync((value) => value + 1);
    setStock((x) => {
      const a = { ...x[site] };
      cart.forEach((p) => (a[p.id] -= 1));
      return { ...x, [site]: a };
    });
    Object.entries(quantities).forEach(([productId, quantity]) =>
      recordStockMovement({
        productId: Number(productId),
        kind: "Venta",
        quantity: -quantity,
        remito: "",
        detail: `Salida por venta ${sale.id.slice(0, 8)}`,
        reference: sale.id,
      }),
    );
    setMessage(
      `${invitation ? "Invitación" : "Venta"} pendiente de confirmación: ${money.format(net)}. No recargues hasta ver “Operación guardada”.`,
    );
    recordAudit(
      "Venta registrada",
      `${sale.id.slice(0, 8)} · ${money.format(net)} · ${splitPayment ? "cobro múltiple" : payment}`,
    );
    setCart([]);
    setDiscount(0);
    setInvitedQuantities({});
    setSplitPayment(false);
    setSplitPayments([{ method: "Efectivo", amount: 0 }, { method: "Transferencia", amount: 0 }]);
    setCustomer("Consumidor final");
    setSelectedCustomerId(null);
  };
  const printReceipt = () => {
    if (!receiptSale) return;
    document.body.classList.add("receipt-printing");
    const cleanup = () => document.body.classList.remove("receipt-printing");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
    window.setTimeout(cleanup, 1000);
  };
  /** Envía siempre la misma identidad: reintentar nunca puede crear otro ajuste. */
  const syncPostCloseCancellation = async (adjustment: PostCloseCancellationAdjustment) => {
    if (syncingAdjustmentIds.current.has(adjustment.id)) return;
    syncingAdjustmentIds.current.add(adjustment.id);
    try {
      const response = await fetch(`${API_BASE}/cash-sheets/adjustment`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site: adjustment.site,
          closeId: adjustment.closeId,
          adjustmentId: adjustment.id,
          saleId: adjustment.saleId,
          businessDate: adjustment.businessDate,
          amount: adjustment.amount,
          paymentMethod: adjustment.paymentMethod,
          reason: adjustment.reason,
          auditReference: adjustment.auditReference,
        }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Drive no confirmó el ajuste.");
      setPostCloseAdjustments((items) => items.map((item) =>
        item.id === adjustment.id
          ? { ...item, status: "synced", lastError: undefined, syncedAtISO: new Date().toISOString() }
          : item,
      ));
      setSyncStatus("Anulación compensada en Drive sin modificar el cierre original.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "sin respuesta";
      setPostCloseAdjustments((items) => items.map((item) =>
        item.id === adjustment.id
          ? { ...item, status: "pending", attempts: item.attempts + 1, lastError: detail }
          : item,
      ));
      setSyncStatus(`Anulación guardada; ajuste de Drive pendiente: ${detail}`);
    } finally {
      syncingAdjustmentIds.current.delete(adjustment.id);
    }
  };
  useEffect(() => {
    if (!user?.id || !operationalReady) return;
    const pending = postCloseAdjustments.filter((item) => item.status === "pending");
    if (!pending.length) return;
    let disposed = false;
    const retry = () => {
      if (!disposed) pending.forEach((item) => { void syncPostCloseCancellation(item); });
    };
    const timer = window.setTimeout(retry, 500);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [user?.id, operationalReady, postCloseAdjustments]);
  const cancelSale = (sale: Sale) => {
    if (!can("anular"))
      return setMessage("Tu usuario no tiene permiso para anular ventas.");
    if (sale.status === "anulada") return;
    const salePayments = payments.filter((item) => item.saleId === sale.id);
    const priorReturns = returnsLog.filter((item) => item.saleId === sale.id);
    let alreadyRefunded = priorReturns
      .filter((item) => item.kind === "Devolución")
      .reduce((sum, item) => sum + item.amount, 0);
    setSales((items) =>
      items.map((x) => (x.id === sale.id ? { ...x, status: "anulada" } : x)),
    );
    setPayments((items) => items.filter((x) => x.saleId !== sale.id));
    salePayments.forEach((item) => {
      const amount = Math.max(0, item.amount - Math.min(item.amount, alreadyRefunded));
      alreadyRefunded = Math.max(0, alreadyRefunded - item.amount);
      if (amount <= 0) return;
      appendCashLedgerEntry({
        kind: "Anulación de venta",
        direction: item.method === "Efectivo" ? "Egreso" : "Informativo",
        amount,
        cashImpact: item.method === "Efectivo" ? -amount : 0,
        paymentMethod: item.method,
        reference: sale.id,
        // El asiento se vincula al turno que cobró la venta, incluso si la
        // anulación se registra después del cierre. Así el libro mayor queda
        // trazable sin contaminar la próxima caja abierta.
        shiftId: item.shiftId,
        detail: "Reversión de cobro por venta anulada",
      });
    });
    const returnedAndRestocked = priorReturns
      .filter((item) => item.restock)
      .flatMap((item) => item.lines)
      .reduce<Record<number, number>>((result, line) => {
        result[line.productId] = (result[line.productId] || 0) + line.quantity;
        return result;
      }, {});
    setStock((x) => {
      const next = { ...x[site] };
      const restored: Record<number, number> = {};
      sale.items.forEach((p) => {
        const used = restored[p.id] || 0;
        if (used < (returnedAndRestocked[p.id] || 0)) restored[p.id] = used + 1;
        else next[p.id] = (next[p.id] || 0) + 1;
      });
      return { ...x, [site]: next };
    });
    const quantities = sale.items.reduce<Record<number, number>>((result, product) => {
      result[product.id] = (result[product.id] || 0) + 1;
      return result;
    }, {});
    Object.keys(quantities).forEach((productId) => {
      quantities[Number(productId)] = Math.max(
        0,
        quantities[Number(productId)] - (returnedAndRestocked[Number(productId)] || 0),
      );
    });
    Object.entries(quantities).forEach(([productId, quantity]) =>
      quantity > 0 &&
      recordStockMovement({
        productId: Number(productId),
        kind: "Anulación",
        quantity,
        remito: "",
        detail: `Reposición por anulación ${sale.id.slice(0, 8)}`,
        reference: sale.id,
      }),
    );
    recordAudit(
      "Venta anulada",
      `${sale.id.slice(0, 8)} · ${money.format(sale.net)} · ${sale.method}`,
    );
    // Una venta del turno cerrado debe compensarse en Drive. La clave es el
    // ID estable de la venta: el servidor y Apps Script la usan para que ni
    // recargas ni reintentos generen una segunda fila.
    const closeId = salePayments.find((item) => item.shiftId)?.shiftId;
    const closedShift = closeId
      ? shiftLog.find((item) => item.id === closeId && item.site === sale.site && Boolean(item.closedAtISO || item.closedAt))
      : undefined;
    const amount = Math.round(salePayments.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
    if (closedShift && amount > 0) {
      const adjustment: PostCloseCancellationAdjustment = {
        id: sale.id,
        saleId: sale.id,
        closeId: closedShift.id,
        site: sale.site,
        businessDate: dateKey(new Date(closedShift.closedAtISO || closedShift.closedAt || sale.createdAtISO)),
        amount,
        paymentMethod: salePayments.length === 1 ? salePayments[0].method : "Múltiple",
        reason: "Anulación posterior al cierre",
        auditReference: `sale:${sale.id};close:${closedShift.id}`,
        status: "pending",
        attempts: 0,
        createdAtISO: new Date().toISOString(),
      };
      setPostCloseAdjustments((items) => items.some((item) => item.id === adjustment.id) ? items : [adjustment, ...items]);
      void syncPostCloseCancellation(adjustment);
    }
    setMessage(
      "Venta anulada: se restituyó el stock y se descontó del cierre.",
    );
  };
  const registerReturn = () => {
    if (!user) return;
    if (!can("anular"))
      return setMessage("Tu usuario no tiene permiso para registrar devoluciones o cambios.");
    const sale = sales.find((item) => item.id === returnSaleId && item.site === site);
    if (!sale || sale.status !== "activa") return setMessage("Elegí una venta activa del local.");
    if (!returnReason.trim()) return setMessage("Indicá el motivo de la devolución o cambio.");
    const soldQuantities = sale.items.reduce<Record<number, number>>((result, product) => {
      result[product.id] = (result[product.id] || 0) + 1;
      return result;
    }, {});
    const alreadyReturned = returnsLog
      .filter((transaction) => transaction.saleId === sale.id)
      .reduce<Record<number, number>>((result, transaction) => {
        transaction.lines.forEach((line) => {
          result[line.productId] = (result[line.productId] || 0) + line.quantity;
        });
        return result;
      }, {});
    const selectedLines = Object.entries(returnQuantities)
      .map(([productId, quantity]) => ({ productId: Number(productId), quantity: Number(quantity) || 0 }))
      .filter((line) => line.quantity > 0);
    if (!selectedLines.length) return setMessage("Seleccioná al menos un producto y cantidad para devolver o cambiar.");
    if (selectedLines.some((line) => line.quantity > (soldQuantities[line.productId] || 0) - (alreadyReturned[line.productId] || 0)))
      return setMessage("Una de las cantidades supera lo que queda disponible de la venta.");
    const invitedByProduct = sale.invitedQuantities || {};
    const paidGross = sale.items.reduce((total, product) => total + product.price, 0) -
      Object.entries(invitedByProduct).reduce((total, [productId, quantity]) => {
        const product = sale.items.find((item) => item.id === Number(productId));
        return total + (product?.price || 0) * quantity;
      }, 0);
    const selectedPaidGross = selectedLines.reduce((total, line) => {
      const product = sale.items.find((item) => item.id === line.productId);
      const invitedAlreadyReturned = Math.min(
        invitedByProduct[line.productId] || 0,
        alreadyReturned[line.productId] || 0,
      );
      const invitedRemaining = Math.max(0, (invitedByProduct[line.productId] || 0) - invitedAlreadyReturned);
      const paidQuantity = Math.max(0, line.quantity - invitedRemaining);
      return total + (product?.price || 0) * paidQuantity;
    }, 0);
    const amount = Math.round(sale.net * (selectedPaidGross / Math.max(paidGross, 1)));
    const transaction: ReturnTransaction = {
      id: crypto.randomUUID(),
      saleId: sale.id,
      site,
      kind: returnKind,
      amount,
      refundMethod: returnRefundMethod,
      reason: returnReason.trim(),
      restock: returnRestock,
      creditNoteNumber: `NC-INT-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${String(returnsLog.length + 1).padStart(4, "0")}`,
      lines: selectedLines,
      createdAt: new Date().toLocaleString("es-AR"),
      createdBy: user.name,
    };
    setReturnsLog((items) => [transaction, ...items]);
    if (returnRestock) {
      setStock((items) => {
        const next = { ...items[site] };
        selectedLines.forEach((line) => {
          next[line.productId] = (next[line.productId] || 0) + line.quantity;
        });
        return { ...items, [site]: next };
      });
      selectedLines.forEach((line) =>
        recordStockMovement({
          productId: line.productId,
          kind: "Devolución",
          quantity: line.quantity,
          remito: "",
          detail: `Reposición por ${returnKind.toLowerCase()} ${sale.id.slice(0, 8)}`,
          reference: sale.id,
        }),
      );
    }
    if (returnKind === "Devolución") {
      appendCashLedgerEntry({
        kind: "Devolución",
        direction: returnRefundMethod === "Efectivo" ? "Egreso" : "Informativo",
        amount,
        cashImpact: returnRefundMethod === "Efectivo" ? -amount : 0,
        paymentMethod: returnRefundMethod,
        reference: sale.id,
        detail: returnReason.trim(),
      });
    }
    recordAudit(
      `${returnKind} registrada`,
      `${transaction.creditNoteNumber} · ${sale.id.slice(0, 8)} · ${money.format(amount)} · ${returnRefundMethod}`,
    );
    setReturnSaleId("");
    setReturnReason("");
    setReturnQuantities({});
    setReturnRestock(true);
    setMessage(
      `${returnKind} registrada como ${transaction.creditNoteNumber}${returnRestock ? "; se repuso el stock" : ""}.`,
    );
  };
  const changeSalePayment = (sale: Sale, method: string) => {
    if (!can("cobrar"))
      return setMessage("Tu usuario no tiene permiso para corregir medios de pago.");
    if (!cashIsOpen)
      return setMessage("La corrección debe hacerse con la caja del local abierta, antes del cierre.");
    if (sale.site !== site || sale.status !== "activa")
      return setMessage("Solo podés corregir ventas activas del local seleccionado.");
    const originalPayments = payments.filter((item) => item.saleId === sale.id);
    if (!originalPayments.length)
      return setMessage("No se encontraron cobros asociados a esta venta. Pedí revisión a Administración.");
    if (originalPayments.every((item) => item.method === method)) {
      setPaymentCorrectionSaleId(null);
      return setMessage("La venta ya tiene ese medio de pago.");
    }
    const previousCash = originalPayments
      .filter((item) => item.method === "Efectivo")
      .reduce((sum, item) => sum + item.amount, 0);
    setSales((items) =>
      items.map((item) => (item.id === sale.id ? { ...item, method } : item)),
    );
    setPayments((items) => [
      ...items.filter((item) => item.saleId !== sale.id),
      {
        method,
        amount: originalPayments.reduce((sum, item) => sum + item.amount, 0),
        saleId: sale.id,
        site: sale.site,
        shiftId: originalPayments[0].shiftId,
        createdAtISO: originalPayments[0].createdAtISO,
      },
    ]);
    const nextCash = method === "Efectivo" ? sale.net : 0;
    if (nextCash !== previousCash)
      appendCashLedgerEntry({
        kind: "Corrección de cobro",
        direction: nextCash > previousCash ? "Ingreso" : "Egreso",
        amount: Math.abs(nextCash - previousCash),
        cashImpact: nextCash - previousCash,
        paymentMethod: method,
        reference: sale.id,
        detail: `${sale.method} a ${method}`,
      });
    recordAudit(
      "Forma de cobro modificada",
      `${sale.id.slice(0, 8)} · ${sale.method} a ${method}`,
    );
    setPaymentCorrectionSaleId(null);
    setPendingSync((value) => value + 1);
    setMessage(`Medio de pago corregido: ${sale.method} a ${method}. El total, los productos y el stock no cambiaron.`);
  };
  const changeSaleInvoice = (
    sale: Sale,
    nextInvoiceType: Sale["invoiceType"],
  ) => {
    // Cambiar el comprobante de una venta registrada es una corrección fiscal:
    // mismo nivel que anular. El servidor además lo rechaza si ya hay factura ARCA.
    if (!can("anular"))
      return setMessage("Tu usuario no tiene permiso para cambiar el comprobante de una venta registrada.");
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
  const synchronizeCashClose = async (
    closeId: string,
    payload: { businessDate: string; payments: { method: string; amount: number }[]; metrics: Record<string, number> },
  ) => {
    setSyncStatus("Enviando el cierre a la planilla del local…");
    try {
      const response = await fetch(`${API_BASE}/cash-sheets/close`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site, closeId, ...payload }),
      });
      const data = await response.json() as { ok?: boolean; error?: string; sync?: { alreadySynced?: boolean; sheet?: string; row?: number } };
      if (!response.ok || !data.ok || !data.sync) throw new Error(data.error || "La planilla no confirmó la actualización.");
      setSyncStatus(`${data.sync.alreadySynced ? "Cierre ya sincronizado" : "Drive sincronizado"}: ${data.sync.sheet}, fila ${data.sync.row}.`);
    } catch (error) {
      // El cierre comercial ya quedó registrado y la API conserva el intento
      // por closeId; reintentar no duplica ni pisa una fila distinta.
      const detail = error instanceof Error ? error.message : "No se pudo contactar a la planilla.";
      setSyncStatus(`Cierre guardado en el sistema. Drive pendiente: ${detail}`);
    }
  };

  const retryLastCashCloseSync = () => {
    const lastShift = shiftLog
      .filter((shift) => shift.site === site && Boolean(shift.closedAtISO || shift.closedAt))
      .sort((a, b) => Date.parse(b.closedAtISO || b.closedAt || "") - Date.parse(a.closedAtISO || a.closedAt || ""))[0];
    if (!lastShift) {
      setSyncStatus("No hay un cierre anterior para reintentar en este local.");
      return;
    }
    const closeAt = lastShift.closedAtISO ? new Date(lastShift.closedAtISO) : new Date();
    const closePayments = methods.map((method) => ({
      method,
      amount: payments
        .filter((payment) => payment.site === site && payment.shiftId === lastShift.id && payment.method === method)
        .reduce((sum, payment) => sum + payment.amount, 0),
    }));
    const closeSales = sales.filter((sale) =>
      sale.site === site && sale.status === "activa" &&
      (!lastShift.openedAtISO || Date.parse(sale.createdAtISO) >= Date.parse(lastShift.openedAtISO)) &&
      (!lastShift.closedAtISO || Date.parse(sale.createdAtISO) <= Date.parse(lastShift.closedAtISO)),
    );
    void synchronizeCashClose(lastShift.id, {
      businessDate: dateKey(closeAt),
      payments: closePayments,
      metrics: {
        total: closePayments.reduce((sum, payment) => sum + payment.amount, 0),
        tickets: closeSales.length,
        discounts: closeSales.reduce((sum, sale) => sum + sale.discount, 0),
        counted: lastShift.countedCash ?? 0,
        envelope: lastShift.envelopeAmount ?? 0,
        difference: lastShift.differenceAmount ?? 0,
      },
    });
  };

  const authorizeCashSheets = async () => {
    if (user?.role !== "administracion") return;
    setSyncStatus("Esta integración se configura con Apps Script desde la cuenta propietaria de las planillas.");
    setSyncStatus("Apps Script debe ser publicado una vez por el dueño de las planillas. Luego Administración carga su URL /exec y la clave compartida en el servidor; no hace falta Google Cloud.");
  };
  const enableValidationOperatingDate = async () => {
    if (user?.role !== "administracion") return;
    setTestOperatingDateBusy(true);
    try {
      const response = await fetch(`${API_BASE}/admin/test-operating-date/enable`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site: "Maure", businessDate: "2026-10-15", label: "PRUEBA DE VALIDACIÓN", purpose: "Validación final auditada: venta, cierre, anulación posterior y ajuste compensatorio." }),
      });
      const data = await response.json() as { ok?: boolean; error?: string; testOperatingDate?: { active?: boolean; site?: string; businessDate?: string; label?: string; enabledAt?: string } };
      if (!response.ok || !data.ok || !data.testOperatingDate?.active) throw new Error(data.error || "No se pudo habilitar la fecha de prueba.");
      setTestOperatingDate({ active: true, ...data.testOperatingDate });
      recordAudit("Fecha operativa de prueba habilitada", "Maure · 15/10/2026 · PRUEBA DE VALIDACIÓN", "Maure");
      setMessage("Fecha de prueba habilitada exclusivamente para Maure. El reloj del equipo no fue modificado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo habilitar la fecha de prueba.");
    } finally { setTestOperatingDateBusy(false); }
  };
  const disableValidationOperatingDate = async () => {
    if (user?.role !== "administracion") return;
    setTestOperatingDateBusy(true);
    try {
      const response = await fetch(`${API_BASE}/admin/test-operating-date/disable`, { method: "POST", credentials: "include" });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "No se pudo deshabilitar la fecha de prueba.");
      setTestOperatingDate({ active: false });
      setMessage("Modo de fecha de prueba deshabilitado. Las operaciones vuelven a usar la fecha real.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo deshabilitar la fecha de prueba.");
    } finally { setTestOperatingDateBusy(false); }
  };

  const confirmClose = () => {
    if (!user) return;
    if (!cashIsOpen) return setMessage("No hay una caja abierta para cerrar.");
    const openOrders = savedOrders.filter((order) => order.site === site);
    if (openOrders.length)
      return setMessage(
        `No se puede cerrar la caja: hay ${openOrders.length} comanda${openOrders.length === 1 ? "" : "s"} abierta${openOrders.length === 1 ? "" : "s"} en ${site}. Cobralas o recuperalas desde Ventas.`,
      );
    if (requiresEnvelope && envelope > counted)
      return setMessage("El monto del sobre no puede ser mayor al efectivo físico contado.");
    // Una diferencia mayor al límite ya no impide cerrar: exige un motivo y
    // queda como incidencia abierta para Administración.
    const differenceExceeded = Math.abs(cashVariance) > siteLimits.maxCashDifference;
    const differenceReason = cashDifferenceReason.trim();
    if (differenceExceeded && !differenceReason)
      return setMessage(
        `La diferencia de ${money.format(cashVariance)} supera el máximo autorizado de ${money.format(siteLimits.maxCashDifference)}. Indicá el motivo para cerrar; quedará como alerta para Administración.`,
      );
    const closeId = activeShift?.id || crypto.randomUUID();
    const closeMoment = operationalNow();
    const shiftSales = sales.filter((sale) =>
      sale.site === site && sale.status === "activa" &&
      (!activeShift?.openedAtISO || Date.parse(sale.createdAtISO) >= Date.parse(activeShift.openedAtISO)),
    );
    const closePayload = {
      businessDate: dateKey(closeMoment),
      payments: totals,
      metrics: {
        total: totals.reduce((sum, item) => sum + item.amount, 0),
        tickets: shiftSales.length,
        discounts: shiftSales.reduce((sum, sale) => sum + sale.discount, 0),
        counted,
        envelope,
        difference: cashVariance,
      },
    };
    setClosed(true);
    setCashOpenBySite((items) => ({ ...items, [site]: false }));
    if (differenceExceeded) {
      setIncidents((items) => [
        {
          id: crypto.randomUUID(),
          site,
          type: "Diferencia de caja",
          detail: `${money.format(cashVariance)} (esperado ${money.format(expected)}, contado ${money.format(counted)}) · ${differenceReason}`,
          createdAt: operationalNow().toLocaleString("es-AR"),
          createdBy: user.name,
          status: "Abierta",
        },
        ...items,
      ]);
      recordAudit("Cierre con diferencia de caja", `${site} · ${money.format(cashVariance)} · ${differenceReason}`);
    }
    setCashDifferenceReason("");
    if (activeShift) {
      const closedNow = closeMoment;
      const finalShift = {
        ...activeShift,
        closedAt: closedNow.toLocaleString("es-AR"),
        closedAtISO: closedNow.toISOString(),
        closedBy: user.name,
        expectedCash: expected,
        countedCash: counted,
        differenceAmount: cashVariance,
        envelopeAmount: envelope,
        ...(differenceExceeded ? { differenceReason } : {}),
      };
      setShiftLog((items) =>
        items.map((shift) => (shift.id === finalShift.id ? finalShift : shift)),
      );
      setActiveShiftBySite((items) => ({ ...items, [site]: undefined }));
    }
    if (requiresEnvelope && envelope > 0)
      setEnvelopeRecords((items) => [
        {
          id: crypto.randomUUID(),
          site,
          amount: envelope,
          status: "En Caja Mayor",
          at: operationalNow().toLocaleString("es-AR"),
          withdrawnAmount: 0,
        },
        ...items,
      ]);
    if (expenses > 0) {
      appendCashLedgerEntry({
        kind: "Gastos declarados al cierre",
        direction: "Egreso",
        amount: expenses,
        cashImpact: -expenses,
        detail: "Total declarado durante el cierre de caja",
      });
    }
    if (withdrawals > 0) {
      appendCashLedgerEntry({
        kind: "Retiros declarados al cierre",
        direction: "Egreso",
        amount: withdrawals,
        cashImpact: -withdrawals,
        detail: "Total declarado durante el cierre de caja",
      });
    }
    if (requiresEnvelope && envelope > 0) {
      appendCashLedgerEntry({
        kind: "Sobre enviado a Caja Mayor",
        direction: "Egreso",
        amount: envelope,
        cashImpact: -envelope,
        detail: "Sobre de efectivo declarado en el cierre",
      });
    }
    appendCashLedgerEntry({
      kind: "Cierre de caja",
      direction: "Informativo",
      amount: counted,
      cashImpact: 0,
      detail: `Esperado ${money.format(expected)} · Diferencia ${money.format(cashVariance)}`,
    });
    void synchronizeCashClose(closeId, closePayload);
    recordAudit(
      "Cierre confirmado",
      `Cobros ${money.format(totals.reduce((a, x) => a + x.amount, 0))} · Sobre ${money.format(envelope)}`,
    );
    setAttendanceReminder("Salida");
    setMessage("Caja cerrada. Recordá marcar tu salida en Fichaje antes de retirarte.");
  };
  const openCash = () => {
    if (!user) return;
    if (cashIsOpen && activeShift)
      return setMessage("La caja y el turno ya se encuentran abiertos.");
    const now = operationalNow();
    const shift: CashShift = {
      id: crypto.randomUUID(),
      site,
      openedAt: now.toLocaleString("es-AR"),
      openedAtISO: now.toISOString(),
      openedBy: user.name,
      initialFund: fund,
    };
    setCashOpenBySite((items) => ({ ...items, [site]: true }));
    setActiveShiftBySite((items) => ({ ...items, [site]: shift }));
    setShiftLog((items) => [shift, ...items]);
    setCashLedger((items) => [
      {
        id: crypto.randomUUID(),
        site,
        shiftId: shift.id,
        kind: "Apertura de caja",
        direction: "Ingreso",
        amount: fund,
        cashImpact: fund,
        detail: "Fondo inicial declarado",
        at: shift.openedAt,
        atISO: now.toISOString(),
        createdBy: user.name,
      },
      ...items,
    ]);
    setClosed(false);
    recordAudit("Caja abierta", `Fondo inicial ${money.format(fund)}`);
    setMessage(`Caja abierta para ${site}. Ya se pueden registrar cobros.`);
  };
  const closeShift = () => {
    if (!user) return;
    if (!cashIsOpen || !activeShift)
      return setMessage("Primero debe existir una caja y turno abiertos.");
    const closedShift = {
      ...activeShift,
      closedAt: new Date().toLocaleString("es-AR"),
      closedBy: user.name,
    };
    setShiftLog((items) =>
      items.map((shift) => (shift.id === closedShift.id ? closedShift : shift)),
    );
    setActiveShiftBySite((items) => ({ ...items, [site]: undefined }));
    recordAudit(
      "Turno cerrado",
      `${site} · ${activeShift.openedBy} a ${user.name} · caja continúa abierta`,
    );
    setMessage("Turno cerrado y auditado. La caja permanece abierta para el siguiente turno.");
  };
  const markAttendance = (kind: AttendanceRecord["kind"]) => {
    if (!user) return;
    const today = new Date().toLocaleDateString("en-CA");
    const todayRecords = attendanceRecords.filter((item) => item.userName === user.name && item.site === site && item.atISO.slice(0, 10) === today);
    const last = todayRecords[0];
    if (kind === "Entrada" && last?.kind === "Entrada") return setMessage("Ya tenés una entrada abierta. Registrá la salida antes de volver a fichar.");
    if (kind === "Salida" && last?.kind !== "Entrada") return setMessage("Primero debe registrarse una entrada.");
    const now = new Date();
    const schedule = schedules.find((item) => item.employee.toLowerCase() === user.name.toLowerCase() && item.site === site);
    const expectedMinutes = schedule ? Number(schedule.startsAt.slice(0, 2)) * 60 + Number(schedule.startsAt.slice(3, 5)) + schedule.toleranceMinutes : 0;
    const actualMinutes = now.getHours() * 60 + now.getMinutes();
    const record: AttendanceRecord = { id: crypto.randomUUID(), userName: user.name, site, kind, at: now.toLocaleString("es-AR"), atISO: now.toISOString(), lateMinutes: kind === "Entrada" && schedule ? Math.max(0, actualMinutes - expectedMinutes) : undefined };
    setAttendanceRecords((items) => [record, ...items]);
    recordAudit(`Fichaje de ${kind.toLowerCase()}`, `${user.name} · ${site}${record.lateMinutes ? ` · tardanza ${record.lateMinutes} min` : ""}`);
    setClock(`${kind} registrada a las ${now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}.`);
    setAttendanceReminder(null);
  };
  const createCashTransfer = () => {
    if (!user) return;
    if (!can("transferirCaja")) return setMessage("Tu usuario no tiene permiso para transferir efectivo.");
    if (!cashIsOpen) return setMessage("Abrí la caja antes de transferir efectivo.");
    if (transferDestination === site) return setMessage("Elegí un destino distinto al local de origen.");
    if (!transferAmount || transferAmount <= 0) return setMessage("Indicá un importe válido.");
    if (transferAmount > ledgerCashBalance) return setMessage("El importe supera el efectivo registrado en la caja actual.");
    const transfer: CashTransfer = { id: crypto.randomUUID(), originSite: site, destination: transferDestination, amount: transferAmount, reason: transferReason.trim() || "Transferencia entre cajas", status: "Pendiente de recepción", createdAt: new Date().toLocaleString("es-AR"), createdBy: user.name };
    setCashTransfers((items) => [transfer, ...items]);
    appendCashLedgerEntry({ kind: "Transferencia enviada", direction: "Egreso", amount: transfer.amount, cashImpact: -transfer.amount, paymentMethod: "Efectivo", reference: transfer.id, detail: `${transfer.destination} · ${transfer.reason}` });
    recordAudit("Transferencia de caja creada", `${site} a ${transfer.destination} · ${money.format(transfer.amount)} · ${transfer.reason}`);
    setTransferAmount(0); setTransferReason("");
    setMessage(`Transferencia creada. ${transfer.destination} deberá confirmar la recepción.`);
  };
  const receiveCashTransfer = (transfer: CashTransfer) => {
    if (!user) return;
    const canReceive = user.role === "administracion" || managesCentralOrders || transfer.destination === site;
    if (!canReceive) return setMessage("Solo el destino o Central puede confirmar esta transferencia.");
    if (transfer.status !== "Pendiente de recepción") return;
    setCashTransfers((items) => items.map((item) => item.id === transfer.id ? { ...item, status: "Recibida", receivedAt: new Date().toLocaleString("es-AR"), receivedBy: user.name } : item));
    const destinationSite = transfer.destination === "Caja Mayor" ? "Villa Mitre" : transfer.destination;
    setCashLedger((items) => [{ id: crypto.randomUUID(), site: destinationSite, shiftId: activeShiftBySite[destinationSite]?.id, kind: "Transferencia recibida", direction: "Ingreso", amount: transfer.amount, cashImpact: transfer.amount, paymentMethod: "Efectivo", reference: transfer.id, detail: `${transfer.originSite} · ${transfer.reason}`, at: new Date().toLocaleString("es-AR"), atISO: new Date().toISOString(), createdBy: user.name }, ...items]);
    recordAudit("Transferencia de caja recibida", `${transfer.originSite} a ${transfer.destination} · ${money.format(transfer.amount)}`);
    setMessage("Transferencia confirmada y conciliada en el libro mayor.");
  };
  const syncContingency = async () => {
    if (connectionMode === "Contingencia")
      return setMessage("Volvé a modo En línea antes de sincronizar.");
    if (!pendingSync) return setMessage("No hay operaciones pendientes de sincronización.");
    setMessage("Sincronizando operaciones pendientes. Esperá la confirmación antes de recargar.");
    try {
      // Pedir sincronizar reintenta también un local que el servidor había rechazado.
      await (await getOutbox())?.unblockAll();
      await flushPendingWrites();
      setMessage("Todas las operaciones pendientes fueron confirmadas por el servidor.");
    } catch {
      refreshPendingCount();
      setMessage("Todavía quedan operaciones pendientes. No repitas cobros y revisá la conexión.");
    }
  };
  useEffect(() => {
    if (!user || !operationalReady || ["administracion", "compras"].includes(user.role)) return;
    const today = dateKey(new Date());
    const lastTodayRecord = attendanceRecords.find((record) =>
      record.userName === user.name && record.site === site && record.atISO.slice(0, 10) === today,
    );
    if (lastTodayRecord?.kind === "Entrada") return;
    const reminderKey = `lartisan:attendance-reminder:${user.id}:${today}`;
    try {
      if (window.sessionStorage.getItem(reminderKey)) return;
      window.sessionStorage.setItem(reminderKey, "shown");
    } catch {
      // Si el navegador bloquea sessionStorage, el recordatorio sigue siendo seguro.
    }
    const timer = window.setTimeout(() => setAttendanceReminder("Entrada"), 0);
    return () => window.clearTimeout(timer);
  }, [attendanceRecords, operationalReady, site, user]);
  if (authLoading && !user) return <SecureLoading />;
  if (!user) return <AccessScreen {...{ portal, login, setLogin, password, setPassword, showPassword, setShowPassword, authLoading, recoverySending, recoveryStage, recoveryCode, setRecoveryCode, recoveryPassword, setRecoveryPassword, recoveryPasswordConfirm, setRecoveryPasswordConfirm, setRecoveryStage, message, setMessage, enter, requestPasswordReset, confirmEmailRecovery }} />;
  if (user.mustChangePassword) return <ForcePasswordChangeScreen {...{ currentPassword, setCurrentPassword, newPassword, setNewPassword, confirmNewPassword, setConfirmNewPassword, message, changeOwnPassword, logout }} />;
  const baseTabs =
    user.role === "administracion"
        ? [
          "Administración",
          "Tareas",
          "Usuarios",
          "Catálogo y precios",
          "Límites",
          "Recetas y costos",
          "Legajos",
          "MRP",
          "Compras de producción",
          "Protección de datos",
          "Actualizaciones",
          "Integraciones",
        ]
      : user.role === "compras"
        ? ["MRP", ...(can("comprasProduccion") ? ["Compras de producción"] : [])]
        : [
          "Ventas",
          "Tareas",
          "Caja",
          "Stock",
          ...(managesCentralOrders ? [] : ["Pedido"]),
          "Devoluciones",
          "Egresos",
          "Incidencias",
          "Fichaje",
          "Clientes",
          "Guía",
          ...(can("mrp") ? ["MRP"] : []),
          ...(can("comprasProduccion") ? ["Compras de producción"] : []),
        ];
  const tabs = [
    ...baseTabs,
    ...(managesCentralOrders ? ["Central de pedidos"] : []),
    ...(canManageSchedules ? ["Horarios"] : []),
    ...(canViewSupervisorReports ? ["Reportes"] : []),
  ];
  const adminTaskAlertCount = user.role === "administracion"
    ? aiSupportRequests.filter((request) => request.status === "pendiente").length +
      resetRequests.filter((request) => request.status === "Pendiente").length
    : 0;
  const availableAdminReports =
    user.role === "administracion"
      // Administración is the owner role: its report access is never
      // constrained by the optional per-user report checklist.
      ? ADMIN_REPORTS
      : ADMIN_REPORTS;
  return (
    <main className="min-h-screen bg-[#f7f3eb] text-[#183a67]">
      {attendanceReminder && user.role !== "administracion" && user.role !== "compras" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="attendance-reminder-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <p className="text-sm font-black uppercase tracking-wide text-[#ec3a35]">Recordatorio de fichaje</p>
            <h2 id="attendance-reminder-title" className="mt-2 text-xl font-black">
              {attendanceReminder === "Entrada" ? "Marcá tu entrada antes de comenzar" : "Antes de retirarte, marcá tu salida"}
            </h2>
            <p className="mt-3 text-sm text-slate-700">
              {attendanceReminder === "Entrada"
                ? `Tu sesión en ${site} quedó iniciada. El fichaje de entrada debe registrarse con tu usuario personal.`
                : `La caja de ${site} ya se cerró. Registrá la salida con tu usuario para que el turno quede completo.`}
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button onClick={() => { setTab("Fichaje"); setAttendanceReminder(null); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="rounded bg-[#183a67] px-4 py-2.5 font-bold text-white">
                Ir a Fichaje
              </button>
              <button onClick={() => setAttendanceReminder(null)} className="rounded border px-4 py-2.5 font-bold">
                Lo haré ahora
              </button>
            </div>
          </div>
        </div>
      )}
      <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b bg-[#fffdf8] px-4 py-3 sm:px-5">
        <b className="font-serif text-xl tracking-[.15em] sm:text-2xl" aria-label="L'ARTISAN sistema interno">
          L&apos;ARTISAN
        </b>
        <div className="flex items-center gap-3 text-sm sm:text-right">
          <span className={`rounded-full px-2 py-1 text-xs font-bold ${connectionMode === "En línea" ? "bg-[#eef5ef] text-green-800" : "bg-[#fff5d8] text-[#9c302a]"}`} title={connectionMode === "En línea" ? "Las operaciones se guardan en el sistema" : "Las operaciones quedan pendientes hasta recuperar conexión"}>
            {connectionMode === "En línea" ? "● En línea" : "● Contingencia"}
          </span>
          <button onClick={() => setNavOpen((open) => !open)} aria-expanded={navOpen} aria-controls="menu-principal" className="rounded border px-3 py-2 font-bold lg:hidden">Menú</button>
          <span>
          {user.name} ·{" "}
          <button onClick={logout} className="underline">
            Salir
          </button>
          </span>
        </div>
      </header>
      <div className="grid lg:grid-cols-[230px_1fr]">
        <aside id="menu-principal" className={`${navOpen ? "block" : "hidden"} border-b bg-[#fffdf8] p-4 lg:block lg:min-h-[calc(100vh-65px)] lg:border-r`}>
          {!(["administracion", "compras"] as Role[]).includes(user.role) && (
            <>
              <label className="text-xs font-bold text-slate-500">
                SUCURSAL ACTIVA
              </label>
              {user.role === "vendedora" && !user.accessAllLocations && (user.locations?.length || 1) === 1 ? (
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
                  {(user.accessAllLocations ? SITES : user.locations?.length ? user.locations : SITES).map((s) => (
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
                onClick={() => { setTab(t); setNavOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                title={t === "Ventas" ? "Registrar productos, cobros y comandas." : t === "Caja" ? "Abrir, controlar y cerrar la caja." : t === "Stock" ? "Consultar existencias y mínimos." : t === "Tareas" ? "Ver acciones pendientes." : `Abrir ${t}.`}
                className={`rounded p-2 text-left text-sm font-bold transition ${tab === t ? "bg-[#183a67] text-white" : "hover:bg-[#eef2f6]"}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span>
                    {t === "Legajos"
                      ? `${t} (Próximamente)`
                      : t}
                  </span>
                  {t === "Tareas" && adminTaskAlertCount > 0 && (
                    <span
                      className="inline-flex min-w-6 items-center justify-center rounded-full bg-[#ec3a35] px-2 py-1 text-xs font-black leading-none text-white shadow-sm"
                      aria-label={`${adminTaskAlertCount} tareas pendientes`}
                      title={`${adminTaskAlertCount} tareas nuevas para revisar`}
                    >
                      {adminTaskAlertCount > 99 ? "99+" : adminTaskAlertCount}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </nav>
        </aside>
        <section className="p-4 sm:p-5 md:p-8">
          {(!catalog.ready || catalog.error) && <div role="status" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
            {catalog.error ? `Catálogo: ${catalog.error}` : "Cargando catálogo central…"}
            {catalog.error && <button onClick={() => void catalog.reload()} className="ml-3 font-bold underline">Reintentar</button>}
          </div>}
          {message && <div role="status" aria-live="polite" className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-[#b9d8c0] bg-[#eef5ef] p-3 text-sm font-semibold shadow-sm"><span>{message}</span><button onClick={() => setMessage("")} aria-label="Cerrar mensaje" className="shrink-0 underline">Cerrar</button></div>}
          {tab === "Reportes" && canViewSupervisorReports ? (
            <>
              <Heading
                k="SUPERVISIÓN · TODOS LOS LOCALES"
                h="Reportes de supervisión"
                p="Seguimiento operativo de ventas, stock, pedidos y cajas por sucursal."
              />
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border bg-white p-5">
                  <p className="text-sm">Ventas de esta sesión</p>
                  <b className="mt-2 block text-2xl">{money.format(sales.filter((sale) => sale.status === "activa").reduce((total, sale) => total + sale.net, 0))}</b>
                </div>
                <div className="rounded-2xl border bg-white p-5">
                  <p className="text-sm">Stock bajo</p>
                  <b className="mt-2 block text-2xl">{lowStockAlerts.length}</b>
                </div>
                <div className="rounded-2xl border bg-white p-5">
                  <p className="text-sm">Pedidos pendientes</p>
                  <b className="mt-2 block text-2xl">{stockRequests.filter((request) => request.status !== "Entregado").length}</b>
                </div>
                <div className="rounded-2xl border bg-white p-5">
                  <p className="text-sm">Cajas abiertas</p>
                  <b className="mt-2 block text-2xl">{SITES.filter((local) => cashOpenBySite[local]).length}</b>
                </div>
              </div>
              <div className="mt-5 overflow-auto rounded-2xl border bg-white">
                <table className="w-full min-w-[780px] text-sm">
                  <thead className="bg-[#eef2f6]">
                    <tr>
                      <th className="p-3 text-left">Local</th>
                      <th className="p-3 text-right">Ventas sesión</th>
                      <th className="p-3 text-center">Stock bajo</th>
                      <th className="p-3 text-center">Pedidos pendientes</th>
                      <th className="p-3 text-center">Caja</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SITES.map((local) => {
                      const localSales = sales.filter((sale) => sale.site === local && sale.status === "activa");
                      const localLowStock = lowStockAlerts.filter((alert) => alert.site === local).length;
                      const localOrders = stockRequests.filter((request) => request.site === local && request.status !== "Entregado").length;
                      return (
                        <tr key={local} className="border-t">
                          <td className="p-3 font-bold">{local}</td>
                          <td className="p-3 text-right">{money.format(localSales.reduce((total, sale) => total + sale.net, 0))}</td>
                          <td className="p-3 text-center">{localLowStock || "—"}</td>
                          <td className="p-3 text-center">{localOrders || "—"}</td>
                          <td className="p-3 text-center">{cashOpenBySite[local] ? "Abierta" : "Cerrada"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 rounded bg-[#eef2f6] p-4 text-sm">
                El perfil autorizado puede consultar los locales asignados. Estos reportes son de seguimiento; los permisos de Administración permanecen separados.
              </p>
            </>
          ) : tab === "Tareas" ? (
            <>
              <Heading
                k={user.role === "administracion" ? "ADMINISTRACIÓN" : `LOCAL · ${site.toUpperCase()}`}
                h="Bandeja de tareas"
                p="Acciones pendientes según tu rol, local y permisos."
              />
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-4">
                <div>
                  <b>Estado de conexión: {connectionMode}</b>
                  <p className="mt-1 text-sm text-slate-500">
                    {connectionMode === "Contingencia"
                      ? `${pendingSync} operación(es) quedan guardadas localmente hasta recuperar conexión.`
                      : pendingSync
                        ? `${pendingSync} operación(es) de contingencia pendientes de sincronizar.`
                        : "Sin operaciones pendientes de sincronización."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setConnectionMode((mode) => mode === "En línea" ? "Contingencia" : "En línea")}
                    className="rounded border px-3 py-2 text-sm font-bold"
                  >
                    {connectionMode === "En línea" ? "Activar contingencia" : "Volver a En línea"}
                  </button>
                  {pendingSync > 0 && (
                    <button onClick={syncContingency} className="rounded bg-[#183a67] px-3 py-2 text-sm font-bold text-white">
                      Sincronizar pendientes
                    </button>
                  )}
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {roleTasks.length ? roleTasks.map((task, index) => (
                  <button
                    key={`${task.title}-${index}`}
                    onClick={() => setTab(task.action)}
                    className="rounded-2xl border bg-white p-5 text-left transition hover:border-[#183a67]"
                  >
                    <p className="text-xs font-bold text-[#ec3a35]">PENDIENTE</p>
                    <b className="mt-2 block">{task.title}</b>
                    <p className="mt-2 text-sm text-slate-600">{task.detail}</p>
                    <span className="mt-4 inline-block text-sm font-bold underline">Ir al módulo</span>
                  </button>
                )) : (
                  <div className="rounded-2xl bg-[#eef5ef] p-5 md:col-span-2 xl:col-span-3">
                    <b>Todo al día</b>
                    <p className="mt-1 text-sm">No hay tareas operativas pendientes para este perfil.</p>
                  </div>
                )}
              </div>
              {user.role === "administracion" && aiSupportRequests.some((request) => request.status === "pendiente") && (
                <section className="mt-6 rounded-2xl border bg-white p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold text-[#ec3a35]">AYUDA DEL SISTEMA</p>
                      <h2 className="mt-1 text-xl font-bold">Consultas derivadas</h2>
                    </div>
                    <span className="rounded-full bg-[#fff5d8] px-3 py-1 text-sm font-bold">
                      {aiSupportRequests.filter((request) => request.status === "pendiente").length} pendiente(s)
                    </span>
                  </div>
                  <div className="mt-4 divide-y">
                    {aiSupportRequests.filter((request) => request.status === "pendiente").map((request) => (
                      <article key={request.id} className="py-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <b>{request.userName}</b>
                            <p className="mt-1 text-xs text-slate-500">
                              {[request.site, request.section, request.createdAt].filter(Boolean).join(" · ")}
                            </p>
                            <p className="mt-2 text-sm">{request.question}</p>
                          </div>
                          <button onClick={() => void resolveAiSupportRequest(request.id)} className="rounded border px-3 py-2 text-sm font-bold hover:bg-[#eef5ef]">
                            Marcar resuelta
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : tab === "Ventas" ? (
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
                  <label className="mb-4 block">
                    <span className="sr-only">Buscar producto</span>
                    <input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Buscar producto o categoría…" className="w-full rounded-xl border bg-white p-3 text-base" />
                  </label>
                  <input
                    ref={salesScannerRef}
                    value={salesScannerValue}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSalesScannerValue(value);
                      captureSalesScan(value);
                    }}
                    aria-label="Captura automática de lectora"
                    autoComplete="off"
                    tabIndex={-1}
                    className="fixed left-[-10000px] top-0 h-px w-px opacity-0"
                  />
                  {scannerResult && <p className="mb-4 rounded-xl border border-[#b8c8dd] bg-[#f4f8fc] px-4 py-3 text-sm font-semibold text-[#183a67]" role="status">{scannerResult}</p>}
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {visible.map((p) => (
                      <button
                        key={p.id}
                        disabled={!cashIsOpen || !stock[site][p.id]}
                        onClick={() => addProductToCart(p)}
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
                  {!visible.length && <div className="rounded-xl border border-dashed bg-white p-6 text-center"><b>No encontramos productos</b><p className="mt-1 text-sm text-slate-500">Probá con otro nombre o elegí la categoría “Todos”.</p><button onClick={() => { setProductSearch(""); setCat("Todos"); }} className="mt-3 rounded border px-3 py-2 text-sm font-bold">Limpiar búsqueda</button></div>}
                </div>
                <aside className="h-fit rounded-2xl border bg-white p-5 shadow-sm">
                  <h2 className="font-bold">Venta actual</h2>
                  <div className="my-3 divide-y">
                    {lines.length ? (
                      lines.map(({ p, q }) => (
                        <div className="flex justify-between py-3" key={p.id}>
                          <span className="pr-3">
                            <b>{p.name}</b> × {q}
                            <label className="mt-1 flex items-center gap-1 text-xs font-medium text-slate-600">
                              <input
                                type="checkbox"
                                checked={(invitedQuantities[p.id] ?? 0) > 0}
                                onChange={(event) =>
                                  setInvitedQuantities((quantities) =>
                                    event.target.checked
                                      ? { ...quantities, [p.id]: 1 }
                                      : Object.fromEntries(
                                          Object.entries(quantities).filter(
                                            ([id]) => Number(id) !== p.id,
                                          ),
                                        ),
                                  )
                                }
                              />
                              Invitación
                            </label>
                            {(invitedQuantities[p.id] ?? 0) > 0 && (
                              <label className="mt-1 flex items-center gap-2 text-xs text-slate-600">
                                Unidades invitadas
                                <input
                                  type="number"
                                  min="1"
                                  max={q}
                                  value={invitedQuantities[p.id]}
                                  onChange={(event) =>
                                    setInvitedQuantities((quantities) => ({
                                      ...quantities,
                                      [p.id]: Math.max(
                                        1,
                                        Math.min(q, Number(event.target.value) || 1),
                                      ),
                                    }))
                                  }
                                  className="w-14 rounded border px-1 py-0.5"
                                />
                              </label>
                            )}
                          </span>
                          <button
                            onClick={() => {
                              setCart((c) => {
                                const i = c.findIndex((x) => x.id === p.id);
                                return c.filter((_, n) => n !== i);
                              });
                              setInvitedQuantities((quantities) => {
                                const remainingUnits = q - 1;
                                const invitedUnits = quantities[p.id] ?? 0;
                                if (remainingUnits === 0 || invitedUnits === 0)
                                  return Object.fromEntries(
                                    Object.entries(quantities).filter(
                                      ([id]) => Number(id) !== p.id,
                                    ),
                                  );
                                return {
                                  ...quantities,
                                  [p.id]: Math.min(invitedUnits, remainingUnits),
                                };
                              });
                              // El botón toma el foco. Restituimos el capturador
                              // invisible para que la próxima lectura USB se
                              // procese como venta sin cerrar y reabrir caja.
                              scannerBufferRef.current = { value: "", lastKeyAt: 0, input: null, originalValue: "" };
                              setSalesScannerValue("");
                              salesScannerRef.current?.focus();
                            }}
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
                    Bruto {money.format(total)} · Descuento {money.format(discountAmount)}
                  </p>
                  {invitationTotal > 0 && (
                    <p className="mt-1 text-sm text-emerald-700">
                      Invitación de producto −{money.format(invitationTotal)}
                    </p>
                  )}
                  <p className="mt-2 text-xl font-bold">
                    Total {money.format(net)}
                  </p>
                  <label className="mt-4 block text-sm font-bold">
                    Medio de pago
                  </label>
                  <select
                    value={payment}
                    onChange={(e) => setPayment(e.target.value)}
                    disabled={splitPayment}
                    className="mt-1 w-full rounded border p-2"
                  >
                    {methods.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                  <label className="mt-3 flex items-center gap-2 text-sm font-bold">
                    <input
                      type="checkbox"
                      checked={splitPayment}
                      onChange={(event) => setSplitPayment(event.target.checked)}
                    />
                    Cobro con varios medios de pago
                  </label>
                  {splitPayment && (
                    <div className="mt-2 rounded border bg-[#eef2f6] p-3">
                      <p className="text-xs font-bold">Distribuí el total entre los medios usados.</p>
                      {splitPayments.map((item, index) => (
                        <div key={index} className="mt-2 grid grid-cols-[1fr_.7fr_auto] gap-2">
                          <select
                            value={item.method}
                            onChange={(event) => setSplitPayments((items) => items.map((current, position) => position === index ? { ...current, method: event.target.value } : current))}
                            className="rounded border p-2 text-sm"
                          >
                            {methods.map((method) => <option key={method}>{method}</option>)}
                          </select>
                          <input
                            type="number"
                            min="0"
                            value={item.amount || ""}
                            onChange={(event) => setSplitPayments((items) => items.map((current, position) => position === index ? { ...current, amount: Number(event.target.value) } : current))}
                            placeholder="Importe"
                            className="rounded border p-2 text-sm"
                          />
                          <button
                            onClick={() => setSplitPayments((items) => items.length > 2 ? items.filter((_, position) => position !== index) : items)}
                            className="text-xs underline"
                          >Quitar</button>
                        </div>
                      ))}
                      <button
                        onClick={() => setSplitPayments((items) => [...items, { method: methods[0], amount: 0 }])}
                        className="mt-3 text-sm font-bold text-[#183a67] underline"
                      >+ Agregar medio</button>
                      <p className={`mt-2 text-xs font-bold ${Math.round(splitPaymentTotal) === net ? "text-emerald-700" : "text-red-600"}`}>
                        Cargado {money.format(splitPaymentTotal)} · debe totalizar {money.format(net)}
                      </p>
                    </div>
                  )}
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
                    <select value={selectedCustomerId || ""} onChange={(event) => { const selected = customers.find(item => item.id === event.target.value); setSelectedCustomerId(selected?.id || null); if (!selected) return; setCustomer(selected.name); setCustomerDocumentType(selected.documentType === "Otro" ? "DNI" : selected.documentType); setCustomerDocumentNumber(selected.documentNumber); setCustomerAddress(selected.address || ""); }} className="mt-1 w-full rounded border p-2 font-normal">
                      <option value="">Buscar cliente registrado por documento…</option>
                      {customers.filter(item => item.site === site && item.active).map(item => <option key={item.id} value={item.id}>{item.name} · {item.documentType} {item.documentNumber}</option>)}
                    </select>
                    <input
                      value={customer}
                      onChange={(event) => { setCustomer(event.target.value); setSelectedCustomerId(null); }}
                      className="mt-1 w-full rounded border p-2 font-normal"
                      placeholder="Consumidor final o razón social"
                    />
                  </label>
                  <div className="mt-3 rounded border border-[#d9d4c9] bg-[#f8fafc] p-3 text-sm">
                    <b>Datos para comprobante fiscal</b>
                    <p className="mt-1 text-xs text-slate-600">Se guardan con la venta. Factura A exige CUIT, condición fiscal y domicilio.</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <label className="font-bold">Documento
                        <select value={customerDocumentType} onChange={(event) => setCustomerDocumentType(event.target.value as NonNullable<Sale["customerDocumentType"]>)} className="mt-1 w-full rounded border p-2 font-normal">
                          <option>Consumidor final</option><option>DNI</option><option>CUIT</option>
                        </select>
                      </label>
                      <label className="font-bold">Número
                        <input value={customerDocumentNumber} onChange={(event) => setCustomerDocumentNumber(event.target.value)} inputMode="numeric" className="mt-1 w-full rounded border p-2 font-normal" placeholder={customerDocumentType === "CUIT" ? "11 dígitos" : "Opcional"} />
                      </label>
                      <label className="font-bold">Condición fiscal
                        <select value={customerTaxCondition} onChange={(event) => setCustomerTaxCondition(event.target.value)} className="mt-1 w-full rounded border p-2 font-normal">
                          <option value="">Seleccionar</option><option>Consumidor final</option><option>Responsable Inscripto</option><option>Monotributista</option><option>Exento</option>
                        </select>
                      </label>
                      <label className="font-bold">Domicilio fiscal
                        <input value={customerAddress} onChange={(event) => setCustomerAddress(event.target.value)} className="mt-1 w-full rounded border p-2 font-normal" placeholder="Calle, número y localidad" />
                      </label>
                    </div>
                  </div>
                  <button
                    onClick={pay}
                    disabled={!cashIsOpen}
                    className="mt-4 w-full rounded bg-[#183a67] py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {cashIsOpen ? "Cobrar venta" : "Abrí caja para cobrar"}
                  </button>
                  <button
                    onClick={() => {
                      const latest = sales.find((sale) => sale.site === site);
                      if (!latest) return setMessage("Primero registrá una venta para generar el ticket.");
                      setReceiptSale(latest);
                    }}
                    className="mt-2 w-full rounded border py-2 font-bold"
                  >
                    Imprimir último ticket
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
                    <div className="mt-4 border-t pt-4">
                      <p className="text-sm font-bold">Buscar venta y corregir medio de pago</p>
                      <p className="mt-1 text-xs text-slate-500">La corrección conserva productos, total, stock y la venta original. Si interviene efectivo, ajusta la caja y deja auditoría.</p>
                      <input
                        value={saleSearch}
                        onChange={(event) => setSaleSearch(event.target.value)}
                        placeholder="Buscar por cliente, importe o referencia"
                        className="mt-2 w-full rounded border p-2 text-xs"
                      />
                    </div>
                    {sales.filter((sale) => sale.site === site && `${sale.customer} ${sale.net} ${sale.id} ${sale.method}`.toLowerCase().includes(saleSearch.trim().toLowerCase())).length ? (
                      sales
                        .filter((sale) => sale.site === site && `${sale.customer} ${sale.net} ${sale.id} ${sale.method}`.toLowerCase().includes(saleSearch.trim().toLowerCase()))
                        .slice(0, 8)
                        .map((sale) => (
                          <div
                            key={sale.id}
                            className="mt-2 rounded border p-2 text-xs"
                          >
                            <div>
                              {money.format(sale.net)} · {sale.customer} ·{" "}
                              {sale.method}
                              {sale.status === "anulada" && " · ANULADA"}
                              <span className="ml-1 text-slate-400">#{sale.id.slice(0, 8)}</span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {sale.status === "activa" && (
                                <button
                                  onClick={() => {
                                    if (!can("cobrar")) return setMessage("Tu usuario no tiene permiso para corregir medios de pago.");
                                    if (!cashIsOpen) return setMessage("Abrí la caja antes de corregir un medio de pago.");
                                    setPaymentCorrectionMethod(payments.find((item) => item.saleId === sale.id)?.method || sale.method);
                                    setPaymentCorrectionSaleId(sale.id);
                                  }}
                                  className="rounded border px-2 py-1 font-bold text-[#183a67]"
                                >
                                  Corregir medio
                                </button>
                              )}
                              <select
                                value={sale.invoiceType}
                                disabled={!can("anular")}
                                title={can("anular") ? undefined : "Requiere permiso para anular ventas"}
                                onChange={(event) =>
                                  changeSaleInvoice(
                                    sale,
                                    event.target.value as Sale["invoiceType"],
                                  )
                                }
                                className="rounded border p-1 disabled:opacity-60"
                              >
                                <option>Factura B</option>
                                <option>Factura B electrónica</option>
                                <option>Factura A</option>
                                <option>Remito interno</option>
                              </select>
                              {sale.status === "activa" && (
                              <button
                                onClick={() => cancelSale(sale)}
                                className="underline"
                              >
                                Anular
                              </button>
                            )}
                            <button
                              onClick={() => setReceiptSale(sale)}
                              className="underline"
                            >
                              Ticket
                            </button>
                            </div>
                          </div>
                        ))
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">
                        No hay ventas de este local que coincidan con la búsqueda.
                      </p>
                    )}
                    {paymentCorrectionSaleId && (() => {
                      const sale = sales.find((item) => item.id === paymentCorrectionSaleId);
                      if (!sale) return null;
                      const salePayments = payments.filter((item) => item.saleId === sale.id);
                      const currentDescription = salePayments.map((item) => `${item.method} ${money.format(item.amount)}`).join(" + ") || sale.method;
                      const isSplit = salePayments.length > 1;
                      return (
                        <div className="mt-3 rounded border-2 border-[#183a67] bg-[#f7fafc] p-3 text-xs">
                          <p className="font-bold">Corregir medio de pago · #{sale.id.slice(0, 8)}</p>
                          <p className="mt-1">Total {money.format(sale.net)} · registrado: {currentDescription}</p>
                          {isSplit && <p className="mt-1 rounded bg-amber-50 p-2 text-amber-900">Esta venta tuvo pago dividido. Esta corrección reunirá el total en un solo medio; verificá el comprobante antes de confirmar.</p>}
                          <label className="mt-2 block font-bold">Medio realmente cobrado
                            <select value={paymentCorrectionMethod} onChange={(event) => setPaymentCorrectionMethod(event.target.value)} className="mt-1 w-full rounded border p-2 font-normal">
                              {methods.map((method) => <option key={method}>{method}</option>)}
                            </select>
                          </label>
                          <p className="mt-2 text-slate-600">No se modifica la venta, el total, el stock ni la factura/CAE. Si cambia Efectivo, se registra el ajuste correspondiente en caja y la auditoría.</p>
                          <div className="mt-3 flex gap-2">
                            <button onClick={() => changeSalePayment(sale, paymentCorrectionMethod)} className="rounded bg-[#183a67] px-3 py-2 font-bold text-white">Confirmar corrección</button>
                            <button onClick={() => setPaymentCorrectionSaleId(null)} className="rounded border px-3 py-2 font-bold">Cancelar</button>
                          </div>
                        </div>
                      );
                    })()}
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
                  <div className="mt-6 border-t pt-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <b>Libro mayor de caja</b>
                      {activeShift && (
                        <span className="text-sm font-bold text-[#183a67]">
                          Efectivo registrado: {money.format(ledgerCashBalance)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Cada apertura, venta, ajuste, retiro, sobre y cierre queda registrado por separado.
                    </p>
                    <div className="mt-3 max-h-80 overflow-auto rounded border">
                      {siteCashLedger.length ? (
                        <table className="w-full text-left text-xs">
                          <thead className="sticky top-0 bg-[#eef2f6] text-[#183a67]">
                            <tr>
                              <th className="p-2">Hora</th>
                              <th className="p-2">Movimiento</th>
                              <th className="p-2">Medio</th>
                              <th className="p-2 text-right">Importe</th>
                            </tr>
                          </thead>
                          <tbody>
                            {siteCashLedger.slice(0, 20).map((entry) => (
                              <tr key={entry.id} className="border-t">
                                <td className="p-2 align-top text-slate-500">{entry.at}</td>
                                <td className="p-2 align-top">
                                  <b>{entry.kind}</b>
                                  <span className="block text-slate-500">{entry.detail}</span>
                                </td>
                                <td className="p-2 align-top">{entry.paymentMethod || "—"}</td>
                                <td className={`p-2 text-right align-top font-bold ${entry.direction === "Egreso" ? "text-[#9c302a]" : entry.direction === "Ingreso" ? "text-green-700" : "text-slate-600"}`}>
                                  {entry.direction === "Egreso" ? "−" : entry.direction === "Ingreso" ? "+" : ""}{money.format(entry.amount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className="p-3 text-sm text-slate-500">El libro mayor comenzará al abrir la caja.</p>
                      )}
                    </div>
                  </div>
                  <div className="mt-6 border-t pt-4">
                    <b>Transferencia formal entre cajas</b>
                    <p className="mt-1 text-xs text-slate-500">El origen registra el egreso ahora; el destino debe confirmar la recepción para completar la conciliación.</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <select value={transferDestination} onChange={(event) => setTransferDestination(event.target.value)} className="rounded border p-2 text-sm">
                        <option>Caja Mayor</option>
                        {SITES.filter((local) => local !== site).map((local) => <option key={local}>{local}</option>)}
                      </select>
                      <input type="number" min="0" value={transferAmount || ""} onChange={(event) => setTransferAmount(Number(event.target.value))} placeholder="Importe" className="rounded border p-2 text-sm" />
                      <button onClick={createCashTransfer} disabled={!cashIsOpen || !can("transferirCaja")} className="rounded border border-[#183a67] px-3 py-2 text-sm font-bold disabled:opacity-40">Enviar efectivo</button>
                    </div>
                    <input value={transferReason} onChange={(event) => setTransferReason(event.target.value)} placeholder="Motivo o referencia" className="mt-2 w-full rounded border p-2 text-sm" />
                    {cashTransfers.filter((transfer) => transfer.originSite === site || transfer.destination === site || (transfer.destination === "Caja Mayor" && managesCentralOrders)).slice(0, 5).map((transfer) => (
                      <div key={transfer.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded bg-[#eef2f6] p-2 text-xs">
                        <span><b>{transfer.originSite} → {transfer.destination}</b> · {money.format(transfer.amount)} · {transfer.status}</span>
                        {transfer.status === "Pendiente de recepción" && (user.role === "administracion" || managesCentralOrders || transfer.destination === site) && <button onClick={() => receiveCashTransfer(transfer)} className="font-bold underline">Confirmar recepción</button>}
                      </div>
                    ))}
                  </div>
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
                    min="0"
                    value={fund}
                    onChange={(e) => setFund(Number(e.target.value))}
                    disabled={Boolean(activeShift)}
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
                  {cashIsOpen && !activeShift && (
                    <button
                      onClick={openCash}
                      className="mt-3 w-full rounded bg-[#183a67] py-3 font-bold text-white"
                    >
                      Abrir nuevo turno
                    </button>
                  )}
                  {cashIsOpen && activeShift && (
                    <div className="mt-3 rounded border border-[#b9d8c0] bg-[#eef5ef] p-3 text-sm">
                      <b>Turno abierto</b>
                      <p className="mt-1">Responsable: {activeShift.openedBy} · Fondo declarado: {money.format(activeShift.initialFund)}</p>
                      <button
                        onClick={closeShift}
                        className="mt-3 rounded border border-[#183a67] px-3 py-2 text-xs font-bold"
                      >
                        Cerrar turno y pasar caja
                      </button>
                    </div>
                  )}
                  <label className="mt-3 block text-sm font-bold">Otros gastos en efectivo (no cargados en Egresos)</label>
                  <input
                    type="number"
                    value={expenses}
                    onChange={(e) => setExpenses(Number(e.target.value))}
                    disabled={!cashControlIsOpen}
                    className="mt-1 w-full rounded border p-2"
                  />
                  <label className="mt-3 block text-sm font-bold">
                    Retiros
                  </label>
                  <input
                    type="number"
                    value={withdrawals}
                    onChange={(e) => setWithdrawals(Number(e.target.value))}
                    disabled={!cashControlIsOpen}
                    className="mt-1 w-full rounded border p-2"
                  />
                  {cashControlIsOpen ? <>
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
                  </> : <p className="mt-3 rounded bg-[#eef2f6] p-3 text-sm text-slate-600">
                    Caja cerrada: la conciliación del turno quedó registrada. Abrí una caja para iniciar una nueva conciliación.
                  </p>}
                  {requiresEnvelope && (
                    <>
                      <label className="mt-3 block text-sm font-bold">
                        Sobre en efectivo
                      </label>
                      <input
                        type="number"
                        value={envelope}
                        onChange={(e) => setEnvelope(Number(e.target.value))}
                        disabled={!cashControlIsOpen}
                        className="mt-1 w-full rounded border p-2"
                      />
                      <p className="mt-1 text-xs text-slate-500">
                        El sobre se descuenta del efectivo físico contado: así
                        se muestra cuánto queda realmente en caja.
                      </p>
                    </>
                  )}
                  {cashControlIsOpen && <>
                    <p
                      className="mt-3 rounded bg-[#eef2f6] p-3 font-bold"
                    >
                      Efectivo que queda en caja: {money.format(cashRemaining)}
                    </p>
                    <p
                      className={`mt-2 rounded p-3 text-sm font-bold ${cashVariance === 0 ? "bg-[#eef5ef]" : "bg-[#fff1ec]"}`}
                    >
                      Diferencia contra efectivo esperado: {money.format(cashVariance)}
                    </p>
                  </>}
                  {cashControlIsOpen && Math.abs(cashVariance) > siteLimits.maxCashDifference && (
                    <label className="mt-3 block text-sm font-bold">
                      Motivo de la diferencia (obligatorio para cerrar)
                      <input
                        value={cashDifferenceReason}
                        onChange={(event) => setCashDifferenceReason(event.target.value)}
                        placeholder="Ej.: vuelto mal entregado, billete faltante"
                        className="mt-1 w-full rounded border p-2 font-normal"
                      />
                      <span className="mt-1 block text-xs font-normal text-slate-500">
                        Supera el máximo de {money.format(siteLimits.maxCashDifference)}: quedará como incidencia para Administración.
                      </span>
                    </label>
                  )}
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
                    {cashAdjustmentKind === "Ajuste de caja" && (
                      <select
                        value={cashAdjustmentImpact}
                        onChange={(event) => setCashAdjustmentImpact(event.target.value as "Ingreso" | "Egreso")}
                        className="mt-2 w-full rounded border p-2"
                        aria-label="Impacto del ajuste"
                      >
                        <option value="Ingreso">Ajuste que suma efectivo</option>
                        <option value="Egreso">Ajuste que resta efectivo</option>
                      </select>
                    )}
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
                    <div className="mt-3 rounded bg-[#eef5ef] p-3 text-sm">
                      <p>Cierre guardado en el sistema. El estado de la planilla se muestra abajo.</p>
                      <button
                        onClick={retryLastCashCloseSync}
                        className="mt-2 rounded border border-[#183a67] px-3 py-2 text-xs font-bold text-[#183a67]"
                      >
                        Reintentar sincronización con Drive
                      </button>
                    </div>
                  )}
                  <div className="mt-4 rounded border border-[#d9d4c9] bg-[#fffdf8] p-3 text-xs">
                    <b>Integración de planilla diaria</b>
                    <p className="mt-1">
                      Hoja destino: {SHEET_CONFIG[site].sheet}. Cada medio de
                      pago se valida contra el encabezado propio del local antes
                      de actualizar la fila del día.
                    </p>
                    <p className="mt-1 text-slate-500">
                      No se duplican cierres ni se reemplazan fórmulas o valores
                      distintos ya cargados. La conexión se administra únicamente en el servidor.
                    </p>
                    <p className="mt-2 text-slate-500">{syncStatus}</p>
                    {user.role === "administracion" && (
                      <button
                        onClick={() => void authorizeCashSheets()}
                        className="mt-3 rounded border border-[#183a67] px-3 py-2 text-xs font-bold text-[#183a67]"
                      >
                        Ver requisitos de Apps Script
                      </button>
                    )}
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
              <div className="mb-4 grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-[1fr_260px]">
                <label className="text-sm font-bold">
                  Buscar producto o insumo
                  <input
                    value={stockSearch}
                    onChange={(event) => setStockSearch(event.target.value)}
                    placeholder="Nombre, presentación, código o código de barras"
                    className="mt-1 w-full rounded border p-2 font-normal"
                  />
                </label>
                <label className="text-sm font-bold">
                  Grupo
                  <select
                    value={stockGroup}
                    onChange={(event) => setStockGroup(event.target.value)}
                    className="mt-1 w-full rounded border p-2 font-normal"
                  >
                    <option>Todos los grupos</option>
                    {stockGroups.map((group) => <option key={group}>{group}</option>)}
                  </select>
                </label>
                <p className="text-xs text-slate-500 md:col-span-2">
                  Mostrando {visibleStockProducts.length} de {products.length} productos del inventario de {site}.
                </p>
              </div>
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
                      <th className="p-3 text-left">Observación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleStockProducts.map((p) => {
                      const countedStock = realStock[site]?.[p.id] ?? "";
                      const countedQuantity = Number(countedStock);
                      const hasValidCount = countedStock !== "" && Number.isFinite(countedQuantity);
                      return (
                      <tr key={p.id} className="border-t">
                        <td className="p-3">
                          <b>{p.name}</b>
                        </td>
                        <td className="p-3">{p.detail}</td>
                        <td className="p-3 text-center">{safeStockQuantity(stock[site]?.[p.id])}</td>
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
                              value={countedStock}
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
                            <span>{countedStock || "—"}</span>
                          )}
                        </td>
                        <td className="p-3 text-center font-bold">
                          {!hasValidCount
                            ? "—"
                            : countedQuantity - safeStockQuantity(stock[site]?.[p.id])}
                        </td>
                        <td className="p-3">
                          {canCountRealStock ? (
                            <input
                              value={stockCountComments[site][p.id] || ""}
                              onChange={(e) =>
                                setStockCountComments((current) => ({
                                  ...current,
                                  [site]: {
                                    ...current[site],
                                    [p.id]: e.target.value,
                                  },
                                }))
                              }
                              placeholder="Obligatoria si hay diferencia"
                              aria-label={`Observación de stock de ${p.name}`}
                              className="w-56 rounded border p-1"
                            />
                          ) : (
                            <span>{stockCountComments[site][p.id] || "—"}</span>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                    {!visibleStockProducts.length && (
                      <tr><td colSpan={7} className="p-4 text-center text-slate-500">No hay productos o insumos que coincidan con la búsqueda y el grupo elegidos.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-sm text-slate-500">
                El conteo real y sus observaciones quedan registrados. Las diferencias requieren comentario y no modifican el stock teórico hasta que se revisen.
              </p>
              {canCountRealStock && (
                <div className="mt-5 rounded-2xl border bg-white p-5">
                  <b>Cerrar control de stock del local</b>
                  <p className="mt-1 text-sm text-slate-500">
                    Los perfiles con permiso de stock cargan el conteo de cada local. Al cerrar, cada diferencia con su observación queda en historial y aparece como tarea para Administración y los perfiles autorizados de stock; el stock teórico no cambia automáticamente.
                  </p>
                  <button
                    onClick={submitStockControl}
                    className="mt-4 rounded bg-[#183a67] px-4 py-2.5 font-bold text-white"
                  >
                    Enviar diferencias para revisión
                  </button>
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
                        {products.map((product) => (
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
                      Enviar a aprobación
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
                        {products.map((product) => (
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
                        <option>Ingreso por remito</option>
                        <option>Ingreso manual</option>
                        <option>Egreso manual</option>
                        <option>Merma</option>
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
                p="Registro personal de entrada y salida con credencial individual."
              />
              <div className="grid max-w-3xl gap-5 md:grid-cols-2">
                <div className="rounded-2xl border bg-white p-6">
                  <p className="rounded bg-[#eef2f6] p-3 text-sm">Fichás con tu sesión personal: <b>{user.name}</b>. El registro queda asociado al local seleccionado.</p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <button
                      onClick={() => markAttendance("Entrada")}
                      className="rounded bg-[#183a67] py-3 font-bold text-white"
                    >
                      Marcar entrada
                    </button>
                    <button
                      onClick={() => markAttendance("Salida")}
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
                  {attendanceRecords.filter((record) => record.site === site).slice(0, 5).map((record) => (
                    <p className="mt-3" key={record.id}>
                      <b>{record.userName}</b> · <span className={record.kind === "Entrada" ? "font-bold text-green-700" : "font-bold text-slate-600"}>{record.kind}</span><span className="block text-xs text-slate-500">{record.at}{record.lateMinutes ? ` · tardanza ${record.lateMinutes} min` : ""}</span>
                    </p>
                  ))}
                  {!attendanceRecords.some((record) => record.site === site) && <p className="mt-4 text-sm text-slate-500">Aún no hay fichajes registrados para este local.</p>}
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
                p="Armá el pedido del local y envialo a Central para preparación y despacho."
              />
              <input
                ref={pedidoScannerRef}
                value={pedidoScannerValue}
                onChange={(event) => {
                  const value = event.target.value;
                  setPedidoScannerValue(value);
                  capturePedidoScan(value);
                }}
                aria-label="Captura automática de lectora para recepción"
                autoComplete="off"
                tabIndex={-1}
                className="fixed left-[-10000px] top-0 h-px w-px opacity-0"
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
                    {products.map((product) => {
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
                              <>
                                <button onClick={() => startScannedReception(request)} className="mt-2 rounded bg-[#183a67] px-3 py-2 font-bold text-white">
                                  Recibir con lectora
                                </button>
                                <button onClick={() => startManualReception(request)} className="ml-2 mt-2 rounded border border-[#183a67] px-3 py-2 font-bold text-[#183a67]">
                                  Recepción manual
                                </button>
                                {receivingRequestId === request.id && (
                                  <div className="mt-3 rounded border border-[#b8c8dd] bg-white p-3">
                                    <b>Validación de recepción</b>
                                    <input
                                      ref={receptionScannerRef}
                                      value={receivingBarcodeInput}
                                      onChange={(event) => {
                                        const value = event.target.value;
                                        setReceivingBarcodeInput(value);
                                        if (productFromScannedCode(value)) {
                                          scanReceivedProduct(value);
                                        }
                                      }}
                                      aria-label="Escáner de recepción activo"
                                      className="sr-only"
                                      autoComplete="off"
                                    />
                                    <p className="mt-1 text-xs text-slate-600">Escaneá cada unidad entregada. Si la lectora falla, usá los botones − y + para registrar el conteo manual. El stock se actualiza sólo cuando la lista coincide con el despacho.</p>
                                    <div className="mt-2 space-y-1 text-xs">
                                      {request.lines.map((line) => {
                                        const product = products.find((item) => item.id === line.productId);
                                        const expected = line.preparedQuantity ?? line.quantity;
                                        const received = receivedScanCounts[line.productId] || 0;
                                        return <div key={line.productId} className="flex items-center justify-between gap-2"><p><b>{product?.name || "Producto"}</b>: {received}/{expected} {received === expected ? "✓" : "pendiente"}</p><span className="flex gap-1"><button type="button" aria-label={`Restar una unidad de ${product?.name || "producto"}`} onClick={() => adjustManualReceptionCount(request, line.productId, -1)} disabled={received === 0} className="rounded border px-2 py-1 font-bold disabled:opacity-40">−</button><button type="button" aria-label={`Sumar una unidad de ${product?.name || "producto"}`} onClick={() => adjustManualReceptionCount(request, line.productId, 1)} disabled={received >= expected} className="rounded border px-2 py-1 font-bold disabled:opacity-40">+</button></span></div>;
                                      })}
                                    </div>
                                    {receivingScanNotice && <p className="mt-2 text-xs font-semibold text-[#183a67]" role="status">{receivingScanNotice}</p>}
                                    <button onClick={() => confirmScannedReception(request)} className="mt-3 rounded bg-[#183a67] px-3 py-2 font-bold text-white">Confirmar ingreso a stock</button>
                                  </div>
                                )}
                              </>
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
                          const product = products.find(
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
                                  {line.quantity ? `Solicitado: ${line.quantity} · Enviado` : "Agregado por Central · Enviado"}
                                  <input
                                    type="number"
                                    min="0"
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
                                  {(line.preparedQuantity ?? line.quantity) > line.quantity ? `Extra ${(line.preparedQuantity ?? line.quantity) - line.quantity}` : `Faltan ${line.quantity - (line.preparedQuantity ?? line.quantity)}`}
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
                      {selectedRequest.status !== "Entregado" && (
                        <div className="no-print mt-4 rounded border bg-[#eef2f6] p-3">
                          <b className="text-sm">Agregar artículo al despacho</b>
                          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_92px_auto]">
                            <select value={centralExtraProductId} onChange={(event) => setCentralExtraProductId(Number(event.target.value))} className="rounded border p-2 text-sm">
                              {products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.detail}</option>)}
                            </select>
                            <input type="number" min="1" value={centralExtraQuantity} onChange={(event) => setCentralExtraQuantity(Math.max(1, Number(event.target.value) || 1))} className="rounded border p-2 text-center text-sm" />
                            <button onClick={() => addCentralExtraItem(selectedRequest)} className="rounded bg-[#183a67] px-3 py-2 text-sm font-bold text-white">Agregar</button>
                          </div>
                        </div>
                      )}
                      {["Pendiente", "En preparación"].includes(selectedRequest.status) ? (
                        <button
                          onClick={() => confirmCentralDispatch(selectedRequest)}
                          className="no-print mt-4 w-full rounded bg-[#ec3a35] px-3 py-3 text-sm font-bold text-white"
                        >
                          Confirmar despacho
                        </button>
                      ) : (
                        <p className="mt-4 rounded bg-[#eef5ef] p-3 text-sm font-semibold text-[#183a67]">
                          {selectedRequest.status === "Entregado" ? "Pedido recibido por el local." : "Despacho confirmado: el local debe validar la recepción con lectora."}
                        </p>
                      )}
                      <div className="no-print mt-4 grid gap-2 sm:grid-cols-2">
                        <button
                          onClick={() => exportRequestCsv(selectedRequest)}
                          className="rounded bg-[#183a67] px-3 py-3 text-sm font-bold text-white"
                        >
                          Descargar CSV
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
                      Un perfil autorizado carga el conteo y otro confirma el cambio
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
                                products.find(
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
                                canApproveStockAdjustments ? (
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
                                    Revisión autorizada
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
                      onChange={(event) => {
                        setReturnSaleId(event.target.value);
                        setReturnQuantities({});
                      }}
                      className="mt-1 w-full rounded border p-2 font-normal"
                    >
                      <option value="">Seleccionar venta</option>
                      {sales
                        .filter(
                          (sale) => sale.site === site && sale.status === "activa",
                        )
                        .map((sale) => (
                          <option key={sale.id} value={sale.id}>
                            {sale.createdAt} · {sale.customer} · {money.format(sale.net)}
                          </option>
                        ))}
                    </select>
                  </label>
                  {returnSaleId && (() => {
                    const sale = sales.find((item) => item.id === returnSaleId);
                    if (!sale) return null;
                    const sold = sale.items.reduce<Record<number, number>>((all, item) => ({ ...all, [item.id]: (all[item.id] || 0) + 1 }), {});
                    const returned = returnsLog.filter((item) => item.saleId === sale.id).reduce<Record<number, number>>((all, item) => {
                      item.lines.forEach((line) => { all[line.productId] = (all[line.productId] || 0) + line.quantity; });
                      return all;
                    }, {});
                    return <div className="mt-3 rounded border bg-[#eef2f6] p-3 text-sm">
                      <b>Productos a devolver / cambiar</b>
                      <p className="mt-1 text-xs text-slate-600">Elegí cantidades. Se admite una devolución parcial y se calcula el importe proporcional.</p>
                      <div className="mt-2 space-y-2">
                        {Object.entries(sold).map(([productId, soldQuantity]) => {
                          const product = products.find((item) => item.id === Number(productId));
                          const available = soldQuantity - (returned[Number(productId)] || 0);
                          return <label key={productId} className="flex items-center justify-between gap-3 rounded bg-white p-2">
                            <span><b>{product?.name || "Producto"}</b><span className="block text-xs text-slate-500">Disponible: {available}</span></span>
                            <input type="number" min="0" max={available} value={returnQuantities[Number(productId)] || ""} placeholder="0" onChange={(event) => setReturnQuantities((items) => ({ ...items, [Number(productId)]: Math.max(0, Math.min(available, Number(event.target.value) || 0)) }))} className="w-20 rounded border p-1 text-center" />
                          </label>;
                        })}
                      </div>
                    </div>;
                  })()}
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
                    Emitir nota interna y registrar
                  </button>
                </div>
                <div className="rounded-2xl border bg-white p-5">
                  <b>Historial de devoluciones y cambios</b>
                  <div className="mt-3 divide-y">
                    {siteReturns.length ? (
                      siteReturns.map((transaction) => (
                        <div key={transaction.id} className="py-3 text-sm">
                          <div className="flex justify-between gap-3">
                            <b>{transaction.kind} · {transaction.creditNoteNumber}</b>
                            <b>{money.format(transaction.amount)}</b>
                          </div>
                          <p className="mt-1">{transaction.reason}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {transaction.createdAt} · {transaction.createdBy} · {transaction.refundMethod} · {transaction.restock ? "Stock repuesto" : "Sin reingreso a stock"} · {transaction.lines.map((line) => `${products.find((item) => item.id === line.productId)?.name || "Producto"} × ${line.quantity}`).join(", ")}
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
              <p className="mt-4 max-w-5xl rounded border border-[#e7c26a] bg-[#fff5d8] p-3 text-xs text-slate-700">La nota de crédito emitida aquí es interna y deja trazabilidad comercial y de stock. El comprobante fiscal ARCA/AFIP se incorporará cuando se active el circuito fiscal.</p>
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
                    <span className="block text-xs font-normal text-slate-500">
                      Se registra el nombre del archivo; el archivo no se guarda en el sistema.
                    </span>
                    <input
                      type="file"
                      onChange={(event) =>
                        setExpenseReceipt(event.target.files?.[0]?.name || "")
                      }
                      className="mt-1 block w-full text-sm font-normal"
                    />
                  </label>
                  <label className="mt-3 flex items-center gap-2 text-sm font-bold">
                    <input
                      type="checkbox"
                      checked={expensePaidWithCash}
                      onChange={(event) => setExpensePaidWithCash(event.target.checked)}
                    />
                    Pagado con efectivo de la caja
                  </label>
                  <p className="mt-1 text-xs text-slate-500">
                    Si está marcado, el importe se descuenta del efectivo esperado del turno y no hay que repetirlo al cierre.
                  </p>
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
                    <li>Ingresá con tu usuario personal, elegí el local correcto y registrá el fichaje.</li>
                    <li>Abrí Caja, declarando fondo inicial y responsable.</li>
                    <li>Elegí Mostrador u Online antes de cargar productos.</li>
                    <li>Guardá comandas si necesitás atender varias ventas.</li>
                    <li>Aplicá descuentos o invitaciones por producto cuando corresponda.</li>
                    <li>Cobrá con el medio real; si son dos, usá Pago dividido y verificá que los importes completen el total.</li>
                    <li>Revisá el tipo de comprobante. Factura A requiere razón social, CUIT, condición Responsable Inscripto y domicilio; el CAE fiscal se controla desde Administración.</li>
                    <li>Revisá el ticket y, si el cliente lo solicita, imprimilo en la térmica de 80 mm. El ticket no reemplaza una factura fiscal.</li>
                    <li>Registrá egresos, devoluciones o incidencias durante el día.</li>
                    <li>Revisá Stock y enviá pedidos sugeridos cuando haga falta.</li>
                    <li>Cerrá o cobrá todas las comandas antes del cierre.</li>
                    <li>Controlá medios de pago, efectivo, sobre y diferencias antes de confirmar.</li>
                    <li>Si trabajaste en Contingencia, sincronizá y comprobá los pendientes antes de cerrar caja.</li>
                  </ol>
                <p className="mt-5 rounded-lg bg-[#eef2f6] p-3 text-xs leading-5 text-slate-600">
                    Nunca compartas tu contraseña. Si ARCA no confirma una factura, no repitas la venta ni la emisión: guardá la referencia y avisá a Administración para conciliación. Si olvidaste tu contraseña, solicitá la recuperación desde la pantalla de ingreso.
                </p>
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
            <CustomerPanel site={site} customers={customers} sales={sales} returnsLog={returnsLog} canWrite={can("cobrar") || user.role === "administracion"} onSave={(record) => { const now = new Date().toISOString(); setCustomers(items => { const old = items.find(x => x.id === record.id); return old ? items.map(x => x.id === record.id ? { ...record, createdAt: old.createdAt, updatedAt: now, createdBy: old.createdBy, active: true } : x) : [{ ...record, createdAt: now, updatedAt: now, createdBy: user.name, active: true }, ...items]; }); recordAudit("Cliente actualizado", record.documentType + " " + record.documentNumber); }} onDeactivate={(id) => { setCustomers(items => items.map(item => item.id === id ? { ...item, active:false, updatedAt:new Date().toISOString() } : item)); recordAudit("Cliente desactivado", id); }} />
          ) : tab === "Recetas y costos" && user.role === "administracion" && can("mrp") ? (
            <MrpPanel initialView="Recetas y costos" />
          ) : tab === "Legajos" && user.role === "administracion" ? (
            <ComingSoonPanel section={tab as ComingSoonSection} />
          ) : tab === "MRP" && can("mrp") ? (
            <MrpPanel />
          ) : tab === "Compras de producción" && can("comprasProduccion") ? (
            <PurchaseCostsPanel />
          ) : tab === "Protección de datos" && user.role === "administracion" ? (
            <>
              <Heading
                k="ADMINISTRACIÓN · SEGURIDAD"
                h="Protección de datos y respaldos"
                p="Política de auditoría, retención y respaldo para proteger la operación de todos los locales."
              />
              <section className={`mb-5 max-w-5xl rounded-2xl border p-5 ${testOperatingDate.active ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="font-bold">Fecha operativa de prueba restringida</h2>
                    <p className="mt-1 text-sm text-slate-600">Únicamente Maure · 15/10/2026 · <b>PRUEBA DE VALIDACIÓN</b>. No modifica el reloj ni permite elegir otra fecha o local.</p>
                    {testOperatingDate.active && <p className="mt-2 text-sm font-semibold text-amber-900">Activa: las operaciones nuevas de Maure quedan auditadas con fecha operativa 15/10/2026. Deshabilitala al finalizar la validación.</p>}
                  </div>
                  <button type="button" disabled={testOperatingDateBusy} onClick={() => void (testOperatingDate.active ? disableValidationOperatingDate() : enableValidationOperatingDate())} className={`rounded px-4 py-2 font-bold text-white disabled:opacity-50 ${testOperatingDate.active ? "bg-[#8a4b08]" : "bg-[#183a67]"}`}>
                    {testOperatingDateBusy ? "Procesando…" : testOperatingDate.active ? "Deshabilitar modo de prueba" : "Habilitar validación Maure"}
                  </button>
                </div>
              </section>
              <div className="grid gap-5 lg:grid-cols-2">
                <div className="rounded-2xl border bg-white p-5">
                  <b>Auditoría inalterable</b>
                  <p className="mt-2 text-sm text-slate-600">
                    Las ventas, anulaciones, cambios de cobro, cierres, stock y permisos deberán registrarse con fecha, usuaria y local. En producción no podrán editarse ni eliminarse desde la interfaz.
                  </p>
                  <p className="mt-4 rounded bg-[#eef2f6] p-3 text-sm">
                    Eventos auditados en esta prueba: <b>{audit.length}</b>
                  </p>
                </div>
                <div className="rounded-2xl border bg-white p-5">
                  <b>Política de retención</b>
                  <label className="mt-4 block text-sm font-bold">
                    Conservar historial durante
                    <input
                      type="number"
                      min="1"
                      value={retentionYears}
                      onChange={(event) => setRetentionYears(Math.max(1, Number(event.target.value) || 1))}
                      className="mt-1 w-28 rounded border p-2 text-center font-normal"
                    /> años
                  </label>
                  <p className="mt-3 text-sm text-slate-600">Incluye ventas, cajas, stock, pedidos, egresos y auditoría.</p>
                </div>
                <div className="rounded-2xl border bg-white p-5">
                  <b>Respaldo automático</b>
                  <label className="mt-4 block text-sm font-bold">
                    Frecuencia
                    <select value={backupFrequency} onChange={(event) => setBackupFrequency(event.target.value)} className="mt-1 block w-full rounded border p-2 font-normal">
                      <option>Dos veces por semana · lunes y jueves 21:00</option>
                      <option>Semanal</option>
                      <option>Cada 15 días</option>
                      <option>Mensual</option>
                    </select>
                  </label>
                  <button
                    onClick={() => {
                      setBackupStatus(`Política ${backupFrequency.toLowerCase()} registrada. El estado real se confirma en el monitoreo.`);
                      recordAudit("Política de respaldo actualizada", `${backupFrequency} · retención ${retentionYears} años`);
                    }}
                    className="mt-4 rounded bg-[#183a67] px-4 py-2 font-bold text-white"
                  >
                    Guardar política
                  </button>
                  <button
                    disabled={backupRunning}
                    onClick={async () => {
                      setBackupRunning(true);
                      setBackupStatus("Generando una copia nueva y verificando su integridad…");
                      try {
                        const response = await fetch(`${API_BASE}/admin/backups/run`, { method: "POST", credentials: "include" });
                        const data = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
                        if (!response.ok || !data.ok) throw new Error(data.error || "No se pudo completar el respaldo.");
                        setBackupStatus("Copia nueva verificada y enviada al resguardo externo.");
                        recordAudit("Respaldo verificado manualmente", "Copia nueva generada antes de la puesta operativa.");
                        setHealthRefreshKey((value) => value + 1);
                      } catch (error) {
                        setBackupStatus(error instanceof Error ? error.message : "No se pudo completar el respaldo.");
                      } finally {
                        setBackupRunning(false);
                      }
                    }}
                    className="mt-4 ml-0 rounded border border-[#183a67] px-4 py-2 font-bold text-[#183a67] disabled:cursor-not-allowed disabled:opacity-60 sm:ml-2"
                  >
                    {backupRunning ? "Verificando copia…" : "Generar y verificar ahora"}
                  </button>
                  <p className="mt-3 text-sm text-slate-600">{backupStatus}</p>
                </div>
                <div className="rounded-2xl border bg-white p-5">
                  <b>Recuperación</b>
                  <p className="mt-2 text-sm text-slate-600">
                    La recuperación se realizará desde una copia verificada de la base de datos, respaldos en Drive y el correo designado. Se probará antes de habilitar el uso diario.
                  </p>
                  <p className="mt-4 rounded bg-[#fff5d8] p-3 text-sm">
                    Para recuperar, primero se identifica la última copia verificada y se prueba en un entorno separado. Las credenciales de respaldo no se muestran en esta pantalla.
                  </p>
                </div>
                <div className="rounded-2xl border bg-white p-5 lg:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <b>Monitoreo de errores y rendimiento</b>
                    <button onClick={() => setHealthRefreshKey((value) => value + 1)} className="rounded border px-3 py-1.5 text-sm font-bold">Revisar ahora</button>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">Verifica API, base de datos, espacio, sincronizaciones y actividad cada cinco minutos. No modifica ventas, cajas ni datos de Drive.</p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {[
                      ["API y base de datos", systemHealth.api === "Disponible" ? `Correcto · ${systemHealth.database || "Disponible"}` : systemHealth.api, systemHealth.api === "Disponible"],
                      ["Usuarios", systemHealth.activeUsers === undefined ? "Verificando" : `${systemHealth.activeUsers} activos de ${systemHealth.totalUsers}`, systemHealth.activeUsers !== undefined],
                      ["Espacio disponible", systemHealth.freeSpaceMb === undefined ? "Verificando" : systemHealth.freeSpaceMb === null ? "No informado por hosting" : `${systemHealth.freeSpaceMb.toLocaleString("es-AR")} MB libres`, systemHealth.freeSpaceMb !== undefined && systemHealth.freeSpaceMb !== null],
                      ["Respuesta de base", systemHealth.databaseLatencyMs === undefined ? "Verificando" : `${systemHealth.databaseLatencyMs} ms`, systemHealth.databaseLatencyMs !== undefined && systemHealth.databaseLatencyMs < 800],
                      ["Actividad operativa", systemHealth.events24h === undefined ? "Verificando" : `${systemHealth.events24h} eventos en 24 h`, systemHealth.events24h !== undefined],
                      ["Sincronizaciones", systemHealth.failedSyncs24h === undefined ? "Verificando" : systemHealth.failedSyncs24h === 0 ? "Sin errores en 24 h" : `${systemHealth.failedSyncs24h} con error en 24 h`, systemHealth.failedSyncs24h === 0],
                      ["Respaldo externo", systemHealth.lastBackup?.status === "verified" ? "Copia verificada" : "Sin copia verificada", systemHealth.lastBackup?.status === "verified"],
                      ["Google Drive", systemHealth.driveConnected === undefined ? "Verificando" : systemHealth.driveConnected ? "Conectado · solo lectura" : "Sin conectar", systemHealth.driveConnected === true],
                      ["Alertas por correo", systemHealth.notification?.status === "sent" ? "Última alerta enviada" : systemHealth.notification?.status === "failed" ? "El correo rechazó el envío" : systemHealth.notification?.status === "disabled" ? "Correo no configurado" : "Monitoreo activo", systemHealth.notification?.status !== "failed" && systemHealth.notification?.status !== "disabled"],
                      ["ARCA", "Producción preparada", false],
                    ].map(([label, status, ok]) => (
                      <div key={String(label)} className={`rounded border p-3 text-sm ${ok ? "border-emerald-200 bg-[#e7f4e8]" : "border-[#e7c26a] bg-[#fff5d8]"}`}>
                        <b>{label}</b><br /><span>{status}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 rounded border border-[#d9d4c9] bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <b>Validación ARCA</b>
                        <p className="mt-1 text-sm text-slate-600">Comprueba el certificado y la autenticación en producción. No emite facturas, CAE ni comprobantes reales.</p>
                      </div>
                      <button
                        onClick={testArcaHomologation}
                        disabled={arcaTesting}
                        className="rounded bg-[#183a67] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                      >
                        {arcaTesting ? "Validando…" : "Probar conexión"}
                      </button>
                    </div>
                    <p className="mt-3 text-sm text-slate-700">{arcaTestMessage}</p>
                  </div>
                  <div className="mt-4 rounded border border-[#d9d4c9] bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <b>Emisión fiscal ARCA</b>
                        <p className="mt-1 text-sm text-slate-600">Prepará la venta y confirmá en pantalla antes de solicitar el CAE. Si ARCA no confirma una respuesta, queda bloqueada para conciliación: nunca se reintenta en automático.</p>
                      </div>
                      <button onClick={() => void loadFiscalSales()} className="rounded border px-3 py-1.5 text-sm font-bold">Actualizar cola</button>
                    </div>
                    {fiscalMessage && <p className="mt-3 rounded bg-[#f8fafc] p-3 text-sm text-slate-700">{fiscalMessage}</p>}
                    <div className="mt-3 max-h-80 overflow-auto rounded border">
                      {fiscalSales.length === 0 ? <p className="p-3 text-sm text-slate-600">No hay ventas A/B pendientes en los últimos registros sincronizados.</p> : fiscalSales.map((sale) => (
                        <div key={sale.id} className="flex flex-wrap items-center justify-between gap-3 border-b p-3 last:border-b-0">
                          <div className="text-sm"><b>{sale.site} · {sale.invoice_type}</b><br /><span>{sale.customer_name || "Consumidor final"} · {money.format(sale.net_amount)} · {new Date(sale.occurred_at).toLocaleString("es-AR")}</span><br /><span className="text-xs text-slate-500">{sale.fiscal_status === "authorized" ? `Autorizada · CAE ${sale.cae || ""}` : sale.fiscal_status === "requires_reconciliation" ? "Requiere conciliación: no reintentar" : sale.fiscal_status === "issuing" ? "Emisión en curso" : "Pendiente de emisión"}</span></div>
                          <div className="flex flex-wrap gap-2">
                            {sale.fiscal_status !== "authorized" && sale.fiscal_status !== "issuing" && sale.fiscal_status !== "requires_reconciliation" && <button disabled={fiscalBusy === sale.id} onClick={() => void issueFiscalSale(sale)} className="rounded bg-[#183a67] px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{fiscalBusy === sale.id ? "Procesando…" : "Emitir con CAE"}</button>}
                            {sale.fiscal_status === "authorized" && <button disabled={fiscalBusy === sale.id} onClick={() => void prepareCreditNote(sale)} className="rounded border px-3 py-2 text-sm font-bold disabled:opacity-50">Nota de crédito</button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {systemHealth.alerts && systemHealth.alerts.length > 0 ? (
                    <div className="mt-4 space-y-2">
                      {systemHealth.alerts.map((alert) => (
                        <p key={alert.message} className={`rounded border p-3 text-sm ${alert.level === "critico" ? "border-red-300 bg-red-50 text-red-900" : "border-[#e7c26a] bg-[#fff5d8] text-[#714f00]"}`}>
                          <b>{alert.level === "critico" ? "Alerta crítica:" : "Atención:"}</b> {alert.message}
                        </p>
                      ))}
                    </div>
                  ) : systemHealth.api === "Disponible" ? (
                    <p className="mt-4 rounded border border-emerald-200 bg-[#e7f4e8] p-3 text-sm text-emerald-900"><b>Sin alertas activas.</b> Los controles técnicos no detectaron problemas críticos.</p>
                  ) : null}
                  {systemHealth.checkedAt && <p className="mt-3 text-xs text-slate-500">Última revisión: {systemHealth.checkedAt}.</p>}
                </div>
              </div>
            </>
          ) : tab === "Actualizaciones" && user.role === "administracion" ? (
            <>
              <Heading k="ADMINISTRACIÓN · OPERACIÓN" h="Actualizaciones seguras" p="Cada versión se valida y se respalda antes de reemplazar la anterior." />
              <div className="grid max-w-5xl gap-5 md:grid-cols-3">
                <div className="rounded-2xl border bg-white p-5"><b>1. Copia previa</b><p className="mt-2 text-sm text-slate-600">Antes de subir una versión se genera y verifica un respaldo de la base de datos y de los archivos publicados.</p></div>
                <div className="rounded-2xl border bg-white p-5"><b>2. Validación</b><p className="mt-2 text-sm text-slate-600">Se revisan salud del sistema, acceso, ventas, caja y sincronización antes de habilitar la nueva versión.</p></div>
                <div className="rounded-2xl border bg-white p-5"><b>3. Vuelta atrás</b><p className="mt-2 text-sm text-slate-600">Si una actualización falla, se restaura la versión anterior y el respaldo verificado. No se edita la producción directamente.</p></div>
              </div>
              <div className="mt-5 max-w-5xl rounded-2xl border border-[#e7c26a] bg-[#fff5d8] p-5 text-sm"><b>Estado operativo:</b> el procedimiento y los archivos de recuperación están preparados. La ejecución de una actualización queda limitada a Administración y debe realizarse fuera del horario de venta, luego de confirmar el respaldo.</div>
              <div className="mt-5 max-w-5xl rounded-2xl border border-[#d9d4c9] bg-white p-5">
                <b>Preparar próxima actualización</b>
                <p className="mt-2 text-sm text-slate-600">Genera un respaldo puntual de MySQL, lo verifica y lo envía a Drive antes de publicar. Si el respaldo falla, la publicación debe detenerse.</p>
                <p className="mt-3 text-sm font-semibold">El respaldo previo se verifica antes de cada publicación programada.</p>
                <p className="mt-2 text-xs text-slate-600">Luego de publicar, usá “Revisar ahora” en Protección de datos. La reversión de una versión se ejecuta únicamente desde el historial protegido de publicación; nunca desde las cuentas de los locales.</p>
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
          ) : tab === "Límites" && user.role === "administracion" ? (
            <>
              <Heading
                k="ADMINISTRACIÓN · CONTROLES"
                h="Límites operativos por local"
                p="Definí los topes que el sistema aplicará antes de permitir descuentos, egresos y cierres de caja."
              />
              <div className="overflow-auto rounded-2xl border bg-white">
                <table className="w-full min-w-[780px] text-sm">
                  <thead className="bg-[#eef2f6]">
                    <tr>
                      <th className="p-3 text-left">Local</th>
                      <th className="p-3 text-center">Descuento máximo</th>
                      <th className="p-3 text-center">Egreso máximo</th>
                      <th className="p-3 text-center">Diferencia máxima de caja</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SITES.map((local) => (
                      <tr key={local} className="border-t">
                        <td className="p-3 font-bold">{local}</td>
                        <td className="p-3 text-center">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={limitsBySite[local].maxDiscount}
                            onChange={(event) => setLimitsBySite((items) => ({
                              ...items,
                              [local]: { ...items[local], maxDiscount: Math.min(100, Math.max(0, Number(event.target.value) || 0)) },
                            }))}
                            className="w-24 rounded border p-2 text-center"
                          /> %
                        </td>
                        <td className="p-3 text-center">
                          <input
                            type="number"
                            min="0"
                            value={limitsBySite[local].maxExpense}
                            onChange={(event) => setLimitsBySite((items) => ({
                              ...items,
                              [local]: { ...items[local], maxExpense: Math.max(0, Number(event.target.value) || 0) },
                            }))}
                            className="w-32 rounded border p-2 text-center"
                          />
                        </td>
                        <td className="p-3 text-center">
                          <input
                            type="number"
                            min="0"
                            value={limitsBySite[local].maxCashDifference}
                            onChange={(event) => setLimitsBySite((items) => ({
                              ...items,
                              [local]: { ...items[local], maxCashDifference: Math.max(0, Number(event.target.value) || 0) },
                            }))}
                            className="w-32 rounded border p-2 text-center"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 rounded border border-[#e7c26a] bg-[#fff5d8] p-4 text-sm">
                Estos controles son exclusivos de Administración. Cada cambio deberá conservarse en la auditoría al conectar la base de datos.
              </p>
            </>
          ) : tab === "Catálogo y precios" && user.role === "administracion" ? (
            <>
              <Heading
                k="ADMINISTRACIÓN · CATÁLOGO CENTRAL"
                h="Catálogo y precios"
                p="Administrá productos, códigos de barras y precios para todos los locales."
              />
              <CatalogEditor catalog={catalog.document} ready={catalog.ready} busy={catalog.busy} onSave={async (next, revision) => {
                await catalog.save(next, priceChanges, revision);
                recordAudit("Catálogo actualizado", "Alta o edición de producto, presentación, categoría, precios y código de barras.");
              }} />
              <details className="rounded-2xl border bg-white p-4">
                <summary className="cursor-pointer text-lg font-bold">Aumentos masivos y versiones de precios</summary>
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
                    disabled={priceIncrease <= 0 || !catalog.ready || catalog.busy}
                    onClick={applyPriceIncrease}
                    className="rounded bg-[#183a67] px-5 py-2.5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Aplicar a todos
                  </button>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  El aumento se aplica al precio de mostrador al confirmar. La fecha queda como referencia en el historial; no programa un cambio futuro.
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
                    {products.filter(
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
                            {money.format(onlinePrices[product.id])}
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
                              disabled={!catalog.ready || catalog.busy}
                              onClick={async () => {
                                if (!window.confirm(`¿Restaurar la lista anterior al aumento del ${change.percentage}%?`)) return;
                                try {
                                  await catalog.save(products.map((p) => ({ ...p, price: change.beforePrices[p.id] ?? p.price })));
                                } catch (error) {
                                  setMessage(error instanceof Error ? error.message : "No se pudo restaurar la lista.");
                                  return;
                                }
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
                                {products.filter((product) => product.id in change.beforePrices).map((product) => (
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
                Los cambios se guardan en el catálogo central. Cada versión conserva la lista anterior.
                Las ventas ya registradas y las cantidades de stock no se modifican.
              </p>
              </details>
            </>
          ) : tab === "Usuarios" && user.role === "administracion" ? (
            <>
              <Heading
                k="ADMINISTRACIÓN · SEGURIDAD"
                h="Usuarios y permisos"
                p="Creá accesos, asigná cargos y locales, bloqueá usuarios y definí qué reportes puede consultar cada administrativo."
              />
              <p className="mb-5 rounded border border-[#e7c26a] bg-[#fff5d8] p-4 text-sm">
                Cada acceso es individual y se identifica con nombre de usuario y contraseña. Las claves se guardan cifradas en el servidor y las solicitudes de recuperación llegan directamente a esta sección.
              </p>
              <div className="rounded-2xl border bg-white p-5">
                <h2 className="font-bold">Crear nuevo usuario</h2>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[1.1fr_1fr_1fr_1fr_1.2fr_auto] xl:items-end">
                  <label className="text-sm font-bold">
                    Nombre
                    <input
                      value={newUserName}
                      onChange={(e) => { setNewUserName(e.target.value); setNewUserFieldErrors((errors) => ({ ...errors, fullName: "" })); }}
                      placeholder="Nombre y apellido"
                      className={`mt-1 block w-full rounded border p-2 font-normal ${newUserFieldErrors.fullName ? "border-red-500" : ""}`}
                    />
                    {newUserFieldErrors.fullName && <span className="mt-1 block text-xs font-normal text-red-700">{newUserFieldErrors.fullName}</span>}
                  </label>
                  <label className="text-sm font-bold">
                    Usuario
                    <input
                      value={newUserUsername}
                      onChange={(e) => { setNewUserUsername(e.target.value.toLowerCase().replace(/\s+/g, ".")); setNewUserFieldErrors((errors) => ({ ...errors, username: "" })); }}
                      placeholder="nombre.apellido"
                      className={`mt-1 block w-full rounded border p-2 font-normal ${newUserFieldErrors.username ? "border-red-500" : ""}`}
                    />
                    {newUserFieldErrors.username && <span className="mt-1 block text-xs font-normal text-red-700">{newUserFieldErrors.username}</span>}
                  </label>
                  <label className="text-sm font-bold">
                    Cargo
                    <select
                      value={newUserRole}
                      onChange={(e) => { setNewUserRole(e.target.value as Role); setNewUserFieldErrors((errors) => ({ ...errors, role: "" })); }}
                      className="mt-1 block w-full rounded border p-2 font-normal"
                    >
                      <option value="vendedora">Vendedora</option>
                      <option value="supervisora">Supervisora</option>
                      <option value="compras">Compras</option>
                      <option value="administracion">Administración</option>
                    </select>
                  </label>
                  <div className={`text-sm font-bold ${newUserFieldErrors.locations ? "text-red-700" : ""}`}>
                    Locales asignados
                    <label className="mt-2 flex items-center gap-2 font-normal">
                      <input
                        type="checkbox"
                        checked={newUserAllLocations}
                        onChange={(e) => { setNewUserAllLocations(e.target.checked); setNewUserFieldErrors((errors) => ({ ...errors, locations: "" })); }}
                      />
                      Todos los locales
                    </label>
                    {!newUserAllLocations && (
                      <div className="mt-2 grid grid-cols-2 gap-1 rounded border p-2 text-xs font-normal">
                        {SITES.map((local) => (
                          <label key={local} className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={newUserSites.includes(local)}
                              onChange={(e) => {
                                setNewUserFieldErrors((errors) => ({ ...errors, locations: "" }));
                                setNewUserSites((items) =>
                                  e.target.checked
                                    ? [...items, local]
                                    : items.filter((item) => item !== local),
                                );
                              }}
                            />
                            {local}
                          </label>
                        ))}
                      </div>
                    )}
                    {newUserFieldErrors.locations && <span className="mt-1 block text-xs font-normal text-red-700">{newUserFieldErrors.locations}</span>}
                  </div>
                  <label className="text-sm font-bold">
                    Contraseña temporal
                    <input
                      value={newUserPassword}
                      onChange={(e) => { setNewUserPassword(e.target.value); setNewUserFieldErrors((errors) => ({ ...errors, temporaryPassword: "" })); }}
                      type="password"
                      placeholder="Mínimo 8 caracteres"
                      className={`mt-1 block w-full rounded border p-2 font-normal ${newUserFieldErrors.temporaryPassword ? "border-red-500" : ""}`}
                    />
                    {newUserFieldErrors.temporaryPassword && <span className="mt-1 block text-xs font-normal text-red-700">{newUserFieldErrors.temporaryPassword}</span>}
                  </label>
                  <label className="flex items-center gap-2 text-sm font-bold xl:pb-3">
                    <input
                      type="checkbox"
                      checked={false}
                      disabled
                      onChange={() => undefined}
                    />
                    Doble factor (pendiente de implementación)
                  </label>
                  <button
                    onClick={createManagedUser}
                    className="rounded bg-[#183a67] px-5 py-2.5 font-bold text-white"
                  >
                    Crear usuario
                  </button>
                </div>
                {createdUserCredentials && (
                  <div className="mt-4 rounded-xl border-2 border-[#e7c26a] bg-[#fff5d8] p-4">
                    <p className="font-bold text-[#8a5b00]">Usuario creado: guardá estos datos antes de continuar</p>
                    <p className="mt-2 text-sm"><b>{createdUserCredentials.name}</b> · Usuario: <code>@{createdUserCredentials.username}</code></p>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <code className="rounded bg-white px-3 py-2 text-base font-bold text-[#183a67]">
                        {createdUserCredentials.password}
                      </code>
                      <button
                        onClick={() => {
                          navigator.clipboard
                            .writeText(createdUserCredentials.password)
                            .then(() => setMessage("Contraseña copiada al portapapeles."))
                            .catch(() => setMessage("Copiá la contraseña manualmente."));
                        }}
                        className="rounded bg-[#183a67] px-3 py-2 text-sm font-bold text-white"
                      >
                        Copiar contraseña
                      </button>
                      <button onClick={() => setCreatedUserCredentials(null)} className="text-sm font-bold underline">
                        Ocultar
                      </button>
                    </div>
                    <p className="mt-3 text-xs text-slate-600">La persona deberá cambiar esta clave en su primer ingreso.</p>
                  </div>
                )}
                {message && (
                  <p className="mt-3 rounded bg-[#eef5ef] p-3 text-sm">
                    {message}
                  </p>
                )}
              </div>
              <div className="mt-6 overflow-auto rounded-xl border bg-white">
                <div className="border-b p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <b>Usuarios registrados</b>
                      <p className="mt-1 text-sm text-slate-500">
                        La cuenta principal de Administración está protegida contra bloqueo accidental.
                      </p>
                    </div>
                    {resetRequests.some((request) => request.status === "Pendiente") && (
                      <span className="rounded bg-[#fff5d8] px-3 py-1 text-sm font-bold text-[#8a5b00]">
                        {resetRequests.filter((request) => request.status === "Pendiente").length} recuperaciones pendientes
                      </span>
                    )}
                  </div>
                  {generatedTemporaryPassword && (
                    <div id="temporary-password-result" className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border-2 border-[#e7c26a] bg-[#fff5d8] p-4">
                      <span className="text-sm font-bold text-[#8a5b00]">
                        Clave temporal para @{generatedTemporaryPassword.username}:
                      </span>
                      <code className="rounded bg-white px-3 py-2 text-base font-bold text-[#183a67]">
                        {generatedTemporaryPassword.password}
                      </code>
                      <button
                        onClick={() => {
                          navigator.clipboard
                            .writeText(generatedTemporaryPassword.password)
                            .then(() => setMessage("Contraseña copiada al portapapeles."))
                            .catch(() => setMessage("Copiá la contraseña manualmente."));
                        }}
                        className="rounded bg-[#183a67] px-3 py-2 text-sm font-bold text-white"
                      >
                        Copiar
                      </button>
                      <button onClick={() => setGeneratedTemporaryPassword(null)} className="text-sm font-bold underline">
                        Ocultar
                      </button>
                    </div>
                  )}
                </div>
                <table className="w-full min-w-[850px] text-sm">
                  <thead className="bg-[#eef2f6]">
                    <tr>
                      <th className="p-3 text-left">Usuario</th>
                      <th className="p-3 text-left">Recuperación</th>
                      <th className="p-3 text-left">Cargo</th>
                      <th className="p-3 text-left">Local asignado</th>
                      <th className="p-3 text-center">Doble factor</th>
                      <th className="p-3 text-center">Estado</th>
                      <th className="p-3 text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {managedUsers.map((profile) => (
                      <tr key={profile.id} className="border-t">
                        <td className="p-3">
                          <b>{profile.name}</b>
                          <span className="mt-1 block text-xs text-slate-500">
                            {profile.username.includes("@")
                              ? profile.username
                              : `@${profile.username}`}
                          </span>
                          {profile.primary && (
                            <span className="ml-2 rounded bg-[#eef2f6] px-2 py-1 text-xs">
                              Cuenta principal
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          {pendingResetFor(profile) ? (
                            <span className="inline-flex rounded bg-[#fff5d8] px-2 py-1 text-xs font-bold text-[#8a5b00]">
                              Pendiente · {pendingResetFor(profile)?.requestedAt}
                            </span>
                          ) : (
                            <span className="text-slate-500">Sin solicitud pendiente</span>
                          )}
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
                                  profile.location || "Recoleta",
                                locations:
                                  profile.locations?.length
                                    ? profile.locations
                                    : [profile.location || "Recoleta"],
                                reportPermissions:
                                  role === "administracion"
                                    ? profile.reportPermissions.length
                                      ? profile.reportPermissions
                                      : ["Resumen"]
                                    : [],
                                actionPermissions:
                                  defaultActionPermissions(role),
                                mfaRequired: false,
                              });
                            }}
                            className="rounded border p-2 disabled:bg-slate-100"
                          >
                            <option value="vendedora">Vendedora</option>
                            <option value="supervisora">Supervisora</option>
                            <option value="compras">Compras</option>
                            <option value="administracion">
                              Administración
                            </option>
                          </select>
                        </td>
                        <td className="p-3">
                          <label className="mb-2 flex items-center gap-2 text-xs font-bold">
                            <input
                              type="checkbox"
                              checked={profile.accessAllLocations}
                              onChange={(e) =>
                                updateManagedUser(profile.id, {
                                  accessAllLocations: e.target.checked,
                                  locations: e.target.checked ? SITES : profile.locations?.length ? profile.locations : [profile.location || "Recoleta"],
                                })
                              }
                            />
                            Todos
                          </label>
                          {profile.accessAllLocations ? (
                            <span className="font-bold text-[#183a67]">Todos los locales</span>
                          ) : (
                            <select
                              multiple
                              value={profile.locations?.length ? profile.locations : [profile.location || "Recoleta"]}
                              onChange={(e) => {
                                const locations = Array.from(e.target.selectedOptions, (option) => option.value);
                                if (locations.length) updateManagedUser(profile.id, { locations, location: locations[0], accessAllLocations: false });
                              }}
                              className="min-w-36 rounded border p-2 text-sm"
                              title="Mantené presionada Ctrl (o Cmd) para seleccionar varios locales."
                            >
                              {SITES.map((local) => <option key={local}>{local}</option>)}
                            </select>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={false}
                              disabled
                              onChange={() => undefined}
                            />
                            Pendiente
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
                          <div className="flex flex-col items-stretch gap-2">
                            <button
                              disabled={
                                profile.primary || resettingUserId === profile.id
                              }
                              onClick={() => {
                                const request = pendingResetFor(profile);
                                if (request) resetPassword(request);
                                else resetManagedUserPassword(profile);
                              }}
                              className="rounded bg-[#183a67] px-3 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                              title={
                                profile.primary
                                  ? "La cuenta principal se recupera desde el acceso administrativo."
                                  : "Genera una clave temporal y cierra las sesiones anteriores."
                              }
                            >
                              {resettingUserId === profile.id
                                ? "Restableciendo…"
                                : pendingResetFor(profile)
                                  ? "Atender recuperación"
                                  : "Restablecer contraseña"}
                            </button>
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
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-6 space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="font-bold">
                      Permisos de reportes administrativos
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Cada administrativo verá únicamente los reportes marcados en
                      su perfil.
                    </p>
                  </div>
                  <label className="text-sm font-bold">
                    Buscar administrativo
                    <input
                      value={actionPermissionSearch}
                      onChange={(event) => setActionPermissionSearch(event.target.value)}
                      placeholder="Nombre o usuario"
                      className="mt-1 block w-64 rounded border p-2 font-normal"
                    />
                  </label>
                </div>
                {managedUsers
                  .filter((profile) => {
                    const search = actionPermissionSearch.trim().toLocaleLowerCase("es");
                    return profile.role === "administracion" && (!search || `${profile.name} ${profile.username}`.toLocaleLowerCase("es").includes(search));
                  })
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
                {!managedUsers.some((profile) => {
                  const search = actionPermissionSearch.trim().toLocaleLowerCase("es");
                  return profile.role === "administracion" && (!search || `${profile.name} ${profile.username}`.toLocaleLowerCase("es").includes(search));
                }) && <p className="rounded border bg-white p-4 text-sm text-slate-500">No encontramos un administrativo con esa búsqueda.</p>}
              </div>
              <div className="mt-6 space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="font-bold">Permisos de acciones</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Definí qué puede realizar cada perfil, además de los
                      reportes que puede consultar.
                    </p>
                  </div>
                  <label className="text-sm font-bold">
                    Buscar usuario
                    <input
                      value={actionPermissionSearch}
                      onChange={(event) => setActionPermissionSearch(event.target.value)}
                      placeholder="Nombre o usuario"
                      className="mt-1 block w-64 rounded border p-2 font-normal"
                    />
                  </label>
                </div>
                {managedUsers.filter((profile) => {
                  const search = actionPermissionSearch.trim().toLocaleLowerCase("es");
                  return !search || `${profile.name} ${profile.username}`.toLocaleLowerCase("es").includes(search);
                }).map((profile) => {
                  const visiblePermissions =
                    actionPermissionDrafts[profile.id] ?? profile.actionPermissions;
                  const hasPendingChanges = actionPermissionDrafts[profile.id] !== undefined;
                  return (
                    <div key={profile.id} className="rounded-xl border bg-white p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <b>{profile.name}</b>
                          <span className="ml-3 text-xs text-slate-500">
                            {visiblePermissions.length} acciones habilitadas
                          </span>
                        </div>
                        {hasPendingChanges && (
                          <span className="rounded bg-[#fff5d8] px-2 py-1 text-xs font-bold text-[#8a5b00]">
                            Cambios sin guardar
                          </span>
                        )}
                      </div>
                      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {ACTION_PERMISSIONS.map((permission) => (
                          <label
                            key={permission.id}
                            className="flex items-center gap-2 rounded bg-[#eef2f6] p-3 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={visiblePermissions.includes(permission.id)}
                              disabled={profile.primary || savingPermissionsFor === profile.id}
                              onChange={() =>
                                setActionPermissionDrafts((drafts) => ({
                                  ...drafts,
                                  [profile.id]: visiblePermissions.includes(permission.id)
                                    ? visiblePermissions.filter((id) => id !== permission.id)
                                    : [...visiblePermissions, permission.id],
                                }))
                              }
                            />
                            {permission.label}
                          </label>
                        ))}
                      </div>
                      {!profile.primary && (
                        <div className="mt-4 flex flex-wrap justify-end gap-2 border-t pt-4">
                          <button
                            disabled={!hasPendingChanges || savingPermissionsFor === profile.id}
                            onClick={() =>
                              setActionPermissionDrafts((drafts) => {
                                const next = { ...drafts };
                                delete next[profile.id];
                                return next;
                              })
                            }
                            className="rounded border px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Descartar
                          </button>
                          <button
                            disabled={!hasPendingChanges || savingPermissionsFor === profile.id}
                            onClick={() => saveActionPermissions(profile)}
                            className="rounded bg-[#183a67] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {savingPermissionsFor === profile.id ? "Guardando…" : "Guardar cambios"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {!managedUsers.filter((profile) => {
                  const search = actionPermissionSearch.trim().toLocaleLowerCase("es");
                  return !search || `${profile.name} ${profile.username}`.toLocaleLowerCase("es").includes(search);
                }).length && <p className="rounded border bg-white p-4 text-sm text-slate-500">No encontramos un usuario con esa búsqueda.</p>}
              </div>
            </>
          ) : tab === "Horarios" && canManageSchedules ? (
            <>
              <Heading
                k="SUPERVISIÓN · CONFIGURACIÓN DE PERSONAL"
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
              <ReportNavigation reports={availableAdminReports} selectedReport={adminReport} onSelect={setAdminReport} />
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
                  Fuente operativa: ventas, cobros, cajas y movimientos guardados por los locales en la base del sistema.
                  {persistedReportSales === null ? " Mostrando la copia disponible mientras se consulta el servidor." : " Historial verificado."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={exportAdminReport}
                    disabled={!can("exportar")}
                    className="rounded border px-3 py-2 text-sm font-bold disabled:opacity-40"
                  >
                    Exportar informe CSV
                  </button>
                  <button
                    onClick={() => window.print()}
                    disabled={!can("exportar")}
                    className="rounded border px-3 py-2 text-sm font-bold disabled:opacity-40"
                  >
                    Imprimir / Guardar PDF
                  </button>
                </div>
                <details className="mt-4 rounded border bg-[#fbfaf7] p-4">
                  <summary className="cursor-pointer font-bold">Importar historial anterior</summary>
                  <p className="mt-2 text-sm text-slate-600">Usá la plantilla para incorporar ventas o cierres anteriores. La importación no modifica operaciones existentes con el mismo identificador y deja registro en Auditoría.</p>
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="text-sm font-bold">Tipo de historial
                      <select value={historyImportKind} onChange={(event) => setHistoryImportKind(event.target.value as "sales" | "cash")} className="mt-1 block rounded border bg-white p-2 font-normal"><option value="sales">Ventas</option><option value="cash">Cierres de caja</option></select>
                    </label>
                    <button onClick={() => downloadCsv(`Plantilla_historial_${historyImportKind}.csv`, historyImportKind === "sales" ? SALES_HISTORY_TEMPLATE : CASH_HISTORY_TEMPLATE)} className="rounded border px-3 py-2 text-sm font-bold">Descargar plantilla</button>
                    <label className="rounded bg-[#183a67] px-3 py-2 text-sm font-bold text-white">{historyImporting ? "Importando…" : "Elegir CSV e importar"}
                      <input type="file" accept=".csv,text/csv" disabled={historyImporting} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importHistoricalFile(file); event.target.value = ""; }} />
                    </label>
                  </div>
                </details>
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
                        {operationalAlerts.length ? operationalAlerts.slice(0, 5).map((alert, index) => (
                          <p key={`${alert.label}-${index}`} className={`rounded p-3 ${alert.tone}`}>
                            <b>{alert.label}</b><br />{alert.detail}
                          </p>
                        )) : (
                          <p className="rounded bg-[#eef5ef] p-3">Sin alertas operativas activas.</p>
                        )}
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
                          <p className="text-sm">Proyección del mes</p>
                          <b className="mt-2 block text-2xl">
                            {projectedNet === null ? "No aplica al rango" : money.format(projectedNet)}
                          </b>
                        </div>
                        <div className="rounded bg-[#eef2f6] p-4">
                          <p className="text-sm">Avance de metas</p>
                          <b className="mt-2 block text-2xl">
                            {targetProgress === null ? "Sin meta" : `${targetProgress}%`}
                          </b>
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
                                <th className="p-3 text-right">Ticket promedio</th>
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
                                    {money.format(row.tickets ? Math.round(row.net / row.tickets) : 0)}
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
                  {adminReport === "PLConsolidado" && (
                    <div className="mt-5">
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[#eef2f6] p-4 text-sm">
                        <div>
                          <b>{pnlConnection.connected ? "Fuente conectada:" : "Fuente pendiente:"}</b>{" "}
                          P&amp;L Consolidado 2026 de Drive. {pnlConnection.updatedAt ? `Última lectura: ${new Date(pnlConnection.updatedAt.replace(" ", "T")).toLocaleString("es-AR")}.` : "Aún no se realizó una lectura automática."}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {pnlConnection.connected ? (
                            <button onClick={syncPnlFromGoogle} disabled={pnlSyncing} className="rounded bg-[#183a67] px-3 py-2 font-bold text-white disabled:opacity-60">
                              {pnlSyncing ? "Actualizando…" : "Actualizar desde Drive"}
                            </button>
                          ) : (
                            <button onClick={connectPnlGoogle} className="rounded bg-[#183a67] px-3 py-2 font-bold text-white">Conectar lectura de Drive</button>
                          )}
                        </div>
                      </div>
                      {pnlSyncMessage && <p className={`mt-3 rounded p-3 text-sm ${pnlSyncMessage.startsWith("P&L actualizado") ? "bg-[#eef5ef] text-green-800" : "bg-[#fff1ec] text-red-800"}`}>{pnlSyncMessage}</p>}
                      <div className="mt-4 rounded border border-[#b9d8c0] bg-[#eef5ef] p-4">
                        <b>Datos financieros protegidos</b>
                        <p className="mt-1 text-sm text-slate-600">
                          {pnlConnection.connected
                            ? `Última copia autenticada: ${pnlConnection.rows.length} filas. Consultá el detalle recibido desde Drive más abajo.`
                            : "Conectá Drive para consultar el P&L. Ningún importe queda incluido en la página pública."}
                        </p>
                      </div>
                      {pnlConnection.rows.length > 0 ? (
                        <div className="mt-5 rounded border bg-white p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div><b>P&amp;L operativo recibido desde Drive</b><p className="mt-1 text-sm text-slate-600">Esta es la fuente autenticada vigente. La planilla original no se modifica.</p></div>
                            <span className="rounded bg-[#eef2f6] px-3 py-2 text-sm font-bold">{pnlConnection.rows.length} filas</span>
                          </div>
                          <div className="mt-4 max-h-[520px] overflow-auto rounded border">
                            <table className="w-full min-w-[1200px] text-xs">
                              <tbody>{pnlConnection.rows.map((row, rowIndex) => <tr key={`pnl-live-${rowIndex}`} className="border-t odd:bg-[#fbfaf7]">{Array.from({ length: Math.max(1, ...pnlConnection.rows.map((item) => item.length)) }).map((_, columnIndex) => <td key={`${rowIndex}-${columnIndex}`} className={`whitespace-nowrap p-2 ${columnIndex === 0 ? "sticky left-0 bg-inherit font-bold" : "text-right"}`}>{row[columnIndex] || ""}</td>)}</tr>)}</tbody>
                            </table>
                          </div>
                        </div>
                      ) : <p className="mt-5 rounded bg-[#fff5d8] p-4 text-sm">Conectá la lectura de Drive para mostrar información operativa. Ya no se presentan importes históricos precargados.</p>}
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
                        Resultado calculado con ventas activas guardadas entre {reportFrom} y {reportTo}. La comparación contra el período anterior está disponible en Evolución.
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
                          {reportSales.length ? (
                            reportSales.map((sale) => (
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
                                No hay ventas activas guardadas para el período y local seleccionados.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {adminReport === "Rentabilidad" && (
                    <div className="mt-5 space-y-4">
                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="rounded bg-[#eef2f6] p-4"><b>Venta neta</b><p className="mt-2 text-2xl font-bold">{money.format(adminTotals.net)}</p><p className="text-sm">Ventas activas del período.</p></div>
                        <div className="rounded bg-[#eef2f6] p-4"><b>Descuentos</b><p className="mt-2 text-2xl font-bold">{money.format(adminTotals.gross - adminTotals.net)}</p><p className="text-sm">Distribuidos proporcionalmente por producto.</p></div>
                        <div className="rounded bg-[#fff5d8] p-4"><b>Margen no calculable</b><p className="mt-2 text-sm">No hay costos unitarios vigentes cargados. Este informe no inventa márgenes.</p></div>
                      </div>
                      <div className="overflow-auto rounded border">
                        <table className="w-full min-w-[780px] text-sm"><thead className="bg-[#183a67] text-white"><tr><th className="p-3 text-left">Producto</th><th className="p-3 text-left">Categoría</th><th className="p-3 text-right">Unidades</th><th className="p-3 text-right">Bruto</th><th className="p-3 text-right">Descuento</th><th className="p-3 text-right">Neto</th><th className="p-3 text-left">Margen</th></tr></thead>
                          <tbody>{profitabilityRows.length ? profitabilityRows.map((row) => <tr key={row.id} className="border-t"><td className="p-3 font-bold">{row.name}</td><td className="p-3">{row.category}</td><td className="p-3 text-right">{row.units}</td><td className="p-3 text-right">{money.format(row.gross)}</td><td className="p-3 text-right">{money.format(row.discount)}</td><td className="p-3 text-right font-bold">{money.format(row.net)}</td><td className="p-3 text-amber-700">Sin costo cargado</td></tr>) : <tr><td colSpan={7} className="p-4 text-slate-500">No hay ventas activas en el período seleccionado.</td></tr>}</tbody>
                        </table>
                        <p className="border-t p-3 text-xs text-slate-500">La venta neta por producto asigna el descuento de cada operación en proporción a su precio. Para calcular margen, primero deben cargarse costos unitarios vigentes.</p>
                      </div>
                      <div className="overflow-auto rounded border">
                        <table className="w-full min-w-[620px] text-sm"><thead className="bg-[#eef2f6]"><tr><th className="p-3 text-left">Categoría</th><th className="p-3 text-right">Unidades</th><th className="p-3 text-right">Venta bruta</th><th className="p-3 text-right">Descuento</th><th className="p-3 text-right">Venta neta</th></tr></thead><tbody>{profitabilityByCategory.map((row) => <tr key={row.category} className="border-t"><td className="p-3 font-bold">{row.category}</td><td className="p-3 text-right">{row.units}</td><td className="p-3 text-right">{money.format(row.gross)}</td><td className="p-3 text-right">{money.format(row.discount)}</td><td className="p-3 text-right font-bold">{money.format(row.net)}</td></tr>)}</tbody></table>
                      </div>
                    </div>
                  )}
                  {adminReport === "Productos" && (
                    <div className="mt-5 overflow-auto rounded border">
                      <table className="w-full min-w-[680px] text-sm">
                        <thead className="bg-[#eef2f6]"><tr><th className="p-3 text-left">Producto</th><th className="p-3 text-left">Categoría</th><th className="p-3 text-right">Unidades</th><th className="p-3 text-right">Venta bruta</th></tr></thead>
                        <tbody>
                          {productPerformance.length ? productPerformance.map((row) => (
                            <tr key={row.id} className="border-t"><td className="p-3 font-bold">{row.name}</td><td className="p-3">{row.category}</td><td className="p-3 text-right">{row.units}</td><td className="p-3 text-right">{money.format(row.gross)}</td></tr>
                          )) : <tr><td colSpan={4} className="p-4 text-slate-500">No hay productos vendidos en el rango seleccionado.</td></tr>}
                        </tbody>
                      </table>
                      <p className="border-t p-3 text-xs text-slate-500">Ranking calculado con las líneas de las ventas activas guardadas. La venta bruta no descuenta promociones.</p>
                    </div>
                  )}
                  {adminReport === "Evolucion" && (
                    <div className="mt-5 overflow-auto rounded-xl border">
                      <div className="border-b bg-[#eef2f6] p-4">
                        <b>Comparación contra el período inmediatamente anterior</b>
                        <p className="mt-1 text-xs text-slate-600">Actual: {reportFrom} a {reportTo} · Anterior: {previousFrom} a {previousTo} · Ambos contienen {reportDays} días.</p>
                      </div>
                      <table className="w-full min-w-[760px] text-sm">
                        <thead className="bg-[#183a67] text-white"><tr><th className="p-3 text-left">Local</th><th className="p-3 text-right">Período actual</th><th className="p-3 text-right">Período anterior</th><th className="p-3 text-right">Variación</th></tr></thead>
                        <tbody>{evolutionRows.map((row) => (
                          <tr key={row.site} className="border-t"><td className="p-3 font-bold">{row.site}</td><td className="p-3 text-right">{money.format(row.current)}</td><td className="p-3 text-right">{money.format(row.previous)}</td><td className={`p-3 text-right font-bold ${row.change === null ? "text-slate-500" : row.change >= 0 ? "text-green-700" : "text-red-700"}`}>{row.change === null ? "Sin base comparable" : `${row.change > 0 ? "+" : ""}${row.change.toFixed(1)}%`}</td></tr>
                        ))}</tbody>
                      </table>
                      {projectedNet !== null && <p className="border-t bg-[#eef5ef] p-3 text-sm"><b>Proyección operativa del mes:</b> {money.format(projectedNet)}, calculada con el promedio diario acumulado hasta hoy.</p>}
                    </div>
                  )}
                  {adminReport === "VendidoCobrado" && (
                    <div className="mt-5 overflow-auto rounded-xl border">
                      <div className="border-b bg-[#eef2f6] p-4">
                        <b>Conciliación de operaciones por local</b>
                        <p className="mt-1 text-xs text-slate-600">
                          Compara ventas activas y pagos asociados entre {reportFrom} y {reportTo}. No equivale a una acreditación bancaria.
                        </p>
                      </div>
                      <table className="w-full min-w-[760px] text-sm">
                        <thead className="bg-[#183a67] text-white">
                          <tr>
                            <th className="p-3 text-left">Local</th>
                            <th className="p-3 text-right">Vendido</th>
                            <th className="p-3 text-right">Cobrado registrado</th>
                            <th className="p-3 text-right">Diferencia</th>
                            <th className="p-3 text-center">Control</th>
                          </tr>
                        </thead>
                        <tbody>
                          {soldCollectedRows.map((row) => (
                            <tr key={row.site} className="border-t"><td className="p-3 font-bold">{row.site}</td><td className="p-3 text-right">{money.format(row.sold)}</td><td className="p-3 text-right">{money.format(row.collected)}</td><td className={`p-3 text-right font-bold ${Math.abs(row.difference) < 1 ? "text-green-700" : "text-red-700"}`}>{money.format(row.difference)}</td><td className="p-3 text-center">{Math.abs(row.difference) < 1 ? "Conciliado" : "Revisar"}</td></tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="border-t p-3 text-xs text-slate-500">
                        Fuente: operaciones y pagos persistidos en la base. Una diferencia indica un pago faltante, duplicado o sin asociación y requiere revisión.
                      </p>
                    </div>
                  )}
                  {adminReport === "Pagos" && (
                    <div className="mt-5 overflow-auto">
                      <table className="w-full min-w-[580px] text-sm">
                        <thead className="bg-[#eef2f6]">
                          <tr>
                            <th className="p-3 text-left">Medio</th>
                            <th className="p-3 text-right">Importe del período</th>
                            <th className="p-3 text-left">Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paymentReportRows.length ? paymentReportRows.map(({ method, amount }) => (
                            <tr key={method} className="border-t">
                              <td className="p-3">{method}</td>
                              <td className="p-3 text-right font-bold">
                                {money.format(amount)}
                              </td>
                              <td className="p-3 text-green-700">
                                Datos operativos
                              </td>
                            </tr>
                          )) : <tr><td colSpan={3} className="p-4 text-slate-500">No hay pagos asociados a ventas activas en el rango seleccionado.</td></tr>}
                        </tbody>
                      </table>
                      <p className="mt-3 text-xs text-slate-500">
                        Importes asociados a ventas activas guardadas entre {reportFrom} y {reportTo}, para {reportSite.toLowerCase()}.
                      </p>
                    </div>
                  )}
                  {adminReport === "Cajas" && (
                    <div className="mt-5 space-y-4">
                    <div className="overflow-auto rounded border">
                      <table className="w-full min-w-[900px] text-sm">
                        <thead className="bg-[#eef2f6]"><tr><th className="p-3 text-left">Local</th><th className="p-3 text-center">Estado actual</th><th className="p-3 text-left">Abierta por</th><th className="p-3 text-left">Apertura</th><th className="p-3 text-left">Último cierre</th><th className="p-3 text-left">Cerrada por</th></tr></thead>
                        <tbody>{cashReportRows.map((row) => (
                          <tr key={row.site} className="border-t"><td className="p-3 font-bold">{row.site}</td><td className={`p-3 text-center font-bold ${row.status === "Abierta" ? "text-amber-700" : "text-green-700"}`}>{row.status}</td><td className="p-3">{row.openedBy}</td><td className="p-3">{row.openedAt}</td><td className="p-3">{row.lastClosedAt}</td><td className="p-3">{row.lastClosedBy}</td></tr>
                        ))}</tbody>
                      </table>
                      <p className="border-t p-3 text-xs text-slate-500">Estado leído de las cajas y turnos guardados. Una caja abierta requiere revisión al finalizar la jornada; no se presume pendiente por una lista fija.</p>
                    </div>
                    <div className="overflow-auto rounded border">
                      <div className="border-b p-4"><b>Historial de aperturas y cierres</b><p className="mt-1 text-sm text-slate-600">Respeta el período y el local seleccionados. Incluye arqueo y diferencia cuando el cierre fue registrado con la versión actual.</p></div>
                      <table className="w-full min-w-[1100px] text-sm"><thead className="bg-[#183a67] text-white"><tr><th className="p-3 text-left">Local</th><th className="p-3 text-left">Apertura</th><th className="p-3 text-left">Abrió</th><th className="p-3 text-right">Fondo</th><th className="p-3 text-left">Cierre</th><th className="p-3 text-left">Cerró</th><th className="p-3 text-right">Esperado</th><th className="p-3 text-right">Contado</th><th className="p-3 text-right">Diferencia</th><th className="p-3 text-right">Sobre</th></tr></thead>
                        <tbody>{cashHistory.length ? cashHistory.map((row) => <tr key={row.id} className="border-t"><td className="p-3 font-bold">{row.site}</td><td className="p-3">{row.openedAt}</td><td className="p-3">{row.openedBy}</td><td className="p-3 text-right">{money.format(row.initialFund)}</td><td className="p-3">{row.closedAt || "Abierta"}</td><td className="p-3">{row.closedBy || "—"}</td><td className="p-3 text-right">{row.expectedCash == null ? "—" : money.format(row.expectedCash)}</td><td className="p-3 text-right">{row.countedCash == null ? "—" : money.format(row.countedCash)}</td><td className={`p-3 text-right font-bold ${(row.differenceAmount || 0) === 0 ? "text-green-700" : "text-amber-700"}`}>{row.differenceAmount == null ? "—" : money.format(row.differenceAmount)}</td><td className="p-3 text-right">{row.envelopeAmount == null ? "—" : money.format(row.envelopeAmount)}</td></tr>) : <tr><td colSpan={10} className="p-4 text-slate-500">No hay cierres registrados en el rango.</td></tr>}</tbody></table>
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
                      <div className="rounded-lg border border-[#b9d8c0] bg-[#eef5ef] p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <b>Gastos y cuentas por pagar de Drive</b>
                            <p className="mt-1 text-sm text-slate-600">
                              Consulta de solo lectura desde GASTOS OPERATIVOS. Se actualiza al abrir si la última copia tiene más de 15 minutos; la hoja nunca se modifica desde este sistema.
                            </p>
                          </div>
                          <button onClick={syncExpensesFromGoogle} disabled={!expenseSync.connected || expenseSyncing} className="rounded bg-[#183a67] px-3 py-2 text-sm font-bold text-white disabled:opacity-60">
                            {expenseSyncing ? "Actualizando…" : "Actualizar ahora"}
                          </button>
                        </div>
                        {expenseSyncMessage && <p className={`mt-3 rounded p-3 text-sm ${expenseSyncMessage.startsWith("Gastos actualizados") ? "bg-white text-green-800" : "bg-[#fff1ec] text-red-800"}`}>{expenseSyncMessage}</p>}
                        {!expenseSync.connected && <p className="mt-3 rounded bg-[#fff5d8] p-3 text-sm">Primero conectá la lectura de Google desde P&amp;L consolidado. Es la misma autorización de solo lectura.</p>}
                      </div>
                      {expenseSync.data && (
                        <>
                          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded bg-[#183a67] p-4 text-white"><p className="text-sm">Cuentas por pagar</p><b className="mt-2 block text-2xl">{money.format(expenseSync.data.summary.totalPayable)}</b><p className="mt-1 text-xs">Saldo pendiente informado</p></div>
                            <div className="rounded bg-[#fff1ec] p-4"><p className="text-sm">Documentos pendientes</p><b className="mt-2 block text-2xl">{expenseSync.data.summary.openCount}</b><p className="mt-1 text-xs">Con importe a pagar mayor a cero</p></div>
                            <div className="rounded bg-[#eef2f6] p-4"><p className="text-sm">Gasto histórico importado</p><b className="mt-2 block text-2xl">{money.format(expenseSync.data.summary.totalExpenses)}</b><p className="mt-1 text-xs">No equivale a resultado mensual</p></div>
                            <div className="rounded bg-[#eef5ef] p-4"><p className="text-sm">Última lectura</p><b className="mt-2 block text-sm">{expenseSync.updatedAt ? new Date(expenseSync.updatedAt.replace(" ", "T")).toLocaleString("es-AR") : "Sin lectura"}</b><p className="mt-1 text-xs">{expenseSync.data.sourceRows} registros válidos</p></div>
                          </div>
                          <div className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
                            <div className="overflow-auto rounded border">
                              <div className="border-b bg-[#eef2f6] p-4"><b>Cuentas pendientes por proveedor</b><p className="mt-1 text-sm text-slate-600">Se muestran los mayores saldos pendientes informados en la hoja.</p></div>
                              <table className="w-full min-w-[720px] text-sm"><thead className="bg-[#183a67] text-white"><tr><th className="p-3 text-left">Fecha</th><th className="p-3 text-left">Proveedor</th><th className="p-3 text-left">Concepto</th><th className="p-3 text-right">Total</th><th className="p-3 text-right">A pagar</th><th className="p-3 text-left">Estado</th></tr></thead><tbody>{expenseSync.data.summary.openItems.length ? expenseSync.data.summary.openItems.map((item, index) => <tr key={`${item.supplier}-${item.document}-${index}`} className="border-t"><td className="p-3">{item.date || "—"}</td><td className="p-3 font-bold">{item.supplier}</td><td className="p-3">{item.category}</td><td className="p-3 text-right">{money.format(item.total)}</td><td className="p-3 text-right font-bold text-[#9c302a]">{money.format(item.amountDue)}</td><td className="p-3">{item.status || "Pendiente"}</td></tr>) : <tr><td colSpan={6} className="p-4 text-slate-500">No hay cuentas con saldo pendiente en la última lectura.</td></tr>}</tbody></table>
                            </div>
                            <div className="rounded border p-4"><b>Mayor saldo por proveedor</b><div className="mt-3 space-y-2 text-sm">{expenseSync.data.summary.bySupplier.filter((item) => item.outstanding > 0).slice(0, 8).map((item) => <div key={item.label} className="rounded bg-[#eef2f6] p-3"><div className="flex justify-between gap-3"><b>{item.label}</b><b className="text-[#9c302a]">{money.format(item.outstanding)}</b></div><p className="mt-1 text-xs text-slate-600">{item.count} comprobantes · Total histórico {money.format(item.total)}</p></div>)}{!expenseSync.data.summary.bySupplier.some((item) => item.outstanding > 0) && <p className="rounded bg-[#eef5ef] p-3 text-sm">Sin proveedores con saldo pendiente.</p>}</div></div>
                          </div>
                        </>
                      )}
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
                    <div className="mt-5 space-y-4">
                      <div className="grid gap-4 md:grid-cols-4">
                        <div className="rounded bg-[#eef2f6] p-4"><b>Stock actual</b><p className="mt-2 text-2xl font-bold">{stockReportRows.reduce((total, row) => total + row.stock, 0)}</p><p className="text-sm">Unidades en los locales elegidos.</p></div>
                        <div className="rounded bg-[#fff5d8] p-4"><b>Bajo mínimo</b><p className="mt-2 text-2xl font-bold">{stockReportRows.filter((row) => row.belowMinimum).length}</p><p className="text-sm">Productos con al menos un local a revisar.</p></div>
                        <div className="rounded bg-[#eef2f6] p-4"><b>Movimientos del período</b><p className="mt-2 text-2xl font-bold">{stockMovementsForReport.length}</p><p className="text-sm">Sólo registros con fecha guardada.</p></div>
                        <div className="rounded bg-[#fff1ec] p-4"><b>Ajustes pendientes</b><p className="mt-2 text-2xl font-bold">{pendingStockAdjustments.length}</p><p className="text-sm">Requieren aprobación operativa.</p></div>
                      </div>
                      <div className="overflow-auto rounded border"><table className="w-full min-w-[820px] text-sm"><thead className="bg-[#183a67] text-white"><tr><th className="p-3 text-left">Producto</th><th className="p-3 text-left">Categoría</th><th className="p-3 text-right">Stock actual</th><th className="p-3 text-right">Mínimo total</th><th className="p-3 text-left">Local más bajo</th><th className="p-3 text-right">Stock más bajo</th><th className="p-3 text-center">Control</th></tr></thead><tbody>{stockReportRows.map((row) => <tr key={row.id} className="border-t"><td className="p-3 font-bold">{row.name}</td><td className="p-3">{row.category}</td><td className="p-3 text-right">{row.stock}</td><td className="p-3 text-right">{row.minimum}</td><td className="p-3">{row.lowestSite}</td><td className="p-3 text-right font-bold">{row.lowestStock}</td><td className={`p-3 text-center font-bold ${row.belowMinimum ? "text-red-700" : "text-green-700"}`}>{row.belowMinimum ? "Reponer" : "OK"}</td></tr>)}</tbody></table></div>
                      <div className="overflow-auto rounded border"><div className="border-b bg-[#eef2f6] p-3"><b>Movimientos registrados en el período</b><p className="text-xs text-slate-600">Los movimientos anteriores que no guardaron fecha ISO no se incluyen en este filtro.</p></div><table className="w-full min-w-[820px] text-sm"><thead className="bg-[#eef2f6]"><tr><th className="p-3 text-left">Fecha</th><th className="p-3 text-left">Local</th><th className="p-3 text-left">Producto</th><th className="p-3 text-left">Movimiento</th><th className="p-3 text-right">Cantidad</th><th className="p-3 text-left">Detalle</th></tr></thead><tbody>{stockMovementsForReport.length ? stockMovementsForReport.slice(0, 50).map((movement) => <tr key={movement.id} className="border-t"><td className="p-3 whitespace-nowrap">{movement.at}</td><td className="p-3">{movement.site}</td><td className="p-3 font-bold">{products.find((product) => product.id === movement.productId)?.name || `Producto ${movement.productId}`}</td><td className="p-3">{movement.kind}</td><td className="p-3 text-right">{movement.quantity > 0 ? "+" : ""}{movement.quantity}</td><td className="p-3 text-slate-600">{movement.detail || movement.remito || "—"}</td></tr>) : <tr><td colSpan={6} className="p-4 text-slate-500">No hay movimientos fechados para el período y local seleccionados.</td></tr>}</tbody></table></div>
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
                            products.filter((product) =>
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
                            {products.filter((product) =>
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
                            <th className="p-3 text-center">Acción</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminRows.map((row) => {
                            const target = monthlyTargets[row.site] || 0;
                            const progress = target > 0 ? Math.round((row.net / target) * 100) : null;
                            return (
                              <tr key={row.site} className="border-t">
                                <td className="p-3 font-bold">{row.site}</td>
                                <td className="p-3 text-right">
                                  <label className="sr-only" htmlFor={`target-${row.site}`}>Meta mensual de {row.site}</label>
                                  <input id={`target-${row.site}`} type="number" min="0" step="1000" value={monthlyTargetDrafts[row.site] || ""} onChange={(event) => setMonthlyTargetDrafts((targets) => ({ ...targets, [row.site]: Math.max(0, Number(event.target.value) || 0) }))} className="w-36 rounded border p-2 text-right" placeholder="Sin meta" />
                                </td>
                                <td className="p-3 text-right">
                                  {money.format(row.net)}
                                </td>
                                <td className={`p-3 text-right font-bold ${progress === null ? "text-slate-500" : progress >= 100 ? "text-green-700" : "text-amber-700"}`}>
                                  {progress === null ? "Sin meta" : `${progress}%`}
                                </td>
                                <td className="p-3 text-right">
                                  {target > 0 ? money.format(Math.max(0, target - row.net)) : "—"}
                                </td>
                                <td className="p-3 text-center"><button onClick={() => saveMonthlyTarget(row.site)} className="rounded bg-[#183a67] px-3 py-2 text-xs font-bold text-white">Guardar meta</button></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <p className="border-t p-3 text-xs text-slate-500">
                        Las metas se guardan en la base operativa. La venta y el avance respetan el período y local seleccionados arriba.
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
                    <div className="mt-5">
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Asistencia</b>
                        <p className="mt-2 text-sm">
                          Entradas, salidas y horas trabajadas por empleado.
                        </p>
                      </div>
                      <div className="rounded bg-[#fff5d8] p-4">
                        <b>Tardanzas</b>
                        <p className="mt-2 text-sm">
                          Se calcularán con los horarios y tolerancias configurados.
                        </p>
                      </div>
                      <div className="rounded bg-[#eef2f6] p-4">
                        <b>Ausencias</b>
                        <p className="mt-2 text-sm">
                          Días sin fichaje y excepciones justificadas.
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 overflow-auto rounded border">
                      <table className="w-full min-w-[650px] text-sm">
                        <thead className="bg-[#183a67] text-white"><tr><th className="p-3 text-left">Persona</th><th className="p-3 text-left">Local</th><th className="p-3 text-left">Movimiento</th><th className="p-3 text-left">Fecha y hora</th><th className="p-3 text-right">Tardanza</th></tr></thead>
                        <tbody>{attendanceRecords.length ? attendanceRecords.filter((record) => reportSite === "Todos los locales" || record.site === reportSite).slice(0, 30).map((record) => <tr key={record.id} className="border-t"><td className="p-3 font-bold">{record.userName}</td><td className="p-3">{record.site}</td><td className="p-3">{record.kind}</td><td className="p-3">{record.at}</td><td className="p-3 text-right">{record.lateMinutes ? `${record.lateMinutes} min` : "—"}</td></tr>) : <tr><td colSpan={5} className="p-4 text-slate-500">Todavía no hay fichajes registrados.</td></tr>}</tbody>
                      </table>
                    </div>
                    </div>
                  )}
                  {adminReport === "Clientes" && (
                    <div className="mt-5 space-y-4">
                      <div className="grid gap-4 md:grid-cols-3"><div className="rounded bg-[#eef2f6] p-4"><b>Base activa</b><p className="mt-2 text-2xl font-bold">{customers.filter(customer => customer.active && (reportSite === "Todos los locales" || customer.site === reportSite)).length}</p></div><div className="rounded bg-[#eef2f6] p-4"><b>Ventas identificadas</b><p className="mt-2 text-2xl font-bold">{reportSales.filter(sale => Boolean(sale.customerId)).length}</p></div><div className="rounded bg-[#eef2f6] p-4"><b>Devoluciones vinculadas</b><p className="mt-2 text-2xl font-bold">{returnsLog.filter(item => reportSales.some(sale => sale.id === item.saleId)).length}</p></div></div>
                      <div className="overflow-auto rounded border"><table className="w-full min-w-[800px] text-sm"><thead className="bg-[#183a67] text-white"><tr><th className="p-3 text-left">Cliente</th><th className="p-3 text-left">Documento</th><th className="p-3 text-left">Local</th><th className="p-3 text-right">Ventas</th><th className="p-3 text-right">Devoluciones</th><th className="p-3 text-right">Venta neta</th></tr></thead><tbody>{customers.filter(customer => reportSite === "Todos los locales" || customer.site === reportSite).map(customer => { const customerSales = reportSales.filter(sale => sale.customerId === customer.id); const saleIds = new Set(customerSales.map(sale => sale.id)); return <tr key={customer.id} className="border-t"><td className="p-3 font-bold">{customer.name}{!customer.active && <span className="ml-2 text-xs text-slate-500">Inactivo</span>}</td><td className="p-3">{customer.documentType} {customer.documentNumber}</td><td className="p-3">{customer.site}</td><td className="p-3 text-right">{customerSales.length}</td><td className="p-3 text-right">{returnsLog.filter(item => saleIds.has(item.saleId)).length}</td><td className="p-3 text-right">{money.format(customerSales.reduce((total, sale) => total + sale.net, 0))}</td></tr>})}{!customers.length && <tr><td colSpan={6} className="p-4 text-slate-500">No hay clientes registrados para este filtro.</td></tr>}</tbody></table></div>
                    </div>
                  )}
                  {adminReport === "Promociones" && (
                    <div className="mt-5 space-y-4">
                      <div className="grid gap-4 md:grid-cols-4"><div className="rounded bg-[#eef2f6] p-4"><b>Operaciones con beneficio</b><p className="mt-2 text-2xl font-bold">{promotionTotals.operations}</p><p className="text-sm">Descuento o invitación registrada.</p></div><div className="rounded bg-[#eef2f6] p-4"><b>Descuento otorgado</b><p className="mt-2 text-2xl font-bold">{money.format(promotionTotals.discount)}</p><p className="text-sm">Sobre operaciones del período.</p></div><div className="rounded bg-[#eef2f6] p-4"><b>Invitaciones</b><p className="mt-2 text-2xl font-bold">{promotionTotals.invitationUnits}</p><p className="text-sm">Unidades marcadas como invitación.</p></div><div className="rounded bg-[#fff5d8] p-4"><b>Margen no disponible</b><p className="mt-2 text-sm">Se necesitan costos unitarios para evaluar rentabilidad del beneficio.</p></div></div>
                      <div className="overflow-auto rounded border"><table className="w-full min-w-[900px] text-sm"><thead className="bg-[#183a67] text-white"><tr><th className="p-3 text-left">Local</th><th className="p-3 text-right">Operaciones</th><th className="p-3 text-right">Con descuento</th><th className="p-3 text-right">Con invitación</th><th className="p-3 text-right">Unidades invitadas</th><th className="p-3 text-right">Bruto</th><th className="p-3 text-right">Descuento</th><th className="p-3 text-right">Neto</th></tr></thead><tbody>{promotionRows.map((row) => <tr key={row.site} className="border-t"><td className="p-3 font-bold">{row.site}</td><td className="p-3 text-right">{row.operations}</td><td className="p-3 text-right">{row.discounted}</td><td className="p-3 text-right">{row.invited}</td><td className="p-3 text-right">{row.invitationUnits}</td><td className="p-3 text-right">{money.format(row.gross)}</td><td className="p-3 text-right">{money.format(row.discount)}</td><td className="p-3 text-right font-bold">{money.format(row.net)}</td></tr>)}</tbody></table><p className="border-t p-3 text-xs text-slate-500">El sistema aún no administra campañas identificadas por nombre o vigencia. Este reporte consolida descuentos manuales e invitaciones efectivamente guardados.</p></div>
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
                        Historial del servidor por usuario, local, fecha, acción y detalle. Ventas anuladas y ajustes conservan su trazabilidad.
                      </p>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <label className="text-sm font-bold">Usuario<input value={auditUserFilter} onChange={(event) => setAuditUserFilter(event.target.value)} placeholder="Nombre del usuario" className="mt-1 block w-full rounded border p-2 font-normal" /></label>
                        <label className="text-sm font-bold">Acción<input value={auditActionFilter} onChange={(event) => setAuditActionFilter(event.target.value)} placeholder="Venta, caja, stock…" className="mt-1 block w-full rounded border p-2 font-normal" /></label>
                      </div>
                      <div className="mt-4 overflow-auto rounded border">
                        <table className="w-full min-w-[900px] text-sm"><thead className="bg-[#183a67] text-white"><tr><th className="p-3 text-left">Fecha</th><th className="p-3 text-left">Usuario</th><th className="p-3 text-left">Local</th><th className="p-3 text-left">Acción</th><th className="p-3 text-left">Detalle</th></tr></thead>
                          <tbody>{auditHistory.length ? auditHistory.map((event) => <tr key={event.id} className="border-t"><td className="p-3 whitespace-nowrap">{event.at}</td><td className="p-3 font-bold">{event.userName}</td><td className="p-3">{event.site}</td><td className="p-3 font-bold">{event.action}</td><td className="p-3 text-slate-600">{event.detail}</td></tr>) : <tr><td colSpan={5} className="p-4 text-slate-500">No hay eventos para los filtros seleccionados.</td></tr>}</tbody></table>
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
                        usando los horarios configurados por Supervisión.
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
      {receiptSale && (
        <div className="receipt-modal fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/55 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Vista previa del ticket">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-2xl">
            <pre className="receipt-print-area mx-auto w-full max-w-[80mm] whitespace-pre-wrap bg-white p-3 font-mono text-[12px] leading-[1.35] text-black">
              {buildThermalReceipt(
                receiptSale,
                payments.filter((payment) => payment.saleId === receiptSale.id),
                user.name,
              )}
            </pre>
            <div className="no-print mt-4 grid grid-cols-2 gap-2">
              <button onClick={() => setReceiptSale(null)} className="rounded border px-4 py-3 font-bold">Cerrar</button>
              <button onClick={printReceipt} className="rounded bg-[#183a67] px-4 py-3 font-bold text-white">Imprimir ticket</button>
            </div>
          </div>
        </div>
      )}
      <AiHelpChat
        key={`${user.role}:${user.name}:${site}`}
        role={user.role}
        site={user.role === "administracion" ? "" : site}
        section={tab}
        userName={user.name}
        reportPermissions={user.reportPermissions}
        onOpenReport={(reportId) => {
          const access = { role: user.role, reportPermissions: user.reportPermissions, supervisorReports: canViewSupervisorReports };
          if (!canOpenReport(access, reportId)) return;
          if (reportId === "Supervision") setTab("Reportes");
          else { setAdminReport(reportId); setTab("Administración"); }
          setNavOpen(false);
        }}
        capabilities={{
          central: managesCentralOrders,
          minimumStock: canAdjustStock,
          countStock: canCountRealStock,
          approveStock: canApproveStockAdjustments,
          supervisorReports: canViewSupervisorReports,
          schedules: canManageSchedules,
        }}
        diagnosticContext={{
          site,
          section: tab,
          connectionMode,
          pendingSync,
          canSell: can("cobrar"),
          cashOpen: cashIsOpen,
          hasActiveShift: Boolean(activeShift),
          cartItems: cart.length,
          customer,
          discount,
          maxDiscount: siteLimits.maxDiscount,
          splitPayment,
          splitPaymentTotal: splitPayments.filter((payment) => payment.amount > 0).reduce((sum, payment) => sum + payment.amount, 0),
          positivePaymentsCount: splitPayments.filter((payment) => payment.amount > 0).length,
          openOrdersCount: savedOrders.filter((order) => order.site === site).length,
          requiresEnvelope,
          saleNet: net,
          countedCash: counted,
          envelopeCash: envelope,
          expectedCash: expected,
          cashVariance,
          maxCashVariance: siteLimits.maxCashDifference,
          lowStockCount: lowStockProducts.length,
          insufficientStockProducts: lines
            .filter(({ p, q }) => q > (stock[site][p.id] || 0))
            .map(({ p }) => p.name),
          invalidInvitationProducts: lines
            .filter(({ p, q }) => (invitedQuantities[p.id] || 0) > q)
            .map(({ p }) => p.name),
          recentMessage: message,
        }}
        onSupportCreated={user.role === "administracion" ? () => void loadAdminSecurityData() : undefined}
      />
      <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="no-print fixed bottom-5 right-40 rounded-full bg-[#183a67] px-4 py-3 text-sm font-bold text-white shadow-lg" aria-label="Volver al inicio" title="Volver al inicio">↑ Arriba</button>
    </main>
  );
}
