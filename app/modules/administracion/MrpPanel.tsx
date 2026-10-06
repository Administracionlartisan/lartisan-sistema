"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE, money } from "../shared/constants";
import Heading from "../shared/components/Heading";
import styles from "./MrpPanel.module.css";

type MrpRow = Record<string, string | number | null | undefined>;
type MrpSnapshot = {
  source: { title: string; mode: string };
  kpis: { estimatedNetCost: number; buyItems: number; prepareItems: number; alerts: number };
  weeklyGuide: unknown[][];
  plan: MrpRow[];
  requirements: MrpRow[];
  buy: MrpRow[];
  prepare: MrpRow[];
  validation: { status: string; checkedLines: number; differences: MrpRow[]; managementApproval: string };
  recipes: Recipe[];
  inputs: MrpRow[];
  recipeValidation: { status: string; checkedLines: number; checkedRecipes: number; costedRecipes: number; missingCostInputs: string[]; differences: MrpRow[] };
  recipeReview?: { required: boolean; recipeKey?: string; changedAt?: string };
  importCounts?: { inputs: number; recipes: number; components: number };
};
type Recipe = { sourceKey?: string; recipe: string; yield: number | null; components: number; costPerUnit: number | null; costStatus: string; missingCosts: string[]; items: MrpRow[] };
type Order = { id: string; item_name: string; provider_name?: string; unit: string; quantity: string; received_quantity: string; status: string; row_version: string };
type Stock = { input_key: string; input_name: string; unit: string; actual_quantity: string; counted_at: string; counted_by_name?: string };

const number = (value: unknown) => {
  if (typeof value === "number") return value;
  const normalized = String(value ?? "").replace(/[^0-9,.-]/g, "").replace(/\./g, "").replace(",", ".");
  return Number(normalized) || 0;
};
const quantity = (value: unknown) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 }).format(number(value));
const mrpKey = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim().replace(/\s+/g, " ");

type MrpView = "Plan semanal" | "Comprar" | "Preparar" | "Explosión y requerimientos" | "Recetas y costos" | "Operación" | "Validación";
const MRP_VIEWS: MrpView[] = ["Plan semanal", "Comprar", "Preparar", "Explosión y requerimientos", "Recetas y costos", "Operación", "Validación"];
type MrpPanelProps = { initialView?: "Plan semanal" | "Recetas y costos" };

