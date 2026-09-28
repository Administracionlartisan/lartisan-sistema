<?php
declare(strict_types=1);

/* El navegador sólo identifica la venta. El servidor reconstruye importe,
 * cliente, punto y número. Si ARCA no confirma, no se reintenta a ciegas. */
function arca_fiscal_document_type(string $invoiceType): int {
    if ($invoiceType === 'Factura A') return 1;
    if ($invoiceType === 'Factura B' || $invoiceType === 'Factura B electrónica') return 6;
    throw new InvalidArgumentException('El tipo de comprobante debe ser Factura A o Factura B.');
}
function arca_fiscal_amounts(float $total): array {
    $cents = (int) round($total * 100); if ($cents < 1) throw new InvalidArgumentException('El comprobante debe tener un importe mayor a cero.');
    $net = (int) round($cents * 100 / 121); return ['total' => $cents / 100, 'net' => $net / 100, 'vat' => ($cents - $net) / 100];
}
function arca_fiscal_point(array $config, string $site): int {
    $point = (int) (($config['arca']['points_of_sale'][$site] ?? 0)); if ($point < 1) throw new InvalidArgumentException('El local de la venta no tiene punto de venta ARCA configurado.'); return $point;
}
function arca_fiscal_customer(array $sale, array $input, int $voucherType): array {
    $name = trim((string) ($input['legalName'] ?? $sale['customer_name'] ?? ''));
    $type = trim((string) ($input['documentType'] ?? $sale['customer_document_type'] ?? 'Consumidor final'));
    $number = preg_replace('/\D+/', '', (string) ($input['documentNumber'] ?? $sale['customer_document_number'] ?? '')) ?: '';
    $condition = trim((string) ($input['taxCondition'] ?? $sale['customer_tax_condition'] ?? ''));
    $address = trim((string) ($input['address'] ?? $sale['customer_address'] ?? ''));
    if (!in_array($type, ['CUIT', 'DNI', 'Consumidor final'], true)) throw new InvalidArgumentException('El tipo de documento fiscal es inválido.');
    if ($type === 'CUIT' && preg_match('/^\d{11}$/', $number) !== 1) throw new InvalidArgumentException('El CUIT debe tener 11 dígitos.');
    if ($type === 'DNI' && preg_match('/^\d{7,8}$/', $number) !== 1) throw new InvalidArgumentException('El DNI debe tener 7 u 8 dígitos.');
    if ($voucherType === 1 && (mb_strlen($name) < 3 || $type !== 'CUIT' || $condition !== 'Responsable Inscripto' || $address === '')) throw new InvalidArgumentException('Factura A requiere razón social, CUIT, condición Responsable Inscripto y domicilio fiscal.');
    return ['name' => $name, 'type' => $type, 'number' => $type === 'Consumidor final' ? '0' : $number, 'condition' => $condition, 'address' => $address];
}
function arca_fiscal_lock(PDO $pdo, int $point, int $voucherType): string {
    $name = 'lartisan_arca_' . $point . '_' . $voucherType; $s = $pdo->prepare('SELECT GET_LOCK(?, 20)'); $s->execute([$name]);
    if ((int) $s->fetchColumn() !== 1) throw new RuntimeException('Hay otra emisión en curso para este punto de venta. Esperá unos segundos y volvé a revisar el estado.'); return $name;
}
function arca_fiscal_unlock(PDO $pdo, string $name): void { try { $s = $pdo->prepare('SELECT RELEASE_LOCK(?)'); $s->execute([$name]); } catch (Throwable) {} }
function arca_fiscal_doc_code(string $type): int { return $type === 'CUIT' ? 80 : ($type === 'DNI' ? 96 : 99); }
function arca_fiscal_receiver_condition(string $condition): int {
    if ($condition === 'Responsable Inscripto') return 1;
    if ($condition === 'Exento') return 4;
    if ($condition === 'Monotributista') return 6;
    return 5;
}
function arca_fiscal_cutover(array $config): ?string {
    $value = trim((string) (($config['arca']['issuance_start_at'] ?? '')));
    $date = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $value);
    return $date && $date->format('Y-m-d H:i:s') === $value ? $value : null;
}

