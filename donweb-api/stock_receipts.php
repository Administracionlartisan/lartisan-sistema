<?php
declare(strict_types=1);

// Las revisiones son independientes del estado operativo: nunca modifican stock.
function ensure_stock_receipt_review_schema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS stock_receipt_review_events (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        movement_id CHAR(36) NOT NULL, site VARCHAR(80) NOT NULL,
        status VARCHAR(20) NOT NULL, observation VARCHAR(500) NOT NULL,
        reviewer_id INT NOT NULL, reviewer_name VARCHAR(190) NOT NULL,
        reviewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_receipt_review_movement (movement_id, id),
        INDEX idx_receipt_review_site (site, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}