export default function MrpPanel({ initialView = "Plan semanal" }: MrpPanelProps) {
  const [view, setView] = useState<MrpView>(initialView);
  const [snapshot, setSnapshot] = useState<MrpSnapshot | null>(null);
  const [updatedAt, setUpdatedAt] = useState("");
  const [canImport, setCanImport] = useState(false);
  const [canEditRecipes, setCanEditRecipes] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [controls, setControls] = useState<MrpRow[]>([]);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [canCountStock, setCanCountStock] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [orderForm, setOrderForm] = useState({ itemName: "", providerName: "", unit: "kg", quantity: "" });
  const [controlForm, setControlForm] = useState({ weekKey: "", itemName: "", expectedQuantity: "", actualQuantity: "" });
  const [stockForm, setStockForm] = useState({ inputKey: "", actualQuantity: "", notes: "" });
  const [productionForm, setProductionForm] = useState({ weekKey: "", recipeKey: "", quantityProduced: "", notes: "" });
  const [receiptByOrder, setReceiptByOrder] = useState<Record<string, string>>({});
  const [filters, setFilters] = useState({ search: "", category: "", provider: "", status: "" });

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const [sourceResponse, operationsResponse] = await Promise.all([
        fetch(`${API_BASE}/mrp/latest`, { credentials: "include", cache: "no-store", signal: controller.signal }),
        fetch(`${API_BASE}/mrp/operations`, { credentials: "include", cache: "no-store", signal: controller.signal }),
      ]);
      const source = await sourceResponse.json() as { error?: string; canImport?: boolean; canEditRecipes?: boolean; snapshot?: { data?: MrpSnapshot; updatedAt?: string } };
      const operations = await operationsResponse.json() as { error?: string; orders?: Order[]; controls?: MrpRow[]; stocks?: Stock[]; canCountStock?: boolean };
      if (!sourceResponse.ok) throw new Error(source.error || "No se pudo leer el MRP.");
      if (!operationsResponse.ok) throw new Error(operations.error || "No se pudo leer la operación MRP.");
      setSnapshot(source.snapshot?.data ?? null);
      setUpdatedAt(source.snapshot?.updatedAt ?? "");
      setCanImport(source.canImport === true);
      setCanEditRecipes(source.canEditRecipes === true);
      setOrders(operations.orders ?? []);
      setControls(operations.controls ?? []);
      setStocks(operations.stocks ?? []); setCanCountStock(operations.canCountStock === true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo cargar el MRP."); }
    finally { window.clearTimeout(timeout); setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    const moduleName = initialView === "Recetas y costos" ? "Recetas y costos" : "MRP semanal";
    void fetch(`${API_BASE}/activity/module-opened`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ module: moduleName }) });
  }, [initialView]);

  const importOnce = async () => {
    if (!importFile || importing) return;
    setNotice(""); setError(""); setImporting(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 90000);
    try {
      if (importFile.size > 2000000) throw new Error("El archivo supera el tamaño admitido (2 MB).");
      const data = await importFile.text();
      if (JSON.parse(data).format !== "lartisan-mrp-once-v1") throw new Error("Seleccioná la copia preparada para la carga única de MRP.");
      const response = await fetch(`${API_BASE}/mrp/import`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: data, signal: controller.signal });
      const body = await response.json() as { error?: string; result?: { alreadyImported: boolean; counts: { inputs: number; recipes: number; components: number } } };
      if (!response.ok || !body.result) throw new Error(body.error || "No se pudo verificar la importación.");
      const { counts } = body.result;
      setNotice(`${body.result.alreadyImported ? "La copia ya estaba importada. No se duplicaron registros." : "Importación guardada y verificada."} ${counts.recipes} recetas, ${counts.components} componentes y ${counts.inputs} insumos.`);
      setImportFile(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error && cause.name === "AbortError" ? "No llegó la confirmación. Usá Verificar estado antes de reintentar: la carga podría haberse completado." : cause instanceof Error ? cause.message : "No se pudo importar el MRP.");
    } finally { window.clearTimeout(timeout); setImporting(false); }
  };

  const submitOrder = async (event: FormEvent) => {
    event.preventDefault(); setNotice("");
    const response = await fetch(`${API_BASE}/mrp/orders`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...orderForm, quantity: Number(orderForm.quantity) }) });
    const body = await response.json() as { error?: string };
    if (!response.ok) return setNotice(body.error || "No se pudo guardar la orden.");
    setOrderForm({ itemName: "", providerName: "", unit: "kg", quantity: "" }); setNotice("Orden guardada en el sistema. La planilla no fue modificada."); void load();
  };
  const submitControl = async (event: FormEvent) => {
    event.preventDefault(); setNotice("");
    const response = await fetch(`${API_BASE}/mrp/controls`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...controlForm, expectedQuantity: Number(controlForm.expectedQuantity), actualQuantity: Number(controlForm.actualQuantity) }) });
    const body = await response.json() as { error?: string; status?: string };
    if (!response.ok) return setNotice(body.error || "No se pudo guardar el control.");
    setControlForm({ weekKey: "", itemName: "", expectedQuantity: "", actualQuantity: "" }); setNotice(`Control guardado: ${body.status}.`); void load();
  };
  const submitReceipt = async (orderId: string) => {
    const received = Number(receiptByOrder[orderId]);
    if (!(received > 0)) return setNotice("Indicá una cantidad recibida válida.");
    const response = await fetch(`${API_BASE}/mrp/orders/${orderId}/receipts`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantityReceived: received }) });
    const body = await response.json() as { error?: string };
    if (!response.ok) return setNotice(body.error || "No se pudo registrar la recepción.");
    setReceiptByOrder((current) => ({ ...current, [orderId]: "" })); setNotice("Recepción guardada en el sistema."); void load();
  };
  const submitStock = async (event: FormEvent) => {
    event.preventDefault(); const input = (snapshot?.inputs ?? []).find((row) => mrpKey(row.item) === stockForm.inputKey); if (!input) return setNotice("Seleccioná un insumo.");
    const response = await fetch(`${API_BASE}/mrp/stock-counts`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inputKey: stockForm.inputKey, inputName: input.item, unit: input.unit ?? input.stockUnit ?? "unidad", actualQuantity: Number(stockForm.actualQuantity), notes: stockForm.notes }) });
    const body = await response.json() as { error?: string }; if (!response.ok) return setNotice(body.error || "No se pudo guardar el stock.");
    setStockForm({ inputKey: "", actualQuantity: "", notes: "" }); setNotice("Stock real guardado. El MRP recalculó las necesidades netas."); void load();
  };
  const submitProduction = async (event: FormEvent) => {
    event.preventDefault(); setNotice("");
    if (!(Number(productionForm.quantityProduced) > 0)) return setNotice("Indicá una cantidad producida válida.");
    const response = await fetch(`${API_BASE}/mrp/production-runs`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...productionForm, quantityProduced: Number(productionForm.quantityProduced) }) });
    const body = await response.json() as { error?: string };
    if (!response.ok) return setNotice(body.error || "No se pudo confirmar la producción.");
    setProductionForm({ weekKey: "", recipeKey: "", quantityProduced: "", notes: "" });
    setNotice("Producción confirmada. Se descontó el stock físico de los insumos y el MRP recalculó sus necesidades."); void load();
  };

  const rows = useMemo(() => view === "Comprar" ? snapshot?.buy : view === "Preparar" ? snapshot?.prepare : view === "Explosión y requerimientos" ? snapshot?.requirements : snapshot?.plan, [snapshot, view]);
  const filterOptions = useMemo(() => {
    const values = (key: string) => Array.from(new Set((rows ?? []).map((row) => String(row[key] ?? "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "es"));
    return { categories: values("category"), providers: values("provider"), statuses: values("status") };
  }, [rows]);
  const filteredRows = useMemo(() => {
    const search = filters.search.trim().toLocaleLowerCase("es");
    return (rows ?? []).filter((row) => {
      const rowText = Object.values(row).join(" ").toLocaleLowerCase("es");
      return (!search || rowText.includes(search))
        && (!filters.category || String(row.category ?? "") === filters.category)
        && (!filters.provider || String(row.provider ?? "") === filters.provider)
        && (!filters.status || String(row.status ?? "") === filters.status);
    });
  }, [filters, rows]);
  const table = view === "Plan semanal" ? (
    <DataTable rows={filteredRows} columns={[["product", "Producto"], ["stock", "Stock"], ["safetyStock", "Seguridad"], ["confirmedOrder", "Pedido"], ["suggestedProduction", "Sugerido"], ["finalProduction", "Final"], ["status", "Estado"]]} />
  ) : (
    <DataTable rows={filteredRows} columns={view === "Explosión y requerimientos" ? [["item", "Insumo / subreceta"], ["category", "Categoría"], ["directRequirement", "Nivel directo"], ["subrecipeRequirement", "Por subrecetas"], ["required", "Requerido total"], ["stock", "Stock"], ["netNeed", "Necesidad"], ["action", "Acción"]] : [["item", "Insumo / subreceta"], ["category", "Categoría"], ["required", "Requerido"], ["stock", "Stock"], ["netNeed", "Necesidad"], ["suggestedQuantity", "Cantidad sugerida"], ["provider", "Proveedor"], ["status", "Estado"]]} />
  );

  if (initialView === "Recetas y costos") return <div className={styles.panel}>
    <Heading k="ADMINISTRACIÓN · PRODUCCIÓN" h="Recetas y costos" p="Fichas técnicas, rendimientos y costos por producto guardados en el sistema." />
    <div className={styles.notice}><div><strong>{snapshot ? "Recetario operativo" : "Recetario sin carga"}</strong><p>Esta sección administra las fichas técnicas y el costo de cada producto. El MRP semanal se usa por separado para planificar compras, preparación y necesidades de producción.</p>{snapshot?.importCounts && <p>{snapshot.importCounts.recipes} recetas · {snapshot.importCounts.components} componentes · {snapshot.importCounts.inputs} insumos.</p>}<button type="button" className={styles.button} disabled={loading} onClick={() => void load()}>Actualizar recetario</button></div><span className={styles.status}>{loading ? "Consultando datos…" : updatedAt ? `Actualizado ${updatedAt}` : error ? "No se pudo verificar" : "Sin recetario confirmado"}</span></div>
    {error && <div className={styles.error}>{error}</div>}
    {notice && <div className={styles.notice}><strong>{notice}</strong></div>}
    {snapshot?.recipeReview?.required && <div className={styles.warning}><strong>MRP pendiente de revisión:</strong> una receta fue modificada el {snapshot.recipeReview.changedAt ?? "último registro"}. Su costo se recalculó; revisá el plan semanal antes de confirmar compras o producción.</div>}
    <RecipesPanel snapshot={snapshot} canEdit={canEditRecipes} onSaved={() => void load()} />
  </div>;

  return <div className={styles.panel}>
    <Heading k="ADMINISTRACIÓN · ABASTECIMIENTO" h="MRP semanal" p="Planificación, requerimientos y seguimiento de compras desde la base operativa del sistema." />
    <div className={styles.notice}><div><strong>{snapshot ? "Recetario guardado en el sistema" : "Carga única del recetario"}</strong><p>{snapshot ? "Las recetas, insumos, rendimientos y costos se consultan desde la base propia. No se vuelve a importar al actualizar la página. El plan semanal mostrado es la copia de origen, no una planificación recalculada automáticamente." : "Importá la copia preparada de la planilla una sola vez. No requiere conectar Google y no modifica el archivo original."}</p>
      {!snapshot && canImport && <div><label>Archivo de migración MRP <input type="file" accept=".json,application/json" disabled={importing} onChange={event => setImportFile(event.target.files?.[0] ?? null)} /></label><button type="button" className={styles.button} disabled={!importFile || importing || loading} onClick={() => void importOnce()}>{importing ? "Guardando y verificando…" : "Importar y guardar en el sistema"}</button></div>}
      {snapshot?.importCounts && <p>{snapshot.importCounts.recipes} recetas · {snapshot.importCounts.components} componentes · {snapshot.importCounts.inputs} insumos.</p>}
      <button type="button" className={styles.button} disabled={loading || importing} onClick={() => void load()}>Verificar estado</button>
    </div><span className={styles.status}>{importing ? "Importando…" : loading ? "Consultando estado…" : updatedAt ? `Guardado ${updatedAt}` : error ? "No se pudo verificar" : "Sin importación confirmada"}</span></div>
    {error && <div className={styles.error}>{error}</div>}
    {notice && <div className={styles.notice}><strong>{notice}</strong></div>}
    <div className={styles.metrics}>
      <Metric label="Costo neto estimado" value={snapshot ? money.format(snapshot.kpis.estimatedNetCost) : "—"} />
      <Metric label="Ítems a comprar" value={snapshot?.kpis.buyItems ?? "—"} />
      <Metric label="Subrecetas a preparar" value={snapshot?.kpis.prepareItems ?? "—"} />
      <Metric label="Alertas operativas" value={snapshot?.kpis.alerts ?? "—"} />
    </div>
    <div className={styles.tabs}>{MRP_VIEWS.map((item) => <button key={item} onClick={() => setView(item)} className={`${styles.tab} ${view === item ? styles.tabActive : ""}`}>{item}</button>)}</div>
    {view === "Operación" ? <OperationPanel {...{ orders, controls, stocks, inputs: snapshot?.inputs ?? [], recipes: snapshot?.recipes ?? [], canCountStock, stockForm, setStockForm, submitStock, productionForm, setProductionForm, submitProduction, orderForm, setOrderForm, controlForm, setControlForm, submitOrder, submitControl, receiptByOrder, setReceiptByOrder, submitReceipt }} /> : view === "Recetas y costos" ? <RecipesPanel snapshot={snapshot} canEdit={canEditRecipes} onSaved={() => void load()} /> : view === "Validación" ? <ValidationPanel snapshot={snapshot} /> : <section className={styles.card}><div className={styles.cardHeader}><div><strong>{view}</strong><p>{loading ? "Leyendo la última copia válida…" : `${filteredRows.length} de ${rows?.length ?? 0} registros visibles`}</p></div></div><div className={styles.filterBar}><label>Buscar<input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Insumo, producto o proveedor" /></label>{filterOptions.categories.length > 0 && <label>Categoría<select value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })}><option value="">Todas</option>{filterOptions.categories.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}{filterOptions.providers.length > 0 && <label>Proveedor<select value={filters.provider} onChange={(event) => setFilters({ ...filters, provider: event.target.value })}><option value="">Todos</option>{filterOptions.providers.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}{filterOptions.statuses.length > 0 && <label>Estado<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Todos</option>{filterOptions.statuses.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}<button type="button" className={styles.filterClear} onClick={() => setFilters({ search: "", category: "", provider: "", status: "" })}>Limpiar filtros</button></div>{table}</section>}
  </div>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className={styles.metric}><span>{label}</span><strong>{value}</strong></div>; }
function DataTable({ rows, columns }: { rows: MrpRow[]; columns: string[][] }) {
  if (!rows.length) return <div className={styles.empty}>No hay registros para mostrar en la última copia.</div>;
  return <div className={styles.tableWrap}><table className={styles.table}><thead><tr>{columns.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.slice(0, 250).map((row, index) => <tr key={String(row.item ?? row.product ?? index)}>{columns.map(([key, label]) => <td key={key} className={/[Cc]osto|Stock|Pedido|Requerido|Necesidad|Sugerido|Final|Cantidad/.test(label) ? styles.amount : ""}>{/stock|quantity|required|need|cost|production|order/i.test(key) ? quantity(row[key]) : String(row[key] ?? "—")}</td>)}</tr>)}</tbody></table></div>;
}
type OperationPanelProps = {
  orders: Order[];
  controls: MrpRow[];
  stocks: Stock[];
  inputs: MrpRow[];
  recipes: Recipe[];
  canCountStock: boolean;
  stockForm: { inputKey: string; actualQuantity: string; notes: string };
  setStockForm: (value: { inputKey: string; actualQuantity: string; notes: string }) => void;
  submitStock: (event: FormEvent) => Promise<void>;
  productionForm: { weekKey: string; recipeKey: string; quantityProduced: string; notes: string };
  setProductionForm: (value: { weekKey: string; recipeKey: string; quantityProduced: string; notes: string }) => void;
  submitProduction: (event: FormEvent) => Promise<void>;
  orderForm: { itemName: string; providerName: string; unit: string; quantity: string };
  setOrderForm: (value: { itemName: string; providerName: string; unit: string; quantity: string }) => void;
  controlForm: { weekKey: string; itemName: string; expectedQuantity: string; actualQuantity: string };
  setControlForm: (value: { weekKey: string; itemName: string; expectedQuantity: string; actualQuantity: string }) => void;
  submitOrder: (event: FormEvent) => Promise<void>;
  submitControl: (event: FormEvent) => Promise<void>;
  receiptByOrder: Record<string, string>;
  setReceiptByOrder: (value: Record<string, string> | ((current: Record<string, string>) => Record<string, string>)) => void;
  submitReceipt: (orderId: string) => Promise<void>;
};
function OperationPanel({ orders, controls, stocks, inputs, recipes, canCountStock, stockForm, setStockForm, submitStock, productionForm, setProductionForm, submitProduction, orderForm, setOrderForm, controlForm, setControlForm, submitOrder, submitControl, receiptByOrder, setReceiptByOrder, submitReceipt }: OperationPanelProps) {
  return <section className={styles.card}><div className={styles.cardHeader}><div><strong>Órdenes, recepciones y control</strong><p>Estos registros viven en la base del sistema y nunca en la planilla original.</p></div></div><div className={styles.forms}>
    <form className={styles.form} onSubmit={submitOrder}><strong>Nueva orden interna</strong><div className={styles.formGrid}><label>Insumo<input required value={orderForm.itemName} onChange={(e) => setOrderForm({ ...orderForm, itemName: e.target.value })} /></label><label>Proveedor<input value={orderForm.providerName} onChange={(e) => setOrderForm({ ...orderForm, providerName: e.target.value })} /></label><label>Unidad<input required value={orderForm.unit} onChange={(e) => setOrderForm({ ...orderForm, unit: e.target.value })} /></label><label>Cantidad<input required min="0.0001" step="0.0001" type="number" value={orderForm.quantity} onChange={(e) => setOrderForm({ ...orderForm, quantity: e.target.value })} /></label></div><button className={styles.button}>Guardar orden</button></form>
    <form className={styles.form} onSubmit={submitControl}><strong>Control semanal</strong><div className={styles.formGrid}><label>Semana (AAAA-S##)<input required placeholder="2026-S37" value={controlForm.weekKey} onChange={(e) => setControlForm({ ...controlForm, weekKey: e.target.value })} /></label><label>Insumo<input required value={controlForm.itemName} onChange={(e) => setControlForm({ ...controlForm, itemName: e.target.value })} /></label><label>Esperado<input required min="0" step="0.0001" type="number" value={controlForm.expectedQuantity} onChange={(e) => setControlForm({ ...controlForm, expectedQuantity: e.target.value })} /></label><label>Real<input required min="0" step="0.0001" type="number" value={controlForm.actualQuantity} onChange={(e) => setControlForm({ ...controlForm, actualQuantity: e.target.value })} /></label></div><button className={styles.button}>Guardar control</button></form>
  </div>{canCountStock && <form className={styles.form} onSubmit={submitStock}><strong>Stock físico para MRP</strong><p>Se registra aquí el inventario real (requiere el permiso «Contar stock de insumos»). Este valor recalcula la necesidad neta de compra del MRP y queda auditado.</p><div className={styles.formGrid}><label>Insumo<select required value={stockForm.inputKey} onChange={(e) => setStockForm({ ...stockForm, inputKey: e.target.value })}><option value="">Seleccionar insumo</option>{inputs.map((input) => <option key={mrpKey(input.item)} value={mrpKey(input.item)}>{String(input.item)} · {String(input.unit ?? input.stockUnit ?? "unidad")}</option>)}</select></label><label>Stock real<input required min="0" step="any" type="number" value={stockForm.actualQuantity} onChange={(e) => setStockForm({ ...stockForm, actualQuantity: e.target.value })} /></label><label>Observación<textarea value={stockForm.notes} onChange={(e) => setStockForm({ ...stockForm, notes: e.target.value })} placeholder="Conteo, ajuste o diferencia" /></label></div><button className={styles.button}>Guardar stock y recalcular MRP</button></form>}<form className={styles.form} onSubmit={submitProduction}><strong>Confirmar producción</strong><p>Registra la elaboración real. Al confirmar, descuenta los insumos directos del stock físico, guarda el movimiento y recalcula la necesidad de compra.</p><div className={styles.formGrid}><label>Semana (AAAA-S##)<input required placeholder="2026-S37" value={productionForm.weekKey} onChange={(e) => setProductionForm({ ...productionForm, weekKey: e.target.value })} /></label><label>Receta / producto<select required value={productionForm.recipeKey} onChange={(e) => setProductionForm({ ...productionForm, recipeKey: e.target.value })}><option value="">Seleccionar receta</option>{recipes.map((recipe) => <option key={recipe.sourceKey ?? mrpKey(recipe.recipe)} value={recipe.sourceKey ?? mrpKey(recipe.recipe)}>{recipe.recipe}</option>)}</select></label><label>Cantidad producida<input required min="0.0001" step="0.0001" type="number" value={productionForm.quantityProduced} onChange={(e) => setProductionForm({ ...productionForm, quantityProduced: e.target.value })} /></label><label>Observación<textarea value={productionForm.notes} onChange={(e) => setProductionForm({ ...productionForm, notes: e.target.value })} placeholder="Turno, lote o novedad" /></label></div><button className={styles.button}>Confirmar y descontar stock</button></form><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Orden</th><th>Insumo</th><th>Proveedor</th><th>Cantidad</th><th>Recibido</th><th>Estado</th><th>Registrar recepción</th></tr></thead><tbody>{orders.map((order: Order) => <tr key={order.id}><td>#{order.id}</td><td>{order.item_name}</td><td>{order.provider_name || "—"}</td><td className={styles.amount}>{quantity(order.quantity)} {order.unit}</td><td className={styles.amount}>{quantity(order.received_quantity)}</td><td><span className={styles.tag}>{order.status}</span></td><td><div className={styles.receipt}><input aria-label={`Cantidad recibida orden ${order.id}`} min="0.0001" step="0.0001" type="number" value={receiptByOrder[order.id] ?? ""} onChange={(event) => setReceiptByOrder((current) => ({ ...current, [order.id]: event.target.value }))} /><button type="button" className={styles.button} onClick={() => void submitReceipt(order.id)}>Recibir</button></div></td></tr>)}</tbody></table>{!orders.length && <div className={styles.empty}>Todavía no hay órdenes internas.</div>}</div>{stocks.length > 0 && <DataTable rows={stocks as unknown as MrpRow[]} columns={[["input_name", "Insumo"], ["actual_quantity", "Stock real"], ["unit", "Unidad"], ["counted_by_name", "Actualizó"], ["counted_at", "Fecha"]]} />}{controls.length > 0 && <div className={styles.cardHeader}><strong>{controls.length} controles semanales registrados</strong></div>}</section>;
}
function ValidationPanel({ snapshot }: { snapshot: MrpSnapshot | null }) {
  const validation = snapshot?.validation;
  const recipes = snapshot?.recipeValidation;
  const differences = [...(validation?.differences ?? []), ...(recipes?.differences ?? [])];
  return <section className={styles.card}><div className={styles.cardHeader}><div><strong>Comparación técnica con la planilla</strong><p>Se recalculan el plan semanal y las cantidades por unidad de cada receta, sin modificar Google Sheets.</p></div></div><div className={styles.forms}><div className={styles.form}><strong>{validation?.status === "ok" && recipes?.status === "ok" ? "Validación técnica correcta" : "Hay diferencias para revisar"}</strong><p>Plan: {validation?.checkedLines ?? 0} líneas. Recetas: {recipes?.checkedLines ?? 0} componentes en {recipes?.checkedRecipes ?? 0} recetas.</p></div><div className={styles.form}><strong>Costos disponibles</strong><p>{recipes?.costedRecipes ?? 0} recetas tienen costo completo. {recipes?.missingCostInputs.length ?? 0} insumos requieren precio o revisión en la planilla.</p><strong className={styles.inlineTitle}>Aprobación de Gerencia: pendiente</strong><p>La validación técnica confirma fórmulas y referencias; Gerencia debe aprobar una corrida real antes de tomar decisiones de costo.</p></div></div>{differences.length ? <DataTable rows={differences} columns={[["recipe", "Receta / producto"], ["ingredient", "Insumo"], ["expected", "Esperado"], ["actual", "Planilla"], ["reason", "Motivo"]]} /> : null}</section>;
}

function downloadRecipeCosts(recipes: Recipe[]) {
  const text = (input: unknown) => `"${String(input ?? "").replace(/"/g, '""')}"`;
  // Excel configurado en Argentina reconoce la coma decimal y el punto y coma
  // como separador de columnas. Los importes se entregan sin comillas para que
  // pueda sumar, filtrar y aplicar formato de moneda correctamente.
  const numeric = (input: number | null | undefined) => input === null || input === undefined ? "" : String(input).replace(".", ",");
  const rows = [
    [text("Receta / producto"), text("Rendimiento"), text("Componentes"), text("Costo por unidad"), text("Estado"), text("Costos pendientes")],
    ...recipes.map((recipe) => [text(recipe.recipe), numeric(recipe.yield), numeric(recipe.components), numeric(recipe.costPerUnit), text(recipe.costStatus), text(recipe.missingCosts.join(" | "))]),
  ];
  const blob = new Blob(["\uFEFF" + rows.map((row) => row.join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = `costos-recetas-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
}

type RecipeHistory = { recipe: string; changedBy: string; changedAt: string; previousCost: number | null; currentCost: number | null; components: number };
function RecipesPanel({ snapshot, canEdit, onSaved }: { snapshot: MrpSnapshot | null; canEdit: boolean; onSaved: () => void }) {
  const [selected, setSelected] = useState(""); const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState<RecipeHistory[]>([]);
  const recipes = snapshot?.recipes ?? [];
  const recipe = recipes.find((item) => item.recipe === selected) ?? recipes[0];
  useEffect(() => { void fetch(`${API_BASE}/mrp/recipes/history`, { credentials: "include", cache: "no-store" }).then(response => response.ok ? response.json() : null).then((body) => setHistory((body as { history?: RecipeHistory[] } | null)?.history ?? [])).catch(() => setHistory([])); }, [snapshot]);
  if (!recipes.length) return <section className={styles.card}><div className={styles.empty}>No hay recetario importado. Administración debe realizar la carga única desde archivo.</div></section>;
  const editingRecipe = creating ? { recipe: "", yield: 1, components: 0, costPerUnit: null, costStatus: "Pendiente de costo", missingCosts: [], items: [] } : recipe;
  return <section className={styles.card}><div className={styles.cardHeader}><div><strong>Recetas y costos</strong><p>El recetario está guardado en la base del sistema. Un costo solo se calcula cuando todos sus insumos y subrecetas tienen un precio válido.</p></div><label className={styles.recipePicker}>Receta<select value={recipe?.recipe ?? ""} onChange={(event) => { setSelected(event.target.value); setCreating(false); }}>{recipes.map((item) => <option key={item.recipe}>{item.recipe}</option>)}</select></label><button type="button" className={styles.button} onClick={() => downloadRecipeCosts(recipes)}>Descargar costos para Excel</button>{canEdit && <button type="button" className={styles.button} onClick={() => setCreating(true)}>Nueva receta</button>}</div>{recipe && !creating && <><div className={styles.recipeMetrics}><Metric label="Rendimiento" value={recipe.yield ?? "—"} /><Metric label="Componentes" value={recipe.components} /><Metric label="Costo por unidad" value={recipe.costPerUnit === null ? "Pendiente" : money.format(recipe.costPerUnit)} /><Metric label="Estado" value={recipe.costStatus} /></div>{recipe.missingCosts.length > 0 && <div className={styles.warning}><strong>Faltan costos que completar:</strong> {recipe.missingCosts.join(", ")}</div>}<DataTable rows={recipe.items} columns={[["ingredient", "Insumo / subreceta"], ["type", "Tipo"], ["quantity", "Cantidad lote"], ["unit", "Unidad"], ["yield", "Rendimiento"], ["perUnit", "Cantidad por unidad"], ["dictionaryCheck", "Control"]]} /></>}{canEdit && editingRecipe && <RecipeEditor key={`${editingRecipe.recipe}|${JSON.stringify(editingRecipe.items)}`} recipe={editingRecipe} onSaved={() => { setCreating(false); onSaved(); }} />}{history.length > 0 && <div className={styles.cardHeader}><div><strong>Historial de cambios</strong><p>Últimas modificaciones de recetas registradas en el sistema.</p></div><DataTable rows={history as unknown as MrpRow[]} columns={[["recipe", "Receta"], ["changedBy", "Modificó"], ["changedAt", "Fecha"], ["previousCost", "Costo anterior"], ["currentCost", "Costo nuevo"], ["components", "Componentes"]]} /></div>}</section>;
}

function RecipeEditor({ recipe, onSaved }: { recipe: Recipe; onSaved: () => void }) {
  // Se reinicia con key al cambiar la receta, en lugar de copiar props en un efecto.
  const [name, setName] = useState(recipe.recipe), [yieldValue, setYieldValue] = useState(String(recipe.yield ?? "")), [lines, setLines] = useState(() => recipe.items.map(item => `${item.ingredient} | ${item.quantity} | ${item.unit} | ${item.type || "Insumo"}`).join("\n")), [message, setMessage] = useState("");
  const save = async (event: FormEvent) => { event.preventDefault(); const items = lines.split("\n").filter(Boolean).map(line => { const [ingredient, quantity, unit, type] = line.split("|").map(part => part.trim()); return { ingredient, quantity: Number(quantity), unit, type: type || "Insumo" }; }); const key = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " "); const response = await fetch(`${API_BASE}/mrp/recipes/${encodeURIComponent(key)}`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipe: name, yield: Number(yieldValue), items }) }); const body = await response.json() as { error?: string }; if (!response.ok) return setMessage(body.error || "No se pudo guardar."); setMessage("Receta guardada y registrada en el historial."); onSaved(); };
  return <form className={styles.form} onSubmit={save}><strong>Editar receta</strong><p>Requiere el permiso «Editar recetas y costos». Un componente por línea: insumo | cantidad lote | unidad | tipo.</p><div className={styles.formGrid}><label>Nombre<input required value={name} onChange={event => setName(event.target.value)} /></label><label>Rendimiento<input required min="0.0001" step="0.0001" type="number" value={yieldValue} onChange={event => setYieldValue(event.target.value)} /></label></div><label>Componentes<textarea required value={lines} onChange={event => setLines(event.target.value)} rows={Math.min(12, Math.max(4, lines.split("\n").length + 1))} /></label><button className={styles.button}>Guardar cambios</button>{message && <p>{message}</p>}</form>;
}
