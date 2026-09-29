import type { Product, PriceChange } from "../shared/types";

export type CatalogDocument = { revision: number; products: Product[]; priceChanges: PriceChange[]; updatedAt?: string };

// Tres dígitos conservan los ceros y evitan lecturas parciales de códigos más largos.
export const normalizeBarcode = (value: string) => {
  const text = value.trim().toUpperCase();
  const match = text.match(/^(?:LART[-'’_\s]*)?(\d{3})$/);
  return match ? `LART-${match[1]}` : null;
};

export function findScannedProduct(products: Product[], value: string) {
  const text = value.trim().toUpperCase();
  const barcode = normalizeBarcode(text.match(/LART[-'’_\s]*\d{3}$/)?.[0] ?? text);
  return barcode ? products.find((p) => p.barcode === barcode || p.barcodeAliases?.includes(barcode)) : undefined;
}

export function validateCatalog(next: Product[], previous: Product[]): Product[] {
  if (!Array.isArray(next) || !next.length || next.length > 999) throw new Error("El catálogo debe contener entre 1 y 999 productos.");
  const ids = new Set<number>();
  const codes = new Map<string, number>();
  const prior = new Map(previous.map((p) => [p.id, p]));
  const maxId = Math.max(0, ...previous.map((p) => p.id));
  let nextId = maxId + 1;
  const result = next.map((p) => {
    if (!p || !Number.isSafeInteger(p.id) || p.id < 1 || ids.has(p.id)) throw new Error("Identificador de producto inválido o duplicado.");
    ids.add(p.id);
    const old = prior.get(p.id);
    if (!old && p.id !== nextId++) throw new Error("Recargá el catálogo para asignar el nuevo producto.");
    for (const field of ["name", "detail", "category"] as const) {
      if (typeof p[field] !== "string" || !p[field].trim() || p[field].length > 180) throw new Error("Completá nombre, presentación y categoría (máximo 180 caracteres).");
    }
    if (!Number.isFinite(p.price) || p.price < 0 || p.price > 100000000 || !Number.isFinite(p.onlinePrice) || p.onlinePrice! < 0 || p.onlinePrice! > 100000000) throw new Error("Ingresá precios válidos, mayores o iguales a cero.");
    const barcode = normalizeBarcode(p.barcode);
    if (!barcode) throw new Error("Usá LART- y tres dígitos, por ejemplo LART-501.");
    // Las etiquetas anteriores siguen perteneciendo a su producto original.
    const aliases = [...new Set([...(old?.barcodeAliases ?? []), ...(old && old.barcode !== barcode ? [old.barcode] : [])])].filter((b) => b !== barcode);
    for (const code of [barcode, ...aliases]) {
      if (codes.has(code) && codes.get(code) !== p.id) throw new Error(`El código ${code} ya pertenece a otro producto o a una etiqueta anterior.`);
      codes.set(code, p.id);
    }
    return { id: p.id, name: p.name.trim(), detail: p.detail.trim(), category: p.category.trim(), price: Math.round(p.price * 100) / 100, onlinePrice: Math.round(p.onlinePrice! * 100) / 100, code: barcode.slice(5), barcode, barcodeAliases: aliases };
  });
  if (previous.some((p) => !ids.has(p.id))) throw new Error("No se pueden eliminar productos con historial del catálogo.");
  return result;
}
