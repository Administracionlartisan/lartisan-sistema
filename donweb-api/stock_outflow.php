<?php

declare(strict_types=1);

/** Validate requests before storage; the server supplies identity and time. */
function make_stock_outflow_request(array $input, string $site, string $actor, string $now): array
{
    $id = $input['id'] ?? null;
    if (!is_string($id) || !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $id)) throw new DomainException('Identificador de solicitud inválido.');
    $destination = trim((string) ($input['destination'] ?? ''));
    $carrier = trim((string) ($input['carrier'] ?? ''));
    $reason = trim((string) ($input['reason'] ?? ''));
    if ($site === '' || $actor === '' || $destination === '' || $carrier === '' || $reason === '') throw new DomainException('Completá destino, responsable del retiro y motivo.');
    foreach ([$destination, $carrier, $reason] as $text) if (mb_strlen($text, 'UTF-8') > 300) throw new DomainException('El texto supera el largo permitido.');
    $lines = $input['lines'] ?? null;
    if (!is_array($lines) || !$lines || count($lines) > 200) throw new DomainException('Agregá productos a la solicitud.');
    $unique = [];
    foreach ($lines as $line) {
        if (!is_array($line)) throw new DomainException('Producto inválido.');
        $product = filter_var($line['productId'] ?? null, FILTER_VALIDATE_INT);
        $quantity = filter_var($line['quantity'] ?? null, FILTER_VALIDATE_INT);
        if ($product === false || $product < 1 || $quantity === false || $quantity < 1 || isset($unique[$product])) throw new DomainException('Producto o cantidad inválidos.');
        $unique[$product] = ['productId' => $product, 'quantity' => $quantity];
    }
    return ['id' => $id, 'site' => $site, 'destination' => $destination, 'carrier' => $carrier, 'reason' => $reason,
        'lines' => array_values($unique), 'status' => 'Pendiente', 'requestedBy' => $actor, 'requestedAtISO' => $now];
}

function reject_stock_outflow(array $request, string $actor, string $now, string $reason): array
{
    if (($request['status'] ?? null) !== 'Pendiente') throw new DomainException('La solicitud ya fue resuelta.');
    $reason = trim($reason);
    if ($actor === '' || $reason === '' || mb_strlen($reason, 'UTF-8') > 300) throw new DomainException('Indicá el motivo del rechazo.');
    $request['status'] = 'Rechazado';
    $request['decidedBy'] = $actor;
    $request['decidedAtISO'] = $now;
    $request['decisionReason'] = $reason;
    return $request;
}

/** Pure validation and planning for an outflow. The caller must hold the site
 * state row lock and persist the request, stock and movements in one transaction. */
function plan_stock_outflow_approval(array $request, array $stock, string $site, string $actor, string $now): array
{
    if (($request['status'] ?? null) !== 'Pendiente') throw new DomainException('La solicitud ya fue resuelta.');
    $id = $request['id'] ?? null;
    if (!is_string($id) || !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $id)) throw new DomainException('Identificador de solicitud inválido.');
    if (($request['site'] ?? null) !== $site || trim($actor) === '') throw new DomainException('Solicitud o responsable inválido.');
    $lines = $request['lines'] ?? null;
    if (!is_array($lines) || !$lines || count($lines) > 200) throw new DomainException('La solicitud no tiene productos válidos.');
    $normalized = [];
    foreach ($lines as $line) {
        if (!is_array($line)) throw new DomainException('Producto inválido.');
        $product = filter_var($line['productId'] ?? null, FILTER_VALIDATE_INT);
        $quantity = filter_var($line['quantity'] ?? null, FILTER_VALIDATE_INT);
        if ($product === false || $product < 1 || $quantity === false || $quantity < 1 || isset($normalized[$product])) throw new DomainException('Producto o cantidad inválidos.');
        $available = $stock[$product] ?? null;
        if (!is_numeric($available) || (float) $available < $quantity) throw new DomainException('No hay stock suficiente para aprobar toda la solicitud.');
        $normalized[$product] = $quantity;
    }
    $movements = [];
    foreach ($normalized as $product => $quantity) {
        $stock[$product] = (float) $stock[$product] - $quantity;
        $hash = hash('sha256', 'stock-outflow:' . strtolower($id) . ':' . $product);
        $movementId = substr($hash, 0, 8) . '-' . substr($hash, 8, 4) . '-5' . substr($hash, 13, 3) . '-a' . substr($hash, 17, 3) . '-' . substr($hash, 20, 12);
        $movements[] = ['id' => $movementId, 'site' => $site, 'productId' => $product, 'kind' => 'Egreso manual', 'quantity' => -$quantity,
            'remito' => '', 'detail' => 'Egreso autorizado · solicitud ' . $id, 'reference' => $id, 'at' => $now, 'atISO' => $now, 'createdBy' => $actor];
    }
    $request['status'] = 'Aprobado';
    $request['decidedBy'] = $actor;
    $request['decidedAtISO'] = $now;
    return ['request' => $request, 'stock' => $stock, 'movements' => $movements];
}

