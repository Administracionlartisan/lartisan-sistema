import type { CatalogDocument } from "../app/modules/config/catalogModel";

export async function readCatalog(db: D1Database): Promise<CatalogDocument | null> {
  const row = await db.prepare("SELECT revision, document_json, created_at FROM catalog_revisions ORDER BY revision DESC LIMIT 1").first<{ revision: number; document_json: string; created_at: string }>();
  return row ? { ...JSON.parse(row.document_json), revision: row.revision, updatedAt: row.created_at } : null;
}

export async function appendCatalog(db: D1Database, doc: CatalogDocument, actor: string): Promise<void> {
  // La PK serializa escrituras concurrentes. Cada versión es un respaldo completo.
  await db.prepare("INSERT INTO catalog_revisions (revision, document_json, actor, created_at) VALUES (?, ?, ?, ?)")
    .bind(doc.revision, JSON.stringify({ products: doc.products, priceChanges: doc.priceChanges }), actor, doc.updatedAt).run();
}
