"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PRODUCTS } from "./operationalCatalog";
import type { CatalogDocument } from "./catalogModel";
import type { Product } from "../shared/types";

const seed: CatalogDocument = {
  revision: -1,
  products: PRODUCTS.map((p) => ({ ...p, onlinePrice: Math.round(p.price * 1.25), barcodeAliases: p.code === "501" ? ["LART-401"] : [] })),
  priceChanges: [],
};

export function useCatalog(userId?: string) {
  const [document, setDocument] = useState(seed);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = useRef(seed);
  const saving = useRef(false);
  const generation = useRef(0);
  const accept = useCallback((doc: CatalogDocument) => {
    if (doc.revision < current.current.revision) return;
    if (doc.revision !== current.current.revision) {
      current.current = doc;
      setDocument(doc);
    }
    setReady(true);
    setError("");
  }, []);
  const reload = useCallback(async () => {
    if (!userId || saving.current) return;
    const session = generation.current;
    try {
      const response = await fetch("/api/catalog", { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(20000) });
      const doc = await response.json() as CatalogDocument & { error?: string };
      if (!response.ok || !Array.isArray(doc.products)) throw new Error(doc.error || "No se pudo cargar el catálogo central.");
      if (session === generation.current && !saving.current) accept(doc);
    } catch (cause) {
      if (session === generation.current) setError(cause instanceof Error ? cause.message : "No se pudo actualizar el catálogo.");
    }
  }, [userId, accept]);
  useEffect(() => {
    generation.current += 1;
    current.current = seed;
    setDocument(seed);
    setReady(false);
    setError("");
    if (!userId) return;
    void reload();
    const refresh = () => { if (window.document.visibilityState === "visible") void reload(); };
    const interval = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => { generation.current += 1; window.clearInterval(interval); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); };
  }, [userId, reload]);
  const save = async (products: Product[], priceChanges = current.current.priceChanges, expectedRevision = current.current.revision) => {
    if (saving.current) throw new Error("Ya hay un guardado en curso.");
    if (!ready || expectedRevision !== current.current.revision) throw new Error("El catálogo cambió o no terminó de cargar. Cancelá la edición y volvé a abrir el producto.");
    saving.current = true;
    setBusy(true);
    const session = generation.current;
    try {
      const response = await fetch("/api/catalog", { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: expectedRevision, products, priceChanges }), signal: AbortSignal.timeout(25000) });
      const doc = await response.json() as CatalogDocument & { error?: string };
      if (!response.ok) throw new Error(doc.error || "No se confirmó el guardado. Recargá el catálogo para comprobarlo.");
      if (session !== generation.current) throw new Error("La sesión cambió. Volvé a ingresar para verificar el guardado.");
      accept(doc);
      return doc;
    } finally { saving.current = false; setBusy(false); }
  };
  return { document, ready, busy, error, reload, save };
}