/** Requests live separately from client snapshots, so stale clients cannot erase decisions. */
function ensure_stock_outflow_schema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS stock_outflow_requests (id CHAR(36) NOT NULL PRIMARY KEY, site VARCHAR(80) NOT NULL, status VARCHAR(20) NOT NULL, request_json LONGTEXT NOT NULL, created_by BIGINT UNSIGNED NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, decided_by BIGINT UNSIGNED NULL, decided_at DATETIME NULL, INDEX idx_stock_outflow_site_status (site, status)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

/** Caller authorizes the actor and site; all related writes commit together. */
function decide_stock_outflow(PDO $pdo, string $id, string $site, array $actor, string $decision, string $reason = ''): array
{
    if (!in_array($decision, ['approve', 'reject'], true)) throw new DomainException('Decisión inválida.');
    $pdo->beginTransaction();
    try {
        $lookup = $pdo->prepare('SELECT request_json FROM stock_outflow_requests WHERE id = ? AND site = ? FOR UPDATE');
        $lookup->execute([$id, $site]);
        $json = $lookup->fetchColumn();
        if ($json === false) throw new DomainException('Solicitud no encontrada.');
        $request = json_decode((string) $json, true);
        if (!is_array($request)) throw new DomainException('Solicitud ilegible; avisá a Administración.');
        $name = (string) ($actor['full_name'] ?? $actor['username'] ?? '');
        $now = gmdate('Y-m-d\TH:i:s\Z');
        if ($decision === 'reject') {
            $result = reject_stock_outflow($request, $name, $now, $reason);
        } else {
            $stateQuery = $pdo->prepare('SELECT state_json FROM operation_site_states WHERE site = ? FOR UPDATE');
            $stateQuery->execute([$site]);
            $stateJson = $stateQuery->fetchColumn();
            $state = $stateJson === false ? null : json_decode((string) $stateJson, true);
            if (!is_array($state) || !is_array($state['stock'] ?? null)) throw new DomainException('No hay stock confirmado para este local.');
            $plan = plan_stock_outflow_approval($request, $state['stock'], $site, $name, $now);
            $previous = $state;
            $state['stock'] = $plan['stock'];
            $state['stockMovements'] = array_merge($plan['movements'], is_array($state['stockMovements'] ?? null) ? $state['stockMovements'] : []);
            $encoded = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            if (strlen($encoded) > 4000000) throw new DomainException('El estado del local supera el tamaño permitido.');
            $pdo->prepare('UPDATE operation_site_states SET state_json = ?, revision = revision + 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE site = ?')->execute([$encoded, (int) $actor['id'], $site]);
            sync_normalized_operations($pdo, $site, $state, (int) $actor['id'], $previous);
            $result = $plan['request'];
        }
        $encodedRequest = json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $pdo->prepare('UPDATE stock_outflow_requests SET status = ?, request_json = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ? AND site = ?')->execute([$result['status'], $encodedRequest, (int) $actor['id'], $id, $site]);
        audit($pdo, (int) $actor['id'], 'stock_outflow_' . $decision, $site . ' · ' . $id);
        $pdo->commit();
        return $result;
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}
