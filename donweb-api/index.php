<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';
require __DIR__ . '/pnl_sync.php';
require __DIR__ . '/cash_sheet_sync.php';
require __DIR__ . '/test_operating_date.php';
require __DIR__ . '/mrp_sync.php';
require __DIR__ . '/assistant.php';
require __DIR__ . '/arca_wsfe.php';

configure_cors($config);
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$route = trim((string) ($_GET['route'] ?? ''), '/');
// La cookie de sesión no protege contra CSRF por sí sola: toda escritura debe
// venir de los orígenes web habilitados. Las lecturas GET no se ven afectadas.
if (in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)
    && !in_array($_SERVER['HTTP_ORIGIN'] ?? '', $config['allowed_origins'], true)) {
    json_response(['ok' => false, 'error' => 'Origen no autorizado.'], 403);
}
try {
    $pdo = db($config);
} catch (Throwable $error) {
    error_log('LARTISAN API database initialization failed: ' . $error->getMessage());
    // El detalle queda en el log; la respuesta pública no revela la tecnología usada.
    json_response(['ok' => false, 'error' => 'database_initialization_failed'], 503);
}
if ($method === 'GET' && ($route === '' || $route === 'health')) {
    $pdo->query('SELECT 1');
    json_response(['ok' => true, 'service' => 'lartisan-api']);
}
// Una migración auxiliar nunca debe bloquear el acceso al sistema. Cada módulo
// también valida su propia estructura justo antes de usarse, donde puede dar un
// error específico sin dejar fuera al resto de la operación.
foreach ([
    'users' => static fn () => ensure_user_locations_schema($pdo),
    'operations' => static fn () => ensure_operations_schema($pdo),
    'mrp' => static fn () => ensure_mrp_schema($pdo),
    'arca_wsfe' => static fn () => ensure_arca_wsfe_schema($pdo),
    'test_operating_date' => static fn () => ensure_test_operating_date_schema($pdo),
] as $schema => $ensure) {
    try {
        $ensure();
    } catch (Throwable $error) {
        error_log('LARTISAN deferred ' . $schema . ' schema update: ' . $error->getMessage());
    }
}

// Con una contraseña temporal solo se puede cambiarla (o salir). Antes esto se
// controlaba únicamente en dos rutas y el resto de las escrituras lo permitía.
if (in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)
    && !in_array($route, ['auth/login', 'auth/logout', 'auth/change-password', 'auth/request-reset', 'auth/confirm-reset-code'], true)) {
    $sessionUser = current_user($pdo);
    if ($sessionUser && !empty($sessionUser['must_change_password'])) {
        json_response(['ok' => false, 'error' => 'Primero debés cambiar la contraseña temporal.'], 403);
    }
}

if ($method === 'GET' && $route === 'admin/arca/status') {
    require_user($pdo, ['administracion']);
    ensure_arca_wsfe_schema($pdo);
    json_response(['ok' => true, 'arca' => arca_wsfe_configuration_status($config)]);
}

// Prueba exclusivamente en homologación: verifica firma y autenticación WSAA.
// No solicita CAE, no crea comprobantes y no toca producción.
if ($method === 'POST' && $route === 'admin/arca/homologation-test') {
    $user = require_user($pdo, ['administracion']);
    if (!in_array($_SERVER['HTTP_ORIGIN'] ?? '', $config['allowed_origins'], true)) {
        json_response(['ok' => false, 'error' => 'Origen no autorizado.'], 403);
    }
    ensure_arca_wsfe_schema($pdo);
    try {
        $ticket = arca_wsaa_request_ticket($config);
        $points = arca_wsfe_configuration_status($config)['pointsOfSale'];
        if (!$points) throw new RuntimeException('No hay puntos de venta ARCA configurados.');
        // Consultas de lectura: validan todos los puntos configurados para
        // Factura A y B. No solicitan CAE ni reservan numeración.
        $checks = [];
        foreach ($points as $site => $configuredPoint) {
            $pointOfSale = (int) $configuredPoint;
            foreach ([1 => 'Factura A', 6 => 'Factura B'] as $voucherType => $label) {
                $checks[] = [
                    'site' => (string) $site,
                    'pointOfSale' => $pointOfSale,
                    'voucherType' => $voucherType,
                    'voucherLabel' => $label,
                    'lastVoucherNumber' => arca_wsfe_last_voucher_number($config, $pointOfSale, $voucherType),
                ];
            }
        }
        // El ticket se prueba y se descarta. Persistir token/sign requiere una
        // clave de cifrado separada que todavía no se configuró en el servidor.
        unset($ticket['token'], $ticket['sign']);
        audit($pdo, (int) $user['id'], 'arca_wsaa_homologation_verified', 'wsfe');
        json_response(['ok' => true, 'environment' => 'homologacion', 'ticketExpiresAt' => $ticket['expiresAt'], 'checks' => $checks]);
    } catch (Throwable $error) {
        // Esta ruta está limitada a Administración y no emite comprobantes. Mostrar
        // la causa operativa permite corregir certificados/configuración sin tener
        // que adivinar frente a un mensaje genérico.
        $arcaError = $error->getMessage();
        error_log('LARTISAN ARCA WSAA homologation test failed: ' . $arcaError);
        audit($pdo, (int) $user['id'], 'arca_wsaa_homologation_failed');
        json_response(['ok' => false, 'error' => 'No se pudo validar ARCA en homologación: ' . $arcaError], 422);
    }
}

// Consulta de producción estrictamente de lectura. Valida WSAA y WSFE para
// todos los puntos configurados mediante FECompUltimoAutorizado: no solicita
// CAE, no reserva numeración y no crea comprobantes.
if (in_array($method, ['GET', 'POST'], true) && $route === 'admin/arca/production-preflight') {
    $user = require_user($pdo, ['administracion']);
    // La variante GET se limita a una consulta autenticada de lectura para
    // permitir la verificación operativa desde Administración. POST conserva
    // la protección de origen para cualquier cliente web.
    if ($method === 'POST' && !in_array($_SERVER['HTTP_ORIGIN'] ?? '', $config['allowed_origins'], true)) {
        json_response(['ok' => false, 'error' => 'Origen no autorizado.'], 403);
    }
    ensure_arca_wsfe_schema($pdo);
    try {
        $status = arca_wsfe_configuration_status($config);
        if ($status['environment'] !== 'produccion' || !$status['readyForProductionTest']) {
            throw new RuntimeException('Producción no está configurada para una consulta segura.');
        }
        $ticket = arca_wsaa_request_ticket($config);
        $checks = [];
        foreach ($status['pointsOfSale'] as $site => $configuredPoint) {
            foreach ([1 => 'Factura A', 6 => 'Factura B'] as $voucherType => $label) {
                $checks[] = [
                    'site' => (string) $site,
                    'pointOfSale' => (int) $configuredPoint,
                    'voucherType' => $voucherType,
                    'voucherLabel' => $label,
                    'lastVoucherNumber' => arca_wsfe_last_voucher_number($config, (int) $configuredPoint, $voucherType),
                ];
            }
        }
        unset($ticket['token'], $ticket['sign']);
        audit($pdo, (int) $user['id'], 'arca_wsfe_production_preflight_verified', 'read_only');
        json_response(['ok' => true, 'environment' => 'produccion', 'ticketExpiresAt' => $ticket['expiresAt'], 'checks' => $checks, 'message' => 'Consulta de producción validada. No se emitió ningún comprobante.']);
    } catch (Throwable $error) {
        $arcaError = $error->getMessage();
        error_log('LARTISAN ARCA production preflight failed: ' . $arcaError);
        audit($pdo, (int) $user['id'], 'arca_wsfe_production_preflight_failed');
        json_response(['ok' => false, 'error' => 'No se pudo validar ARCA en producción: ' . $arcaError], 422);
    }
}

// Cola interna de preparación fiscal. No emite comprobantes ni llama a ARCA.
if ($method === 'GET' && $route === 'admin/arca/fiscal-documents') {
    require_user($pdo, ['administracion']);
    ensure_arca_wsfe_schema($pdo);
    $rows = $pdo->query('SELECT id, sale_reference, site_name, point_of_sale, voucher_type, voucher_number, cae, cae_expires_on, environment, status, response_summary, created_at, updated_at FROM arca_fiscal_documents ORDER BY updated_at DESC LIMIT 200')->fetchAll();
    json_response(['ok' => true, 'documents' => $rows]);
}

if ($method === 'GET' && $route === 'admin/arca/eligible-sales') {
    require_user($pdo, ['administracion']);
    try {
        ensure_normalized_operations_schema($pdo);
        ensure_arca_wsfe_schema($pdo);
        require_once __DIR__ . '/arca_fiscal_queue.php';

        // Esta consulta sólo usa columnas presentes desde la primera versión de
        // ambas tablas. Así la cola no queda fuera de servicio mientras el
        // servidor completa migraciones no esenciales de datos de cliente.
        // Las notas de crédito usan una referencia distinta a la venta, por lo
        // que no hace falta depender de document_kind para excluirlas.
        $cutover = arca_fiscal_cutover($config);
        if (!$cutover) json_response(['ok' => true, 'sales' => [], 'cutoverRequired' => true]);
        // HEX evita comparar textos con collations históricas distintas entre las
        // tablas importadas y las tablas fiscales nuevas.
        $statement = $pdo->prepare("SELECT s.id,s.site,s.occurred_at,s.net_amount,s.invoice_type,s.customer_name,s.status,d.id AS document_id,d.status AS fiscal_status,d.voucher_number,d.cae FROM lartisan_sales s LEFT JOIN arca_fiscal_documents d ON HEX(d.sale_reference) = HEX(s.id) WHERE s.status='activa' AND s.occurred_at >= ? AND s.invoice_type IN ('Factura A','Factura B','Factura B electrónica') ORDER BY s.occurred_at DESC LIMIT 50");
        $statement->execute([$cutover]);
        json_response(['ok' => true, 'sales' => $statement->fetchAll(), 'cutover' => $cutover]);
    } catch (Throwable $error) {
        error_log('LARTISAN fiscal eligible sales failed: ' . $error->getMessage());
        json_response(['ok' => false, 'error' => 'No se pudo cargar la cola fiscal. Intentá nuevamente o revisá la salud de la API.'], 500);
    }
}

if ($method === 'POST' && $route === 'admin/arca/fiscal-documents/prepare') {
    $user = require_user($pdo, ['administracion']);
    if (!in_array($_SERVER['HTTP_ORIGIN'] ?? '', $config['allowed_origins'], true)) {
        json_response(['ok' => false, 'error' => 'Origen no autorizado.'], 403);
    }
    try {
        // Se carga sólo en la operación fiscal: cualquier incompatibilidad futura
        // no puede interrumpir salud, ventas, stock ni el resto de la API.
        require_once __DIR__ . '/arca_fiscal_queue.php';
        $document = arca_prepare_fiscal_document($pdo, $config, (int) $user['id'], request_body());
        audit($pdo, (int) $user['id'], 'arca_fiscal_document_prepared', (string) ($document['sale_reference'] ?? ''));
        json_response(['ok' => true, 'document' => $document, 'message' => 'Comprobante preparado internamente. No se emitió CAE ni se informó a ARCA.']);
    } catch (InvalidArgumentException $error) {
        json_response(['ok' => false, 'error' => $error->getMessage()], 422);
    } catch (PDOException $error) {
        throw $error;
    } catch (RuntimeException $error) {
        // Configuración fiscal faltante: Administración necesita el motivo exacto.
        json_response(['ok' => false, 'error' => $error->getMessage()], 422);
    }
}

if ($method === 'POST' && $route === 'admin/arca/fiscal-documents/issue') {
    $user = require_user($pdo, ['administracion']);
    if (!in_array($_SERVER['HTTP_ORIGIN'] ?? '', $config['allowed_origins'], true)) json_response(['ok' => false, 'error' => 'Origen no autorizado.'], 403);
    try {
        require_once __DIR__ . '/arca_fiscal_queue.php';
        $document = arca_issue_fiscal_document($pdo, $config, (int) $user['id'], (int) (request_body()['documentId'] ?? 0));
        audit($pdo, (int) $user['id'], 'arca_fiscal_document_authorized', (string) ($document['id'] ?? ''));
        json_response(['ok' => true, 'document' => $document, 'message' => 'Comprobante autorizado por ARCA con CAE.']);
    } catch (InvalidArgumentException $error) { json_response(['ok' => false, 'error' => $error->getMessage()], 422); }
    catch (PDOException $error) { throw $error; }
    // Incluye "ARCA no confirmó la emisión… pendiente de conciliación": Administración
    // debe verlo para no reintentar un comprobante que ARCA pudo haber autorizado.
    catch (RuntimeException $error) { json_response(['ok' => false, 'error' => $error->getMessage()], 422); }
}

