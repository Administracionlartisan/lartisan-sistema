<?php

declare(strict_types=1);

const MRP_SPREADSHEET_ID = '1o0bcoAJUdCQ7VLskOSEM94ieBb1KHcd5O_Rz7h972fY';

function ensure_mrp_schema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS mrp_sync_runs (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        status VARCHAR(20) NOT NULL,
        source_spreadsheet_id VARCHAR(128) NOT NULL,
        payload_json LONGTEXT NULL,
        payload_hash CHAR(64) NULL,
        rows_imported INT UNSIGNED NOT NULL DEFAULT 0,
        triggered_by BIGINT UNSIGNED NULL,
        error_message VARCHAR(1000) NULL,
        started_at DATETIME NOT NULL,
        finished_at DATETIME NULL,
        INDEX idx_mrp_sync_status_date (status, started_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS mrp_purchase_orders (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        source_order_id VARCHAR(100) NULL,
        item_name VARCHAR(190) NOT NULL,
        provider_name VARCHAR(190) NULL,
        unit VARCHAR(40) NOT NULL,
        quantity DECIMAL(14,4) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'Por pedir',
        notes VARCHAR(1000) NULL,
        row_version INT UNSIGNED NOT NULL DEFAULT 1,
        created_by BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_mrp_orders_status_date (status, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS mrp_receipts (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        purchase_order_id BIGINT UNSIGNED NOT NULL,
        quantity_received DECIMAL(14,4) NOT NULL,
        notes VARCHAR(1000) NULL,
        received_by BIGINT UNSIGNED NOT NULL,
        received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_mrp_receipts_order (purchase_order_id, received_at),
        CONSTRAINT fk_mrp_receipts_order FOREIGN KEY (purchase_order_id) REFERENCES mrp_purchase_orders(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS mrp_weekly_controls (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        week_key VARCHAR(20) NOT NULL,
        item_name VARCHAR(190) NOT NULL,
        expected_quantity DECIMAL(14,4) NOT NULL DEFAULT 0,
        actual_quantity DECIMAL(14,4) NOT NULL DEFAULT 0,
        status VARCHAR(60) NOT NULL DEFAULT 'Pendiente',
        notes VARCHAR(1000) NULL,
        row_version INT UNSIGNED NOT NULL DEFAULT 1,
        updated_by BIGINT UNSIGNED NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_mrp_control_week_item (week_key, item_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    // Catálogo propio del sistema. Google Sheets se utiliza únicamente como fuente
    // de importación; la operación diaria y los informes no dependen de editarla.
    $pdo->exec("CREATE TABLE IF NOT EXISTS mrp_input_catalog (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        source_key VARCHAR(190) NOT NULL,
        source_code VARCHAR(100) NULL,
        item_name VARCHAR(190) NOT NULL,
        category_name VARCHAR(190) NULL,
        stock_unit VARCHAR(40) NULL,
        unit_cost DECIMAL(16,4) NULL,
        provider_name VARCHAR(190) NULL,
        source_run_id BIGINT UNSIGNED NOT NULL,
        imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_mrp_input_catalog_key (source_key),
        INDEX idx_mrp_input_catalog_run (source_run_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS mrp_recipe_catalog (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        source_key VARCHAR(190) NOT NULL,
        recipe_name VARCHAR(190) NOT NULL,
        yield_quantity DECIMAL(16,4) NULL,
        component_count INT UNSIGNED NOT NULL DEFAULT 0,
        cost_per_unit DECIMAL(16,4) NULL,
        cost_status VARCHAR(60) NOT NULL,
        missing_costs_json TEXT NULL,
        source_run_id BIGINT UNSIGNED NOT NULL,
        imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_mrp_recipe_catalog_key (source_key),
        INDEX idx_mrp_recipe_catalog_run (source_run_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS mrp_recipe_components (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        recipe_id BIGINT UNSIGNED NOT NULL,
        source_line INT UNSIGNED NOT NULL,
        component_name VARCHAR(190) NOT NULL,
        component_key VARCHAR(190) NOT NULL,
        component_type VARCHAR(80) NULL,
        batch_quantity DECIMAL(16,4) NOT NULL DEFAULT 0,
        unit_name VARCHAR(40) NULL,
        yield_quantity DECIMAL(16,4) NULL,
        quantity_per_unit DECIMAL(16,6) NOT NULL DEFAULT 0,
        expected_per_unit DECIMAL(16,6) NOT NULL DEFAULT 0,
        dictionary_check VARCHAR(120) NULL,
        unit_check VARCHAR(120) NULL,
        source_run_id BIGINT UNSIGNED NOT NULL,
        imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_mrp_recipe_component_line (recipe_id, source_line),
        INDEX idx_mrp_recipe_component_key (component_key),
        INDEX idx_mrp_recipe_component_run (source_run_id),
        CONSTRAINT fk_mrp_recipe_components_recipe FOREIGN KEY (recipe_id) REFERENCES mrp_recipe_catalog(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

function require_mrp_user(PDO $pdo): array
{
    $user = require_user($pdo, ['administracion', 'supervisora', 'compras']);
    if (!user_can_action($user, 'mrp')) json_response(['ok' => false, 'error' => 'No tenés permiso para consultar MRP'], 403);
    return $user;
}

function mrp_number($value): float
{
    $raw = trim((string) $value);
    if ($raw === '') return 0.0;
    $raw = preg_replace('/[^0-9,\.\-]/', '', $raw) ?? '';
    // Compatible with the PHP version installed on the shared hosting (PHP 7.x).
    if (strpos($raw, ',') !== false && strpos($raw, '.') !== false) $raw = str_replace('.', '', $raw);
    if (strpos($raw, ',') !== false) $raw = str_replace(',', '.', $raw);
    return is_numeric($raw) ? (float) $raw : 0.0;
}

// The shared hosting can run without mbstring. These fallbacks preserve the
// import instead of turning a missing optional extension into a failed run.
function mrp_lower(string $value): string
{
    return function_exists('mb_strtolower') ? mb_strtolower($value, 'UTF-8') : strtolower($value);
}

function mrp_upper(string $value): string
{
    return function_exists('mb_strtoupper') ? mb_strtoupper($value, 'UTF-8') : strtoupper($value);
}

function mrp_limit_text(string $value, int $length): string
{
    return function_exists('mb_substr') ? mb_substr($value, 0, $length, 'UTF-8') : substr($value, 0, $length);
}

function mrp_fetch_ranges(PDO $pdo, array $config): array
{
    $token = pnl_access_token($pdo, $config);
    $ranges = [
        "'00_Control_Semanal_MRP'!A1:D30",
        "'04_Plan_Produccion_Semanal'!A1:L500",
        "'05_Resumen_Compras_y_Produccion'!A1:U500",
        "'09_Lista_Compras_Operativa'!A1:U500",
        "'01_Diccionario_Insumos'!A1:U1015",
        "'02_Recetario_Maestro'!A1:J1000",
    ];
    $query = implode('&', array_map(static fn (string $range): string => 'ranges=' . rawurlencode($range), $ranges));
    $url = 'https://sheets.googleapis.com/v4/spreadsheets/' . rawurlencode(MRP_SPREADSHEET_ID) . '/values:batchGet?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE&' . $query;
    $response = pnl_http($url, ['headers' => ['Authorization: Bearer ' . $token]]);
    $valueRanges = $response['json']['valueRanges'] ?? null;
    if ($response['status'] !== 200 || !is_array($valueRanges) || count($valueRanges) !== count($ranges)) {
        throw new RuntimeException('Google no devolvió una copia válida del MRP.');
    }
    return array_map(static fn (array $range): array => is_array($range['values'] ?? null) ? $range['values'] : [], $valueRanges);
}

function mrp_key($value): string
{
    $text = mrp_lower(trim((string) $value));
    $text = strtr($text, ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u']);
    return preg_replace('/\s+/', ' ', $text) ?? '';
}

function mrp_recipe_snapshot(array $dictionaryValues, array $recipeValues): array
{
    $dictionary = mrp_rows($dictionaryValues, 0, [
        'code' => 'Código', 'item' => 'Nombre', 'category' => 'Categoría', 'unit' => 'Unidad stock/compra',
        'unitCost' => 'Costo Unitario', 'provider' => 'Proveedor',
    ], 1100);
    $costs = [];
    foreach ($dictionary as $row) {
        $key = mrp_key($row['item'] ?? '');
        if ($key === '') continue;
        $cost = mrp_number($row['unitCost'] ?? 0);
        $costs[$key] = [
            'sourceKey' => $key,
            'code' => trim((string) ($row['code'] ?? '')),
            'item' => trim((string) ($row['item'] ?? '')),
            'category' => trim((string) ($row['category'] ?? '')),
            'unit' => trim((string) ($row['unit'] ?? '')),
            'unitCost' => $cost > 0 ? $cost : null,
            'provider' => trim((string) ($row['provider'] ?? '')),
        ];
    }
    $recipeRows = mrp_rows($recipeValues, 0, [
        'recipe' => 'Artículo o Subreceta', 'ingredient' => 'Insumo', 'batchQuantity' => 'Cantidad Lote',
        'unit' => 'Unidad', 'yield' => 'Rendimiento', 'perUnit' => 'Cantidad x Unidad Final',
        'type' => 'Tipo', 'status' => 'Estado / Alerta', 'dictionaryCheck' => 'Control Diccionario', 'unitCheck' => 'Control Unidad',
    ], 1100);
    $recipes = [];
    foreach ($recipeRows as $row) {
        $recipe = trim((string) ($row['recipe'] ?? ''));
        $ingredient = trim((string) ($row['ingredient'] ?? ''));
        if ($recipe === '' || $ingredient === '') continue;
        $batch = mrp_number($row['batchQuantity'] ?? 0);
        $yield = mrp_number($row['yield'] ?? 0);
        $perUnit = mrp_number($row['perUnit'] ?? 0);
        $expectedPerUnit = $yield > 0 ? $batch / $yield : $batch;
        $key = mrp_key($recipe);
        $recipes[$key] ??= ['recipe' => $recipe, 'yield' => $yield ?: null, 'items' => []];
        if (($recipes[$key]['yield'] ?? null) === null && $yield > 0) $recipes[$key]['yield'] = $yield;
        $recipes[$key]['items'][] = [
            'sourceLine' => count($recipes[$key]['items']) + 1,
            'ingredient' => $ingredient,
            'quantity' => $batch,
            'unit' => trim((string) ($row['unit'] ?? '')),
            'yield' => $yield ?: null,
            'perUnit' => $perUnit,
            'expectedPerUnit' => $expectedPerUnit,
            'type' => trim((string) ($row['type'] ?? '')),
            'dictionaryCheck' => trim((string) ($row['dictionaryCheck'] ?? '')),
            'unitCheck' => trim((string) ($row['unitCheck'] ?? '')),
        ];
    }
    $memo = [];
    $calculate = function (string $recipeKey, array $stack = []) use (&$calculate, &$memo, $recipes, $costs): array {
        if (isset($memo[$recipeKey])) return $memo[$recipeKey];
        if (isset($stack[$recipeKey])) return ['cost' => null, 'missing' => ['Ciclo de subrecetas'], 'cycle' => true];
        $recipe = $recipes[$recipeKey] ?? null;
        if (!$recipe) return ['cost' => null, 'missing' => ['Receta no encontrada'], 'cycle' => false];
        $stack[$recipeKey] = true;
        $cost = 0.0; $missing = [];
        foreach ($recipe['items'] as $item) {
            $ingredientKey = mrp_key($item['ingredient']);
            $isSubrecipe = strpos(mrp_lower((string) $item['type']), 'subreceta') !== false;
            if ($isSubrecipe) {
                $child = $calculate($ingredientKey, $stack);
                if ($child['cost'] === null) { $missing = array_merge($missing, $child['missing']); continue; }
                $cost += $item['perUnit'] * $child['cost'];
                continue;
            }
            $unitCost = $costs[$ingredientKey]['unitCost'] ?? null;
            if ($unitCost === null) { $missing[] = $item['ingredient']; continue; }
            $cost += $item['perUnit'] * $unitCost;
        }
        return $memo[$recipeKey] = ['cost' => $missing ? null : round($cost, 4), 'missing' => array_values(array_unique($missing)), 'cycle' => false];
    };
    $summary = []; $lineDifferences = []; $missingCosts = [];
    foreach ($recipes as $recipeKey => $recipe) {
        $result = $calculate($recipeKey);
        foreach ($recipe['items'] as $item) {
            if (abs($item['perUnit'] - $item['expectedPerUnit']) > 0.0001) {
                $lineDifferences[] = ['recipe' => $recipe['recipe'], 'ingredient' => $item['ingredient'], 'expected' => $item['expectedPerUnit'], 'actual' => $item['perUnit'], 'reason' => 'La cantidad por unidad no coincide con lote/rendimiento'];
            }
            if ($item['dictionaryCheck'] !== '' && strpos(mrp_upper($item['dictionaryCheck']), 'OK') !== 0) {
                $lineDifferences[] = ['recipe' => $recipe['recipe'], 'ingredient' => $item['ingredient'], 'expected' => 'En diccionario', 'actual' => $item['dictionaryCheck'], 'reason' => 'Control de diccionario'];
            }
            if ($item['unitCheck'] !== '' && strpos(mrp_upper($item['unitCheck']), 'OK') !== 0) {
                $lineDifferences[] = ['recipe' => $recipe['recipe'], 'ingredient' => $item['ingredient'], 'expected' => 'Unidad válida', 'actual' => $item['unitCheck'], 'reason' => 'Control de unidad'];
            }
        }
        foreach ($result['missing'] as $missing) $missingCosts[$missing] = true;
        $summary[] = [
            'sourceKey' => $recipeKey,
            'recipe' => $recipe['recipe'], 'yield' => $recipe['yield'], 'components' => count($recipe['items']),
            'costPerUnit' => $result['cost'], 'costStatus' => $result['cost'] === null ? 'Pendiente de costo' : 'Calculado',
            'missingCosts' => $result['missing'], 'items' => $recipe['items'],
        ];
    }
    usort($summary, static fn (array $a, array $b): int => strnatcasecmp($a['recipe'], $b['recipe']));
    return [
        'recipes' => $summary,
        'inputs' => array_values($costs),
        'recipeValidation' => [
            'status' => count($lineDifferences) === 0 ? 'ok' : 'differences',
            'checkedLines' => count($recipeRows), 'checkedRecipes' => count($summary),
            'costedRecipes' => count(array_filter($summary, static fn (array $recipe): bool => $recipe['costPerUnit'] !== null)),
            'missingCostInputs' => array_values(array_keys($missingCosts)), 'differences' => array_slice($lineDifferences, 0, 100),
        ],
    ];
}

/**
 * Persiste una copia normalizada e independiente del recetario. Esta rutina no
 * escribe en Google Sheets: sólo recibe el snapshot ya validado en memoria.
 */
function mrp_persist_master_data(PDO $pdo, array $snapshot, int $runId): void
{
    $ownsTransaction = !$pdo->inTransaction();
    if ($ownsTransaction) $pdo->beginTransaction();
    try {
        // El catálogo refleja exactamente la última importación verificada. Las
        // corridas completas anteriores permanecen auditables en mrp_sync_runs.
        $pdo->exec('DELETE FROM mrp_recipe_components');
        $pdo->exec('DELETE FROM mrp_recipe_catalog');
        $pdo->exec('DELETE FROM mrp_input_catalog');

        $input = $pdo->prepare('INSERT INTO mrp_input_catalog (source_key, source_code, item_name, category_name, stock_unit, unit_cost, provider_name, source_run_id, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())');
        foreach (($snapshot['inputs'] ?? []) as $row) {
            $input->execute([
                mrp_clean_text($row['sourceKey'] ?? mrp_key($row['item'] ?? ''), 190),
                mrp_clean_text($row['code'] ?? '', 100) ?: null,
                mrp_clean_text($row['item'] ?? '', 190),
                mrp_clean_text($row['category'] ?? '', 190) ?: null,
                mrp_clean_text($row['unit'] ?? '', 40) ?: null,
                isset($row['unitCost']) && $row['unitCost'] !== null ? (float) $row['unitCost'] : null,
                mrp_clean_text($row['provider'] ?? '', 190) ?: null,
                $runId,
            ]);
        }
        $recipe = $pdo->prepare('INSERT INTO mrp_recipe_catalog (source_key, recipe_name, yield_quantity, component_count, cost_per_unit, cost_status, missing_costs_json, source_run_id, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())');
        $component = $pdo->prepare('INSERT INTO mrp_recipe_components (recipe_id, source_line, component_name, component_key, component_type, batch_quantity, unit_name, yield_quantity, quantity_per_unit, expected_per_unit, dictionary_check, unit_check, source_run_id, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())');
        foreach (($snapshot['recipes'] ?? []) as $row) {
            $recipe->execute([
                mrp_clean_text($row['sourceKey'] ?? mrp_key($row['recipe'] ?? ''), 190),
                mrp_clean_text($row['recipe'] ?? '', 190),
                isset($row['yield']) && $row['yield'] !== null ? (float) $row['yield'] : null,
                (int) ($row['components'] ?? 0),
                isset($row['costPerUnit']) && $row['costPerUnit'] !== null ? (float) $row['costPerUnit'] : null,
                mrp_clean_text($row['costStatus'] ?? 'Pendiente de costo', 60),
                json_encode($row['missingCosts'] ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                $runId,
            ]);
            $recipeId = (int) $pdo->lastInsertId();
            foreach (($row['items'] ?? []) as $item) {
                $component->execute([
                    $recipeId, max(1, (int) ($item['sourceLine'] ?? 1)),
                    mrp_clean_text($item['ingredient'] ?? '', 190), mrp_clean_text(mrp_key($item['ingredient'] ?? ''), 190),
                    mrp_clean_text($item['type'] ?? '', 80) ?: null, (float) ($item['quantity'] ?? 0),
                    mrp_clean_text($item['unit'] ?? '', 40) ?: null,
                    isset($item['yield']) && $item['yield'] !== null ? (float) $item['yield'] : null,
                    (float) ($item['perUnit'] ?? 0), (float) ($item['expectedPerUnit'] ?? 0),
                    mrp_clean_text($item['dictionaryCheck'] ?? '', 120) ?: null,
                    mrp_clean_text($item['unitCheck'] ?? '', 120) ?: null, $runId,
                ]);
            }
        }
        if ($ownsTransaction) $pdo->commit();
    } catch (Throwable $error) {
        if ($ownsTransaction && $pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}

function mrp_rows(array $values, int $headerIndex, array $fields, int $limit = 300): array
{
    $header = $values[$headerIndex] ?? [];
    $positions = [];
    foreach ($fields as $key => $labels) {
        foreach ((array) $labels as $label) {
            $position = array_search($label, $header, true);
            if ($position !== false) { $positions[$key] = $position; break; }
        }
    }
    $rows = [];
    foreach (array_slice($values, $headerIndex + 1) as $row) {
        if (!is_array($row) || trim((string) ($row[0] ?? '')) === '') continue;
        $item = [];
        foreach ($positions as $key => $position) $item[$key] = $row[$position] ?? null;
        $rows[] = $item;
        if (count($rows) >= $limit) break;
    }
    return $rows;
}

function mrp_build_snapshot(array $ranges): array
{
    [$guide, $planValues, $summaryValues, $listValues, $dictionaryValues, $recipeValues] = $ranges;
    $plan = mrp_rows($planValues, 6, [
        'product' => 'Producto terminado', 'unit' => 'Unidad', 'stock' => 'Stock actual PT',
        'safetyStock' => 'Stock seguridad PT', 'confirmedOrder' => 'Pedido semanal confirmado',
        'suggestedProduction' => 'Producción sugerida', 'finalProduction' => 'Cantidad final a producir',
        'included' => 'Incluir en MRP', 'sentToMrp' => 'Cantidad enviada al MRP', 'status' => 'Estado', 'notes' => 'Observaciones',
    ]);
    $requirements = mrp_rows($summaryValues, 4, [
        'item' => 'Insumo / Subreceta', 'category' => 'Categoría', 'unit' => 'Unidad',
        'required' => 'Requerido Total', 'stock' => 'Stock Actual', 'safetyStock' => 'Stock Seguridad',
        'netNeed' => 'Necesidad Neta', 'unitCost' => 'Costo Unitario', 'estimatedCost' => 'Costo Necesidad',
        'action' => 'Acción', 'observation' => 'Observación', 'provider' => 'Proveedor',
        'directRequirement' => 'Requerido Nivel 0', 'subrecipeRequirement' => 'Requerido Subrecetas',
    ]);
    $operational = mrp_rows($listValues, 4, [
        'item' => ['Insumo / Subreceta', 'Insumo/Subreceta'], 'category' => 'Categoría', 'unit' => 'Unidad MRP',
        'required' => ['Requerido total', 'Requerido Total'], 'stock' => ['Stock actual', 'Stock Actual'],
        'safetyStock' => ['Stock seguridad', 'Stock Seguridad'], 'netNeed' => ['Necesidad neta', 'Necesidad Neta'],
        'action' => 'Acción MRP', 'provider' => 'Proveedor compra', 'suggestedQuantity' => 'Cantidad sugerida acción',
        'unitCost' => ['Costo unitario', 'Costo Unitario'], 'estimatedCost' => ['Costo estimado', 'Costo Estimado'],
        'status' => 'Estado operativo', 'notes' => 'Observaciones',
    ]);
    $buy = array_values(array_filter($operational, static fn (array $row): bool => mrp_upper(trim((string) ($row['action'] ?? ''))) === 'COMPRAR' && mrp_number($row['netNeed'] ?? 0) > 0));
    $prepare = array_values(array_filter($operational, static fn (array $row): bool => mrp_upper(trim((string) ($row['action'] ?? ''))) === 'PREPARAR' && mrp_number($row['netNeed'] ?? 0) > 0));
    $technicalChecks = [];
    foreach ($plan as $row) {
        $expected = max(0, mrp_number($row['safetyStock'] ?? 0) - mrp_number($row['stock'] ?? 0)) + mrp_number($row['confirmedOrder'] ?? 0);
        $actual = mrp_number($row['suggestedProduction'] ?? 0);
        if (abs($expected - $actual) > 0.001) $technicalChecks[] = ['recipe' => $row['product'] ?? '', 'expected' => $expected, 'actual' => $actual, 'reason' => 'El sugerido de origen difiere de seguridad menos stock más pedido'];
    }
    $recipeSnapshot = mrp_recipe_snapshot($dictionaryValues, $recipeValues);
    return array_merge([
        'source' => ['spreadsheetId' => MRP_SPREADSHEET_ID, 'title' => 'MRP LArtisan - OPERATIVO OPTIMIZADO', 'mode' => 'read_only'],
        'kpis' => ['estimatedNetCost' => mrp_number($summaryValues[2][1] ?? 0), 'buyItems' => count($buy), 'prepareItems' => count($prepare), 'alerts' => (int) mrp_number($summaryValues[2][7] ?? 0)],
        'weeklyGuide' => array_slice(array_values(array_filter(array_slice($guide, 4), static fn ($row): bool => is_array($row) && isset($row[0]) && is_numeric((string) $row[0]))), 0, 10),
        'plan' => $plan, 'requirements' => $requirements, 'buy' => $buy, 'prepare' => $prepare,
        'validation' => ['status' => count($technicalChecks) === 0 ? 'ok' : 'differences', 'checkedLines' => count($plan), 'differences' => array_slice($technicalChecks, 0, 20), 'managementApproval' => 'pending'],
    ], $recipeSnapshot);
}

/** Validate the exported copy before touching any live data. No Google calls. */
function mrp_snapshot_from_import(array $bundle): array
{
    if (($bundle['format'] ?? '') !== 'lartisan-mrp-once-v1'
        || ($bundle['sourceSpreadsheetId'] ?? '') !== MRP_SPREADSHEET_ID
        || !preg_match('/^[a-f0-9]{64}$/D', (string) ($bundle['sourceSha256'] ?? '')))
        throw new InvalidArgumentException('El archivo no es una copia MRP válida.');
    $tabs = ['00_Control_Semanal_MRP', '04_Plan_Produccion_Semanal', '05_Resumen_Compras_y_Produccion', '09_Lista_Compras_Operativa', '01_Diccionario_Insumos', '02_Recetario_Maestro'];
    $ranges = $bundle['ranges'] ?? null;
    if (($bundle['tabs'] ?? []) !== $tabs || !is_array($ranges) || count($ranges) !== 6)
        throw new InvalidArgumentException('Faltan hojas de la copia MRP.');
    foreach ($ranges as $rows) {
        if (!is_array($rows) || count($rows) > 2000) throw new InvalidArgumentException('Cantidad de filas no válida.');
        foreach ($rows as $row) {
            if (!is_array($row) || count($row) > 50) throw new InvalidArgumentException('Fila no válida.');
            foreach ($row as $value) {
                if (!(is_null($value) || is_string($value) || is_int($value) || is_float($value) || is_bool($value))
                    || (is_string($value) && strlen($value) > 4000)
                    || (is_float($value) && !is_finite($value)))
                    throw new InvalidArgumentException('Celda no válida.');
            }
        }
    }
    $required = [4 => ['Código', 'Nombre', 'Categoría', 'Unidad stock/compra', 'Costo Unitario', 'Proveedor'],
                 5 => ['Artículo o Subreceta', 'Insumo', 'Cantidad Lote', 'Unidad', 'Rendimiento', 'Cantidad x Unidad Final', 'Tipo', 'Control Diccionario', 'Control Unidad']];
    foreach ($required as $index => $headers) {
        if (array_diff($headers, $ranges[$index][0] ?? [])) throw new InvalidArgumentException('Encabezados de recetas o insumos incompletos.');
    }
    // Current mapper limits must never silently truncate a larger source.
    if (count($ranges[1]) > 307 || count($ranges[2]) > 305 || count($ranges[3]) > 305
        || count($ranges[4]) > 1101 || count($ranges[5]) > 1101)
        throw new InvalidArgumentException('La copia supera el tamaño admitido; requiere revisar el mapeo antes de importar.');
    $snapshot = mrp_build_snapshot($ranges);
    if (count($snapshot['inputs']) === 0 || count($snapshot['recipes']) === 0)
        throw new InvalidArgumentException('La copia no contiene recetas e insumos.');
    $names = [];
    foreach (array_slice($ranges[4], 1) as $row) {
        if (trim((string) ($row[0] ?? '')) === '') continue;
        $name = mrp_key($row[1] ?? '');
        if ($name === '' || isset($names[$name])) throw new InvalidArgumentException('Hay insumos sin nombre o duplicados.');
        $names[$name] = true;
    }
    $sourceLines = 0;
    foreach (array_slice($ranges[5], 1) as $row) {
        if (trim((string) ($row[0] ?? '')) === '') continue;
        if (trim((string) ($row[1] ?? '')) === '') throw new InvalidArgumentException('Hay una receta sin componente.');
        foreach ([2, 5] as $column) {
            if (!is_numeric($row[$column] ?? null) || (float) $row[$column] < 0)
                throw new InvalidArgumentException('Hay cantidades o rendimientos no válidos.');
        }
        // Sheet F = IF(E="", C, C/E): blank yield intentionally means a per-unit quantity.
        if (($row[4] ?? null) !== null && $row[4] !== '' && (!is_numeric($row[4]) || (float) $row[4] <= 0))
            throw new InvalidArgumentException('Hay un rendimiento no válido.');
        $sourceLines++;
    }
    $components = array_sum(array_column($snapshot['recipes'], 'components'));
    if ($components !== $sourceLines || count($snapshot['inputs']) !== count($names))
        throw new InvalidArgumentException('El conteo no coincide con la planilla.');
    foreach ($snapshot['recipeValidation']['differences'] as $difference) {
        if ($difference['reason'] === 'La cantidad por unidad no coincide con lote/rendimiento')
            throw new InvalidArgumentException('Las cantidades por unidad no coinciden con la planilla.');
    }
    $snapshot['source']['mode'] = 'local_once';
    $snapshot['source']['sha256'] = $bundle['sourceSha256'];
    $snapshot['source']['exportedAt'] = mrp_clean_text($bundle['exportedAt'] ?? '', 80);
    $snapshot['importCounts'] = ['inputs' => count($names), 'recipes' => count($snapshot['recipes']), 'components' => $components];
    return $snapshot;
}

/** Atomic, serialized and idempotent first migration. Never overwrites a catalog. */
function mrp_import_once(PDO $pdo, array $bundle, int $userId): array
{
    $snapshot = mrp_snapshot_from_import($bundle);
    ensure_mrp_schema($pdo);
    if ((int) $pdo->query("SELECT GET_LOCK('lartisan_mrp_import', 5)")->fetchColumn() !== 1)
        throw new RuntimeException('Otra importación está en curso.');
    try {
        $pdo->beginTransaction();
        $existing = $pdo->query("SELECT id, payload_json FROM mrp_sync_runs WHERE status='verified' ORDER BY id DESC LIMIT 1 FOR UPDATE")->fetch();
        if ($existing) {
            $previous = json_decode($existing['payload_json'], true) ?: [];
            if (($previous['source']['sha256'] ?? '') === $bundle['sourceSha256']) {
                $pdo->rollBack();
                return ['alreadyImported' => true, 'counts' => $previous['importCounts'] ?? []];
            }
            throw new InvalidArgumentException('El sistema ya tiene un MRP importado. No se reemplazaron datos.');
        }
        foreach (['mrp_input_catalog', 'mrp_recipe_catalog', 'mrp_recipe_components'] as $table) {
            if ((int) $pdo->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn() > 0)
                throw new InvalidArgumentException('Ya hay datos en el catálogo. Se requiere conciliarlos antes de importar.');
        }
        $pdo->prepare("INSERT INTO mrp_sync_runs (status, source_spreadsheet_id, triggered_by, started_at) VALUES ('running', ?, ?, NOW())")
            ->execute([MRP_SPREADSHEET_ID, $userId]);
        $runId = (int) $pdo->lastInsertId();
        mrp_persist_master_data($pdo, $snapshot, $runId);
        foreach (['inputs' => 'mrp_input_catalog', 'recipes' => 'mrp_recipe_catalog', 'components' => 'mrp_recipe_components'] as $key => $table) {
            if ((int) $pdo->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn() !== $snapshot['importCounts'][$key])
                throw new RuntimeException('No coincide la verificación de filas guardadas.');
        }
        $payload = json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $rows = array_sum($snapshot['importCounts']);
        $pdo->prepare("UPDATE mrp_sync_runs SET status='verified', payload_json=?, payload_hash=?, rows_imported=?, finished_at=NOW() WHERE id=?")
            ->execute([$payload, hash('sha256', $payload), $rows, $runId]);
        audit($pdo, $userId, 'mrp_imported_once', 'run=' . $runId . ';filas=' . $rows);
        $pdo->commit();
        return ['alreadyImported' => false, 'counts' => $snapshot['importCounts']];
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    } finally {
        $pdo->query("SELECT RELEASE_LOCK('lartisan_mrp_import')");
    }
}

function mrp_sync_from_google(PDO $pdo, array $config, int $userId): array
{
    ensure_mrp_schema($pdo);
    $pdo->prepare("INSERT INTO mrp_sync_runs (status, source_spreadsheet_id, triggered_by, started_at) VALUES ('running', ?, ?, NOW())")
        ->execute([MRP_SPREADSHEET_ID, $userId]);
    $runId = (int) $pdo->lastInsertId();
    try {
        $snapshot = mrp_build_snapshot(mrp_fetch_ranges($pdo, $config));
        $payload = json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($payload === false) throw new RuntimeException('No se pudo guardar la copia MRP.');
        mrp_persist_master_data($pdo, $snapshot, $runId);
        $rows = count($snapshot['plan']) + count($snapshot['requirements']) + count($snapshot['recipes']) + count($snapshot['inputs']);
        $pdo->prepare("UPDATE mrp_sync_runs SET status='verified', payload_json=?, payload_hash=?, rows_imported=?, finished_at=NOW() WHERE id=?")
            ->execute([$payload, hash('sha256', $payload), $rows, $runId]);
        audit($pdo, $userId, 'mrp_synced_read_only', 'filas=' . $rows);
        return ['data' => $snapshot, 'rowsImported' => $rows, 'updatedAt' => date('Y-m-d H:i:s')];
    } catch (Throwable $error) {
        $pdo->prepare("UPDATE mrp_sync_runs SET status='failed', error_message=?, finished_at=NOW() WHERE id=?")
            ->execute([substr($error->getMessage(), 0, 1000), $runId]);
        audit($pdo, $userId, 'mrp_sync_failed');
        throw $error;
    }
}

function mrp_clean_text($value, int $max): string
{
    return mrp_limit_text(trim((string) $value), $max);
}
