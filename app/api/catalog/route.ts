import { env } from "cloudflare:workers";
import { PRODUCTS } from "../../modules/config/operationalCatalog";
import { validateCatalog, type CatalogDocument } from "../../modules/config/catalogModel";
import { API_BASE } from "../../modules/shared/constants";
import type { ApiUser, OperationalSnapshot } from "../../modules/shared/types";
import { readCatalog, appendCatalog } from "../../../db/catalogStore";

export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
const database = () => (env as unknown as { DB: D1Database }).DB;

async function upstream(path: "auth/me" | "operations/states", cookie: string) {
  const options: RequestInit = { headers: { Cookie: cookie }, redirect: "manual", signal: AbortSignal.timeout(15000) };
  const response = await fetch(`${API_BASE}/${path}`, options);
  // No degradar a HTTP ni omitir la validación TLS para reenviar una sesión.
  if (response.status === 525 || response.status === 526) throw new CatalogConnectionError();
  return response;
}

class CatalogConnectionError extends Error {
  constructor() { super("El catálogo no puede conectarse de forma segura al servidor. Es necesario revisar su certificado de conexión."); }
}

async function identity(request: Request): Promise<{ user: ApiUser; cookie: string } | Response> {
  const cookie = request.headers.get("cookie")?.split(";").map((v) => v.trim()).find((v) => /^lartisan_session=[a-f0-9]+$/i.test(v));
  if (!cookie) return json({ error: "Sesión requerida." }, 401);
  // workerd admite "manual", no "error". Nunca seguir redirecciones con la cookie.
  const response = await upstream("auth/me", cookie);
  if (!response.ok) {
    if (response.status !== 401) console.error("catalog_identity_rejected", JSON.stringify({ status: response.status, contentType: response.headers.get("content-type"), server: response.headers.get("server") }));
    return json({ error: "No se pudo validar la sesión." }, response.status === 401 ? 401 : 503);
  }
  const data = await response.json() as { user?: ApiUser };
  if (!data.user || data.user.mustChangePassword || data.user.must_change_password) return json({ error: "Primero completá el cambio de contraseña." }, 403);
  return { user: data.user, cookie };
}

async function initialCatalog(cookie: string): Promise<CatalogDocument> {
  // Solo se usa antes del primer guardado central. Recupera los precios vigentes.
  const response = await upstream("operations/states", cookie);
  if (!response.ok) throw new Error("No se recuperaron los precios actuales.");
  const data = await response.json() as { states?: Record<string, { state: OperationalSnapshot }> };
  const configuration = Object.values(data.states ?? {}).find((v) => v.state.prices)?.state;
  const validPrice = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
  return {
    revision: 0,
    products: PRODUCTS.map((p) => ({ ...p, price: validPrice(configuration?.prices?.[p.id], p.price), onlinePrice: validPrice(configuration?.onlinePrices?.[p.id], Math.round(p.price * 1.25)), barcodeAliases: p.code === "501" ? ["LART-401"] : [] })),
    priceChanges: configuration?.priceChanges ?? [],
  };
}

export async function GET(request: Request) {
  try {
    const auth = await identity(request);
    if (auth instanceof Response) return auth;
    return json(await readCatalog(database()) ?? await initialCatalog(auth.cookie));
  } catch (error) {
    console.error("catalog_load_failed", error instanceof Error ? error.message : "unknown_error");
    return json({ error: error instanceof CatalogConnectionError ? error.message : "No se pudo cargar el catálogo central. Intentá nuevamente." }, 503);
  }
}

export async function PUT(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Origen no autorizado." }, 403);
    const auth = await identity(request);
    if (auth instanceof Response) return auth;
    if (auth.user.role !== "administracion") return json({ error: "Solo Administración puede modificar el catálogo." }, 403);
    const text = await request.text();
    if (text.length > 1000000) return json({ error: "El catálogo supera el tamaño permitido." }, 413);
    let body: CatalogDocument;
    try { body = JSON.parse(text); } catch { return json({ error: "Datos inválidos." }, 422); }
    const current = await readCatalog(database()) ?? await initialCatalog(auth.cookie);
    if (body.revision !== current.revision) return json({ error: "Otra persona actualizó el catálogo. Recargá el catálogo y revisá tus cambios antes de guardar." }, 409);
    let products;
    try { products = validateCatalog(body.products, current.products); } catch (error) { return json({ error: (error as Error).message }, 422); }
    const priceChanges = Array.isArray(body.priceChanges) ? body.priceChanges : current.priceChanges;
    const doc = { revision: current.revision + 1, products, priceChanges, updatedAt: new Date().toISOString() };
    try { await appendCatalog(database(), doc, String(auth.user.id)); }
    catch (error) {
      if (String(error).includes("UNIQUE constraint")) return json({ error: "Otro equipo guardó cambios. Recargá el catálogo antes de reintentar." }, 409);
      throw error;
    }
    return json(doc);
  } catch (error) {
    console.error("catalog_save_failed", error instanceof Error ? error.message : "unknown_error");
    return json({ error: error instanceof CatalogConnectionError ? error.message : "No se confirmó el guardado. Recargá el catálogo para comprobarlo; tus cambios siguen en el formulario." }, 503);
  }
}