if ($method === 'POST' && $route === 'admin/arca/fiscal-documents/credit-note/prepare') {
    $user = require_user($pdo, ['administracion']);
    if (!in_array($_SERVER['HTTP_ORIGIN'] ?? '', $config['allowed_origins'], true)) json_response(['ok' => false, 'error' => 'Origen no autorizado.'], 403);
    try {
        require_once __DIR__ . '/arca_fiscal_queue.php';
        $document = arca_prepare_credit_note($pdo, $config, (int) $user['id'], request_body());
        audit($pdo, (int) $user['id'], 'arca_credit_note_prepared', (string) ($document['id'] ?? ''));
        json_response(['ok' => true, 'document' => $document, 'message' => 'Nota de crédito preparada. Requiere confirmación explícita antes de solicitar CAE.']);
    } catch (InvalidArgumentException $error) { json_response(['ok' => false, 'error' => $error->getMessage()], 422); }
    catch (PDOException $error) { throw $error; }
    catch (RuntimeException $error) { json_response(['ok' => false, 'error' => $error->getMessage()], 422); }
}
$pdo->exec(
    "CREATE TABLE IF NOT EXISTS password_recovery_codes (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        code_hash VARCHAR(255) NOT NULL,
        attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        expires_at DATETIME NOT NULL,
        used_at DATETIME NULL,
        requested_ip VARCHAR(45) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_recovery_user_created (user_id, created_at),
        INDEX idx_recovery_expiry (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
);

if ($method === 'GET' && $route === 'admin/pnl/google-callback') {
    $state = (string) ($_GET['state'] ?? '');
    $code = (string) ($_GET['code'] ?? '');
    $stateHash = hash('sha256', $state);
    ensure_pnl_sync_schema($pdo);
    $lookup = $pdo->prepare('SELECT user_id FROM pnl_oauth_states WHERE state_hash = ? AND expires_at > NOW() LIMIT 1');
    $lookup->execute([$stateHash]);
    $userId = $lookup->fetchColumn();
    $pdo->prepare('DELETE FROM pnl_oauth_states WHERE state_hash = ?')->execute([$stateHash]);
    $success = false;
    $message = 'No se pudo validar la autorización de Google.';
    try {
        if (!$userId || $code === '') throw new RuntimeException($message);
        pnl_exchange_authorization_code($pdo, $config, $code);
        audit($pdo, (int) $userId, 'pnl_google_connected', 'lectura_solo');
        $success = true;
        $message = 'Google quedó conectado con permiso de solo lectura. Ya podés volver a Administración y actualizar el P&L.';
    } catch (Throwable $error) {
        $message = 'No se pudo conectar Google: ' . htmlspecialchars($error->getMessage(), ENT_QUOTES, 'UTF-8');
    }
    http_response_code($success ? 200 : 400);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>L’ARTISAN · P&L</title><body style="font-family:Arial,sans-serif;padding:40px;color:#183a67"><h1>' . ($success ? 'Conexión lista' : 'No se pudo completar') . '</h1><p>' . $message . '</p><p><a href="https://admin.lartisantaller.com/">Volver a Administración</a></p></body></html>';
    exit;
}

if ($method === 'GET' && $route === 'admin/pnl/authorization-url') {
    $admin = require_user($pdo, ['administracion']);
    try {
        json_response(['ok' => true, 'authorizationUrl' => pnl_authorization_url($pdo, $config, (int) $admin['id'])]);
    } catch (PDOException $error) {
        throw $error;
    } catch (RuntimeException $error) {
        // Ej.: "La conexión de Google no está configurada todavía."
        json_response(['ok' => false, 'error' => $error->getMessage()], 422);
    }
}

// La autorización de escritura de cierres no comparte el token de lectura de
// P&L. Así se puede revocar una sin afectar la otra y nunca se amplían
// silenciosamente permisos que Administración no aprobó.
if ($method === 'GET' && $route === 'admin/cash-sheets/google-callback') {
    $state = (string) ($_GET['state'] ?? '');
    $code = (string) ($_GET['code'] ?? '');
    ensure_cash_sheet_sync_schema($pdo);
    $lookup = $pdo->prepare('SELECT user_id FROM cash_sheet_oauth_states WHERE state_hash = ? AND expires_at > NOW() LIMIT 1');
    $lookup->execute([hash('sha256', $state)]);
    $userId = $lookup->fetchColumn();
    $pdo->prepare('DELETE FROM cash_sheet_oauth_states WHERE state_hash = ?')->execute([hash('sha256', $state)]);
    $success = false;
    $message = 'No se pudo validar la autorización de Google Sheets.';
    try {
        if (!$userId || $code === '') throw new RuntimeException($message);
        cash_sheet_exchange_authorization_code($pdo, $config, $code);
        audit($pdo, (int) $userId, 'cash_sheets_google_connected', 'escritura_cierres');
        $success = true;
        $message = 'Google Sheets quedó conectado para los cierres. Volvé a Administración para hacer la prueba controlada.';
    } catch (Throwable $error) {
        $message = 'No se pudo conectar Google Sheets: ' . htmlspecialchars($error->getMessage(), ENT_QUOTES, 'UTF-8');
    }
    http_response_code($success ? 200 : 400);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>L’ARTISAN · Google Sheets</title><body style="font-family:Arial,sans-serif;padding:40px;color:#183a67"><h1>' . ($success ? 'Conexión lista' : 'No se pudo completar') . '</h1><p>' . $message . '</p><p><a href="https://admin.lartisantaller.com/">Volver a Administración</a></p></body></html>';
    exit;
}

if ($method === 'GET' && $route === 'admin/cash-sheets/status') {
    require_user($pdo, ['administracion']);
    ensure_cash_sheet_sync_schema($pdo);
    $locations = is_array($config['cash_sheet_sync']['locations'] ?? null) ? $config['cash_sheet_sync']['locations'] : [];
    $configured = [];
    foreach (operational_sites() as $site) {
        $item = $locations[$site] ?? [];
        $configured[$site] = is_array($item) && trim((string) ($item['spreadsheet_id'] ?? '')) !== '' && trim((string) ($item['sheet'] ?? '')) !== '';
    }
    $last = $pdo->query("SELECT site,status,business_date,sheet_name,target_row,finished_at,error_message FROM cash_sheet_sync_runs ORDER BY started_at DESC LIMIT 20")->fetchAll();
    json_response(['ok' => true, 'provider' => cash_sheet_provider($config), 'connected' => cash_sheet_is_connected($pdo, $config), 'configured' => $configured, 'lastRuns' => $last]);
}

if ($method === 'GET' && $route === 'admin/cash-sheets/authorization-url') {
    $admin = require_user($pdo, ['administracion']);
    if (cash_sheet_provider($config) === 'apps_script') {
        json_response(['ok' => false, 'error' => 'La integración usa Apps Script. Publicá el script con el dueño de las planillas y configurá su URL segura en el servidor.'], 409);
    }
    try {
        json_response(['ok' => true, 'authorizationUrl' => cash_sheet_authorization_url($pdo, $config, (int) $admin['id'])]);
    } catch (RuntimeException $error) {
        json_response(['ok' => false, 'error' => $error->getMessage()], 422);
    }
}

// Fecha operativa de prueba: sólo Administración puede habilitarla y su
// alcance no es configurable desde el navegador. La lectura está autenticada
// para que Ventas pueda representar la misma fecha que validará la API.
if ($method === 'GET' && $route === 'operations/test-operating-date') {
    require_user($pdo);
    json_response(['ok' => true, 'testOperatingDate' => test_operating_date_public_payload($pdo)]);
}

if ($method === 'POST' && $route === 'admin/test-operating-date/enable') {
    $admin = require_user($pdo, ['administracion']);
    $input = request_body();
    $site = trim((string) ($input['site'] ?? ''));
    $businessDate = trim((string) ($input['businessDate'] ?? ''));
    $label = trim((string) ($input['label'] ?? ''));
    $purpose = trim((string) ($input['purpose'] ?? ''));
    validate_test_operating_date_scope($site, $businessDate, $label);
    if ($purpose === '' || mb_strlen($purpose) > 500) {
        json_response(['ok' => false, 'error' => 'Indicá el motivo auditado de la prueba.'], 422);
    }
    ensure_test_operating_date_schema($pdo);
    $active = active_test_operating_date($pdo);
    if ($active !== null) {
        if ((string) $active['site'] !== $site || (string) $active['business_date'] !== $businessDate) {
            json_response(['ok' => false, 'error' => 'Ya existe una ventana de prueba activa; cerrala antes de habilitar otra.'], 409);
        }
        json_response(['ok' => true, 'testOperatingDate' => test_operating_date_public_payload($pdo)]);
    }
    $pdo->prepare("INSERT INTO test_operating_date_runs (site,business_date,label,purpose,status,enabled_by) VALUES (?,?,?,?,'active',?)")
        ->execute([$site, $businessDate, $label, $purpose, (int) $admin['id']]);
    audit($pdo, (int) $admin['id'], 'test_operating_date_enabled', $site . ' · ' . $businessDate . ' · ' . $label . ' · ' . mb_substr($purpose, 0, 300));
    json_response(['ok' => true, 'testOperatingDate' => test_operating_date_public_payload($pdo)]);
}

if ($method === 'POST' && $route === 'admin/test-operating-date/disable') {
    $admin = require_user($pdo, ['administracion']);
    ensure_test_operating_date_schema($pdo);
    $active = active_test_operating_date($pdo);
    if ($active !== null) {
        $pdo->prepare("UPDATE test_operating_date_runs SET status='disabled',disabled_by=?,disabled_at=NOW() WHERE id=? AND status='active'")
            ->execute([(int) $admin['id'], (int) $active['id']]);
        audit($pdo, (int) $admin['id'], 'test_operating_date_disabled', (string) $active['site'] . ' · ' . (string) $active['business_date'] . ' · ' . (string) $active['label']);
    }
    json_response(['ok' => true, 'testOperatingDate' => ['active' => false]]);
}

if ($method === 'POST' && $route === 'cash-sheets/close') {
    $user = require_user($pdo);
    try {
        $result = cash_sheet_sync_close($pdo, $config, $user, request_body());
        json_response(['ok' => true, 'sync' => $result]);
    } catch (InvalidArgumentException $error) {
        json_response(['ok' => false, 'error' => $error->getMessage()], 422);
    } catch (RuntimeException $error) {
        error_log('LARTISAN cash-sheet sync failed: ' . $error->getMessage());
        json_response(['ok' => false, 'error' => $error->getMessage()], 503);
    }
}

if ($method === 'POST' && $route === 'cash-sheets/adjustment') {
    $user = require_user($pdo);
    try {
        $result = cash_sheet_sync_adjustment($pdo, $config, $user, request_body());
        json_response(['ok' => true, 'sync' => $result]);
    } catch (InvalidArgumentException $error) {
        json_response(['ok' => false, 'error' => $error->getMessage()], 422);
    } catch (RuntimeException $error) {
        error_log('LARTISAN cash-sheet adjustment failed: ' . $error->getMessage());
        json_response(['ok' => false, 'error' => $error->getMessage()], 503);
    }
}

if ($method === 'GET' && $route === 'admin/pnl/latest') {
    require_user($pdo, ['administracion']);
    ensure_pnl_sync_schema($pdo);
    $latest = $pdo->query("SELECT rows_imported, payload_json, started_at, finished_at FROM pnl_sync_runs WHERE status = 'verified' ORDER BY id DESC LIMIT 1")->fetch();
    $connected = pnl_is_connected($pdo, $config);
    json_response([
        'ok' => true,
        'connected' => $connected,
        'snapshot' => $latest ? [
            'rows' => json_decode((string) $latest['payload_json'], true) ?: [],
            'rowsImported' => (int) $latest['rows_imported'],
            'updatedAt' => $latest['finished_at'] ?: $latest['started_at'],
        ] : null,
    ]);
}

if ($method === 'POST' && $route === 'admin/pnl/sync') {
    $admin = require_user($pdo, ['administracion']);
    ensure_pnl_sync_schema($pdo);
    $last = $pdo->query("SELECT started_at FROM pnl_sync_runs WHERE started_at >= DATE_SUB(NOW(), INTERVAL 1 MINUTE) ORDER BY id DESC LIMIT 1")->fetchColumn();
    if ($last) json_response(['ok' => false, 'error' => 'Esperá un minuto antes de volver a sincronizar.'], 429);
    $sheetId = trim((string) ($config['pnl_sync']['spreadsheet_id'] ?? ''));
    $range = (string) ($config['pnl_sync']['range'] ?? "'P&L Consolidado 2026 COPIA'!A1:AN220");
    if ($sheetId === '') json_response(['ok' => false, 'error' => 'La fuente financiera no está configurada en el servidor'], 503);
    $pdo->prepare("INSERT INTO pnl_sync_runs (status, source_spreadsheet_id, source_range, triggered_by, started_at) VALUES ('running', ?, ?, ?, NOW())")
        ->execute([$sheetId, $range, $admin['id']]);
    $runId = (int) $pdo->lastInsertId();
    try {
        $rows = pnl_fetch_sheet_values($pdo, $config);
        $payload = json_encode($rows, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($payload === false) throw new RuntimeException('No se pudo guardar la copia de lectura del P&L.');
        $pdo->prepare("UPDATE pnl_sync_runs SET status = 'verified', rows_imported = ?, payload_json = ?, payload_hash = ?, finished_at = NOW() WHERE id = ?")
            ->execute([count($rows), $payload, hash('sha256', $payload), $runId]);
        audit($pdo, (int) $admin['id'], 'pnl_synced_from_google', 'filas=' . count($rows));
        json_response(['ok' => true, 'snapshot' => ['rows' => $rows, 'rowsImported' => count($rows), 'updatedAt' => date('Y-m-d H:i:s')]]);
    } catch (Throwable $error) {
        $pdo->prepare("UPDATE pnl_sync_runs SET status = 'failed', error_message = ?, finished_at = NOW() WHERE id = ?")
            ->execute([substr($error->getMessage(), 0, 1000), $runId]);
        audit($pdo, (int) $admin['id'], 'pnl_sync_failed');
        json_response(['ok' => false, 'error' => 'No se pudo actualizar el P&L. Se conserva la última versión válida.'], 502);
    }
}

if ($method === 'GET' && $route === 'admin/expenses/latest') {
    $admin = require_user($pdo, ['administracion']);
    ensure_expense_sync_schema($pdo);
    $latest = $pdo->query("SELECT rows_imported, payload_json, started_at, finished_at FROM expense_sync_runs WHERE status = 'verified' ORDER BY id DESC LIMIT 1")->fetch();
    $connected = pnl_is_connected($pdo, $config);
    $lastUpdate = $latest ? ($latest['finished_at'] ?: $latest['started_at']) : null;
    $stale = !$lastUpdate || strtotime((string) $lastUpdate) < (time() - 15 * 60);
    // Evita lecturas simultáneas desde varias pestañas y reintentos continuos
    // si Drive devuelve un error. Administración conserva "Actualizar ahora".
    $recentAttempt = $pdo->query("SELECT started_at FROM expense_sync_runs WHERE started_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE) ORDER BY id DESC LIMIT 1")->fetchColumn();
    if ($connected && $stale && !$recentAttempt) {
        try {
            expense_sync_from_google($pdo, $config, (int) $admin['id']);
            $latest = $pdo->query("SELECT rows_imported, payload_json, started_at, finished_at FROM expense_sync_runs WHERE status = 'verified' ORDER BY id DESC LIMIT 1")->fetch();
        } catch (Throwable $error) {
            error_log('LARTISAN automatic expense sync failed: ' . $error->getMessage());
        }
    }
    json_response([
        'ok' => true,
        'connected' => $connected,
        'snapshot' => $latest ? [
            'data' => json_decode((string) $latest['payload_json'], true) ?: [],
            'rowsImported' => (int) $latest['rows_imported'],
            'updatedAt' => $latest['finished_at'] ?: $latest['started_at'],
        ] : null,
    ]);
}

if ($method === 'POST' && $route === 'admin/expenses/sync') {
    $admin = require_user($pdo, ['administracion']);
    ensure_expense_sync_schema($pdo);
    $last = $pdo->query("SELECT started_at FROM expense_sync_runs WHERE started_at >= DATE_SUB(NOW(), INTERVAL 1 MINUTE) ORDER BY id DESC LIMIT 1")->fetchColumn();
    if ($last) json_response(['ok' => false, 'error' => 'Esperá un minuto antes de volver a sincronizar.'], 429);
    try {
        json_response(['ok' => true, 'snapshot' => expense_sync_from_google($pdo, $config, (int) $admin['id'])]);
    } catch (Throwable $error) {
        json_response(['ok' => false, 'error' => 'No se pudieron actualizar gastos y cuentas por pagar. Se conserva la última versión válida.'], 502);
    }
}

if ($method === 'GET' && $route === 'mrp/latest') {
    $mrpUser = require_mrp_user($pdo);
    ensure_mrp_schema($pdo);
    $latest = $pdo->query("SELECT payload_json, rows_imported, started_at, finished_at FROM mrp_sync_runs WHERE status='verified' ORDER BY id DESC LIMIT 1")->fetch();
    // Reading the catalog never triggers imports, OAuth or background replacement.
    $lastAttempt = $pdo->query("SELECT id, status, error_message, started_at FROM mrp_sync_runs ORDER BY id DESC LIMIT 1")->fetch();
    $review = $pdo->query('SELECT required_review, recipe_key, changed_at FROM mrp_recipe_review_state WHERE id=1')->fetch();
    $data = $latest ? mrp_apply_actual_stock($pdo, mrp_apply_recipe_overrides($pdo, json_decode((string) $latest['payload_json'], true) ?: [])) : null;
    if ($data && $review && (int) $review['required_review'] === 1) $data['recipeReview'] = ['required' => true, 'recipeKey' => $review['recipe_key'], 'changedAt' => $review['changed_at']];
    json_response(['ok' => true, 'importMode' => 'one_time_file',
        'canImport' => $mrpUser['role'] === 'administracion',
        'lastAttempt' => $lastAttempt ? ['id' => $lastAttempt['id'], 'status' => $lastAttempt['status'], 'startedAt' => $lastAttempt['started_at']] : null,
        'snapshot' => $latest ? [
        'data' => $data,
        'rowsImported' => (int) $latest['rows_imported'],
        'updatedAt' => $latest['finished_at'] ?: $latest['started_at'],
    ] : null, 'canEditRecipes' => mrp_can_edit_recipes($mrpUser)]);
}

if ($method === 'GET' && $route === 'mrp/recipes/history') {
    require_mrp_user($pdo); ensure_mrp_schema($pdo);
    $rows = $pdo->query("SELECT l.recipe_key, l.before_json, l.after_json, l.changed_at, COALESCE(NULLIF(u.full_name, ''), u.username, 'Sistema') AS changed_by
        FROM mrp_recipe_change_log l LEFT JOIN users u ON u.id=l.changed_by ORDER BY l.changed_at DESC, l.id DESC LIMIT 50")->fetchAll();
    $history = array_map(static function (array $row): array {
        $before = $row['before_json'] ? json_decode((string) $row['before_json'], true) : null;
        $after = json_decode((string) $row['after_json'], true) ?: [];
        return ['recipe' => $after['recipe'] ?? $row['recipe_key'], 'changedBy' => $row['changed_by'], 'changedAt' => $row['changed_at'], 'previousCost' => $before['costPerUnit'] ?? null, 'currentCost' => $after['costPerUnit'] ?? null, 'components' => $after['components'] ?? 0];
    }, $rows);
    json_response(['ok' => true, 'history' => $history]);
}

if ($method === 'GET' && $route === 'purchase-costs/catalog') {
    $user = require_user($pdo, ['administracion', 'vendedora', 'supervisora', 'compras']); ensure_mrp_schema($pdo);
    if (!mrp_can_register_production_purchase($user)) json_response(['ok' => false, 'error' => 'Tu usuario no tiene el permiso «Cargar compras de producción» con acceso a Villa Mitre. Pedíselo a Administración.'], 403);
    $latest = $pdo->query("SELECT payload_json FROM mrp_sync_runs WHERE status='verified' ORDER BY id DESC LIMIT 1")->fetchColumn();
    $snapshot = mrp_apply_recipe_overrides($pdo, json_decode((string) $latest, true) ?: []);
    $inputs = array_map(static fn (array $input): array => ['key' => mrp_key($input['item'] ?? ''), 'name' => (string) ($input['item'] ?? ''), 'unit' => (string) ($input['unit'] ?? $input['stockUnit'] ?? 'unidad'), 'unitCost' => $input['unitCost'] ?? null], $snapshot['inputs'] ?? []);
    usort($inputs, static fn (array $a, array $b): int => strnatcasecmp($a['name'], $b['name']));
    $history = $pdo->query("SELECT h.*, COALESCE(NULLIF(u.full_name,''),u.username) AS loaded_by_name FROM mrp_input_cost_history h LEFT JOIN users u ON u.id=h.loaded_by ORDER BY h.created_at DESC, h.id DESC LIMIT 200")->fetchAll();
    $orders = $pdo->query("SELECT id, source_order_id, item_name, provider_name, unit, quantity, status FROM mrp_purchase_orders WHERE status IN ('Por pedir','Pedido','Recibido') ORDER BY created_at DESC LIMIT 300")->fetchAll();
    json_response(['ok' => true, 'inputs' => $inputs, 'history' => $history, 'orders' => $orders, 'canLoad' => true]);
}

if ($method === 'POST' && $route === 'purchase-costs') {
    $user = require_user($pdo, ['administracion', 'vendedora', 'supervisora', 'compras']); ensure_mrp_schema($pdo);
    if (!mrp_can_register_production_purchase($user)) json_response(['ok' => false, 'error' => 'Tu usuario no tiene el permiso «Cargar compras de producción» con acceso a Villa Mitre. Pedíselo a Administración.'], 403);
    if (!in_array($_SERVER['HTTP_ORIGIN'] ?? '', $config['allowed_origins'], true)) json_response(['ok' => false, 'error' => 'Origen no autorizado.'], 403);
    $body = request_body(); $provider = mrp_clean_text($body['provider'] ?? '', 190); $invoice = mrp_clean_text($body['invoice'] ?? '', 100); $date = mrp_clean_text($body['purchaseDate'] ?? '', 10); $paymentMethod = mrp_clean_text($body['paymentMethod'] ?? '', 60); $lines = $body['lines'] ?? [];
    if ($provider === '' || $invoice === '' || !preg_match('/^\\d{4}-\\d{2}-\\d{2}$/', $date) || !is_array($lines) || count($lines) < 1 || count($lines) > 100) json_response(['ok' => false, 'error' => 'Indicá fecha, proveedor, factura y al menos un insumo válido.'], 422);
    $latest = $pdo->query("SELECT payload_json FROM mrp_sync_runs WHERE status='verified' ORDER BY id DESC LIMIT 1")->fetchColumn(); $base = json_decode((string) $latest, true) ?: [];
    $known = []; foreach (($base['inputs'] ?? []) as $input) $known[mrp_key($input['item'] ?? '')] = $input;
    $clean = []; foreach ($lines as $line) { $key = mrp_key($line['inputKey'] ?? ''); $quantity = (float) ($line['quantity'] ?? 0); $cost = (float) ($line['unitCost'] ?? 0); $expectedQuantity = ($line['expectedQuantity'] ?? '') === '' ? null : (float) $line['expectedQuantity']; $expectedCost = ($line['expectedUnitCost'] ?? '') === '' ? null : (float) $line['expectedUnitCost']; $orderReference = mrp_clean_text($line['sourceOrderReference'] ?? '', 100); $observations = mrp_clean_text($line['observations'] ?? '', 1000); if (!isset($known[$key]) || !is_finite($quantity) || $quantity <= 0 || !is_finite($cost) || $cost <= 0 || ($expectedQuantity !== null && (!is_finite($expectedQuantity) || $expectedQuantity < 0)) || ($expectedCost !== null && (!is_finite($expectedCost) || $expectedCost <= 0))) json_response(['ok' => false, 'error' => 'Cada línea debe usar un insumo válido, cantidad y costo positivos; los valores esperados deben ser válidos.'], 422); $clean[] = [$key, $quantity, $cost, $expectedQuantity, $expectedCost, $orderReference ?: null, $observations ?: null]; }
    $batch = sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x', mt_rand(0,65535), mt_rand(0,65535), mt_rand(0,65535), mt_rand(0,65535), mt_rand(16384,20479), mt_rand(0,65535), mt_rand(0,65535), mt_rand(0,65535)); $warnings = [];
    $pdo->beginTransaction(); try { foreach ($clean as [$key, $quantity, $cost, $expectedQuantity, $expectedCost, $orderReference, $observations]) { $previousStmt=$pdo->prepare('SELECT unit_cost FROM mrp_input_cost_overrides WHERE input_key=?'); $previousStmt->execute([$key]); $previous=$previousStmt->fetchColumn(); if ($previous === false) $previous=$known[$key]['unitCost'] ?? null; $previous=$previous === null ? null : (float)$previous; $warning=$previous && ($cost/$previous >= 2 || $cost/$previous <= .5); if ($warning) $warnings[]=$known[$key]['item'] ?? $key; $unit=mrp_clean_text($known[$key]['unit'] ?? $known[$key]['stockUnit'] ?? 'unidad',40); $differences=[]; if ($expectedQuantity !== null && abs($quantity-$expectedQuantity) > 0.0001) $differences[]='cantidad real distinta a la solicitada'; if ($expectedCost !== null && abs($cost-$expectedCost) > 0.0001) $differences[]='precio real distinto al previsto'; $validation = $expectedQuantity === null && $expectedCost === null ? 'Sin referencia' : ($differences ? 'Con diferencia' : 'Validada'); $reason = $differences ? implode('; ', $differences) : null; $pdo->prepare('INSERT INTO mrp_input_cost_history (batch_id,input_key,input_name,unit,quantity,expected_quantity,previous_unit_cost,expected_unit_cost,new_unit_cost,provider_name,invoice_number,source_order_reference,payment_method,purchase_date,variation_warning,validation_status,difference_reason,observations,loaded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([$batch,$key,$known[$key]['item'] ?? $key,$unit,$quantity,$expectedQuantity,$previous,$expectedCost,$cost,$provider,$invoice,$orderReference,$paymentMethod ?: null,$date,$warning?1:0,$validation,$reason,$observations,$user['id']]); $pdo->prepare('INSERT INTO mrp_input_cost_overrides (input_key,unit_cost,updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE unit_cost=VALUES(unit_cost),updated_by=VALUES(updated_by),updated_at=NOW()')->execute([$key,$cost,$user['id']]); } $pdo->prepare('INSERT INTO mrp_recipe_review_state (id,required_review,recipe_key,changed_by,changed_at) VALUES (1,1,?,?,NOW()) ON DUPLICATE KEY UPDATE required_review=1,recipe_key=VALUES(recipe_key),changed_by=VALUES(changed_by),changed_at=NOW()')->execute(['costos-de-insumos',$user['id']]); audit($pdo,(int)$user['id'],'production_purchase_loaded','factura='.$invoice.'; lote='.$batch); $pdo->commit(); } catch (Throwable $error) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $error; }
    json_response(['ok'=>true,'batchId'=>$batch,'warnings'=>$warnings]);
}

if ($method === 'PUT' && preg_match('#^mrp/recipes/([a-z0-9 -]+)$#i', $route, $matches)) {
    $mrpUser = require_mrp_user($pdo);
    if (!mrp_can_edit_recipes($mrpUser)) json_response(['ok' => false, 'error' => 'Tu usuario no tiene el permiso «Editar recetas y costos». Pedíselo a Administración.'], 403);
    ensure_mrp_schema($pdo);
    if (!in_array($_SERVER['HTTP_ORIGIN'] ?? '', $config['allowed_origins'], true)) json_response(['ok' => false, 'error' => 'Origen no autorizado.'], 403);
    $body = request_body(); $key = mrp_key(rawurldecode($matches[1]));
    $name = mrp_clean_text($body['recipe'] ?? '', 190); $yield = (float) ($body['yield'] ?? 0); $items = $body['items'] ?? [];
    if ($key === '' || $name === '' || !is_finite($yield) || $yield <= 0 || !is_array($items) || count($items) < 1 || count($items) > 100) json_response(['ok' => false, 'error' => 'Indicá receta, rendimiento y al menos un componente válido.'], 422);
    $cleanItems = [];
    foreach ($items as $line) {
        $ingredient = mrp_clean_text($line['ingredient'] ?? '', 190); $quantity = (float) ($line['quantity'] ?? 0); $unit = mrp_clean_text($line['unit'] ?? '', 40);
        if ($ingredient === '' || $unit === '' || !is_finite($quantity) || $quantity <= 0) json_response(['ok' => false, 'error' => 'Cada componente requiere insumo, cantidad y unidad válidos.'], 422);
        $cleanItems[] = ['sourceLine' => count($cleanItems) + 1, 'ingredient' => $ingredient, 'quantity' => $quantity, 'unit' => $unit, 'yield' => $yield, 'perUnit' => $quantity / $yield, 'expectedPerUnit' => $quantity / $yield, 'type' => mrp_clean_text($line['type'] ?? 'Insumo', 80), 'dictionaryCheck' => '', 'unitCheck' => ''];
    }
    $latestPayload = $pdo->query("SELECT payload_json FROM mrp_sync_runs WHERE status='verified' ORDER BY id DESC LIMIT 1")->fetchColumn();
    $latestData = json_decode((string) $latestPayload, true) ?: []; $inputCosts = []; $recipeCosts = [];
    foreach (($latestData['inputs'] ?? []) as $input) $inputCosts[mrp_key($input['item'] ?? '')] = $input['unitCost'] ?? null;
    foreach (mrp_apply_recipe_overrides($pdo, $latestData)['recipes'] ?? [] as $known) $recipeCosts[mrp_key($known['recipe'] ?? '')] = $known['costPerUnit'] ?? null;
    $cost = 0.0; $missing = [];
    foreach ($cleanItems as $item) { $componentKey = mrp_key($item['ingredient']); $componentCost = strpos(mrp_lower($item['type']), 'subreceta') !== false ? ($recipeCosts[$componentKey] ?? null) : ($inputCosts[$componentKey] ?? null); if ($componentCost === null || (float) $componentCost <= 0) $missing[] = $item['ingredient']; else $cost += $item['perUnit'] * (float) $componentCost; }
    $recipe = ['sourceKey' => $key, 'recipe' => $name, 'yield' => $yield, 'components' => count($cleanItems), 'costPerUnit' => $missing ? null : round($cost, 4), 'costStatus' => $missing ? 'Pendiente de costo' : 'Calculado', 'missingCosts' => array_values(array_unique($missing)), 'items' => $cleanItems];
    $old = $pdo->prepare('SELECT recipe_json FROM mrp_recipe_overrides WHERE recipe_key=?'); $old->execute([$key]); $before = $old->fetchColumn();
    $json = json_encode($recipe, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    $pdo->beginTransaction();
    try {
        $pdo->prepare('INSERT INTO mrp_recipe_overrides (recipe_key,recipe_json,updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE recipe_json=VALUES(recipe_json),updated_by=VALUES(updated_by),updated_at=NOW()')->execute([$key, $json, $mrpUser['id']]);
        $pdo->prepare('INSERT INTO mrp_recipe_change_log (recipe_key,before_json,after_json,changed_by) VALUES (?,?,?,?)')->execute([$key, $before ?: null, $json, $mrpUser['id']]);
        $pdo->prepare('INSERT INTO mrp_recipe_review_state (id,required_review,recipe_key,changed_by,changed_at) VALUES (1,1,?,?,NOW()) ON DUPLICATE KEY UPDATE required_review=1,recipe_key=VALUES(recipe_key),changed_by=VALUES(changed_by),changed_at=NOW()')->execute([$key, $mrpUser['id']]);
        audit($pdo, (int) $mrpUser['id'], 'mrp_recipe_saved', $key); $pdo->commit();
    } catch (Throwable $error) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $error; }
    json_response(['ok' => true, 'recipe' => $recipe]);
}

if ($method === 'POST' && $route === 'mrp/sync') {
    require_mrp_user($pdo);
    json_response(['ok' => false, 'error' => 'La sincronización MRP fue reemplazada por una importación única desde archivo.'], 409);
}

if ($method === 'POST' && $route === 'mrp/import') {
    $admin = require_user($pdo, ['administracion']);
    // Cookie authentication alone is not a CSRF boundary.
    if (!in_array($_SERVER['HTTP_ORIGIN'] ?? '', $config['allowed_origins'], true))
        json_response(['ok' => false, 'error' => 'Origen no autorizado.'], 403);
    if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0)
        json_response(['ok' => false, 'error' => 'Se requiere un archivo JSON.'], 415);
    $raw = file_get_contents('php://input', false, null, 0, 2000001);
    if ($raw === false || strlen($raw) > 2000000) json_response(['ok' => false, 'error' => 'Archivo demasiado grande.'], 413);
    try {
        $bundle = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
        if (!is_array($bundle)) throw new InvalidArgumentException('Archivo inválido.');
        json_response(['ok' => true, 'result' => mrp_import_once($pdo, $bundle, (int) $admin['id'])]);
    } catch (InvalidArgumentException | JsonException $error) {
        json_response(['ok' => false, 'error' => $error->getMessage()], 422);
    } catch (Throwable $error) {
        error_log('LARTISAN one-time MRP import failed: ' . $error->getMessage());
        json_response(['ok' => false, 'error' => 'No se completó la importación. No se guardó una carga parcial.'], 500);
    }
}

if ($method === 'GET' && $route === 'mrp/operations') {
    require_mrp_user($pdo);
    ensure_mrp_schema($pdo);
    $orders = $pdo->query("SELECT o.*, COALESCE(SUM(r.quantity_received),0) AS received_quantity FROM mrp_purchase_orders o LEFT JOIN mrp_receipts r ON r.purchase_order_id=o.id GROUP BY o.id ORDER BY o.created_at DESC LIMIT 200")->fetchAll();
    $controls = $pdo->query("SELECT * FROM mrp_weekly_controls ORDER BY updated_at DESC LIMIT 200")->fetchAll();
    $stocks = $pdo->query("SELECT s.*, COALESCE(NULLIF(u.full_name,''),u.username) AS counted_by_name FROM mrp_input_stock s LEFT JOIN users u ON u.id=s.counted_by ORDER BY s.input_name LIMIT 500")->fetchAll();
    json_response(['ok' => true, 'orders' => $orders, 'controls' => $controls, 'stocks' => $stocks, 'canCountStock' => mrp_can_count_stock(require_mrp_user($pdo))]);
}

if ($method === 'POST' && $route === 'mrp/stock-counts') {
    $mrpUser = require_mrp_user($pdo);
    if (!mrp_can_count_stock($mrpUser)) json_response(['ok' => false, 'error' => 'Tu usuario no tiene el permiso «Contar stock de insumos (MRP)». Pedíselo a Administración.'], 403);
    ensure_mrp_schema($pdo);
    $body = request_body();
    $key = mrp_clean_text($body['inputKey'] ?? '', 190);
    $name = mrp_clean_text($body['inputName'] ?? '', 190);
    $unit = mrp_clean_text($body['unit'] ?? '', 40);
    $actual = (float) ($body['actualQuantity'] ?? -1);
    $notes = mrp_clean_text($body['notes'] ?? '', 1000);
    if ($key === '' || $name === '' || $unit === '' || !is_finite($actual) || $actual < 0) json_response(['ok' => false, 'error' => 'Completá insumo, unidad y stock real válido.'], 422);
    $previousStmt = $pdo->prepare('SELECT actual_quantity FROM mrp_input_stock WHERE input_key=?'); $previousStmt->execute([$key]);
    $previous = $previousStmt->fetchColumn();
    $pdo->beginTransaction(); try {
        $pdo->prepare('INSERT INTO mrp_input_stock (input_key,input_name,unit,actual_quantity,counted_by) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE input_name=VALUES(input_name),unit=VALUES(unit),actual_quantity=VALUES(actual_quantity),counted_by=VALUES(counted_by),counted_at=NOW()')->execute([$key,$name,$unit,$actual,$mrpUser['id']]);
        $pdo->prepare('INSERT INTO mrp_input_stock_history (input_key,input_name,unit,previous_quantity,actual_quantity,notes,counted_by) VALUES (?,?,?,?,?,?,?)')->execute([$key,$name,$unit,$previous === false ? null : $previous,$actual,$notes ?: null,$mrpUser['id']]);
        audit($pdo, (int) $mrpUser['id'], 'mrp_actual_stock_counted', $key . '=' . $actual . ' ' . $unit); $pdo->commit();
    } catch (Throwable $error) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $error; }
    json_response(['ok' => true]);
}

if ($method === 'POST' && $route === 'mrp/production-runs') {
    $mrpUser = require_mrp_user($pdo); ensure_mrp_schema($pdo); $body = request_body();
    $week = mrp_clean_text($body['weekKey'] ?? '', 20); $recipeKey = mrp_clean_text($body['recipeKey'] ?? '', 190); $quantity = (float) ($body['quantityProduced'] ?? 0); $notes = mrp_clean_text($body['notes'] ?? '', 1000);
    if (!preg_match('/^\d{4}-S\d{1,2}$/', $week) || $recipeKey === '' || !is_finite($quantity) || $quantity <= 0) json_response(['ok'=>false,'error'=>'Indicá semana, receta y producción válida.'],422);
    $latest = $pdo->query("SELECT payload_json FROM mrp_sync_runs WHERE status='verified' ORDER BY id DESC LIMIT 1")->fetchColumn();
    $snapshot = $latest ? mrp_apply_recipe_overrides($pdo, json_decode((string)$latest,true) ?: []) : []; $recipe = null;
    foreach (($snapshot['recipes'] ?? []) as $row) if (($row['sourceKey'] ?? mrp_key($row['recipe'] ?? '')) === $recipeKey) { $recipe=$row; break; }
    if (!$recipe) json_response(['ok'=>false,'error'=>'Receta no encontrada.'],404);
    $pdo->beginTransaction(); try {
        foreach (($recipe['items'] ?? []) as $item) { if (strpos(mrp_lower((string)($item['type'] ?? '')), 'subreceta') !== false) continue; $key=mrp_key($item['ingredient'] ?? ''); $used=(float)($item['perUnit'] ?? 0)*$quantity; if ($key==='' || $used<=0) continue; $st=$pdo->prepare('SELECT actual_quantity,input_name,unit FROM mrp_input_stock WHERE input_key=? FOR UPDATE'); $st->execute([$key]); $current=$st->fetch(); if (!$current) continue; $after=max(0,(float)$current['actual_quantity']-$used); $pdo->prepare('UPDATE mrp_input_stock SET actual_quantity=?,counted_by=?,counted_at=NOW() WHERE input_key=?')->execute([$after,$mrpUser['id'],$key]); $pdo->prepare('INSERT INTO mrp_input_stock_history (input_key,input_name,unit,previous_quantity,actual_quantity,notes,counted_by) VALUES (?,?,?,?,?,?,?)')->execute([$key,$current['input_name'],$current['unit'],$current['actual_quantity'],$after,'Consumo producción: '.($recipe['recipe'] ?? $recipeKey),$mrpUser['id']]); }
        $pdo->prepare('INSERT INTO mrp_production_runs (week_key,recipe_key,recipe_name,quantity_produced,notes,produced_by) VALUES (?,?,?,?,?,?)')->execute([$week,$recipeKey,$recipe['recipe'],$quantity,$notes ?: null,$mrpUser['id']]); audit($pdo,(int)$mrpUser['id'],'mrp_production_confirmed',$recipeKey.'='.$quantity); $pdo->commit();
    } catch(Throwable $error){if($pdo->inTransaction())$pdo->rollBack();throw $error;} json_response(['ok'=>true],201);
}

if ($method === 'POST' && $route === 'mrp/orders') {
    $mrpUser = require_mrp_user($pdo);
    $body = request_body();
    $item = mrp_clean_text($body['itemName'] ?? '', 190);
    $provider = mrp_clean_text($body['providerName'] ?? '', 190);
    $unit = mrp_clean_text($body['unit'] ?? '', 40);
    $quantity = (float) ($body['quantity'] ?? 0);
    $notes = mrp_clean_text($body['notes'] ?? '', 1000);
    if ($item === '' || $unit === '' || !is_finite($quantity) || $quantity <= 0) json_response(['ok' => false, 'error' => 'Completá insumo, unidad y una cantidad válida.'], 422);
    $pdo->prepare('INSERT INTO mrp_purchase_orders (item_name, provider_name, unit, quantity, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([$item, $provider ?: null, $unit, $quantity, $notes ?: null, $mrpUser['id']]);
    $id = (int) $pdo->lastInsertId();
    audit($pdo, (int) $mrpUser['id'], 'mrp_purchase_order_created', 'order_id=' . $id);
    json_response(['ok' => true, 'id' => $id], 201);
}

if ($method === 'PATCH' && preg_match('#^mrp/orders/(\d+)$#', $route, $matches)) {
    $mrpUser = require_mrp_user($pdo);
    $body = request_body();
    $id = (int) $matches[1];
    $version = (int) ($body['rowVersion'] ?? 0);
    $status = mrp_clean_text($body['status'] ?? '', 30);
    if (!in_array($status, ['Por pedir', 'Pedido', 'Recibido', 'Cancelado'], true) || $version < 1) json_response(['ok' => false, 'error' => 'Estado o versión inválida.'], 422);
    $stmt = $pdo->prepare('UPDATE mrp_purchase_orders SET status=?, row_version=row_version+1 WHERE id=? AND row_version=?');
    $stmt->execute([$status, $id, $version]);
    if ($stmt->rowCount() !== 1) json_response(['ok' => false, 'error' => 'Otro usuario actualizó esta orden. Volvé a cargarla.'], 409);
    audit($pdo, (int) $mrpUser['id'], 'mrp_purchase_order_updated', 'order_id=' . $id);
    json_response(['ok' => true, 'rowVersion' => $version + 1]);
}

if ($method === 'POST' && preg_match('#^mrp/orders/(\d+)/receipts$#', $route, $matches)) {
    $mrpUser = require_mrp_user($pdo);
    $orderId = (int) $matches[1];
    $body = request_body();
    $quantity = (float) ($body['quantityReceived'] ?? 0);
    $notes = mrp_clean_text($body['notes'] ?? '', 1000);
    if (!is_finite($quantity) || $quantity <= 0) json_response(['ok' => false, 'error' => 'Indicá una cantidad recibida válida.'], 422);
    $exists = $pdo->prepare('SELECT id FROM mrp_purchase_orders WHERE id=?');
    $exists->execute([$orderId]);
    if (!$exists->fetchColumn()) json_response(['ok' => false, 'error' => 'Orden no encontrada.'], 404);
    $pdo->beginTransaction();
    try {
        $pdo->prepare('INSERT INTO mrp_receipts (purchase_order_id, quantity_received, notes, received_by) VALUES (?, ?, ?, ?)')
            ->execute([$orderId, $quantity, $notes ?: null, $mrpUser['id']]);
        $pdo->prepare("UPDATE mrp_purchase_orders o SET status=IF((SELECT COALESCE(SUM(quantity_received),0) FROM mrp_receipts WHERE purchase_order_id=o.id)>=o.quantity,'Recibido','Pedido'), row_version=row_version+1 WHERE id=?")
            ->execute([$orderId]);
        audit($pdo, (int) $mrpUser['id'], 'mrp_receipt_recorded', 'order_id=' . $orderId);
        $pdo->commit();
    } catch (Throwable $error) { $pdo->rollBack(); throw $error; }
    json_response(['ok' => true], 201);
}

if ($method === 'POST' && $route === 'mrp/controls') {
    $mrpUser = require_mrp_user($pdo);
    $body = request_body();
    $week = mrp_clean_text($body['weekKey'] ?? '', 20);
    $item = mrp_clean_text($body['itemName'] ?? '', 190);
    $expected = (float) ($body['expectedQuantity'] ?? 0);
    $actual = (float) ($body['actualQuantity'] ?? 0);
    $notes = mrp_clean_text($body['notes'] ?? '', 1000);
    if (!preg_match('/^\d{4}-S\d{1,2}$/', $week) || $item === '' || !is_finite($expected) || !is_finite($actual) || $expected < 0 || $actual < 0) json_response(['ok' => false, 'error' => 'Control semanal inválido.'], 422);
    $difference = $actual - $expected;
    $status = abs($difference) < 0.0001 ? 'OK' : ($difference > 0 ? 'Comprado de más' : 'Comprado de menos');
    $pdo->prepare("INSERT INTO mrp_weekly_controls (week_key,item_name,expected_quantity,actual_quantity,status,notes,updated_by) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE expected_quantity=VALUES(expected_quantity),actual_quantity=VALUES(actual_quantity),status=VALUES(status),notes=VALUES(notes),updated_by=VALUES(updated_by),row_version=row_version+1")
        ->execute([$week, $item, $expected, $actual, $status, $notes ?: null, $mrpUser['id']]);
    audit($pdo, (int) $mrpUser['id'], 'mrp_weekly_control_updated', $week . ' ' . $item);
    json_response(['ok' => true, 'status' => $status]);
}

if ($method === 'POST' && $route === 'auth/login') {
    $body = request_body();
    $username = mb_strtolower(trim((string) ($body['username'] ?? '')), 'UTF-8');
    $password = (string) ($body['password'] ?? '');
    if ($username === '' || $password === '') {
        json_response(['ok' => false, 'error' => 'Usuario y contraseña son obligatorios'], 422);
    }

    $stmt = $pdo->prepare('SELECT * FROM users WHERE username = ? LIMIT 1');
    $stmt->execute([$username]);
    $user = $stmt->fetch();
    $locked = $user && $user['locked_until'] && strtotime($user['locked_until']) > time();
    if (!$user || !(bool) $user['active'] || $locked || !password_verify($password, $user['password_hash'])) {
        if ($user && !$locked) {
            $attempts = (int) $user['failed_attempts'] + 1;
            $lockUntil = $attempts >= 5 ? date('Y-m-d H:i:s', time() + 15 * 60) : null;
            $pdo->prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?')
                ->execute([$attempts, $lockUntil, $user['id']]);
            audit($pdo, (int) $user['id'], 'login_failed');
        } else {
            audit($pdo, null, 'login_failed', $username);
        }
        json_response(['ok' => false, 'error' => 'Credenciales inválidas'], 401);
    }

    $pdo->prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?')->execute([$user['id']]);
    create_session($pdo, (int) $user['id'], $config);
    audit($pdo, (int) $user['id'], 'login_success');
    json_response(['ok' => true, 'user' => public_user($user, $config)]);
}

if ($method === 'POST' && $route === 'auth/logout') {
    $user = current_user($pdo);
    clear_session($pdo, $config);
    audit($pdo, $user ? (int) $user['id'] : null, 'logout');
    json_response(['ok' => true]);
}

if ($method === 'GET' && $route === 'auth/me') {
    $user = require_user($pdo);
    json_response(['ok' => true, 'user' => public_user($user, $config)]);
}

if ($method === 'GET' && $route === 'catalog') {
    require_user($pdo);
    ensure_catalog_schema($pdo);
    $row = $pdo->query('SELECT document_json FROM catalog_documents WHERE id = 1')->fetch();
    $catalog = $row ? json_decode((string) $row['document_json'], true) : null;
    json_response(['ok' => true, 'catalog' => is_array($catalog) ? $catalog : null]);
}

if ($method === 'PUT' && $route === 'catalog') {
    $user = require_user($pdo, ['administracion']);
    if (!in_array($_SERVER['HTTP_ORIGIN'] ?? '', $config['allowed_origins'], true)) {
        json_response(['ok' => false, 'error' => 'Origen no autorizado.'], 403);
    }
    if (!empty($user['must_change_password'])) {
        json_response(['ok' => false, 'error' => 'Primero debés cambiar la contraseña temporal.'], 403);
    }
    ensure_catalog_schema($pdo);
    $body = request_body();
    $expectedRevision = max(0, (int) ($body['revision'] ?? -1));
    $products = $body['products'] ?? null;
    $priceChanges = $body['priceChanges'] ?? [];
    if (!is_array($products) || count($products) < 1 || count($products) > 1000 || !is_array($priceChanges)) {
        json_response(['ok' => false, 'error' => 'Catálogo inválido.'], 422);
    }
    $ids = [];
    $codes = [];
    foreach ($products as $product) {
        if (!is_array($product) || !is_numeric($product['id'] ?? null) || (int) $product['id'] < 1 || !is_string($product['name'] ?? null) || trim((string) $product['name']) === '' || !is_string($product['category'] ?? null) || trim((string) $product['category']) === '' || !is_string($product['barcode'] ?? null) || !preg_match('/^LART-\\d{3}$/', $product['barcode']) || !is_numeric($product['price'] ?? null) || !is_numeric($product['onlinePrice'] ?? null) || (float) $product['price'] < 0 || (float) $product['onlinePrice'] < 0) {
            json_response(['ok' => false, 'error' => 'Un producto del catálogo no es válido.'], 422);
        }
        $id = (int) $product['id'];
        if (isset($ids[$id])) json_response(['ok' => false, 'error' => 'Hay identificadores de producto duplicados.'], 422);
        $ids[$id] = true;
        $labels = array_merge([$product['barcode']], is_array($product['barcodeAliases'] ?? null) ? $product['barcodeAliases'] : []);
        foreach ($labels as $label) {
            if (!is_string($label) || !preg_match('/^LART-\\d{3}$/', $label) || isset($codes[$label])) json_response(['ok' => false, 'error' => 'Hay códigos de barras duplicados o inválidos.'], 422);
            $codes[$label] = true;
        }
    }
    $pdo->beginTransaction();
    try {
        $row = $pdo->query('SELECT revision, document_json FROM catalog_documents WHERE id = 1 FOR UPDATE')->fetch();
        $currentRevision = $row ? (int) $row['revision'] : 0;
        if ($currentRevision !== $expectedRevision) {
            $pdo->rollBack();
            json_response(['ok' => false, 'error' => 'Otra persona actualizó el catálogo. Recargá y revisá los cambios.'], 409);
        }
        $previous = $row ? json_decode((string) $row['document_json'], true) : null;
        if (is_array($previous['products'] ?? null)) {
            $incoming = array_fill_keys(array_map(static fn(array $p): int => (int) $p['id'], $products), true);
            foreach ($previous['products'] as $old) if (is_array($old) && isset($old['id']) && !isset($incoming[(int) $old['id']])) {
                $pdo->rollBack();
                json_response(['ok' => false, 'error' => 'No se pueden eliminar productos con historial.'], 422);
            }
        }
        $catalog = ['revision' => $currentRevision + 1, 'products' => array_values($products), 'priceChanges' => array_values($priceChanges), 'updatedAt' => gmdate('c')];
        $json = json_encode($catalog, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false || strlen($json) > 1_000_000) throw new RuntimeException('El catálogo supera el tamaño permitido.');
        if ($row) $pdo->prepare('UPDATE catalog_documents SET revision = ?, document_json = ?, updated_by = ? WHERE id = 1')->execute([$catalog['revision'], $json, $user['id']]);
        else $pdo->prepare('INSERT INTO catalog_documents (id, revision, document_json, updated_by) VALUES (1, ?, ?, ?)')->execute([$catalog['revision'], $json, $user['id']]);
        audit($pdo, (int) $user['id'], 'catalog_updated');
        $pdo->commit();
        json_response(['ok' => true, 'catalog' => $catalog]);
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}

// Registra accesos a áreas sensibles sin convertir cada actualización de página
// en ruido. La misma persona queda asentada una vez por módulo cada 30 minutos.
if ($method === 'POST' && $route === 'activity/module-opened') {
    $user = require_user($pdo);
    if (!in_array($_SERVER['HTTP_ORIGIN'] ?? '', $config['allowed_origins'], true)) {
        json_response(['ok' => false, 'error' => 'Origen no autorizado.'], 403);
    }
    $module = trim((string) (request_body()['module'] ?? ''));
    $allowedModules = ['MRP semanal', 'Recetas y costos', 'Compras de producción', 'Reportes'];
    if (!in_array($module, $allowedModules, true)) {
        json_response(['ok' => false, 'error' => 'Módulo inválido.'], 422);
    }
    $recent = $pdo->prepare("SELECT 1 FROM audit_log WHERE user_id = ? AND event_type = 'module_opened' AND event_detail = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 MINUTE) LIMIT 1");
    $recent->execute([(int) $user['id'], $module]);
    if (!$recent->fetchColumn()) {
        audit($pdo, (int) $user['id'], 'module_opened', $module);
    }
    json_response(['ok' => true]);
}

if ($method === 'POST' && $route === 'assistant/chat') {
    $user = require_user($pdo);
    ensure_assistant_schema($pdo);
    $body = request_body();
    $question = assistant_clean_text($body['question'] ?? '', 1200);
    $site = assistant_clean_text($body['site'] ?? '', 80);
    $section = assistant_clean_text($body['section'] ?? '', 120);
    $history = is_array($body['history'] ?? null) ? $body['history'] : [];
    if (mb_strlen($question, 'UTF-8') < 2) {
        json_response(['ok' => false, 'error' => 'Escribí una pregunta para consultar al asistente.'], 422);
    }
    if ($site !== '' && !in_array($site, operational_sites(), true)) $site = '';
    if ($site !== '' && $user['role'] !== 'administracion' && !user_can_access_site($user, $site)) {
        json_response(['ok' => false, 'error' => 'No tenés acceso a ese local.'], 403);
    }
    $rate = $pdo->prepare("SELECT COUNT(*) FROM ai_chat_messages WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 10 MINUTE)");
    $rate->execute([(int) $user['id']]);
    if ((int) $rate->fetchColumn() >= 12) {
        json_response(['ok' => false, 'error' => 'Alcanzaste el límite momentáneo. Esperá unos minutos antes de volver a consultar.'], 429);
    }
    $insert = $pdo->prepare("INSERT INTO ai_chat_messages (user_id, role_snapshot, site, section_name, question, status) VALUES (?, ?, ?, ?, ?, 'processing')");
    $insert->execute([(int) $user['id'], $user['role'], $site ?: null, $section ?: null, $question]);
    $messageId = (int) $pdo->lastInsertId();
    try {
        $result = assistant_openai_response($config, $user, $site, $section, $question, $history);
        $pdo->prepare("UPDATE ai_chat_messages SET answer = ?, status = 'answered', request_id = ? WHERE id = ?")
            ->execute([$result['answer'], $result['requestId'] ?: null, $messageId]);
        audit($pdo, (int) $user['id'], 'ai_assistant_question', 'message_id=' . $messageId);
        json_response(['ok' => true, 'messageId' => $messageId, 'answer' => $result['answer']]);
    } catch (Throwable $error) {
        error_log('LARTISAN assistant failed: ' . $error->getMessage());
        $pdo->prepare("UPDATE ai_chat_messages SET status = 'failed' WHERE id = ?")->execute([$messageId]);
        $notConfigured = $error->getMessage() === 'assistant_not_configured';
        json_response([
            'ok' => false,
            'messageId' => $messageId,
            'error' => $notConfigured
                ? 'El asistente está instalado y pendiente de activar por Administración.'
                : 'El asistente no pudo responder ahora. Podés enviar la consulta a Administración.',
        ], 503);
    }
}

if ($method === 'POST' && $route === 'assistant/escalate') {
    $user = require_user($pdo);
    ensure_assistant_schema($pdo);
    $body = request_body();
    $question = assistant_clean_text($body['question'] ?? '', 1200);
    $site = assistant_clean_text($body['site'] ?? '', 80);
    $section = assistant_clean_text($body['section'] ?? '', 120);
    $chatMessageId = filter_var($body['messageId'] ?? null, FILTER_VALIDATE_INT) ?: null;
    if (mb_strlen($question, 'UTF-8') < 2) {
        json_response(['ok' => false, 'error' => 'No hay una consulta para enviar.'], 422);
    }
    if ($site !== '' && !in_array($site, operational_sites(), true)) $site = '';
    if ($site !== '' && $user['role'] !== 'administracion' && !user_can_access_site($user, $site)) {
        json_response(['ok' => false, 'error' => 'No tenés acceso a ese local.'], 403);
    }
    $rate = $pdo->prepare("SELECT COUNT(*) FROM ai_support_requests WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)");
    $rate->execute([(int) $user['id']]);
    if ((int) $rate->fetchColumn() >= 5) {
        json_response(['ok' => false, 'error' => 'Ya enviaste varias consultas hoy. Administración las revisará desde su bandeja.'], 429);
    }
    $stmt = $pdo->prepare("INSERT INTO ai_support_requests (chat_message_id, user_id, username_snapshot, role_snapshot, site, section_name, question) VALUES (?, ?, ?, ?, ?, ?, ?)");
    $stmt->execute([$chatMessageId, (int) $user['id'], $user['full_name'], $user['role'], $site ?: null, $section ?: null, $question]);
    $requestId = (int) $pdo->lastInsertId();
    audit($pdo, (int) $user['id'], 'ai_support_requested', 'request_id=' . $requestId);
    json_response(['ok' => true, 'requestId' => $requestId, 'message' => 'Consulta enviada a Administración.']);
}

if ($method === 'GET' && $route === 'admin/assistant-requests') {
    require_user($pdo, ['administracion']);
    ensure_assistant_schema($pdo);
    $rows = $pdo->query("SELECT id, username_snapshot, role_snapshot, site, section_name, question, status, created_at, resolved_at FROM ai_support_requests ORDER BY (status = 'pendiente') DESC, created_at DESC LIMIT 100")->fetchAll();
    json_response(['ok' => true, 'requests' => $rows]);
}

if ($method === 'PATCH' && preg_match('#^admin/assistant-requests/(\d+)$#', $route, $matches)) {
    $admin = require_user($pdo, ['administracion']);
    ensure_assistant_schema($pdo);
    $requestId = (int) $matches[1];
    $pdo->prepare("UPDATE ai_support_requests SET status = 'resuelta', resolved_at = NOW(), resolved_by = ? WHERE id = ? AND status = 'pendiente'")
        ->execute([(int) $admin['id'], $requestId]);
    audit($pdo, (int) $admin['id'], 'ai_support_resolved', 'request_id=' . $requestId);
    json_response(['ok' => true]);
}

if ($method === 'POST' && $route === 'auth/change-password') {
    $user = require_user($pdo);
    $body = request_body();
    $currentPassword = (string) ($body['currentPassword'] ?? '');
    $newPassword = (string) ($body['newPassword'] ?? '');
    if (!password_verify($currentPassword, $user['password_hash'])) {
        json_response(['ok' => false, 'error' => 'La contraseña actual no es correcta'], 422);
    }
    if (!valid_password($newPassword)) {
        json_response(['ok' => false, 'error' => 'La nueva contraseña no cumple los requisitos'], 422);
    }
    $hash = password_hash($newPassword, PASSWORD_DEFAULT);
    $pdo->prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
        ->execute([$hash, $user['id']]);
    $pdo->prepare('DELETE FROM user_sessions WHERE user_id = ?')->execute([$user['id']]);
    audit($pdo, (int) $user['id'], 'password_changed');
    clear_session($pdo, $config);
    json_response(['ok' => true]);
}

if ($method === 'POST' && $route === 'auth/request-reset') {
    $body = request_body();
    $username = mb_strtolower(trim((string) ($body['username'] ?? '')), 'UTF-8');
    $stmt = $pdo->prepare('SELECT id, role FROM users WHERE username = ? AND active = 1 LIMIT 1');
    $stmt->execute([$username]);
    $resetUser = $stmt->fetch();

    if ($resetUser && $resetUser['role'] === 'administracion') {
        $userId = (int) $resetUser['id'];
        $recent = $pdo->prepare(
            'SELECT created_at FROM password_recovery_codes WHERE user_id = ? ORDER BY id DESC LIMIT 1'
        );
        $recent->execute([$userId]);
        $lastCreated = $recent->fetchColumn();
        if ($lastCreated && strtotime((string) $lastCreated) > time() - 60) {
            json_response([
                'ok' => false,
                'error' => 'Esperá un minuto antes de solicitar otro código.',
            ], 429);
        }
        $hourly = $pdo->prepare(
            'SELECT COUNT(*) FROM password_recovery_codes
             WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)'
        );
        $hourly->execute([$userId]);
        if ((int) $hourly->fetchColumn() >= 5) {
            json_response([
                'ok' => false,
                'error' => 'Se alcanzó el límite de códigos. Intentá nuevamente dentro de una hora.',
            ], 429);
        }

        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $expiresAt = date('Y-m-d H:i:s', time() + 15 * 60);
        $pdo->prepare(
            'INSERT INTO password_recovery_codes
             (user_id, code_hash, expires_at, requested_ip) VALUES (?, ?, ?, ?)'
        )->execute([$userId, password_hash($code, PASSWORD_DEFAULT), $expiresAt, client_ip()]);
        $recoveryId = (int) $pdo->lastInsertId();
        $destination = trim((string) ($config['admin_recovery_email'] ?? ''));
        if ($destination === '') {
            $pdo->prepare('DELETE FROM password_recovery_codes WHERE id = ?')->execute([$recoveryId]);
            audit($pdo, $userId, 'password_recovery_not_configured');
            json_response(['ok' => false, 'error' => 'La recuperación no está configurada'], 503);
        }
        $from = trim((string) ($config['recovery_from_email'] ?? ''));
        if ($from === '') {
            $pdo->prepare('DELETE FROM password_recovery_codes WHERE id = ?')->execute([$recoveryId]);
            audit($pdo, $userId, 'password_recovery_sender_not_configured');
            json_response(['ok' => false, 'error' => 'La recuperación no está configurada'], 503);
        }
        $subject = "Codigo de recuperacion - L'ARTISAN";
        $emailBody = "Se solicito recuperar el acceso de Administracion.\n\n"
            . "Codigo: {$code}\n\n"
            . "El codigo vence en 15 minutos y solo puede usarse una vez.\n"
            . "Si no solicitaste este cambio, ignora este correo.";
        $headers = [
            'From: Sistema LARTISAN <' . $from . '>',
            'Reply-To: ' . $destination,
            'Content-Type: text/plain; charset=UTF-8',
            'X-Mailer: PHP/' . PHP_VERSION,
        ];
        if (!mail($destination, $subject, $emailBody, implode("\r\n", $headers))) {
            $pdo->prepare('DELETE FROM password_recovery_codes WHERE id = ?')->execute([$recoveryId]);
            audit($pdo, $userId, 'password_recovery_email_failed');
            json_response([
                'ok' => false,
                'error' => 'No pudimos enviar el código. Intentá nuevamente en unos minutos.',
            ], 503);
        }
        audit($pdo, $userId, 'password_recovery_code_sent');
        json_response([
            'ok' => true,
            'delivery' => 'email_code',
            'message' => 'Enviamos un código de 6 dígitos al correo de Administración.',
        ]);
    }

    if ($resetUser) {
        $userId = (int) $resetUser['id'];
        $pending = $pdo->prepare(
            "SELECT id FROM password_reset_requests
             WHERE user_id = ? AND status = 'pendiente' AND requested_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE)"
        );
        $pending->execute([$userId]);
        if (!$pending->fetchColumn()) {
            $pdo->prepare('INSERT INTO password_reset_requests (user_id) VALUES (?)')->execute([$userId]);
            audit($pdo, (int) $userId, 'password_reset_requested');
        }
    }
    json_response(['ok' => true, 'message' => 'Si el usuario existe, Administración recibirá la solicitud.']);
}

if ($method === 'POST' && $route === 'auth/confirm-reset-code') {
    $body = request_body();
    $username = mb_strtolower(trim((string) ($body['username'] ?? '')), 'UTF-8');
    $code = trim((string) ($body['code'] ?? ''));
    $newPassword = (string) ($body['newPassword'] ?? '');
    if (!preg_match('/^\d{6}$/', $code) || !valid_password($newPassword)) {
        json_response([
            'ok' => false,
            'error' => 'Revisá el código y usá una contraseña segura de al menos 8 caracteres.',
        ], 422);
    }
    $stmt = $pdo->prepare(
        "SELECT c.*, u.id AS account_id
         FROM password_recovery_codes c
         JOIN users u ON u.id = c.user_id
         WHERE u.username = ? AND u.role = 'administracion' AND u.active = 1
           AND c.used_at IS NULL AND c.expires_at > NOW() AND c.attempts < 5
         ORDER BY c.id DESC LIMIT 1"
    );
    $stmt->execute([$username]);
    $recovery = $stmt->fetch();
    if (!$recovery || !password_verify($code, $recovery['code_hash'])) {
        if ($recovery) {
            $pdo->prepare('UPDATE password_recovery_codes SET attempts = attempts + 1 WHERE id = ?')
                ->execute([$recovery['id']]);
            audit($pdo, (int) $recovery['account_id'], 'password_recovery_code_failed');
        } else {
            audit($pdo, null, 'password_recovery_code_failed', $username);
        }
        json_response(['ok' => false, 'error' => 'El código es incorrecto o venció.'], 422);
    }

    $userId = (int) $recovery['account_id'];
    $pdo->beginTransaction();
    try {
        $pdo->prepare(
            'UPDATE users SET password_hash = ?, must_change_password = 0,
             failed_attempts = 0, locked_until = NULL WHERE id = ?'
        )->execute([password_hash($newPassword, PASSWORD_DEFAULT), $userId]);
        $pdo->prepare('UPDATE password_recovery_codes SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL')
            ->execute([$userId]);
        $pdo->prepare('DELETE FROM user_sessions WHERE user_id = ?')->execute([$userId]);
        audit($pdo, $userId, 'password_recovered_by_email');
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    clear_session($pdo, $config);
    json_response(['ok' => true, 'message' => 'Contraseña actualizada. Ya podés ingresar.']);
}

if ($method === 'GET' && $route === 'operations/states') {
    $user = require_user($pdo);
    ensure_operations_schema($pdo);
    $allowedSites = array_values(array_filter(
        operational_sites(),
        static fn (string $site): bool => user_can_access_site($user, $site)
    ));
    // Central recibe además, de los locales que no opera, solo pedidos y ajustes pendientes.
    $centralSites = user_manages_central_orders($user)
        ? array_values(array_diff(operational_sites(), $allowedSites))
        : [];
    if (!$allowedSites) {
        json_response(['ok' => true, 'states' => []]);
    }
    foreach ($allowedSites as $site) {
        // Una falla de mantenimiento nunca impide leer las operaciones.
        try {
            compact_oversized_site_state($pdo, $config, $site);
        } catch (Throwable $error) {
            error_log('LARTISAN state compaction failed for ' . $site . ': ' . $error->getMessage());
        }
    }
    $readableSites = array_merge($allowedSites, $centralSites);
    $placeholders = implode(',', array_fill(0, count($readableSites), '?'));
    $stmt = $pdo->prepare(
        "SELECT site, state_json, revision, updated_at FROM operation_site_states WHERE site IN ($placeholders)"
    );
    $stmt->execute($readableSites);
    $states = [];
    foreach ($stmt->fetchAll() as $row) {
        $state = json_decode((string) $row['state_json'], true);
        if (is_array($state)) {
            $centralOnly = in_array($row['site'], $centralSites, true);
            $states[$row['site']] = [
                'state' => $centralOnly ? central_site_view($state) : operational_snapshot_for_user($user, $state, (string) $row['site']),
                'revision' => (int) $row['revision'],
                'updatedAt' => $row['updated_at'],
                'centralOnly' => $centralOnly,
            ];
        }
    }
    json_response(['ok' => true, 'states' => $states]);
}

// Algunos alojamientos compartidos bloquean por reglas propias los PUT y las
// rutas que contienen "operations" antes de que PHP pueda recibirlos. El
// cliente usa POST /sync para no dejar ventas, recepciones ni stock atrapados
// en la cola local. Se mantiene la ruta PUT anterior para compatibilidad.
$isLegacyOperationWrite = $method === 'PUT' && preg_match('#^operations/states/([^/]+)$#', $route, $matches);
$isSyncOperationWrite = $method === 'POST' && $route === 'sync';
if ($isLegacyOperationWrite || $isSyncOperationWrite) {
    $user = require_user($pdo);
    if (!empty($user['must_change_password'])) {
        json_response(['ok' => false, 'error' => 'Primero debés cambiar la contraseña temporal'], 403);
    }
    ensure_operations_schema($pdo);
    $body = request_body();
    $site = $isLegacyOperationWrite
        ? rawurldecode($matches[1])
        : trim((string) ($body['site'] ?? ''));
    if (!in_array($site, operational_sites(), true)) {
        json_response(['ok' => false, 'error' => 'Local operativo inválido'], 422);
    }
    $centralOnly = !user_can_access_site($user, $site)
        && in_array($site, operational_sites(), true)
        && user_manages_central_orders($user);
    if (!user_can_access_site($user, $site) && !$centralOnly) {
        json_response(['ok' => false, 'error' => 'No tenés acceso a este local'], 403);
    }
    $baseRevision = max(0, (int) ($body['baseRevision'] ?? 0));
    $requestId = trim((string) ($body['requestId'] ?? ''));
    $baseState = $body['baseState'] ?? null;
    $state = $body['state'] ?? null;
    $clientEvent = is_array($body['event'] ?? null) ? $body['event'] : [];
    if (!is_array($state) || !preg_match('/^[a-f0-9-]{36}$/i', $requestId)) {
        json_response(['ok' => false, 'error' => 'Datos operativos inválidos'], 422);
    }
    $syncStage = 'preparar';
    $pdo->beginTransaction();
    try {
        $requestLookup = $pdo->prepare('SELECT revision FROM operation_requests WHERE request_id = ? AND site = ? LIMIT 1');
        $requestLookup->execute([$requestId, $site]);
        $processedRevision = $requestLookup->fetchColumn();
        if ($processedRevision !== false) {
            $pdo->commit();
            json_response(['ok' => true, 'revision' => (int) $processedRevision, 'alreadyProcessed' => true]);
        }
        $revisionStatement = $pdo->prepare('SELECT revision, state_json FROM operation_site_states WHERE site = ? FOR UPDATE');
        $revisionStatement->execute([$site]);
        $currentRow = $revisionStatement->fetch();
        $currentRevision = $currentRow === false ? false : (int) $currentRow['revision'];
        $previousState = $currentRow === false ? [] : (json_decode((string) $currentRow['state_json'], true) ?: []);
        if ($centralOnly && $currentRow === false) {
            // Un local sin datos no tiene pedidos que Central pueda gestionar.
            $pdo->commit();
            json_response(['ok' => true, 'revision' => 0, 'merged' => false, 'state' => null]);
        }
        $syncStage = 'autorizar';
        $authorizedIncoming = $centralOnly
            ? authorize_central_changes($user, $previousState, is_array($baseState) ? $baseState : [], $state)
            : authorize_operational_snapshot($user, $previousState, $state);
        $merged = false;
        if ($centralOnly) {
            // Los cambios de Central ya se aplicaron sobre el estado vigente.
            $state = $authorizedIncoming;
        } elseif ($currentRow !== false && (int) $currentRevision !== $baseRevision) {
            if (!is_array($baseState)) {
                $pdo->rollBack();
                json_response(['ok' => false, 'error' => 'Otro equipo actualizó este local', 'currentRevision' => (int) $currentRevision], 409);
            }
            $state = merge_operational_snapshot($baseState, $previousState, $authorizedIncoming);
            $merged = true;
        } else {
            $state = $authorizedIncoming;
        }
        validate_test_operating_snapshot($pdo, $site, $previousState, $state, $clientEvent);
        // El historial completo vive en las tablas normalizadas y en
        // operation_archive; el estado del local conserva solo lo reciente y lo
        // abierto para que cada envío no crezca sin límite.
        $syncStage = 'validar_comprobante';
        try {
            [$state, $invoiceFindings] = enforce_invoice_type_changes($pdo, $user, $previousState, $state);
        } catch (Throwable $invoiceValidationError) {
            // La protección fiscal debe ser conservadora sin bloquear el resto
            // de la operación. Ante una falla técnica se conservan los tipos de
            // comprobante previamente guardados y se permiten stock, caja,
            // pedidos y recepciones.
            error_log('LARTISAN invoice validation fallback: ' . $invoiceValidationError->getMessage());
            $previousSales = is_array($previousState['sales'] ?? null) ? $previousState['sales'] : [];
            $knownSales = operational_items_by_id($previousSales);
            foreach (is_array($state['sales'] ?? null) ? $state['sales'] : [] as $index => $sale) {
                if (!is_array($sale) || !isset($sale['id']) || !is_scalar($sale['id'])) continue;
                $before = $knownSales[(string) $sale['id']] ?? null;
                if (is_array($before)) $state['sales'][$index]['invoiceType'] = $before['invoiceType'] ?? null;
            }
            $invoiceFindings = [];
        }
        $untrimmedState = $state;
        $syncStage = 'recortar';
        [$state] = compact_operational_state($untrimmedState, $config);
        $syncStage = 'archivar_recorte';
        archive_removed_operational_items($pdo, $site, $previousState, $untrimmedState, $state);
        // Etapa de observación: se registran las diferencias de importes sin
        // rechazar la operación. Un error de control nunca impide guardar.
        try {
            record_sale_validation_findings($pdo, $site, (int) $user['id'], array_merge($invoiceFindings,
                validate_operational_sales($previousState, $untrimmedState, $site, catalog_price_lists($pdo))));
        } catch (Throwable $validationError) {
            error_log('LARTISAN sale validation failed: ' . $validationError->getMessage());
        }
        $changedKeys = array_values(array_filter(array_unique(array_merge(array_keys($previousState), array_keys($state))), static function ($key) use ($previousState, $state): bool {
            return ($previousState[$key] ?? null) !== ($state[$key] ?? null);
        }));
        $stateJson = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $eventJson = json_encode([
            'changedKeys' => $changedKeys,
            'recordedAt' => gmdate('c'),
            'requestId' => $requestId,
            'mergedConcurrentChanges' => $merged,
            'event' => [
                'action' => substr((string) ($clientEvent['action'] ?? 'Actualización operativa'), 0, 160),
                'detail' => substr((string) ($clientEvent['detail'] ?? ''), 0, 800),
                'testOperatingDate' => substr((string) ($clientEvent['testOperatingDate'] ?? ''), 0, 10),
                'testLabel' => substr((string) ($clientEvent['testLabel'] ?? ''), 0, 120),
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($stateJson === false || $eventJson === false || strlen($stateJson) > 4_000_000) {
            $pdo->rollBack();
            json_response(['ok' => false, 'error' => 'La operación supera el tamaño permitido'], 422);
        }
        $syncStage = 'guardar_estado';
        if ($currentRow === false) {
            if ($baseRevision !== 0) {
                $pdo->rollBack();
                json_response(['ok' => false, 'error' => 'La versión del local cambió', 'currentRevision' => 0], 409);
            }
            $pdo->prepare('INSERT INTO operation_site_states (site, state_json, revision, updated_by) VALUES (?, ?, 1, ?)')
                ->execute([$site, $stateJson, $user['id']]);
        } else {
            $pdo->prepare('UPDATE operation_site_states SET state_json = ?, revision = revision + 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE site = ?')
                ->execute([$stateJson, $user['id'], $site]);
        }
        $syncStage = 'guardar_evento';
        $pdo->prepare(
            'INSERT INTO operation_events (site, user_id, event_type, event_json) VALUES (?, ?, ?, ?)'
        )->execute([$site, $user['id'], 'operacion_actualizada', $eventJson]);
        // El estado operativo es la fuente de verdad para caja, ventas y stock.
        // Las tablas normalizadas alimentan reportes; una estructura antigua o
        // una inconsistencia allí no puede dejar una operación comercial
        // atrapada en la cola del local.
        try {
            sync_normalized_operations($pdo, $site, $untrimmedState, (int) $user['id'], $currentRow === false ? null : $previousState);
        } catch (Throwable $normalizationError) {
            error_log('LARTISAN normalized operations sync failed for ' . $site . ': ' . $normalizationError->getMessage());
        }
        $syncStage = 'auditar';
        audit($pdo, (int) $user['id'], 'operational_state_updated', $site);
        $nextRevision = $currentRow === false ? 1 : ((int) $currentRevision + 1);
        $syncStage = 'confirmar_solicitud';
        $pdo->prepare('INSERT INTO operation_requests (request_id, site, user_id, revision) VALUES (?, ?, ?, ?)')
            ->execute([$requestId, $site, $user['id'], $nextRevision]);
        $syncStage = 'confirmar';
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        $failureDetail = preg_replace('/[\r\n]+/', ' ', $error->getMessage()) ?: 'Sin detalle disponible.';
        $failureDetail = substr($syncStage . ': ' . $failureDetail, 0, 800);
        error_log('LARTISAN operation sync failed at ' . $syncStage . ' for ' . $site . ': ' . $failureDetail);
        // El intento fallido se audita fuera de la transacción revertida para
        // poder diagnosticar una cola pendiente sin exponer el detalle técnico
        // al equipo de ventas.
        try {
            audit($pdo, (int) $user['id'], 'operational_sync_failed', $site . ' · ' . $failureDetail);
        } catch (Throwable $auditError) {
            error_log('LARTISAN operation sync failure audit failed: ' . $auditError->getMessage());
        }
        json_response(['ok' => false, 'error' => 'No se pudo guardar la operación en la etapa ' . $syncStage . '.'], 500);
    }
    $revision = (int) $pdo->query("SELECT revision FROM operation_site_states WHERE site = " . $pdo->quote($site))->fetchColumn();
    json_response(['ok' => true, 'revision' => $revision, 'merged' => $merged ?? false, 'state' => ($merged ?? false) ? operational_snapshot_for_user($user, $state, $site) : null]);
}

if ($method === 'POST' && $route === 'monitoring/heartbeat') {
    require_user($pdo);
    $result = notify_monitoring_alerts($pdo, $config);
    json_response(['ok' => true, 'notification' => $result]);
}

if ($method === 'GET' && $route === 'admin/audit') {
    require_user($pdo, ['administracion']);
    $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['from'] ?? '')) ? (string) $_GET['from'] : date('Y-m-01');
    $to = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['to'] ?? '')) ? (string) $_GET['to'] : date('Y-m-d');
    $siteFilter = trim((string) ($_GET['site'] ?? ''));
    $userFilter = trim((string) ($_GET['user'] ?? ''));
    $actionFilter = trim((string) ($_GET['action'] ?? ''));
    $sql = "SELECT e.id, e.site, e.event_json, e.created_at, COALESCE(u.full_name, 'Sistema') AS user_name
            FROM operation_events e LEFT JOIN users u ON u.id = e.user_id
            WHERE e.created_at >= ? AND e.created_at < DATE_ADD(?, INTERVAL 1 DAY)";
    $params = [$from, $to];
    if ($siteFilter !== '' && in_array($siteFilter, operational_sites(), true)) { $sql .= ' AND e.site = ?'; $params[] = $siteFilter; }
    if ($userFilter !== '') { $sql .= ' AND COALESCE(u.full_name, ?) LIKE ?'; $params[] = 'Sistema'; $params[] = '%' . $userFilter . '%'; }
    if ($actionFilter !== '') { $sql .= ' AND e.event_json LIKE ?'; $params[] = '%' . $actionFilter . '%'; }
    $sql .= ' ORDER BY e.created_at DESC, e.id DESC LIMIT 1000';
    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $events = [];
    foreach ($statement->fetchAll() as $row) {
        $payload = json_decode((string) $row['event_json'], true) ?: [];
        $event = is_array($payload['event'] ?? null) ? $payload['event'] : [];
        $events[] = [
            'id' => 'operation-' . $row['id'], 'at' => $row['created_at'], 'site' => $row['site'],
            'userName' => $row['user_name'], 'action' => (string) ($event['action'] ?? $payload['eventType'] ?? 'Actualización operativa'),
            'detail' => (string) ($event['detail'] ?? implode(', ', $payload['changedKeys'] ?? [])),
        ];
    }
    if ($siteFilter === '') {
        $auditSql = "SELECT a.id, a.event_type, a.event_detail, a.created_at, COALESCE(u.full_name, 'Sistema') AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.created_at >= ? AND a.created_at < DATE_ADD(?, INTERVAL 1 DAY)";
        $auditParams = [$from, $to];
        if ($userFilter !== '') { $auditSql .= ' AND COALESCE(u.full_name, ?) LIKE ?'; $auditParams[] = 'Sistema'; $auditParams[] = '%' . $userFilter . '%'; }
        if ($actionFilter !== '') { $auditSql .= ' AND (a.event_type LIKE ? OR a.event_detail LIKE ?)'; $auditParams[] = '%' . $actionFilter . '%'; $auditParams[] = '%' . $actionFilter . '%'; }
        $auditSql .= ' ORDER BY a.created_at DESC LIMIT 1000';
        $auditStatement = $pdo->prepare($auditSql); $auditStatement->execute($auditParams);
        foreach ($auditStatement->fetchAll() as $row) $events[] = [
            'id' => 'security-' . $row['id'], 'at' => $row['created_at'], 'site' => 'General', 'userName' => $row['user_name'],
            'action' => str_replace('_', ' ', (string) $row['event_type']), 'detail' => (string) ($row['event_detail'] ?? ''),
        ];
        usort($events, static fn (array $left, array $right): int => strcmp((string) $right['at'], (string) $left['at']));
        $events = array_slice($events, 0, 1000);
    }
    json_response(['ok' => true, 'events' => $events]);
}

if ($method === 'GET' && $route === 'admin/cash-history') {
    require_user($pdo, ['administracion']);
    ensure_normalized_operations_schema($pdo);
    $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['from'] ?? '')) ? (string) $_GET['from'] : date('Y-m-01');
    $to = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['to'] ?? '')) ? (string) $_GET['to'] : date('Y-m-d');
    $siteFilter = trim((string) ($_GET['site'] ?? ''));
    $sql = 'SELECT id, site, opened_at, opened_by, initial_fund, closed_at, closed_by, expected_cash, counted_cash, difference_amount, envelope_amount FROM lartisan_cash_sessions WHERE opened_at >= ? AND opened_at < DATE_ADD(?, INTERVAL 1 DAY)';
    $params = [$from, $to];
    if ($siteFilter !== '' && in_array($siteFilter, operational_sites(), true)) { $sql .= ' AND site = ?'; $params[] = $siteFilter; }
    $sql .= ' ORDER BY opened_at DESC LIMIT 2000';
    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    json_response(['ok' => true, 'sessions' => array_map(static fn (array $row): array => [
        'id' => $row['id'], 'site' => $row['site'], 'openedAt' => $row['opened_at'], 'openedBy' => $row['opened_by'],
        'initialFund' => (float) $row['initial_fund'], 'closedAt' => $row['closed_at'], 'closedBy' => $row['closed_by'],
        'expectedCash' => $row['expected_cash'] === null ? null : (float) $row['expected_cash'],
        'countedCash' => $row['counted_cash'] === null ? null : (float) $row['counted_cash'],
        'differenceAmount' => $row['difference_amount'] === null ? null : (float) $row['difference_amount'],
        'envelopeAmount' => $row['envelope_amount'] === null ? null : (float) $row['envelope_amount'],
    ], $statement->fetchAll())]);
}

if ($method === 'GET' && $route === 'admin/report-sales') {
    require_user($pdo, ['administracion']);
    ensure_normalized_operations_schema($pdo);
    $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['from'] ?? '')) ? (string) $_GET['from'] : date('Y-m-01');
    $to = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['to'] ?? '')) ? (string) $_GET['to'] : date('Y-m-d');
    $siteFilter = trim((string) ($_GET['site'] ?? ''));
    $sql = 'SELECT * FROM lartisan_sales WHERE occurred_at >= ? AND occurred_at < DATE_ADD(?, INTERVAL 1 DAY)';
    $params = [$from, $to];
    if ($siteFilter !== '' && in_array($siteFilter, operational_sites(), true)) { $sql .= ' AND site = ?'; $params[] = $siteFilter; }
    $sql .= ' ORDER BY occurred_at DESC LIMIT 10000';
    $statement = $pdo->prepare($sql); $statement->execute($params); $saleRows = $statement->fetchAll();
    $ids = array_column($saleRows, 'id'); $itemsBySale = []; $paymentsBySale = [];
    if ($ids) {
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $itemStatement = $pdo->prepare("SELECT * FROM lartisan_sale_items WHERE sale_id IN ($placeholders) ORDER BY sale_id, line_number");
        $itemStatement->execute($ids);
        foreach ($itemStatement->fetchAll() as $item) $itemsBySale[$item['sale_id']][] = $item;
        $paymentStatement = $pdo->prepare("SELECT * FROM lartisan_sale_payments WHERE sale_id IN ($placeholders)");
        $paymentStatement->execute($ids);
        foreach ($paymentStatement->fetchAll() as $paymentRow) $paymentsBySale[$paymentRow['sale_id']][] = ['method' => $paymentRow['payment_method'], 'amount' => (float) $paymentRow['amount'], 'saleId' => $paymentRow['sale_id']];
    }
    $sales = [];
    foreach ($saleRows as $row) {
        $items = [];
        foreach ($itemsBySale[$row['id']] ?? [] as $item) for ($count = 0; $count < (int) $item['quantity']; $count++) $items[] = [
            'id' => (int) $item['product_id'], 'name' => $item['product_name'], 'detail' => $item['presentation'] ?? '', 'category' => 'Histórico', 'price' => (float) $item['unit_price'],
        ];
        $sales[] = [
            'id' => $row['id'], 'site' => $row['site'], 'createdAt' => $row['occurred_at'], 'createdAtISO' => str_replace(' ', 'T', (string) $row['occurred_at']),
            'items' => $items, 'gross' => (float) $row['gross_amount'], 'discount' => (float) $row['discount_amount'], 'net' => (float) $row['net_amount'],
            'method' => $row['payment_method'] ?: 'Sin informar', 'invoiceType' => $row['invoice_type'] ?: 'Remito interno', 'customer' => $row['customer_name'] ?: 'Consumidor final',
            'invitation' => (bool) $row['invitation'], 'channel' => $row['channel'] ?: 'Mostrador', 'status' => $row['status'] ?: 'activa',
        ];
    }
    json_response(['ok' => true, 'sales' => $sales, 'payments' => array_values(array_merge(...array_values($paymentsBySale ?: [[]]))), 'truncated' => count($sales) >= 10000]);
}

