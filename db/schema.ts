import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

export const catalogRevisions = sqliteTable("catalog_revisions", {
  revision: integer("revision").primaryKey(),
  documentJson: text("document_json").notNull(),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull(),
});
