<?php

declare(strict_types=1);

/** Presence is deliberately server-side. Browser coordinates are evidence, not
 * proof of identity, so uncertain readings always become an exception rather
 * than a fraud accusation. */
function ensure_attendance_presence_schema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS lartisan_site_presence_settings (
        site VARCHAR(80) NOT NULL PRIMARY KEY,
        latitude DECIMAL(10,7) NULL,
        longitude DECIMAL(10,7) NULL,
        radius_meters SMALLINT UNSIGNED NOT NULL DEFAULT 100,
        max_accuracy_meters SMALLINT UNSIGNED NOT NULL DEFAULT 75,
        updated_by BIGINT UNSIGNED NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS lartisan_attendance_exceptions (
        id CHAR(36) NOT NULL PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        site VARCHAR(80) NOT NULL,
        kind ENUM('Entrada','Salida') NOT NULL,
        status ENUM('Pendiente','Aprobada','Rechazada') NOT NULL DEFAULT 'Pendiente',
        reason VARCHAR(80) NOT NULL,
        evidence_json TEXT NULL,
        requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME NULL,
        resolved_by BIGINT UNSIGNED NULL,
        resolution_note VARCHAR(500) NULL,
        INDEX idx_lartisan_attendance_exceptions_site_status (site, status),
        INDEX idx_lartisan_attendance_exceptions_user_status (user_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    // Una computadora de mostrador puede autorizarse una sola vez para un
    // local. Conserva un secreto aleatorio local: no se usa IP ni ubicación
    // estimada, y nunca se habilita sola.
    $pdo->exec("CREATE TABLE IF NOT EXISTS lartisan_attendance_devices (
        id CHAR(36) NOT NULL PRIMARY KEY,
        site VARCHAR(80) NOT NULL,
        device_id CHAR(36) NOT NULL,
        token_hash CHAR(64) NOT NULL,
        label VARCHAR(120) NOT NULL,
        status ENUM('Pendiente','Aprobado','Revocado') NOT NULL DEFAULT 'Pendiente',
        requested_by BIGINT UNSIGNED NOT NULL,
        requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        approved_by BIGINT UNSIGNED NULL,
        approved_at DATETIME NULL,
        UNIQUE KEY uq_lartisan_attendance_device (site, device_id),
        INDEX idx_lartisan_attendance_device_status (site, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    // Los horarios no viven dentro del snapshot del navegador: cada versión es
    // una fuente histórica independiente para que un cambio futuro jamás
    // recalcule injustamente un fichaje ya ocurrido.
    $pdo->exec("CREATE TABLE IF NOT EXISTS lartisan_employee_schedule_versions (
        id CHAR(36) NOT NULL PRIMARY KEY,
        employee_user_id BIGINT UNSIGNED NOT NULL,
        site VARCHAR(80) NOT NULL,
        weekday TINYINT UNSIGNED NOT NULL,
        starts_at TIME NULL,
        ends_at TIME NULL,
        tolerance_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 10,
        effective_from DATE NOT NULL,
        effective_to DATE NULL,
        created_by BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_lartisan_schedule_lookup (employee_user_id, site, weekday, effective_from, effective_to),
        INDEX idx_lartisan_schedule_site_date (site, effective_from, effective_to)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

function attendance_local_date(string $value): ?string
{
    try { return (new DateTimeImmutable($value))->setTimezone(new DateTimeZone('America/Argentina/Buenos_Aires'))->format('Y-m-d'); }
    catch (Throwable $error) { return null; }
}

function attendance_schedule_payload(array $row): array
{
    return [
        'id' => (string) $row['id'], 'employeeUserId' => (int) $row['employee_user_id'],
        'employeeName' => (string) ($row['employee_name'] ?? ''), 'site' => (string) $row['site'],
        'weekday' => (int) $row['weekday'], 'startsAt' => $row['starts_at'] === null ? null : substr((string) $row['starts_at'], 0, 5),
        'endsAt' => $row['ends_at'] === null ? null : substr((string) $row['ends_at'], 0, 5),
        'toleranceMinutes' => (int) $row['tolerance_minutes'], 'effectiveFrom' => (string) $row['effective_from'],
        'effectiveTo' => $row['effective_to'] === null ? null : (string) $row['effective_to'],
        'createdAt' => (string) $row['created_at'], 'createdBy' => (string) ($row['created_by_name'] ?? ''),
    ];
}

function attendance_schedule_for(PDO $pdo, int $employeeId, string $site, string $date): ?array
{
    $weekday = (int) (new DateTimeImmutable($date))->format('N');
    $stmt = $pdo->prepare('SELECT * FROM lartisan_employee_schedule_versions WHERE employee_user_id=? AND site=? AND weekday=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from DESC LIMIT 1');
    $stmt->execute([$employeeId, $site, $weekday, $date, $date]);
    return $stmt->fetch() ?: null;
}

function presence_settings(PDO $pdo, string $site): ?array
{
    $statement = $pdo->prepare('SELECT site, latitude, longitude, radius_meters, max_accuracy_meters FROM lartisan_site_presence_settings WHERE site = ?');
    $statement->execute([$site]);
    $row = $statement->fetch();
    if (!$row || $row['latitude'] === null || $row['longitude'] === null) return null;
    return ['site' => (string) $row['site'], 'latitude' => (float) $row['latitude'], 'longitude' => (float) $row['longitude'], 'radiusMeters' => (int) $row['radius_meters'], 'maxAccuracyMeters' => (int) $row['max_accuracy_meters']];
}

function presence_distance_meters(float $aLat, float $aLon, float $bLat, float $bLon): float
{
    $earth = 6371000.0;
    $dLat = deg2rad($bLat - $aLat); $dLon = deg2rad($bLon - $aLon);
    $x = sin($dLat / 2) ** 2 + cos(deg2rad($aLat)) * cos(deg2rad($bLat)) * sin($dLon / 2) ** 2;
    return 2 * $earth * atan2(sqrt($x), sqrt(1 - $x));
}

function presence_uuid(): string
{
    $bytes = bin2hex(random_bytes(16));
    return substr($bytes, 0, 8) . '-' . substr($bytes, 8, 4) . '-4' . substr($bytes, 13, 3) . '-a' . substr($bytes, 17, 3) . '-' . substr($bytes, 20, 12);
}

function attendance_authorized_device(PDO $pdo, string $site, array $device): ?array
{
    $deviceId = trim((string) ($device['deviceId'] ?? ''));
    $token = trim((string) ($device['token'] ?? ''));
    if (!preg_match('/^[a-f0-9-]{36}$/i', $deviceId) || strlen($token) < 32 || strlen($token) > 300) return null;
    $stmt = $pdo->prepare("SELECT * FROM lartisan_attendance_devices WHERE site=? AND device_id=? AND status='Aprobado' LIMIT 1");
    $stmt->execute([$site, $deviceId]); $row = $stmt->fetch();
    return $row && hash_equals((string) $row['token_hash'], hash('sha256', $token)) ? $row : null;
}

/**
 * Las computadoras fijas de los locales fichan con la sesión personal sin
 * geocerca ni aprobación. Los dispositivos móviles conservan la validación
 * de presencia para evitar que el fichaje se haga fuera del local.
 */
function attendance_request_is_mobile(): bool
{
    $agent = strtolower((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''));
    return (bool) preg_match('/android|iphone|ipad|ipod|windows phone|mobile/', $agent);
}

function presence_evaluate(PDO $pdo, string $site, array $geo): array
{
    $settings = presence_settings($pdo, $site);
    if ($settings === null) return ['ok' => false, 'reason' => 'Local sin geocerca configurada', 'settings' => null];
    $lat = filter_var($geo['latitude'] ?? null, FILTER_VALIDATE_FLOAT);
    $lon = filter_var($geo['longitude'] ?? null, FILTER_VALIDATE_FLOAT);
    $accuracy = filter_var($geo['accuracy'] ?? null, FILTER_VALIDATE_FLOAT);
    $capturedAt = strtotime((string) ($geo['capturedAt'] ?? ''));
    if ($lat === false || $lon === false || $accuracy === false || $capturedAt === false) return ['ok' => false, 'reason' => 'Ubicación no disponible', 'settings' => $settings];
    if ($lat < -90 || $lat > 90 || $lon < -180 || $lon > 180 || $accuracy < 0) return ['ok' => false, 'reason' => 'Ubicación sospechosa', 'settings' => $settings];
    if (abs(time() - $capturedAt) > 600) return ['ok' => false, 'reason' => 'Ubicación vencida', 'settings' => $settings];
    if ($accuracy > $settings['maxAccuracyMeters']) return ['ok' => false, 'reason' => 'Precisión insuficiente', 'settings' => $settings, 'accuracy' => $accuracy];
    $distance = presence_distance_meters((float) $lat, (float) $lon, $settings['latitude'], $settings['longitude']);
    if ($distance > $settings['radiusMeters']) return ['ok' => false, 'reason' => 'Fuera de zona', 'settings' => $settings, 'distance' => $distance, 'accuracy' => $accuracy];
    return ['ok' => true, 'reason' => 'Dentro de zona', 'settings' => $settings, 'distance' => $distance, 'accuracy' => $accuracy];
}

function attendance_append_to_locked_state(PDO $pdo, string $site, array $user, string $kind, array $extra = []): array
{
    $lookup = $pdo->prepare('SELECT state_json, revision FROM operation_site_states WHERE site = ? FOR UPDATE');
    $lookup->execute([$site]); $row = $lookup->fetch();
    $state = $row ? json_decode((string) $row['state_json'], true) : [];
    if (!is_array($state)) $state = [];
    $records = is_array($state['attendanceRecords'] ?? null) ? $state['attendanceRecords'] : [];
    $mine = array_values(array_filter($records, static fn ($record): bool => is_array($record) && ($record['userId'] ?? null) === (int) $user['id']));
    usort($mine, static fn ($a, $b) => strcmp((string) ($b['atISO'] ?? ''), (string) ($a['atISO'] ?? '')));
    $last = $mine[0] ?? null;
    if ($kind === 'Entrada' && ($last['kind'] ?? null) === 'Entrada') throw new RuntimeException('Ya existe una entrada abierta para este usuario.');
    if ($kind === 'Salida' && ($last['kind'] ?? null) !== 'Entrada') throw new RuntimeException('Primero debe registrarse una entrada.');
    $now = new DateTimeImmutable('now');
    $record = array_merge(['id' => presence_uuid(), 'userId' => (int) $user['id'], 'userName' => (string) $user['full_name'], 'site' => $site, 'kind' => $kind, 'at' => $now->format('j/n/Y, H:i:s'), 'atISO' => $now->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\\TH:i:s.v\\Z')], $extra);
    array_unshift($records, $record); $state['attendanceRecords'] = $records;
    $json = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($row) $pdo->prepare('UPDATE operation_site_states SET state_json = ?, revision = revision + 1, updated_by = ? WHERE site = ?')->execute([$json, $user['id'], $site]);
    else $pdo->prepare('INSERT INTO operation_site_states (site, state_json, revision, updated_by) VALUES (?, ?, 1, ?)')->execute([$site, $json, $user['id']]);
    return $record;
}

function enforce_strict_cash_snapshot(array $previous, array $next, array $user, string $site): void
{
    $wasOpen = !empty($previous['cashOpen']); $isOpen = !empty($next['cashOpen']);
    $wasShift = is_array($previous['activeShift'] ?? null) ? $previous['activeShift'] : null;
    $shift = is_array($next['activeShift'] ?? null) ? $next['activeShift'] : null;
    if ($wasOpen && $isOpen && $wasShift !== null && (!$shift || ($shift['id'] ?? '') !== ($wasShift['id'] ?? ''))) {
        throw new RuntimeException('La caja ya está abierta por ' . ($wasShift['openedBy'] ?? 'otra responsable') . '. Debe realizarse el cierre completo antes del relevo.');
    }
    if ($wasOpen && $isOpen && $wasShift !== null && $shift === null) throw new RuntimeException('No se permite cerrar un turno dejando la caja abierta.');
    if (!$wasOpen && $isOpen) {
        if (!$shift || empty($shift['id']) || ($shift['site'] ?? '') !== $site) throw new RuntimeException('La apertura debe crear una responsable activa.');
        if (($shift['openedBy'] ?? '') !== (string) $user['full_name']) throw new RuntimeException('La caja solo puede ser abierta por la responsable de la sesión.');
    }
    if ($wasOpen && !$isOpen && $wasShift !== null) {
        $closed = false;
        foreach (is_array($next['shiftLog'] ?? null) ? $next['shiftLog'] : [] as $item) if (is_array($item) && ($item['id'] ?? '') === ($wasShift['id'] ?? '') && (!empty($item['closedAtISO']) || !empty($item['closedAt']))) { $closed = true; break; }
        if (!$closed) throw new RuntimeException('El cierre completo debe registrar arqueo y responsable saliente antes de abrir otra caja.');
    }
}

/**
 * When an old browser attempts to close a different, already superseded shift,
 * the caller keeps the current cash state so other queued work can still be
 * synchronized.  That recovery must also discard the closing entries created
 * by the stale shift: otherwise its envelope or closing balance is written to
 * the current local's journal even though the close itself was rejected.
 *
 * New sales that belong to the actual active shift are intentionally kept.
 */
function preserve_current_cash_after_rejected_stale_close(array $previous, array $candidate): array
{
    $active = is_array($previous['activeShift'] ?? null) ? $previous['activeShift'] : null;
    $activeId = (string) ($active['id'] ?? '');

    foreach (['cashOpen', 'activeShift', 'shiftLog'] as $field) {
        if (array_key_exists($field, $previous)) $candidate[$field] = $previous[$field];
        else unset($candidate[$field]);
    }

    $knownLedger = [];
    foreach (is_array($previous['cashLedger'] ?? null) ? $previous['cashLedger'] : [] as $entry) {
        if (is_array($entry) && isset($entry['id']) && is_scalar($entry['id'])) $knownLedger[(string) $entry['id']] = true;
    }
    $candidate['cashLedger'] = array_values(array_filter(
        is_array($candidate['cashLedger'] ?? null) ? $candidate['cashLedger'] : [],
        static function ($entry) use ($knownLedger, $activeId): bool {
            if (!is_array($entry) || !isset($entry['id']) || !is_scalar($entry['id'])) return false;
            $id = (string) $entry['id'];
            if (isset($knownLedger[$id])) return true;
            // A new journal entry is trustworthy only when it was recorded
            // against the shift the server still has open.
            return $activeId !== '' && (string) ($entry['shiftId'] ?? '') === $activeId;
        }
    ));

    // An envelope belongs to a valid closing operation. It has no shift id in
    // older snapshots, so retaining a newly added one would be ambiguous.
    if (array_key_exists('envelopeRecords', $previous)) $candidate['envelopeRecords'] = $previous['envelopeRecords'];
    else unset($candidate['envelopeRecords']);

    return $candidate;
}