if ($method === 'POST' && $route === 'admin/history/import') {
    $admin = require_user($pdo, ['administracion']);
    ensure_normalized_operations_schema($pdo);
    $body = request_body(); $kind = (string) ($body['kind'] ?? 'sales'); $rows = $body['rows'] ?? [];
    if (!in_array($kind, ['sales', 'cash'], true) || !is_array($rows) || !$rows || count($rows) > 5000) json_response(['ok' => false, 'error' => 'Archivo histórico inválido o demasiado grande'], 422);
    $batchHash = hash('sha256', json_encode([$kind, $rows], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    $uuid = static function (string $seed): string { $hex = substr(hash('sha256', $seed), 0, 32); return substr($hex,0,8).'-'.substr($hex,8,4).'-4'.substr($hex,13,3).'-a'.substr($hex,17,3).'-'.substr($hex,20,12); };
    $imported = 0; $rejected = 0; $pdo->beginTransaction();
    try {
        if ($kind === 'sales') {
            $insert = $pdo->prepare("INSERT INTO lartisan_sales (id, site, occurred_at, gross_amount, discount_amount, net_amount, payment_method, invoice_type, customer_name, channel, status, invitation, synced_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?) ON DUPLICATE KEY UPDATE id=id");
            $paymentInsert = $pdo->prepare('INSERT INTO lartisan_sale_payments (sale_id, payment_method, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount=VALUES(amount)');
            foreach ($rows as $index => $row) {
                if (!is_array($row)) { $rejected++; continue; }
                $siteName = trim((string) ($row['local'] ?? '')); $at = historical_datetime($row['fecha'] ?? ''); $net = historical_number($row['neto'] ?? 0);
                if (!in_array($siteName, operational_sites(), true) || !$at || $net < 0) { $rejected++; continue; }
                $saleId = preg_match('/^[a-f0-9-]{36}$/i', (string) ($row['operacion'] ?? '')) ? (string) $row['operacion'] : $uuid($batchHash . '|' . $index);
                $gross = historical_number($row['bruto'] ?? $net); $discount = historical_number($row['descuento'] ?? max(0, $gross - $net)); $methodName = trim((string) ($row['medio_pago'] ?? 'Sin informar'));
                $insert->execute([$saleId, $siteName, $at, $gross, $discount, $net, $methodName, (string) ($row['comprobante'] ?? 'Remito interno'), (string) ($row['cliente'] ?? 'Consumidor final'), (string) ($row['canal'] ?? 'Mostrador'), (string) ($row['estado'] ?? 'activa'), $admin['id']]);
                $paymentInsert->execute([$saleId, $methodName, $net]); $imported++;
            }
        } else {
            $insert = $pdo->prepare("INSERT INTO lartisan_cash_sessions (id, site, opened_at, opened_by, initial_fund, closed_at, closed_by, expected_cash, counted_cash, difference_amount, envelope_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id=id");
            foreach ($rows as $index => $row) {
                if (!is_array($row)) { $rejected++; continue; }
                $siteName = trim((string) ($row['local'] ?? '')); $opened = historical_datetime($row['apertura'] ?? '');
                if (!in_array($siteName, operational_sites(), true) || !$opened) { $rejected++; continue; }
                $id = preg_match('/^[a-f0-9-]{36}$/i', (string) ($row['turno'] ?? '')) ? (string) $row['turno'] : $uuid($batchHash . '|cash|' . $index);
                $expectedValue = historical_number($row['esperado'] ?? 0); $countedValue = historical_number($row['contado'] ?? 0);
                $insert->execute([$id, $siteName, $opened, (string) ($row['abrió'] ?? $row['abrio'] ?? 'Histórico'), historical_number($row['fondo_inicial'] ?? 0), historical_datetime($row['cierre'] ?? ''), (string) ($row['cerró'] ?? $row['cerro'] ?? ''), $expectedValue, $countedValue, historical_number($row['diferencia'] ?? ($countedValue - $expectedValue)), historical_number($row['sobre'] ?? 0)]); $imported++;
            }
        }
        audit($pdo, (int) $admin['id'], 'historical_import', $kind . ': importados=' . $imported . ', rechazados=' . $rejected);
        $pdo->commit();
    } catch (Throwable $error) { $pdo->rollBack(); throw $error; }
    json_response(['ok' => true, 'imported' => $imported, 'rejected' => $rejected]);
}

if ($method === 'GET' && $route === 'admin/reset-requests') {
    require_user($pdo, ['administracion']);
    $rows = $pdo->query(
        "SELECT r.id, r.status, r.requested_at, r.resolved_at,
                u.id AS user_id, u.username, u.full_name, u.role, u.assigned_location
         FROM password_reset_requests r
         JOIN users u ON u.id = r.user_id
         ORDER BY (r.status = 'pendiente') DESC, r.requested_at DESC
         LIMIT 100"
    )->fetchAll();
    json_response(['ok' => true, 'requests' => $rows]);
}

if ($method === 'POST' && $route === 'admin/reset-password') {
    $admin = require_user($pdo, ['administracion']);
    $body = request_body();
    $requestId = (int) ($body['requestId'] ?? 0);
    $temporaryPassword = (string) ($body['temporaryPassword'] ?? '');
    if ($requestId < 1 || !valid_password($temporaryPassword)) {
        json_response(['ok' => false, 'error' => 'Solicitud o contraseña provisoria inválida'], 422);
    }
    $stmt = $pdo->prepare("SELECT user_id FROM password_reset_requests WHERE id = ? AND status = 'pendiente'");
    $stmt->execute([$requestId]);
    $userId = $stmt->fetchColumn();
    if (!$userId) {
        json_response(['ok' => false, 'error' => 'La solicitud ya no está pendiente'], 409);
    }
    $pdo->beginTransaction();
    try {
        $pdo->prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?')
            ->execute([password_hash($temporaryPassword, PASSWORD_DEFAULT), $userId]);
        $pdo->prepare("UPDATE password_reset_requests SET status = 'resuelta', resolved_at = NOW(), resolved_by = ? WHERE id = ?")
            ->execute([$admin['id'], $requestId]);
        $pdo->prepare('DELETE FROM user_sessions WHERE user_id = ?')->execute([$userId]);
        audit($pdo, (int) $admin['id'], 'temporary_password_generated', 'user_id=' . $userId);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    json_response(['ok' => true]);
}

if ($method === 'POST' && preg_match('#^admin/users/(\d+)/reset-password$#', $route, $matches)) {
    $admin = require_user($pdo, ['administracion']);
    $userId = (int) $matches[1];
    $stmt = $pdo->prepare('SELECT id, username, full_name FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $target = $stmt->fetch();
    if (!$target) {
        json_response(['ok' => false, 'error' => 'Usuario no encontrado'], 404);
    }
    if (is_primary_user($target, $config)) {
        json_response(['ok' => false, 'error' => 'La cuenta principal se recupera desde el acceso administrativo'], 422);
    }

    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    $randomPart = '';
    for ($index = 0; $index < 8; $index++) {
        $randomPart .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    }
    $temporaryPassword = 'Lar!' . $randomPart . '7a';

    $pdo->beginTransaction();
    try {
        $pdo->prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?')
            ->execute([password_hash($temporaryPassword, PASSWORD_DEFAULT), $userId]);
        $pdo->prepare("UPDATE password_reset_requests SET status = 'resuelta', resolved_at = NOW(), resolved_by = ? WHERE user_id = ? AND status = 'pendiente'")
            ->execute([$admin['id'], $userId]);
        $pdo->prepare('DELETE FROM user_sessions WHERE user_id = ?')->execute([$userId]);
        audit($pdo, (int) $admin['id'], 'password_reset_by_admin', 'user_id=' . $userId);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    json_response([
        'ok' => true,
        'username' => $target['username'],
        'temporaryPassword' => $temporaryPassword,
    ]);
}

if ($method === 'PATCH' && preg_match('#^admin/users/(\d+)$#', $route, $matches)) {
    $admin = require_user($pdo, ['administracion']);
    $userId = (int) $matches[1];
    $body = request_body();
    $stmt = $pdo->prepare('SELECT username, role, assigned_location, assigned_locations, access_all_locations, active, report_permissions, action_permissions, mfa_required FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $existing = $stmt->fetch();
    if (!$existing) {
        json_response(['ok' => false, 'error' => 'Usuario no encontrado'], 404);
    }
    $username = array_key_exists('username', $body)
        ? mb_strtolower(trim((string) $body['username']), 'UTF-8')
        : $existing['username'];
    $role = (string) ($body['role'] ?? $existing['role']);
    $location = array_key_exists('assignedLocation', $body)
        ? (trim((string) $body['assignedLocation']) ?: null)
        : $existing['assigned_location'];
    $allLocations = array_key_exists('accessAllLocations', $body)
        ? (!empty($body['accessAllLocations']) ? 1 : 0)
        : (int) $existing['access_all_locations'];
    $locations = array_key_exists('assignedLocations', $body)
        ? $body['assignedLocations']
        : assigned_locations($existing);
    if (!is_array($locations)) $locations = [];
    $locations = array_values(array_unique(array_filter($locations, static fn ($site): bool => is_string($site) && in_array($site, operational_sites(), true))));
    $active = array_key_exists('active', $body)
        ? (!empty($body['active']) ? 1 : 0)
        : (int) $existing['active'];
    $reportPermissions = array_key_exists('reportPermissions', $body) ? $body['reportPermissions'] : json_decode((string) ($existing['report_permissions'] ?? '[]'), true);
    $actionPermissions = array_key_exists('actionPermissions', $body) ? $body['actionPermissions'] : json_decode((string) ($existing['action_permissions'] ?? '[]'), true);
    if (!is_array($reportPermissions)) $reportPermissions = [];
    if (!is_array($actionPermissions)) $actionPermissions = [];
    $reportPermissions = array_values(array_unique(array_filter($reportPermissions, 'is_string')));
    $actionPermissions = array_values(array_unique(array_filter($actionPermissions, static fn ($permission): bool => is_string($permission) && in_array($permission, ['cobrar', 'anular', 'egresos', 'pedidos', 'incidencias', 'stock', 'transferirCaja', 'exportar', 'mrp', 'editarRecetas', 'comprasProduccion', 'stockMrp'], true))));
    // Si la edición no trae permisos, se conservan tal cual. NULL significa "los
    // del cargo": convertirlo en [] al bloquear o cambiar de local dejaba al
    // usuario sin ningún permiso (por ejemplo, sin poder cobrar).
    $reportPermissionsValue = array_key_exists('reportPermissions', $body) ? json_encode($reportPermissions, JSON_UNESCAPED_UNICODE) : $existing['report_permissions'];
    $actionPermissionsValue = array_key_exists('actionPermissions', $body) ? json_encode($actionPermissions, JSON_UNESCAPED_UNICODE) : $existing['action_permissions'];
    $mfaRequired = array_key_exists('mfaRequired', $body) ? (!empty($body['mfaRequired']) ? 1 : 0) : $existing['mfa_required'];
    if (!in_array($role, ['vendedora', 'supervisora', 'compras', 'administracion'], true)) {
        json_response(['ok' => false, 'error' => 'Cargo inválido'], 422);
    }
    if (!valid_username($username)) {
        json_response(['ok' => false, 'error' => 'Usuario o correo laboral inválido'], 422);
    }
    if (is_primary_user($existing, $config) && ($role !== 'administracion' || !$active)) {
        json_response(['ok' => false, 'error' => 'La cuenta principal no puede bloquearse ni cambiar de cargo'], 422);
    }
    if ($allLocations) {
        $locations = operational_sites();
    } elseif (!$locations) {
        json_response(['ok' => false, 'error' => 'Seleccioná al menos un local o Todos los locales'], 422);
    }
    $location = $locations[0] ?? $location;
    $pdo->prepare(
        'UPDATE users SET username = ?, role = ?, assigned_location = ?, assigned_locations = ?, access_all_locations = ?, active = ?, report_permissions = ?, action_permissions = ?, mfa_required = ? WHERE id = ?'
    )->execute([$username, $role, $location, json_encode($locations, JSON_UNESCAPED_UNICODE), $allLocations, $active, $reportPermissionsValue, $actionPermissionsValue, $mfaRequired, $userId]);
    audit($pdo, (int) $admin['id'], 'user_updated', 'user_id=' . $userId);
    json_response(['ok' => true]);
}

if ($method === 'GET' && $route === 'admin/users') {
    require_user($pdo, ['administracion']);
    $rows = $pdo->query(
        'SELECT id, username, full_name, role, assigned_location, assigned_locations, access_all_locations, active, must_change_password, report_permissions, action_permissions, mfa_required, created_at
         FROM users ORDER BY full_name'
    )->fetchAll();
    $users = array_map(static fn (array $row): array => public_user($row, $config) + [
        'active' => (bool) $row['active'],
        'created_at' => $row['created_at'],
    ], $rows);
    json_response(['ok' => true, 'users' => $users]);
}

if ($method === 'GET' && $route === 'admin/health') {
    require_user($pdo, ['administracion']);
    $totalUsers = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
    $activeUsers = (int) $pdo->query('SELECT COUNT(*) FROM users WHERE active = 1')->fetchColumn();
    $freeBytes = function_exists('disk_free_space') ? @disk_free_space(__DIR__) : false;
    json_response([
        'ok' => true,
        'database' => 'Disponible',
        'users' => ['total' => $totalUsers, 'active' => $activeUsers],
        'space' => $freeBytes === false ? null : (int) $freeBytes,
        'checked_at' => gmdate('c'),
    ]);
}

if ($method === 'GET' && $route === 'admin/monitoring') {
    require_user($pdo, ['administracion']);
    ensure_pnl_sync_schema($pdo);
    ensure_expense_sync_schema($pdo);
    ensure_mrp_schema($pdo);

    $startedAt = microtime(true);
    $pdo->query('SELECT 1');
    $databaseLatencyMs = (int) round((microtime(true) - $startedAt) * 1000);
    $freeBytes = function_exists('disk_free_space') ? @disk_free_space(__DIR__) : false;
    $totalUsers = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
    $activeUsers = (int) $pdo->query('SELECT COUNT(*) FROM users WHERE active = 1')->fetchColumn();
    $events24h = (int) $pdo->query("SELECT COUNT(*) FROM operation_events WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)")->fetchColumn();
    $failedPnl = (int) $pdo->query("SELECT COUNT(*) FROM pnl_sync_runs WHERE status = 'failed' AND started_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)")->fetchColumn();
    $failedExpenses = (int) $pdo->query("SELECT COUNT(*) FROM expense_sync_runs WHERE status = 'failed' AND started_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)")->fetchColumn();
    $failedMrp = (int) $pdo->query("SELECT COUNT(*) FROM mrp_sync_runs WHERE status = 'failed' AND started_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)")->fetchColumn();
    $lastPnl = $pdo->query("SELECT finished_at, status FROM pnl_sync_runs ORDER BY id DESC LIMIT 1")->fetch();
    $lastExpenses = $pdo->query("SELECT finished_at, status FROM expense_sync_runs ORDER BY id DESC LIMIT 1")->fetch();
    $lastMrp = $pdo->query("SELECT finished_at, status FROM mrp_sync_runs ORDER BY id DESC LIMIT 1")->fetch();
    $lastBackup = null;
    if (table_exists($pdo, 'backup_runs')) {
        $lastBackup = $pdo->query('SELECT finished_at, status FROM backup_runs ORDER BY id DESC LIMIT 1')->fetch();
    }

    $alerts = [];
    if (($failedPnl + $failedExpenses + $failedMrp) > 0) {
        $alerts[] = ['level' => 'atencion', 'message' => 'Hubo sincronizaciones que no se completaron en las últimas 24 horas.'];
    }
    if (!$lastBackup || ($lastBackup['status'] ?? '') !== 'verified') {
        $alerts[] = ['level' => 'atencion', 'message' => 'No hay un respaldo externo verificado recientemente.'];
    }
    if ($freeBytes !== false && $freeBytes < 512 * 1024 * 1024) {
        $alerts[] = ['level' => 'critico', 'message' => 'El espacio disponible del servidor está por debajo de 512 MB.'];
    }

    json_response([
        'ok' => true,
        'api' => 'Disponible',
        'database' => 'Disponible',
        'database_latency_ms' => $databaseLatencyMs,
        'users' => ['total' => $totalUsers, 'active' => $activeUsers],
        'space' => $freeBytes === false ? null : (int) $freeBytes,
        'events_24h' => $events24h,
        'failed_syncs_24h' => $failedPnl + $failedExpenses + $failedMrp,
        'drive_connected' => pnl_is_connected($pdo, $config),
        'last_pnl_sync' => $lastPnl ?: null,
        'last_expense_sync' => $lastExpenses ?: null,
        'last_mrp_sync' => $lastMrp ?: null,
        'last_backup' => $lastBackup ?: null,
        'alerts' => $alerts,
        'checked_at' => gmdate('c'),
    ]);
}

if ($method === 'GET' && $route === 'admin/backups/latest') {
    require_user($pdo, ['administracion']);
    $pdo->exec("CREATE TABLE IF NOT EXISTS backup_runs (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, started_at DATETIME NOT NULL, finished_at DATETIME NULL,
        status VARCHAR(30) NOT NULL, filename VARCHAR(255) NOT NULL, size_bytes BIGINT UNSIGNED NULL,
        sha256 CHAR(64) NULL, drive_file_id VARCHAR(255) NULL, error_message VARCHAR(1000) NULL,
        INDEX idx_backup_runs_started (started_at), INDEX idx_backup_runs_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $latest = $pdo->query('SELECT started_at, finished_at, status, filename, size_bytes, error_message FROM backup_runs ORDER BY id DESC LIMIT 1')->fetch();
    json_response(['ok' => true, 'backup' => $latest ?: null]);
}

if ($method === 'POST' && $route === 'admin/backups/run') {
    $admin = require_user($pdo, ['administracion']);
    $pdo->exec("CREATE TABLE IF NOT EXISTS backup_runs (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, started_at DATETIME NOT NULL, finished_at DATETIME NULL,
        status VARCHAR(30) NOT NULL, filename VARCHAR(255) NOT NULL, size_bytes BIGINT UNSIGNED NULL,
        sha256 CHAR(64) NULL, drive_file_id VARCHAR(255) NULL, error_message VARCHAR(1000) NULL,
        INDEX idx_backup_runs_started (started_at), INDEX idx_backup_runs_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $last = $pdo->query("SELECT started_at FROM backup_runs WHERE started_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE) ORDER BY id DESC LIMIT 1")->fetchColumn();
    if ($last) json_response(['ok' => false, 'error' => 'Ya hay un respaldo iniciado hace menos de cinco minutos.'], 429);
    if (!function_exists('exec') || !defined('PHP_BINARY') || PHP_BINARY === '') {
        json_response(['ok' => false, 'error' => 'El hosting no permite iniciar respaldos bajo demanda.'], 503);
    }
    $command = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__DIR__ . '/backup.php') . ' run 2>&1';
    $output = [];
    $exitCode = 1;
    exec($command, $output, $exitCode);
    audit($pdo, (int) $admin['id'], 'backup_before_update', 'resultado=' . $exitCode);
    if ($exitCode !== 0) json_response(['ok' => false, 'error' => 'El respaldo previo no se pudo verificar. No publiques una actualización.', 'detail' => implode("\n", array_slice($output, -3))], 500);
    json_response(['ok' => true, 'message' => 'Respaldo previo verificado y enviado a Drive.']);
}

if ($method === 'POST' && $route === 'admin/users') {
    $admin = require_user($pdo, ['administracion']);
    $body = request_body();
    $username = mb_strtolower(trim((string) ($body['username'] ?? '')), 'UTF-8');
    $fullName = trim((string) ($body['fullName'] ?? ''));
    $role = (string) ($body['role'] ?? '');
    $location = trim((string) ($body['assignedLocation'] ?? '')) ?: null;
    $allLocations = !empty($body['accessAllLocations']) ? 1 : 0;
    $locations = $body['assignedLocations'] ?? ($location ? [$location] : []);
    if (!is_array($locations)) $locations = [];
    $locations = array_values(array_unique(array_filter($locations, static fn ($site): bool => is_string($site) && in_array($site, operational_sites(), true))));
    if ($allLocations) $locations = operational_sites();
    $temporaryPassword = (string) ($body['temporaryPassword'] ?? '');
    $reportPermissions = is_array($body['reportPermissions'] ?? null) ? array_values(array_filter($body['reportPermissions'], 'is_string')) : null;
    $actionPermissions = is_array($body['actionPermissions'] ?? null) ? array_values(array_filter($body['actionPermissions'], 'is_string')) : null;
    $mfaRequired = array_key_exists('mfaRequired', $body) ? (!empty($body['mfaRequired']) ? 1 : 0) : null;
    $fieldErrors = [];
    if ($fullName === '') $fieldErrors['fullName'] = 'Ingresá nombre y apellido.';
    if (!valid_username($username)) $fieldErrors['username'] = 'Usá nombre.apellido o un correo @lartisantaller.com.';
    if (!in_array($role, ['vendedora', 'supervisora', 'compras', 'administracion'], true)) $fieldErrors['role'] = 'Seleccioná un cargo válido.';
    if (!$locations) $fieldErrors['locations'] = 'Seleccioná al menos un local o Todos los locales.';
    if (!valid_password($temporaryPassword)) $fieldErrors['temporaryPassword'] = 'Debe tener 8 o más caracteres, mayúscula, minúscula, número y símbolo.';
    if ($fieldErrors) {
        json_response(['ok' => false, 'error' => 'Revisá los campos marcados.', 'fields' => $fieldErrors], 422);
    }
    $stmt = $pdo->prepare(
        'INSERT INTO users (username, full_name, password_hash, role, assigned_location, assigned_locations, access_all_locations, report_permissions, action_permissions, mfa_required)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    try {
        $stmt->execute([$username, $fullName, password_hash($temporaryPassword, PASSWORD_DEFAULT), $role, $locations[0], json_encode($locations, JSON_UNESCAPED_UNICODE), $allLocations, $reportPermissions === null ? null : json_encode($reportPermissions, JSON_UNESCAPED_UNICODE), $actionPermissions === null ? null : json_encode($actionPermissions, JSON_UNESCAPED_UNICODE), $mfaRequired]);
    } catch (PDOException $error) {
        if ((string) $error->getCode() === '23000') {
            json_response(['ok' => false, 'error' => 'Ese nombre de usuario ya existe', 'fields' => ['username' => 'Ese usuario ya está en uso.']], 409);
        }
        throw $error;
    }
    $newId = (int) $pdo->lastInsertId();
    audit($pdo, (int) $admin['id'], 'user_created', 'user_id=' . $newId);
    json_response(['ok' => true, 'id' => $newId], 201);
}

json_response(['ok' => false, 'error' => 'Ruta no encontrada'], 404);