function arca_prepare_fiscal_document(PDO $pdo, array $config, int $userId, array $input): array {
    ensure_normalized_operations_schema($pdo); ensure_arca_wsfe_schema($pdo);
    $saleId = trim((string) ($input['saleReference'] ?? '')); if (!preg_match('/^[a-f0-9-]{36}$/i', $saleId)) throw new InvalidArgumentException('La referencia de venta es inválida.');
    $q = $pdo->prepare('SELECT * FROM lartisan_sales WHERE id=? LIMIT 1'); $q->execute([$saleId]); $sale = $q->fetch();
    if (!$sale) throw new InvalidArgumentException('No se encontró la venta indicada.'); if ($sale['status'] !== 'activa') throw new InvalidArgumentException('Sólo se pueden facturar ventas activas.');
    $cutover = arca_fiscal_cutover($config);
    if (!$cutover) throw new RuntimeException('La emisión fiscal todavía no tiene una fecha de corte configurada.');
    if ((string) $sale['occurred_at'] < $cutover) throw new InvalidArgumentException('Esta venta es anterior al inicio de emisión fiscal de este sistema y no se puede reenviar a ARCA.');
    $voucher = arca_fiscal_document_type((string) $sale['invoice_type']); $point = arca_fiscal_point($config, (string) $sale['site']); $customer = arca_fiscal_customer($sale, $input, $voucher); $amounts = arca_fiscal_amounts((float) $sale['net_amount']);
    $items = $pdo->prepare('SELECT product_id, product_name, quantity, unit_price FROM lartisan_sale_items WHERE sale_id=? ORDER BY line_number'); $items->execute([$saleId]); $lines = $items->fetchAll(); if (!$lines) throw new InvalidArgumentException('La venta no tiene productos para facturar.');
    $reference = hash('sha256', json_encode([$saleId, $point, $voucher, $amounts, $customer, $lines], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    $pdo->beginTransaction(); try {
        $q = $pdo->prepare('SELECT * FROM arca_fiscal_documents WHERE sale_reference=? FOR UPDATE'); $q->execute([$saleId]); $existing = $q->fetch();
        if ($existing && in_array((string) $existing['status'], ['authorized', 'issuing', 'requires_reconciliation'], true)) { $pdo->commit(); return $existing; }
        $pdo->prepare('UPDATE lartisan_sales SET customer_name=?,customer_document_type=?,customer_document_number=?,customer_tax_condition=?,customer_address=? WHERE id=?')->execute([$customer['name'] ?: null, $customer['type'], $customer['number'] === '0' ? null : $customer['number'], $customer['condition'] ?: null, $customer['address'] ?: null, $saleId]);
        $s = $pdo->prepare("INSERT INTO arca_fiscal_documents (sale_reference,site_name,point_of_sale,voucher_type,environment,status,request_reference,response_summary,amount_total,amount_net,amount_vat,customer_name,customer_document_type,customer_document_number,customer_tax_condition,customer_address,document_kind,created_by) VALUES (?,?,?,?,?,'prepared',?,?,?,?,?,?,?,?,?,?,?,'invoice',?) ON DUPLICATE KEY UPDATE site_name=VALUES(site_name),point_of_sale=VALUES(point_of_sale),voucher_type=VALUES(voucher_type),environment=VALUES(environment),status='prepared',request_reference=VALUES(request_reference),response_summary=VALUES(response_summary),amount_total=VALUES(amount_total),amount_net=VALUES(amount_net),amount_vat=VALUES(amount_vat),customer_name=VALUES(customer_name),customer_document_type=VALUES(customer_document_type),customer_document_number=VALUES(customer_document_number),customer_tax_condition=VALUES(customer_tax_condition),customer_address=VALUES(customer_address),updated_at=CURRENT_TIMESTAMP");
        $s->execute([$saleId, $sale['site'], $point, $voucher, (string) ($config['arca']['environment'] ?? 'homologacion'), $reference, 'Preparado. Requiere confirmación explícita antes de solicitar CAE.', $amounts['total'], $amounts['net'], $amounts['vat'], $customer['name'] ?: null, $customer['type'], $customer['number'], $customer['condition'] ?: null, $customer['address'] ?: null, $userId]);
        $q->execute([$saleId]); $document = $q->fetch(); $pdo->commit(); return $document ?: [];
    } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
}

function arca_issue_fiscal_document(PDO $pdo, array $config, int $userId, int $documentId): array {
    ensure_arca_wsfe_schema($pdo); if (!arca_wsfe_configuration_status($config)['productionIssuanceEnabled']) throw new RuntimeException('La emisión fiscal de producción no está habilitada en la configuración privada del servidor.');
    $q = $pdo->prepare('SELECT * FROM arca_fiscal_documents WHERE id=? LIMIT 1'); $q->execute([$documentId]); $doc = $q->fetch(); if (!$doc) throw new InvalidArgumentException('No se encontró el comprobante fiscal.');
    if ($doc['status'] === 'authorized') return $doc; if ($doc['status'] === 'requires_reconciliation') throw new RuntimeException('La emisión anterior no pudo confirmarse. Conciliá el comprobante con ARCA antes de intentar otra vez.'); if (!in_array($doc['status'], ['prepared', 'rejected'], true)) throw new RuntimeException('El comprobante ya está en proceso de emisión.');
    $lock = arca_fiscal_lock($pdo, (int) $doc['point_of_sale'], (int) $doc['voucher_type']); try {
        $q->execute([$documentId]); $doc = $q->fetch(); if (!$doc) throw new InvalidArgumentException('No se encontró el comprobante fiscal.'); if ($doc['status'] === 'authorized') return $doc;
        $number = arca_wsfe_last_voucher_number($config, (int) $doc['point_of_sale'], (int) $doc['voucher_type']) + 1;
        $pdo->prepare("UPDATE arca_fiscal_documents SET status='issuing',voucher_number=?,issue_attempted_at=NOW(),response_summary='Solicitud enviada a ARCA; esperando autorización.' WHERE id=?")->execute([$number, $documentId]);
        $request = ['pointOfSale' => (int) $doc['point_of_sale'], 'voucherType' => (int) $doc['voucher_type'], 'voucherNumber' => $number, 'date' => (new DateTimeImmutable('now', new DateTimeZone('America/Argentina/Buenos_Aires')))->format('Ymd'), 'total' => (float) $doc['amount_total'], 'net' => (float) $doc['amount_net'], 'vat' => (float) $doc['amount_vat'], 'documentTypeCode' => arca_fiscal_doc_code((string) $doc['customer_document_type']), 'documentNumber' => $doc['customer_document_type'] === 'Consumidor final' ? '0' : (string) $doc['customer_document_number'], 'receiverVatCondition' => arca_fiscal_receiver_condition((string) $doc['customer_tax_condition'])];
        if (!empty($doc['source_document_id'])) { $source = $pdo->prepare("SELECT point_of_sale,voucher_type,voucher_number FROM arca_fiscal_documents WHERE id=? AND status='authorized'"); $source->execute([(int) $doc['source_document_id']]); $original = $source->fetch(); if (!$original) throw new RuntimeException('No se encontró la factura original autorizada.'); $request['associated'] = ['pointOfSale' => (int) $original['point_of_sale'], 'voucherType' => (int) $original['voucher_type'], 'voucherNumber' => (int) $original['voucher_number']]; }
        try { $result = arca_wsfe_issue_cae($config, $request); }
        catch (InvalidArgumentException $e) { $pdo->prepare("UPDATE arca_fiscal_documents SET status='rejected',response_summary=? WHERE id=?")->execute([$e->getMessage(), $documentId]); throw $e; }
        catch (Throwable $e) { $pdo->prepare("UPDATE arca_fiscal_documents SET status='requires_reconciliation',response_summary=? WHERE id=?")->execute(['No se pudo confirmar la respuesta de ARCA: ' . substr($e->getMessage(), 0, 700), $documentId]); throw new RuntimeException('ARCA no confirmó la emisión. El comprobante quedó pendiente de conciliación; no lo reintentes automáticamente.'); }
        $pdo->prepare("UPDATE arca_fiscal_documents SET status='authorized',cae=?,cae_expires_on=?,response_summary=? WHERE id=?")->execute([$result['cae'], $result['expiresOn'], $result['summary'], $documentId]); $q->execute([$documentId]); return $q->fetch() ?: [];
    } finally { arca_fiscal_unlock($pdo, $lock); }
}

function arca_prepare_credit_note(PDO $pdo, array $config, int $userId, array $input): array {
    ensure_arca_wsfe_schema($pdo); $sourceId = (int) ($input['sourceDocumentId'] ?? 0); $reason = trim((string) ($input['reason'] ?? '')); if ($reason === '') throw new InvalidArgumentException('Indicá el motivo de la nota de crédito.');
    $q = $pdo->prepare("SELECT * FROM arca_fiscal_documents WHERE id=? AND status='authorized' AND document_kind='invoice' LIMIT 1"); $q->execute([$sourceId]); $source = $q->fetch(); if (!$source) throw new InvalidArgumentException('Elegí una factura autorizada para emitir la nota de crédito.');
    $amounts = arca_fiscal_amounts((float) ($input['amount'] ?? 0)); $used = $pdo->prepare("SELECT COALESCE(SUM(amount_total),0) FROM arca_fiscal_documents WHERE source_document_id=? AND status='authorized'"); $used->execute([$sourceId]); if (round((float) $used->fetchColumn() + $amounts['total'], 2) > round((float) $source['amount_total'], 2)) throw new InvalidArgumentException('La nota de crédito supera el saldo facturado disponible.');
    $reference = hash('sha256', implode('|', ['nc', $sourceId, $amounts['total'], $reason, microtime(true), random_int(1, PHP_INT_MAX)])); $voucher = (int) $source['voucher_type'] === 1 ? 3 : 8; $saleRef = $source['sale_reference'] . ':NC:' . substr($reference, 0, 12);
    $s = $pdo->prepare("INSERT INTO arca_fiscal_documents (sale_reference,site_name,point_of_sale,voucher_type,environment,status,request_reference,response_summary,amount_total,amount_net,amount_vat,customer_name,customer_document_type,customer_document_number,customer_tax_condition,customer_address,source_document_id,document_kind,created_by) VALUES (?,?,?,?,?,'prepared',?,?,?,?,?,?,?,?,?,?,?,?,?,'credit_note',?)");
    $s->execute([$saleRef, $source['site_name'], $source['point_of_sale'], $voucher, $source['environment'], $reference, 'Nota de crédito preparada. Motivo: ' . substr($reason, 0, 600), $amounts['total'], $amounts['net'], $amounts['vat'], $source['customer_name'], $source['customer_document_type'], $source['customer_document_number'], $source['customer_tax_condition'], $source['customer_address'], $sourceId, $userId]);
    $q = $pdo->prepare('SELECT * FROM arca_fiscal_documents WHERE id=?'); $q->execute([(int) $pdo->lastInsertId()]); return $q->fetch() ?: [];
}
