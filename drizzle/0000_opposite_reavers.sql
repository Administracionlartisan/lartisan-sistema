CREATE TABLE `catalog_revisions` (
	`revision` integer PRIMARY KEY NOT NULL,
	`document_json` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL
);
