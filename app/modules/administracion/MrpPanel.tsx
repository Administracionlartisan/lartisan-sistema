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
};
type Recipe = { recipe: string; yield: number | null; components: number; costPerUnit: number | null; costStatus: string; missingCosts: string[]; items: MrpRow[] };
type Order = { id: string; item_name: string; provider_name?: string; unit: string; quantity: string; received_quantity: string; status: string; row_version: string };

const number = (value: unknown) => {
  if (typeof value === "number") return value;
  const normalized = String(value ?? "").replace(/[^0-9,.-]/g, "").replace(/\./g, "").replace(",", ".");
  return Number(normalized) || 0;
};
const quantity = (value: unknown) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 }).format(number(value));

export default function MrpPanel() {
  const [view, setView] = useState("Plan semanal");
  const [snapshot, setSnapshot] = useState<MrpSnapshot | null>(null);
  const [updatedAt, setUpdatedAt] = useState("");
  const [googleConnected, setGoogleConnected] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [controls, setControls] = useState<MrpRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [orderForm, setOrderForm] = useState({ itemName: "", providerName: "", unit: "kg", quantity: "" });
  const [controlForm, setControlForm] = useState({ weekKey: "", itemName: "", expectedQuantity: "", actualQuantity: "" });
  const [receiptByOrder, setReceiptByOrder] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [sourceResponse, operationsResponse] = await Promise.all([
        fetch(`${API_BASE}/mrp/latest`, { credentials: "include", cache: "no-store" }),
        fetch(`${API_BASE}/mrp/operations`, { credentials: "include", cache: "no-store" }),
      ]);
      const source = await sourceResponse.json() as { error?: string; connected?: boolean; snapshot?: { data?: MrpSnapshot; updatedAt?: string } };
      const operations = await operationsResponse.json() as { error?: string; orders?: Order[]; controls?: MrpRow[] };
      if (!sourceResponse.ok) throw new Error(source.error || "No se pudo leer el MRP.");
      if (!operationsResponse.ok) throw new Error(operations.error || "No se pudo leer la operación MRP.");
      setSnapshot(source.snapshot?.data ?? null);
      setUpdatedAt(source.snapshot?.updatedAt ?? "");
      setGoogleConnected(source.connected === true);
      setOrders(operations.orders ?? []);
      setControls(operations.controls ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo cargar el MRP."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const connectGoogleReadOnly = async () => {
    setNotice("");
    try {
      const response = await fetch(`${API_BASE}/admin/pnl/authorization-url`, { credentials: "include", cache: "no-store" });
      const body = await response.json() as { error?: string; authorizationUrl?: string };
      if (!response.ok || !body.authorizationUrl) throw new Error(body.error || "No se pudo preparar la conexión con Google.");
      window.location.assign(body.authorizationUrl);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "No se pudo preparar la conexión con Google.");
    }
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

  const rows = useMemo(() => view === "Comprar" ? snapshot?.buy : view === "Preparar" ? snapshot?.prepare : view === "Explosión y requerimientos" ? snapshot?.requirements : snapshot?.plan, [snapshot, view]);
  const table = view === "Plan semanal" ? (
    <DataTable rows={rows ?? []} columns={[["product", "Producto"], ["stock", "Stock"], ["safetyStock", "Seguridad"], ["confirmedOrder", "Pedido"], ["suggestedProduction", "Sugerido"], ["finalProduction", "Final"], ["status", "Estado"]]} />
  ) : (
    <DataTable rows={rows ?? []} columns={view === "Explosión y requerimientos" ? [["item", "Insumo / subreceta"], ["category", "Categoría"], ["directRequirement", "Nivel directo"], ["subrecipeRequirement", "Por subrecetas"], ["required", "Requerido total"], ["stock", "Stock"], ["netNeed", "Necesidad"], ["action", "Acción"]] : [["item", "Insumo / subreceta"], ["category", "Categoría"], ["required", "Requerido"], ["stock", "Stock"], ["netNeed", "Necesidad"], ["suggestedQuantity", "Cantidad sugerida"], ["provider", "Proveedor"], ["status", "Estado"]]} />
  );

  return <div className={styles.panel}>
    <Heading k="ADMINISTRACIÓN · ABASTECIMIENTO" h="MRP semanal" p="Planificación, requerimientos y seguimiento de compras desde la base operativa del sistema." />
    <div className={styles.notice}><div><strong>Recetario importado a la base del sistema</strong><p>La sincronización guarda insumos, recetas, componentes, rendimientos y costos en la base propia. Google Sheets queda protegida como fuente de lectura y nunca recibe cambios desde esta pantalla.</p>{(!googleConnected || (!snapshot && !loading)) && <button type="button" className={styles.button} onClick={() => void connectGoogleReadOnly()}>Conectar lectura de Google</button>}</div><span className={styles.status}><span className={styles.dot} />{updatedAt ? `Importado ${updatedAt}` : loading ? "Actualizando…" : googleConnected ? "Preparando importación…" : "Conexión de Google pendiente"}</span></div>
    {error && <div className={styles.error}>{error}</div>}
    {notice && <div className={styles.notice}><strong>{notice}</strong></div>}
    <div className={styles.metrics}>
      <Metric label="Costo neto estimado" value={snapshot ? money.format(snapshot.kpis.estimatedNetCost) : "—"} />
      <Metric label="Ítems a comprar" value={snapshot?.kpis.buyItems ?? "—"} />
      <Metric label="Subrecetas a preparar" value={snapshot?.kpis.prepareItems ?? "—"} />
      <Metric label="Alertas operativas" value={snapshot?.kpis.alerts ?? "—"} />
    </div>
    <div className={styles.tabs}>{["Plan semanal", "Comprar", "Preparar", "Explosión y requerimientos", "Recetas y costos", "Operación", "Validación"].map((item) => <button key={item} onClick={() => setView(item)} className={`${styles.tab} ${view === item ? styles.tabActive : ""}`}>{item}</button>)}</div>
    {view === "Operación" ? <OperationPanel {...{ orders, controls, orderForm, setOrderForm, controlForm, setControlForm, submitOrder, submitControl, receiptByOrder, setReceiptByOrder, submitReceipt }} /> : view === "Recetas y costos" ? <RecipesPanel snapshot={snapshot} /> : view === "Validación" ? <ValidationPanel snapshot={snapshot} /> : <section className={styles.card}><div className={styles.cardHeader}><div><strong>{view}</strong><p>{loading ? "Leyendo la última copia válida…" : `${rows?.length ?? 0} registros visibles`}</p></div></div>{table}</section>}
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
function OperationPanel({ orders, controls, orderForm, setOrderForm, controlForm, setControlForm, submitOrder, submitControl, receiptByOrder, setReceiptByOrder, submitReceipt }: OperationPanelProps) {
  return <section className={styles.card}><div className={styles.cardHeader}><div><strong>Órdenes, recepciones y control</strong><p>Estos registros viven en la base del sistema y nunca en la planilla original.</p></div></div><div className={styles.forms}>
    <form className={styles.form} onSubmit={submitOrder}><strong>Nueva orden interna</strong><div className={styles.formGrid}><label>Insumo<input required value={orderForm.itemName} onChange={(e) => setOrderForm({ ...orderForm, itemName: e.target.value })} /></label><label>Proveedor<input value={orderForm.providerName} onChange={(e) => setOrderForm({ ...orderForm, providerName: e.target.value })} /></label><label>Unidad<input required value={orderForm.unit} onChange={(e) => setOrderForm({ ...orderForm, unit: e.target.value })} /></label><label>Cantidad<input required min="0.0001" step="0.0001" type="number" value={orderForm.quantity} onChange={(e) => setOrderForm({ ...orderForm, quantity: e.target.value })} /></label></div><button className={styles.button}>Guardar orden</button></form>
    <form className={styles.form} onSubmit={submitControl}><strong>Control semanal</strong><div className={styles.formGrid}><label>Semana (AAAA-S##)<input required placeholder="2026-S37" value={controlForm.weekKey} onChange={(e) => setControlForm({ ...controlForm, weekKey: e.target.value })} /></label><label>Insumo<input required value={controlForm.itemName} onChange={(e) => setControlForm({ ...controlForm, itemName: e.target.value })} /></label><label>Esperado<input required min="0" step="0.0001" type="number" value={controlForm.expectedQuantity} onChange={(e) => setControlForm({ ...controlForm, expectedQuantity: e.target.value })} /></label><label>Real<input required min="0" step="0.0001" type="number" value={controlForm.actualQuantity} onChange={(e) => setControlForm({ ...controlForm, actualQuantity: e.target.value })} /></label></div><button className={styles.button}>Guardar control</button></form>
  </div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Orden</th><th>Insumo</th><th>Proveedor</th><th>Cantidad</th><th>Recibido</th><th>Estado</th><th>Registrar recepción</th></tr></thead><tbody>{orders.map((order: Order) => <tr key={order.id}><td>#{order.id}</td><td>{order.item_name}</td><td>{order.provider_name || "—"}</td><td className={styles.amount}>{quantity(order.quantity)} {order.unit}</td><td className={styles.amount}>{quantity(order.received_quantity)}</td><td><span className={styles.tag}>{order.status}</span></td><td><div className={styles.receipt}><input aria-label={`Cantidad recibida orden ${order.id}`} min="0.0001" step="0.0001" type="number" value={receiptByOrder[order.id] ?? ""} onChange={(event) => setReceiptByOrder((current) => ({ ...current, [order.id]: event.target.value }))} /><button type="button" className={styles.button} onClick={() => void submitReceipt(order.id)}>Recibir</button></div></td></tr>)}</tbody></table>{!orders.length && <div className={styles.empty}>Todavía no hay órdenes internas.</div>}</div>{controls.length > 0 && <div className={styles.cardHeader}><strong>{controls.length} controles semanales registrados</strong></div>}</section>;
}
function ValidationPanel({ snapshot }: { snapshot: MrpSnapshot | null }) {
  const validation = snapshot?.validation;
  const recipes = snapshot?.recipeValidation;
  const differences = [...(validation?.differences ?? []), ...(recipes?.differences ?? [])];
  return <section className={styles.card}><div className={styles.cardHeader}><div><strong>Comparación técnica con la planilla</strong><p>Se recalculan el plan semanal y las cantidades por unidad de cada receta, sin modificar Google Sheets.</p></div></div><div className={styles.forms}><div className={styles.form}><strong>{validation?.status === "ok" && recipes?.status === "ok" ? "Validación técnica correcta" : "Hay diferencias para revisar"}</strong><p>Plan: {validation?.checkedLines ?? 0} líneas. Recetas: {recipes?.checkedLines ?? 0} componentes en {recipes?.checkedRecipes ?? 0} recetas.</p></div><div className={styles.form}><strong>Costos disponibles</strong><p>{recipes?.costedRecipes ?? 0} recetas tienen costo completo. {recipes?.missingCostInputs.length ?? 0} insumos requieren precio o revisión en la planilla.</p><strong className={styles.inlineTitle}>Aprobación de Gerencia: pendiente</strong><p>La validación técnica confirma fórmulas y referencias; Gerencia debe aprobar una corrida real antes de tomar decisiones de costo.</p></div></div>{differences.length ? <DataTable rows={differences} columns={[["recipe", "Receta / producto"], ["ingredient", "Insumo"], ["expected", "Esperado"], ["actual", "Planilla"], ["reason", "Motivo"]]} /> : null}</section>;
}

function RecipesPanel({ snapshot }: { snapshot: MrpSnapshot | null }) {
  const [selected, setSelected] = useState("");
  const recipes = snapshot?.recipes ?? [];
  const recipe = recipes.find((item) => item.recipe === selected) ?? recipes[0];
  useEffect(() => { if (!selected && recipes[0]) setSelected(recipes[0].recipe); }, [recipes, selected]);
  if (!recipes.length) return <section className={styles.card}><div className={styles.empty}>No hay recetario disponible todavía. Actualizá el MRP cuando exista una conexión autorizada con la planilla.</div></section>;
  return <section className={styles.card}><div className={styles.cardHeader}><div><strong>Recetas y costos</strong><p>El recetario está guardado en la base del sistema. Un costo solo se calcula cuando todos sus insumos y subrecetas tienen un precio válido.</p></div><label className={styles.recipePicker}>Receta<select value={recipe?.recipe ?? ""} onChange={(event) => setSelected(event.target.value)}>{recipes.map((item) => <option key={item.recipe}>{item.recipe}</option>)}</select></label></div>{recipe && <><div className={styles.recipeMetrics}><Metric label="Rendimiento" value={recipe.yield ?? "—"} /><Metric label="Componentes" value={recipe.components} /><Metric label="Costo por unidad" value={recipe.costPerUnit === null ? "Pendiente" : money.format(recipe.costPerUnit)} /><Metric label="Estado" value={recipe.costStatus} /></div>{recipe.missingCosts.length > 0 && <div className={styles.warning}><strong>Faltan costos que completar:</strong> {recipe.missingCosts.join(", ")}</div>}<DataTable rows={recipe.items} columns={[["ingredient", "Insumo / subreceta"], ["type", "Tipo"], ["quantity", "Cantidad lote"], ["unit", "Unidad"], ["yield", "Rendimiento"], ["perUnit", "Cantidad por unidad"], ["dictionaryCheck", "Control"]]} /></>}</section>;
}
