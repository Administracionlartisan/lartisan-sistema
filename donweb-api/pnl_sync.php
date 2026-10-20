<?php

declare(strict_types=1);

/**
 * Consulta el P&L por OAuth de usuario. No escribe en Drive ni en la hoja.
 * La autorización se almacena fuera de public_html y se puede revocar desde
 * la cuenta de Google cuando Administración lo necesite.
 */
function ensure_pnl_sync_schema(PDO $pdo): void
{
    if (!table_exists($pdo, 'pnl_sync_runs')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS pnl_sync_runs (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            status VARCHAR(20) NOT NULL,
            source_spreadsheet_id VARCHAR(128) NOT NULL,
            source_range VARCHAR(512) NOT NULL,
            rows_imported INT UNSIGNED NOT NULL DEFAULT 0,
            payload_json LONGTEXT NULL,
            payload_hash CHAR(64) NULL,
            triggered_by BIGINT UNSIGNED NULL,
            error_message VARCHAR(1000) NULL,
            started_at DATETIME NOT NULL,
            finished_at DATETIME NULL,
            INDEX idx_pnl_sync_status_date (status, started_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
    if (!table_exists($pdo, 'pnl_oauth_states')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS pnl_oauth_states (
            state_hash CHAR(64) PRIMARY KEY,
            user_id BIGINT UNSIGNED NOT NULL,
            expires_at DATETIME NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_pnl_oauth_expiry (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
    if (!table_exists($pdo, 'pnl_oauth_credentials')) {
        $pdo->exec("CREATE TABLE IF NOT EXISTS pnl_oauth_credentials (
            id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
            credential_ciphertext TEXT NOT NULL,
            connected_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}

function ensure_expense_sync_schema(PDO $pdo): void
{
    if (!table_exists($pdo, 'expense_sync_runs')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS expense_sync_runs (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            status VARCHAR(20) NOT NULL,
            source_spreadsheet_id VARCHAR(128) NOT NULL,
            source_range VARCHAR(512) NOT NULL,
            rows_imported INT UNSIGNED NOT NULL DEFAULT 0,
            payload_json LONGTEXT NULL,
            payload_hash CHAR(64) NULL,
            triggered_by BIGINT UNSIGNED NULL,
            error_message VARCHAR(1000) NULL,
            started_at DATETIME NOT NULL,
            finished_at DATETIME NULL,
            INDEX idx_expense_sync_status_date (status, started_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
}

function pnl_private_token_path(): string
{
    return dirname(__DIR__, 2) . '/lartisan-pnl-oauth.json';
}

function pnl_oauth_client(array $config): array
{
    $drive = $config['backup']['drive'] ?? [];
    $clientId = (string) ($drive['client_id'] ?? '');
    $clientSecret = (string) ($drive['client_secret'] ?? '');
    $redirect = (string) ($config['pnl_sync']['redirect_uri'] ?? 'https://www.lartisantaller.com/sistema-api/admin/pnl/google-callback');
    if ($clientId === '' || $clientSecret === '' || $redirect === '') {
        throw new RuntimeException('La conexión de Google no está configurada todavía.');
    }
    return ['client_id' => $clientId, 'client_secret' => $clientSecret, 'redirect_uri' => $redirect];
}

function pnl_authorization_url(PDO $pdo, array $config, int $userId): string
{
    ensure_pnl_sync_schema($pdo);
    $oauth = pnl_oauth_client($config);
    $state = bin2hex(random_bytes(32));
    $pdo->prepare('DELETE FROM pnl_oauth_states WHERE expires_at < NOW()')->execute();
    $pdo->prepare('INSERT INTO pnl_oauth_states (state_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))')
        ->execute([hash('sha256', $state), $userId]);
    return 'https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query([
        'client_id' => $oauth['client_id'],
        'redirect_uri' => $oauth['redirect_uri'],
        'response_type' => 'code',
        'scope' => 'https://www.googleapis.com/auth/spreadsheets.readonly',
        'access_type' => 'offline',
        'prompt' => 'consent',
        'state' => $state,
    ]);
}

function pnl_credential_key(array $config): string
{
    $oauth = pnl_oauth_client($config);
    return hash('sha256', 'lartisan-pnl-v1|' . $oauth['client_secret'], true);
}

function pnl_store_refresh_token(PDO $pdo, array $config, string $refreshToken): void
{
    $iv = random_bytes(12);
    $tag = '';
    $ciphertext = openssl_encrypt($refreshToken, 'aes-256-gcm', pnl_credential_key($config), OPENSSL_RAW_DATA, $iv, $tag);
    if ($ciphertext === false || $tag === '') throw new RuntimeException('No se pudo proteger la autorización de Google.');
    $payload = json_encode(['iv' => base64_encode($iv), 'tag' => base64_encode($tag), 'data' => base64_encode($ciphertext)], JSON_UNESCAPED_SLASHES);
    if ($payload === false) throw new RuntimeException('No se pudo proteger la autorización de Google.');
    $pdo->prepare('INSERT INTO pnl_oauth_credentials (id, credential_ciphertext, connected_at) VALUES (1, ?, NOW()) ON DUPLICATE KEY UPDATE credential_ciphertext=VALUES(credential_ciphertext), connected_at=VALUES(connected_at)')
        ->execute([base64_encode($payload)]);
}

function pnl_stored_refresh_token(PDO $pdo, array $config): string
{
    ensure_pnl_sync_schema($pdo);
    $encoded = $pdo->query('SELECT credential_ciphertext FROM pnl_oauth_credentials WHERE id = 1')->fetchColumn();
    if (is_string($encoded) && $encoded !== '') {
        $decoded = json_decode((string) base64_decode($encoded, true), true);
        if (is_array($decoded)) {
            $iv = base64_decode((string) ($decoded['iv'] ?? ''), true);
            $tag = base64_decode((string) ($decoded['tag'] ?? ''), true);
            $data = base64_decode((string) ($decoded['data'] ?? ''), true);
            if ($iv !== false && $tag !== false && $data !== false) {
                $token = openssl_decrypt($data, 'aes-256-gcm', pnl_credential_key($config), OPENSSL_RAW_DATA, $iv, $tag);
                if (is_string($token) && $token !== '') return $token;
            }
        }
    }
    $legacy = is_file(pnl_private_token_path()) ? json_decode((string) file_get_contents(pnl_private_token_path()), true) : null;
    return is_array($legacy) ? (string) ($legacy['refresh_token'] ?? '') : '';
}

function pnl_is_connected(PDO $pdo, array $config): bool
{
    return pnl_stored_refresh_token($pdo, $config) !== '';
}

function pnl_exchange_authorization_code($pdoOrConfig, $configOrCode, ?string $code = null): void
{
    if ($pdoOrConfig instanceof PDO) {
        $pdo = $pdoOrConfig;
        $config = is_array($configOrCode) ? $configOrCode : [];
        $authorizationCode = (string) $code;
    } else {
        global $pdo;
        $config = is_array($pdoOrConfig) ? $pdoOrConfig : [];
        $authorizationCode = (string) $configOrCode;
    }
    if (!($pdo instanceof PDO)) throw new RuntimeException('No se pudo acceder al almacenamiento seguro.');
    $oauth = pnl_oauth_client($config);
    $response = pnl_http('https://oauth2.googleapis.com/token', [
        'method' => 'POST',
        'form' => [
            'code' => $authorizationCode,
            'client_id' => $oauth['client_id'],
            'client_secret' => $oauth['client_secret'],
            'redirect_uri' => $oauth['redirect_uri'],
            'grant_type' => 'authorization_code',
        ],
    ]);
    if ($response['status'] !== 200 || empty($response['json']['refresh_token'])) {
        throw new RuntimeException('Google no devolvió una autorización permanente.');
    }
    pnl_store_refresh_token($pdo, $config, (string) $response['json']['refresh_token']);
}

function pnl_access_token($pdoOrConfig, ?array $maybeConfig = null): string
{
    if ($pdoOrConfig instanceof PDO) {
        $pdo = $pdoOrConfig;
        $config = $maybeConfig ?? [];
    } else {
        global $pdo;
        $config = is_array($pdoOrConfig) ? $pdoOrConfig : [];
    }
    if (!($pdo instanceof PDO)) throw new RuntimeException('No se pudo acceder al almacenamiento seguro.');
    $refreshToken = pnl_stored_refresh_token($pdo, $config);
    if ($refreshToken === '') throw new RuntimeException('Falta autorizar la lectura del P&L con Google.');
    $oauth = pnl_oauth_client($config);
    $response = pnl_http('https://oauth2.googleapis.com/token', [
        'method' => 'POST',
        'form' => [
            'client_id' => $oauth['client_id'],
            'client_secret' => $oauth['client_secret'],
            'refresh_token' => $refreshToken,
            'grant_type' => 'refresh_token',
        ],
    ]);
    if ($response['status'] !== 200 || empty($response['json']['access_token'])) {
        throw new RuntimeException('Google rechazó la autorización de lectura del P&L.');
    }
    return (string) $response['json']['access_token'];
}

function pnl_fetch_sheet_values($pdoOrConfig, ?array $maybeConfig = null): array
{
    if ($pdoOrConfig instanceof PDO) {
        $pdo = $pdoOrConfig;
        $config = $maybeConfig ?? [];
    } else {
        global $pdo;
        $config = is_array($pdoOrConfig) ? $pdoOrConfig : [];
    }
    if (!($pdo instanceof PDO)) throw new RuntimeException('No se pudo acceder al almacenamiento seguro.');
    $sheetId = trim((string) ($config['pnl_sync']['spreadsheet_id'] ?? ''));
    $range = (string) ($config['pnl_sync']['range'] ?? "'P&L Consolidado 2026 COPIA'!A1:AN220");
    if ($sheetId === '' || $range === '') throw new RuntimeException('Falta identificar la hoja del P&L.');
    $accessToken = pnl_access_token($pdo, $config);
    $url = 'https://sheets.googleapis.com/v4/spreadsheets/' . rawurlencode($sheetId) . '/values/' . rawurlencode($range) . '?majorDimension=ROWS';
    $response = pnl_http($url, ['headers' => ['Authorization: Bearer ' . $accessToken]]);
    $rows = $response['json']['values'] ?? null;
    if ($response['status'] !== 200 || !is_array($rows) || count($rows) < 2 || count($rows) > 1000) {
        throw new RuntimeException('No se pudo obtener una versión válida del P&L desde Google.');
    }
    return $rows;
}

function expense_fetch_sheet_values($pdoOrConfig, ?array $maybeConfig = null): array
{
    if ($pdoOrConfig instanceof PDO) {
        $pdo = $pdoOrConfig;
        $config = $maybeConfig ?? [];
    } else {
        global $pdo;
        $config = is_array($pdoOrConfig) ? $pdoOrConfig : [];
    }
    if (!($pdo instanceof PDO)) throw new RuntimeException('No se pudo acceder al almacenamiento seguro.');
    $sheetId = trim((string) ($config['pnl_sync']['spreadsheet_id'] ?? ''));
    $range = (string) ($config['expense_sync']['range'] ?? "'GASTOS OPERATIVOS'!A7:Z10000");
    if ($sheetId === '' || $range === '') throw new RuntimeException('Falta identificar la fuente de gastos.');
    $accessToken = pnl_access_token($pdo, $config);
    $url = 'https://sheets.googleapis.com/v4/spreadsheets/' . rawurlencode($sheetId) . '/values/' . rawurlencode($range) . '?majorDimension=ROWS';
    $response = pnl_http($url, ['headers' => ['Authorization: Bearer ' . $accessToken]]);
    $rows = $response['json']['values'] ?? null;
    if ($response['status'] !== 200 || !is_array($rows) || count($rows) < 2 || count($rows) > 10000) {
        throw new RuntimeException('No se pudo obtener una versión válida de gastos desde Google.');
    }
    return $rows;
}

function expense_money_value($value): float
{
    $raw = trim((string) $value);
    if ($raw === '') return 0.0;
    $negative = strpos($raw, '-') !== false || strpos($raw, '(') !== false;
    $raw = preg_replace('/[^0-9,\.]/', '', $raw) ?? '';
    if ($raw === '') return 0.0;
    $lastComma = strrpos($raw, ',');
    $lastDot = strrpos($raw, '.');
    if ($lastComma !== false && $lastDot !== false) {
        if ($lastComma > $lastDot) {
            $raw = str_replace('.', '', $raw);
            $raw = str_replace(',', '.', $raw);
        } else {
            $raw = str_replace(',', '', $raw);
        }
    } elseif ($lastComma !== false) {
        $decimals = strlen($raw) - $lastComma - 1;
        $raw = $decimals === 2 ? str_replace(',', '.', $raw) : str_replace(',', '', $raw);
    } elseif ($lastDot !== false) {
        $decimals = strlen($raw) - $lastDot - 1;
        if ($decimals !== 2) $raw = str_replace('.', '', $raw);
    }
    $amount = (float) $raw;
    return $negative ? -$amount : $amount;
}

function expense_sync_snapshot(array $rows): array
{
    $totals = ['totalExpenses' => 0.0, 'totalPaid' => 0.0, 'totalPayable' => 0.0, 'openCount' => 0];
    $byCategory = [];
    $bySupplier = [];
    $openItems = [];
    $validRows = 0;

    foreach (array_slice($rows, 1) as $row) {
        if (!is_array($row)) continue;
        $supplier = trim((string) ($row[3] ?? ''));
        $category = trim((string) ($row[4] ?? 'Sin categoría'));
        $total = expense_money_value($row[10] ?? '');
        $amountDue = max(0.0, expense_money_value($row[13] ?? ''));
        if ($supplier === '' || $total <= 0) continue;
        $validRows++;
        $totals['totalExpenses'] += $total;
        $totals['totalPayable'] += $amountDue;
        $totals['totalPaid'] += max(0.0, $total - $amountDue);

        if (!isset($byCategory[$category])) $byCategory[$category] = ['label' => $category, 'total' => 0.0, 'outstanding' => 0.0, 'count' => 0];
        $byCategory[$category]['total'] += $total;
        $byCategory[$category]['outstanding'] += $amountDue;
        $byCategory[$category]['count']++;
        if (!isset($bySupplier[$supplier])) $bySupplier[$supplier] = ['label' => $supplier, 'total' => 0.0, 'outstanding' => 0.0, 'count' => 0];
        $bySupplier[$supplier]['total'] += $total;
        $bySupplier[$supplier]['outstanding'] += $amountDue;
        $bySupplier[$supplier]['count']++;

        if ($amountDue > 0) {
            $totals['openCount']++;
            $openItems[] = [
                'date' => (string) ($row[2] ?? ''),
                'supplier' => $supplier,
                'category' => $category,
                'document' => (string) ($row[5] ?? ''),
                'total' => round($total, 2),
                'amountDue' => round($amountDue, 2),
                'paid' => strtoupper(trim((string) ($row[11] ?? ''))) === 'SI',
                'paymentMethod' => (string) ($row[14] ?? ''),
                'status' => (string) ($row[21] ?? ''),
                'responsible' => (string) ($row[20] ?? ''),
            ];
        }
    }

    usort($openItems, static fn (array $a, array $b): int => $b['amountDue'] <=> $a['amountDue']);
    $sortGroups = static function (array $items): array {
        $values = array_values($items);
        usort($values, static fn (array $a, array $b): int => $b['outstanding'] <=> $a['outstanding']);
        return array_slice($values, 0, 20);
    };

    foreach ($totals as $key => $value) {
        if (is_float($value)) $totals[$key] = round($value, 2);
    }

    return [
        'sourceRows' => $validRows,
        'summary' => [
            'totalExpenses' => $totals['totalExpenses'],
            'totalPaid' => $totals['totalPaid'],
            'totalPayable' => $totals['totalPayable'],
            'openCount' => $totals['openCount'],
            'byCategory' => $sortGroups($byCategory),
            'bySupplier' => $sortGroups($bySupplier),
            'openItems' => array_slice($openItems, 0, 250),
        ],
    ];
}

/**
 * Guarda una copia de consulta de gastos. La fuente de Google conserva el
 * control: este proceso no modifica celdas, pagos ni comprobantes originales.
 */
function expense_sync_from_google(PDO $pdo, array $config, int $userId): array
{
    ensure_expense_sync_schema($pdo);
    $sheetId = trim((string) ($config['pnl_sync']['spreadsheet_id'] ?? ''));
    $range = (string) ($config['expense_sync']['range'] ?? "'GASTOS OPERATIVOS'!A7:Z10000");
    if ($sheetId === '') throw new RuntimeException('La fuente de gastos no está configurada en el servidor');
    $pdo->prepare("INSERT INTO expense_sync_runs (status, source_spreadsheet_id, source_range, triggered_by, started_at) VALUES ('running', ?, ?, ?, NOW())")
        ->execute([$sheetId, $range, $userId]);
    $runId = (int) $pdo->lastInsertId();
    try {
        $rows = expense_fetch_sheet_values($pdo, $config);
        $snapshot = expense_sync_snapshot($rows);
        $payload = json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($payload === false) throw new RuntimeException('No se pudo guardar la copia de gastos.');
        $pdo->prepare("UPDATE expense_sync_runs SET status = 'verified', rows_imported = ?, payload_json = ?, payload_hash = ?, finished_at = NOW() WHERE id = ?")
            ->execute([(int) $snapshot['sourceRows'], $payload, hash('sha256', $payload), $runId]);
        audit($pdo, $userId, 'expenses_synced_from_google', 'filas=' . $snapshot['sourceRows']);
        return ['data' => $snapshot, 'rowsImported' => $snapshot['sourceRows'], 'updatedAt' => date('Y-m-d H:i:s')];
    } catch (Throwable $error) {
        $pdo->prepare("UPDATE expense_sync_runs SET status = 'failed', error_message = ?, finished_at = NOW() WHERE id = ?")
            ->execute([substr($error->getMessage(), 0, 1000), $runId]);
        audit($pdo, $userId, 'expenses_sync_failed');
        throw $error;
    }
}

function pnl_http(string $url, array $options = []): array
{
    if (!function_exists('curl_init')) throw new RuntimeException('El hosting no tiene disponible cURL.');
    $handle = curl_init($url);
    $headers = $options['headers'] ?? [];
    $settings = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_HTTPHEADER => $headers];
    if (($options['method'] ?? 'GET') === 'POST') {
        $settings[CURLOPT_POST] = true;
        $settings[CURLOPT_POSTFIELDS] = http_build_query($options['form'] ?? []);
        $settings[CURLOPT_HTTPHEADER] = array_merge($headers, ['Content-Type: application/x-www-form-urlencoded']);
    }
    curl_setopt_array($handle, $settings);
    $body = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    curl_close($handle);
    return ['status' => $status, 'json' => json_decode((string) $body, true) ?: []];
}
