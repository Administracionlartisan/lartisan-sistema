<?php

declare(strict_types=1);

/**
 * Sincronización de cierres con las planillas diarias de cada local.
 *
 * Esta integración se mantiene separada del acceso de lectura de P&L: escribir
 * una hoja requiere una autorización OAuth distinta y explícita. Las claves no
 * se envían al navegador ni se guardan en public_html.
 */

function ensure_cash_sheet_sync_schema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS cash_sheet_oauth_states (
        state_hash CHAR(64) PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_cash_sheet_oauth_expiry (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS cash_sheet_oauth_credentials (
        id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
        credential_ciphertext TEXT NOT NULL,
        connected_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS cash_sheet_sync_runs (
        close_id CHAR(36) NOT NULL PRIMARY KEY,
        site VARCHAR(80) NOT NULL,
        business_date DATE NOT NULL,
        status ENUM('running','verified','failed','rejected') NOT NULL,
        payload_hash CHAR(64) NOT NULL,
        spreadsheet_id VARCHAR(128) NULL,
        sheet_name VARCHAR(160) NULL,
        target_row INT NULL,
        written_fields_json TEXT NULL,
        error_message VARCHAR(1000) NULL,
        triggered_by BIGINT UNSIGNED NOT NULL,
        started_at DATETIME NOT NULL,
        finished_at DATETIME NULL,
        INDEX idx_cash_sheet_site_date (site, business_date),
        INDEX idx_cash_sheet_status (status, started_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

function cash_sheet_oauth_client(array $config): array
{
    $drive = $config['backup']['drive'] ?? [];
    $clientId = (string) ($drive['client_id'] ?? '');
    $clientSecret = (string) ($drive['client_secret'] ?? '');
    $redirect = (string) ($config['cash_sheet_sync']['redirect_uri'] ?? 'https://www.lartisantaller.com/sistema-api/admin/cash-sheets/google-callback');
    if ($clientId === '' || $clientSecret === '' || $redirect === '') {
        throw new RuntimeException('La conexión segura de Google Sheets no está configurada.');
    }
    return ['client_id' => $clientId, 'client_secret' => $clientSecret, 'redirect_uri' => $redirect];
}

function cash_sheet_credential_key(array $config): string
{
    $oauth = cash_sheet_oauth_client($config);
    return hash('sha256', 'lartisan-cash-sheet-v1|' . $oauth['client_secret'], true);
}

function cash_sheet_store_refresh_token(PDO $pdo, array $config, string $refreshToken): void
{
    $iv = random_bytes(12);
    $tag = '';
    $ciphertext = openssl_encrypt($refreshToken, 'aes-256-gcm', cash_sheet_credential_key($config), OPENSSL_RAW_DATA, $iv, $tag);
    if ($ciphertext === false || $tag === '') throw new RuntimeException('No se pudo proteger la autorización de Google Sheets.');
    $payload = json_encode(['iv' => base64_encode($iv), 'tag' => base64_encode($tag), 'data' => base64_encode($ciphertext)], JSON_UNESCAPED_SLASHES);
    if ($payload === false) throw new RuntimeException('No se pudo proteger la autorización de Google Sheets.');
    $pdo->prepare('INSERT INTO cash_sheet_oauth_credentials (id, credential_ciphertext, connected_at) VALUES (1, ?, NOW()) ON DUPLICATE KEY UPDATE credential_ciphertext=VALUES(credential_ciphertext), connected_at=VALUES(connected_at)')
        ->execute([base64_encode($payload)]);
}

function cash_sheet_stored_refresh_token(PDO $pdo, array $config): string
{
    $encoded = $pdo->query('SELECT credential_ciphertext FROM cash_sheet_oauth_credentials WHERE id = 1')->fetchColumn();
    if (!is_string($encoded) || $encoded === '') return '';
    $decoded = json_decode((string) base64_decode($encoded, true), true);
    if (!is_array($decoded)) return '';
    $iv = base64_decode((string) ($decoded['iv'] ?? ''), true);
    $tag = base64_decode((string) ($decoded['tag'] ?? ''), true);
    $data = base64_decode((string) ($decoded['data'] ?? ''), true);
    if ($iv === false || $tag === false || $data === false) return '';
    $token = openssl_decrypt($data, 'aes-256-gcm', cash_sheet_credential_key($config), OPENSSL_RAW_DATA, $iv, $tag);
    return is_string($token) ? $token : '';
}

function cash_sheet_is_connected(PDO $pdo, array $config): bool
{
    ensure_cash_sheet_sync_schema($pdo);
    return cash_sheet_stored_refresh_token($pdo, $config) !== '';
}

function cash_sheet_authorization_url(PDO $pdo, array $config, int $userId): string
{
    ensure_cash_sheet_sync_schema($pdo);
    $oauth = cash_sheet_oauth_client($config);
    $state = bin2hex(random_bytes(32));
    $pdo->prepare('DELETE FROM cash_sheet_oauth_states WHERE expires_at < NOW()')->execute();
    $pdo->prepare('INSERT INTO cash_sheet_oauth_states (state_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))')
        ->execute([hash('sha256', $state), $userId]);
    return 'https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query([
        'client_id' => $oauth['client_id'],
        'redirect_uri' => $oauth['redirect_uri'],
        'response_type' => 'code',
        // Alcance de escritura acotado a las planillas que el propietario
        // comparta con la cuenta autorizada. No se solicita acceso a Drive.
        'scope' => 'https://www.googleapis.com/auth/spreadsheets',
        'access_type' => 'offline',
        'prompt' => 'consent',
        'state' => $state,
    ]);
}

function cash_sheet_exchange_authorization_code(PDO $pdo, array $config, string $code): void
{
    $oauth = cash_sheet_oauth_client($config);
    $response = cash_sheet_http('https://oauth2.googleapis.com/token', [
        'method' => 'POST',
        'form' => [
            'code' => $code,
            'client_id' => $oauth['client_id'],
            'client_secret' => $oauth['client_secret'],
            'redirect_uri' => $oauth['redirect_uri'],
            'grant_type' => 'authorization_code',
        ],
    ]);
    if ($response['status'] !== 200 || empty($response['json']['refresh_token'])) {
        throw new RuntimeException('Google no devolvió una autorización permanente para las planillas.');
    }
    cash_sheet_store_refresh_token($pdo, $config, (string) $response['json']['refresh_token']);
}

function cash_sheet_access_token(PDO $pdo, array $config): string
{
    $refreshToken = cash_sheet_stored_refresh_token($pdo, $config);
    if ($refreshToken === '') throw new RuntimeException('Administración todavía no autorizó la escritura en Google Sheets.');
    $oauth = cash_sheet_oauth_client($config);
    $response = cash_sheet_http('https://oauth2.googleapis.com/token', [
        'method' => 'POST',
        'form' => [
            'client_id' => $oauth['client_id'],
            'client_secret' => $oauth['client_secret'],
            'refresh_token' => $refreshToken,
            'grant_type' => 'refresh_token',
        ],
    ]);
    if ($response['status'] !== 200 || empty($response['json']['access_token'])) {
        throw new RuntimeException('Google rechazó la autorización para escribir los cierres.');
    }
    return (string) $response['json']['access_token'];
}

function cash_sheet_normalize_header(string $value): string
{
    $value = trim(mb_strtolower($value, 'UTF-8'));
    $value = strtr($value, ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u']);
    return preg_replace('/\s+/', ' ', $value) ?? '';
}

function cash_sheet_column_name(int $index): string
{
    $name = '';
    $index++;
    while ($index > 0) {
        $mod = ($index - 1) % 26;
        $name = chr(65 + $mod) . $name;
        $index = intdiv($index - 1, 26);
    }
    return $name;
}

function cash_sheet_date_matches(string $value, string $date): bool
{
    $value = trim($value);
    if ($value === '') return false;
    $formats = ['Y-m-d', 'd/m/Y', 'd/m/y', 'd-m-Y', 'Y/m/d'];
    foreach ($formats as $format) {
        $parsed = DateTimeImmutable::createFromFormat('!' . $format, $value);
        if ($parsed && $parsed->format($format) === $value && $parsed->format('Y-m-d') === $date) return true;
    }
    return false;
}

function cash_sheet_number($value): float
{
    $raw = trim((string) $value);
    if ($raw === '') return 0.0;
    $raw = preg_replace('/[^0-9,\.\-]/', '', $raw) ?? '';
    if ($raw === '') return 0.0;
    $comma = strrpos($raw, ',');
    $dot = strrpos($raw, '.');
    if ($comma !== false && $dot !== false) {
        $raw = $comma > $dot ? str_replace(',', '.', str_replace('.', '', $raw)) : str_replace(',', '', $raw);
    } elseif ($comma !== false) {
        $raw = str_replace(',', '.', $raw);
    }
    return (float) $raw;
}

function cash_sheet_config_for_site(array $config, string $site): array
{
    $locations = $config['cash_sheet_sync']['locations'] ?? [];
    $item = is_array($locations) ? ($locations[$site] ?? null) : null;
    if (!is_array($item) || trim((string) ($item['spreadsheet_id'] ?? '')) === '' || trim((string) ($item['sheet'] ?? '')) === '') {
        throw new RuntimeException('La planilla de ' . $site . ' no está configurada aún en el servidor.');
    }
    return $item;
}

function cash_sheet_fetch_values(string $token, string $spreadsheetId, string $range, string $render = 'FORMATTED_VALUE'): array
{
    $url = 'https://sheets.googleapis.com/v4/spreadsheets/' . rawurlencode($spreadsheetId) . '/values/' . rawurlencode($range)
        . '?majorDimension=ROWS&valueRenderOption=' . rawurlencode($render);
    $response = cash_sheet_http($url, ['headers' => ['Authorization: Bearer ' . $token]]);
    if ($response['status'] !== 200 || !is_array($response['json']['values'] ?? null)) {
        throw new RuntimeException('No se pudo leer la planilla de cierre configurada.');
    }
    return $response['json']['values'];
}

function cash_sheet_sync_close(PDO $pdo, array $config, array $user, array $input): array
{
    ensure_cash_sheet_sync_schema($pdo);
    $site = trim((string) ($input['site'] ?? ''));
    $closeId = trim((string) ($input['closeId'] ?? ''));
    $businessDate = trim((string) ($input['businessDate'] ?? ''));
    if (!in_array($site, operational_sites(), true) || !user_can_access_site($user, $site) || !user_can_action($user, 'cobrar')) {
        throw new InvalidArgumentException('No tenés permiso para sincronizar el cierre de este local.');
    }
    if (!preg_match('/^[a-f0-9-]{36}$/i', $closeId) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $businessDate)) {
        throw new InvalidArgumentException('Identificador o fecha de cierre inválidos.');
    }
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $businessDate);
    if (!$date || $date->format('Y-m-d') !== $businessDate) throw new InvalidArgumentException('Fecha de cierre inválida.');
    $payments = is_array($input['payments'] ?? null) ? $input['payments'] : [];
    $safePayments = [];
    foreach ($payments as $payment) {
        if (!is_array($payment)) continue;
        $method = trim((string) ($payment['method'] ?? ''));
        $amount = (float) ($payment['amount'] ?? 0);
        if ($method !== '' && is_finite($amount) && $amount >= 0) $safePayments[$method] = round($amount, 2);
    }
    $metrics = is_array($input['metrics'] ?? null) ? $input['metrics'] : [];
    $safeMetrics = [];
    foreach (['total', 'tickets', 'discounts', 'counted', 'envelope', 'difference'] as $key) {
        $value = (float) ($metrics[$key] ?? 0);
        if (!is_finite($value) || $value < 0 && $key !== 'difference') throw new InvalidArgumentException('Importes de cierre inválidos.');
        $safeMetrics[$key] = round($value, 2);
    }
    $payload = ['site' => $site, 'date' => $businessDate, 'payments' => $safePayments, 'metrics' => $safeMetrics];
    $payloadHash = hash('sha256', (string) json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    $existing = $pdo->prepare('SELECT * FROM cash_sheet_sync_runs WHERE close_id = ? LIMIT 1');
    $existing->execute([$closeId]);
    $run = $existing->fetch();
    if ($run) {
        if (!hash_equals((string) $run['payload_hash'], $payloadHash)) throw new RuntimeException('Ese cierre ya fue enviado con datos distintos; no se sobrescribió la planilla.');
        if ($run['status'] === 'verified') return ['alreadySynced' => true, 'row' => (int) $run['target_row'], 'sheet' => (string) $run['sheet_name'], 'fields' => json_decode((string) $run['written_fields_json'], true) ?: []];
        $pdo->prepare("UPDATE cash_sheet_sync_runs SET status='running', error_message=NULL, started_at=NOW(), finished_at=NULL WHERE close_id=?")->execute([$closeId]);
    } else {
        $pdo->prepare("INSERT INTO cash_sheet_sync_runs (close_id, site, business_date, status, payload_hash, triggered_by, started_at) VALUES (?, ?, ?, 'running', ?, ?, NOW())")
            ->execute([$closeId, $site, $businessDate, $payloadHash, (int) $user['id']]);
    }
    try {
        $location = cash_sheet_config_for_site($config, $site);
        $spreadsheetId = trim((string) $location['spreadsheet_id']);
        $sheet = trim((string) $location['sheet']);
        $headerRow = max(1, (int) ($location['header_row'] ?? 5));
        $firstDataRow = $headerRow + 1;
        $token = cash_sheet_access_token($pdo, $config);
        $range = "'" . str_replace("'", "''", $sheet) . "'!A" . $headerRow . ':AZ5000';
        $values = cash_sheet_fetch_values($token, $spreadsheetId, $range);
        $headers = is_array($values[0] ?? null) ? $values[0] : [];
        if (!$headers) throw new RuntimeException('La hoja no contiene encabezados en la fila configurada.');
        $headerIndex = [];
        foreach ($headers as $index => $header) {
            $normalized = cash_sheet_normalize_header((string) $header);
            if ($normalized !== '' && !array_key_exists($normalized, $headerIndex)) $headerIndex[$normalized] = $index;
        }
        $dateHeader = cash_sheet_normalize_header((string) ($location['date_header'] ?? 'FECHA'));
        if (!array_key_exists($dateHeader, $headerIndex)) throw new RuntimeException('No se encontró el encabezado de fecha configurado.');
        $dateColumn = (int) $headerIndex[$dateHeader];
        $targetOffset = null;
        foreach (array_slice($values, 1) as $offset => $row) {
            if (cash_sheet_date_matches((string) ($row[$dateColumn] ?? ''), $businessDate)) { $targetOffset = $offset + 1; break; }
        }
        if ($targetOffset === null) throw new RuntimeException('No existe una fila para la fecha del cierre; no se agregó una fila nueva.');
        $rowNumber = $headerRow + $targetOffset;
        // Se consulta la misma fila en modo fórmula antes de escribir: una
        // fórmula de la planilla nunca se reemplaza automáticamente.
        $formulaRows = cash_sheet_fetch_values($token, $spreadsheetId, "'" . str_replace("'", "''", $sheet) . "'!A" . $rowNumber . ':AZ' . $rowNumber, 'FORMULA');
        $formulaRow = is_array($formulaRows[0] ?? null) ? $formulaRows[0] : [];
        $fieldHeaders = [
            'total' => (string) ($location['total_header'] ?? 'FACT TOTAL'),
            'tickets' => (string) ($location['tickets_header'] ?? 'Tickets'),
            'discounts' => (string) ($location['discounts_header'] ?? 'DESCUENTOS'),
        ];
        $paymentHeaders = is_array($location['payment_headers'] ?? null) ? $location['payment_headers'] : [];
        $writes = [];
        foreach ($fieldHeaders as $metric => $header) {
            $normalized = cash_sheet_normalize_header($header);
            if (array_key_exists($normalized, $headerIndex)) $writes[(int) $headerIndex[$normalized]] = $safeMetrics[$metric];
        }
        foreach ($safePayments as $method => $amount) {
            $header = $paymentHeaders[$method] ?? null;
            if (!is_string($header) || $header === '') continue;
            $normalized = cash_sheet_normalize_header($header);
            if (!array_key_exists($normalized, $headerIndex)) throw new RuntimeException('No se encontró el encabezado configurado para ' . $method . '.');
            $writes[(int) $headerIndex[$normalized]] = $amount;
        }
        if (!$writes) throw new RuntimeException('No hay campos válidos configurados para actualizar.');
        ksort($writes);
        $data = [];
        $writtenFields = [];
        foreach ($writes as $column => $amount) {
            $existingValue = (string) ($values[$targetOffset][$column] ?? '');
            $formulaValue = (string) ($formulaRow[$column] ?? '');
            if (str_starts_with($formulaValue, '=')) throw new RuntimeException('La columna ' . (string) ($headers[$column] ?? '') . ' contiene una fórmula y no se reemplazó.');
            if ($existingValue !== '' && abs(cash_sheet_number($existingValue) - $amount) > 0.01 && abs(cash_sheet_number($existingValue)) > 0.01) {
                throw new RuntimeException('La columna ' . (string) ($headers[$column] ?? '') . ' ya tiene un valor distinto; no se sobrescribió.');
            }
            $cell = cash_sheet_column_name($column) . $rowNumber;
            $data[] = ['range' => "'" . str_replace("'", "''", $sheet) . "'!" . $cell, 'values' => [[$amount]]];
            $writtenFields[(string) ($headers[$column] ?? $cell)] = $amount;
        }
        $url = 'https://sheets.googleapis.com/v4/spreadsheets/' . rawurlencode($spreadsheetId) . '/values:batchUpdate';
        $response = cash_sheet_http($url, [
            'method' => 'POST',
            'headers' => ['Authorization: Bearer ' . $token, 'Content-Type: application/json'],
            'json' => ['valueInputOption' => 'USER_ENTERED', 'data' => $data],
        ]);
        if ($response['status'] !== 200) throw new RuntimeException('Google no confirmó la escritura del cierre.');
        $fieldsJson = json_encode($writtenFields, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $pdo->prepare("UPDATE cash_sheet_sync_runs SET status='verified', spreadsheet_id=?, sheet_name=?, target_row=?, written_fields_json=?, finished_at=NOW() WHERE close_id=?")
            ->execute([$spreadsheetId, $sheet, $rowNumber, $fieldsJson, $closeId]);
        audit($pdo, (int) $user['id'], 'cash_close_synced_to_google_sheet', $site . ' · fila ' . $rowNumber);
        return ['alreadySynced' => false, 'row' => $rowNumber, 'sheet' => $sheet, 'fields' => $writtenFields];
    } catch (Throwable $error) {
        $message = substr(preg_replace('/[\r\n]+/', ' ', $error->getMessage()) ?: 'No se pudo sincronizar el cierre.', 0, 1000);
        $pdo->prepare("UPDATE cash_sheet_sync_runs SET status='failed', error_message=?, finished_at=NOW() WHERE close_id=?")
            ->execute([$message, $closeId]);
        throw $error;
    }
}

function cash_sheet_http(string $url, array $options = []): array
{
    if (!function_exists('curl_init')) throw new RuntimeException('El hosting no tiene disponible cURL.');
    $handle = curl_init($url);
    $headers = $options['headers'] ?? [];
    $settings = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 25, CURLOPT_HTTPHEADER => $headers];
    if (($options['method'] ?? 'GET') === 'POST') {
        $settings[CURLOPT_POST] = true;
        if (array_key_exists('json', $options)) {
            $body = json_encode($options['json'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if ($body === false) throw new RuntimeException('No se pudo preparar el envío a Google Sheets.');
            $settings[CURLOPT_POSTFIELDS] = $body;
        } else {
            $settings[CURLOPT_POSTFIELDS] = http_build_query($options['form'] ?? []);
            if (!in_array('Content-Type: application/x-www-form-urlencoded', $headers, true)) $headers[] = 'Content-Type: application/x-www-form-urlencoded';
            $settings[CURLOPT_HTTPHEADER] = $headers;
        }
    }
    curl_setopt_array($handle, $settings);
    $body = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    curl_close($handle);
    return ['status' => $status, 'json' => json_decode((string) $body, true) ?: []];
}
