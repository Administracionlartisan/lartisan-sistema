<?php

declare(strict_types=1);

/**
 * Ventana excepcional, de una sola fecha, para una validación auditada.  No
 * cambia la zona horaria del servidor ni el reloj: sólo autoriza que Maure
 * guarde operaciones de prueba con la fecha operativa indicada.
 */
function ensure_test_operating_date_schema(PDO $pdo): void
{
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
        UNIQUE KEY uq_test_operating_date_active (site, business_date, status),
        INDEX idx_test_operating_date_status (status, site, business_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

function active_test_operating_date(PDO $pdo): ?array
{
    ensure_test_operating_date_schema($pdo);
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
    $active = active_test_operating_date($pdo);
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
    if (!$hasCanonicalEvent && !$legacyLabeledReplay) {
        throw new InvalidArgumentException('La operación de prueba debe conservar su fecha y etiqueta auditadas.');
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
                    throw new InvalidArgumentException('Un registro nuevo no utiliza la fecha operativa de prueba autorizada.');
                }
            }
            if ($collection === 'sales' && !str_contains((string) ($item['customer'] ?? ''), 'PRUEBA DE VALIDACIÓN')) {
                throw new InvalidArgumentException('La venta de prueba debe estar identificada para auditoría.');
            }
            if ($collection === 'stockMovements' && !str_contains((string) ($item['detail'] ?? ''), 'PRUEBA DE VALIDACIÓN')) {
                throw new InvalidArgumentException('El movimiento de stock de prueba debe estar identificado para auditoría.');
            }
        }
    }
}
