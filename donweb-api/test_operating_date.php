<?php

declare(strict_types=1);

/**
 * Ventana excepcional, de una sola fecha, para una validación auditada.  No
 * cambia la zona horaria del servidor ni el reloj: sólo autoriza que Maure
 * guarde operaciones de prueba con la fecha operativa indicada.
 */
function ensure_test_operating_date_schema(PDO $pdo): void
{
    if (!table_exists($pdo, 'test_operating_date_runs')) {
        $pdo->exec("CREATE TABLE IF NOT EXISTS test_operating_date_runs (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            site VARCHAR(80) NOT NULL,
            business_date DATE NOT NULL,
            label VARCHAR(120) NOT NULL,
            purpose VARCHAR(500) NOT NULL,
            status ENUM('active','disabled') NOT NULL DEFAULT 'active',
            enabled_by BIGINT UNSIGNED NOT NULL,
            enabled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            disabled_by BIGINT UNSIGNED NULL,
            disabled_at DATETIME NULL,
            INDEX idx_test_operating_date_status (status, site, business_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
    // La clave única (site, business_date, status) impedía desactivar la
    // ventana por segunda vez: chocaba con la fila ya desactivada y la ventana
    // quedaba activa, rechazando toda venta real de Maure. Que haya una sola
    // ventana activa lo garantiza la habilitación.
    if ($pdo->query("SHOW INDEX FROM test_operating_date_runs WHERE Key_name = 'uq_test_operating_date_active'")->fetch()) {
        $pdo->exec('ALTER TABLE test_operating_date_runs DROP INDEX uq_test_operating_date_active');
    }
}

/** Solo lectura: /sync la consulta dentro de su transacción, donde un DDL
 * haría un COMMIT implícito. La estructura la crea la migración inicial. */
function active_test_operating_date(PDO $pdo): ?array
{
    if (!table_exists($pdo, 'test_operating_date_runs')) return null;
    $statement = $pdo->query("SELECT id,site,business_date,label,purpose,enabled_by,enabled_at FROM test_operating_date_runs WHERE status='active' ORDER BY id DESC LIMIT 1");
    $row = $statement->fetch();
    return is_array($row) ? $row : null;
}

function test_operating_date_is_authorized(PDO $pdo, string $site, string $businessDate): bool
{
    $active = active_test_operating_date($pdo);
    return $active !== null
        && (string) $active['site'] === $site
        && (string) $active['business_date'] === $businessDate;
}

function require_authorized_business_date(PDO $pdo, string $site, string $businessDate): void
{
    $today = (new DateTimeImmutable('now'))->format('Y-m-d');
    if ($businessDate === $today) return;
    if (!test_operating_date_is_authorized($pdo, $site, $businessDate)) {
        throw new InvalidArgumentException('La fecha operativa no está autorizada para este local.');
    }
}

function test_operating_date_public_payload(PDO $pdo): array
{
    $active = active_test_operating_date($pdo);
    if ($active === null) return ['active' => false];
    return [
        'active' => true,
        'site' => (string) $active['site'],
        'businessDate' => (string) $active['business_date'],
        'label' => (string) $active['label'],
        'purpose' => (string) $active['purpose'],
        'enabledAt' => (string) $active['enabled_at'],
    ];
}

/** The one-off scope is deliberately hard-coded rather than user-selectable. */
function validate_test_operating_date_scope(string $site, string $businessDate, string $label): void
{
    if ($site !== 'Maure' || $businessDate !== '2026-10-15' || $label !== 'PRUEBA DE VALIDACIÓN') {
        throw new InvalidArgumentException('Esta ventana de fecha está restringida a Maure, 15/10/2026 y PRUEBA DE VALIDACIÓN.');
    }
}

/**
 * The browser cannot opt into an arbitrary backdated state. While the narrow
 * window is active, every changed Maure snapshot must explicitly identify the
 * validation and every newly-created timestamped record must use that exact
 * business date.
 */
function validate_test_operating_snapshot(PDO $pdo, string $site, array $previous, array $incoming, array $event): void
{
    check_test_operating_snapshot(active_test_operating_date($pdo), $site, $previous, $incoming, $event);
}

/** Un rechazo aquí es definitivo (422): reintentar no cambia el resultado
 * mientras la ventana siga activa, y la cola del equipo se conserva. */
function check_test_operating_snapshot(?array $active, string $site, array $previous, array $incoming, array $event): void
{
    if ($active === null || $site !== (string) $active['site']) return;
    $businessDate = (string) $active['business_date'];
    $hasCanonicalEvent = (string) ($event['testOperatingDate'] ?? '') === $businessDate
        && (string) ($event['testLabel'] ?? '') === 'PRUEBA DE VALIDACIÓN';
    // Migración de una única cola local creada por la primera versión del modo
    // de prueba: al compactar una escritura pendiente se perdían los campos
    // canónicos del evento, aunque el detalle auditado sí estaba identificado.
    // Sólo se acepta mientras la ventana estricta de Maure está activa; las
    // colecciones nuevas se siguen verificando más abajo contra la misma fecha.
    $legacyLabeledReplay = !$hasCanonicalEvent
        && str_contains((string) ($event['detail'] ?? ''), 'PRUEBA DE VALIDACIÓN');
    $windowNotice = $site . ' tiene activa la ventana de prueba del ' . $businessDate
        . ': solo acepta operaciones identificadas como PRUEBA DE VALIDACIÓN. Administración debe cerrarla para sincronizar operaciones reales.';
    if (!$hasCanonicalEvent && !$legacyLabeledReplay) {
        throw new OperationalSyncRejected($windowNotice);
    }
    foreach (['sales', 'shiftLog', 'cashLedger', 'stockMovements', 'returnsLog', 'audit'] as $collection) {
        $known = [];
        foreach ((array) ($previous[$collection] ?? []) as $item) {
            if (is_array($item) && isset($item['id'])) $known[(string) $item['id']] = true;
        }
        foreach ((array) ($incoming[$collection] ?? []) as $item) {
            if (!is_array($item) || !isset($item['id']) || isset($known[(string) $item['id']])) continue;
            $timestamps = array_filter([
                $item['createdAtISO'] ?? null, $item['openedAtISO'] ?? null,
                $item['closedAtISO'] ?? null, $item['atISO'] ?? null,
            ], static fn ($value): bool => is_string($value) && $value !== '');
            foreach ($timestamps as $timestamp) {
                if (!str_starts_with((string) $timestamp, $businessDate . 'T')) {
                    throw new OperationalSyncRejected('Un registro nuevo no utiliza la fecha operativa de prueba autorizada. ' . $windowNotice);
                }
            }
            if ($collection === 'sales' && !str_contains((string) ($item['customer'] ?? ''), 'PRUEBA DE VALIDACIÓN')) {
                throw new OperationalSyncRejected('La venta de prueba debe estar identificada para auditoría. ' . $windowNotice);
            }
            if ($collection === 'stockMovements' && !str_contains((string) ($item['detail'] ?? ''), 'PRUEBA DE VALIDACIÓN')) {
                throw new OperationalSyncRejected('El movimiento de stock de prueba debe estar identificado para auditoría. ' . $windowNotice);
            }
        }
    }
}
