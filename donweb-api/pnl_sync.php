<?php

declare(strict_types=1);

/**
 * Consulta el P&L por OAuth de usuario. No escribe en Drive ni en la hoja.
 * La autorización se almacena fuera de public_html y se puede revocar desde
 * la cuenta de Google cuando Administración lo necesite.
 */
function ensure_pnl_sync_schema(PDO $pdo): void
{
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

function pnl_exchange_authorization_code(array $config, string $code): void
{
    $oauth = pnl_oauth_client($config);
    $response = pnl_http('https://oauth2.googleapis.com/token', [
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
        throw new RuntimeException('Google no devolvió una autorización permanente.');
    }
    $payload = json_encode([
        'refresh_token' => $response['json']['refresh_token'],
        'connected_at' => gmdate('c'),
        'scope' => 'spreadsheets.readonly',
    ], JSON_UNESCAPED_SLASHES);
    if ($payload === false || file_put_contents(pnl_private_token_path(), $payload, LOCK_EX) === false) {
        throw new RuntimeException('No se pudo guardar la autorización de Google en el área privada.');
    }
    @chmod(pnl_private_token_path(), 0600);
}

function pnl_access_token(array $config): string
{
    $path = pnl_private_token_path();
    $stored = is_file($path) ? json_decode((string) file_get_contents($path), true) : null;
    $refreshToken = is_array($stored) ? (string) ($stored['refresh_token'] ?? '') : '';
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

function pnl_fetch_sheet_values(array $config): array
{
    $sheetId = (string) ($config['pnl_sync']['spreadsheet_id'] ?? '1K-MQnFGyr1MN_HRtTyXdDrjai8l2-gAPetSmPx11viA');
    $range = (string) ($config['pnl_sync']['range'] ?? "'P&L Consolidado 2026 COPIA'!A1:AN220");
    if ($sheetId === '' || $range === '') throw new RuntimeException('Falta identificar la hoja del P&L.');
    $accessToken = pnl_access_token($config);
    $url = 'https://sheets.googleapis.com/v4/spreadsheets/' . rawurlencode($sheetId) . '/values/' . rawurlencode($range) . '?majorDimension=ROWS';
    $response = pnl_http($url, ['headers' => ['Authorization: Bearer ' . $accessToken]]);
    $rows = $response['json']['values'] ?? null;
    if ($response['status'] !== 200 || !is_array($rows) || count($rows) < 2 || count($rows) > 1000) {
        throw new RuntimeException('No se pudo obtener una versión válida del P&L desde Google.');
    }
    return $rows;
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
