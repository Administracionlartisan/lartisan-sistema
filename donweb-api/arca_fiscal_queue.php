<?php

declare(strict_types=1);

/**
 * Cola interna aislada de preparación fiscal.
 * Nunca llama a ARCA, no emite CAE y no altera las rutas operativas generales.
 */
function arca_prepare_fiscal_document(PDO $pdo, array $config, int $userId, array $input): array
{
    ensure_normalized_operations_schema($pdo);
    ensure_arca_wsfe_schema($pdo);
    $saleId = trim((string) ($input['saleReference'] ?? ''));
    if (!preg_match('/^[a-f0-9-]{36}$/i', $saleId)) throw new InvalidArgumentException('La referencia de venta es inválida.');
    $saleQuery = $pdo->prepare('SELECT * FROM lartisan_sales WHERE id = ? LIMIT 1');
    $saleQuery->execute([$saleId]);
    $sale = $saleQuery->fetch();
    if (!$sale) throw new InvalidArgumentException('No se encontró la venta indicada.');
    if ((string) $sale['status'] !== 'activa') throw new InvalidArgumentException('Sólo se pueden preparar ventas activas.');
    if ((float) $sale['net_amount'] <= 0) throw new InvalidArgumentException('La venta no tiene un importe válido.');

    $invoiceType = (string) $sale['invoice_type'];
    if ($invoiceType === 'Factura A') $voucherType = 1;
    elseif ($invoiceType === 'Factura B' || $invoiceType === 'Factura B electrónica') $voucherType = 6;
    else throw new InvalidArgumentException('El tipo de comprobante debe ser Factura A o Factura B. Un remito interno no se informa a ARCA.');

    $arca = is_array($config['arca'] ?? null) ? $config['arca'] : [];
    $points = is_array($arca['points_of_sale'] ?? null) ? $arca['points_of_sale'] : [];
    $pointOfSale = (int) ($points[(string) $sale['site']] ?? 0);
    if ($pointOfSale < 1) throw new InvalidArgumentException('El local de la venta no tiene un punto de venta ARCA configurado.');

    $legalName = trim((string) ($input['legalName'] ?? $sale['customer_name'] ?? ''));
    $documentType = trim((string) ($input['documentType'] ?? $sale['customer_document_type'] ?? ''));
    $documentNumber = preg_replace('/\D+/', '', (string) ($input['documentNumber'] ?? $sale['customer_document_number'] ?? '')) ?: '';
    $taxCondition = trim((string) ($input['taxCondition'] ?? $sale['customer_tax_condition'] ?? ''));
    $address = trim((string) ($input['address'] ?? $sale['customer_address'] ?? ''));
    if ($voucherType === 1) {
        if (strlen($legalName) < 3) throw new InvalidArgumentException('Factura A requiere razón social.');
        if ($documentType !== 'CUIT' || preg_match('/^\d{11}$/', $documentNumber) !== 1) throw new InvalidArgumentException('Factura A requiere CUIT de 11 dígitos.');
        if ($taxCondition !== 'Responsable Inscripto') throw new InvalidArgumentException('Factura A requiere condición fiscal Responsable Inscripto.');
        if ($address === '') throw new InvalidArgumentException('Factura A requiere domicilio fiscal.');
    }
    if ($documentType !== '' && !in_array($documentType, ['CUIT', 'DNI', 'Consumidor final'], true)) throw new InvalidArgumentException('El tipo de documento fiscal es inválido.');
    if ($documentType === 'CUIT' && preg_match('/^\d{11}$/', $documentNumber) !== 1) throw new InvalidArgumentException('El CUIT debe tener 11 dígitos.');
    if ($documentType === 'DNI' && preg_match('/^\d{7,8}$/', $documentNumber) !== 1) throw new InvalidArgumentException('El DNI debe tener 7 u 8 dígitos.');

    $itemsQuery = $pdo->prepare('SELECT product_id, product_name, quantity, unit_price FROM lartisan_sale_items WHERE sale_id = ? ORDER BY line_number');
    $itemsQuery->execute([$saleId]);
    $items = $itemsQuery->fetchAll();
    if (!$items) throw new InvalidArgumentException('La venta no tiene productos para facturar.');
    $requestReference = hash('sha256', json_encode(['sale' => $saleId, 'site' => $sale['site'], 'point' => $pointOfSale, 'voucher' => $voucherType, 'net' => number_format((float) $sale['net_amount'], 2, '.', ''), 'customer' => [$legalName, $documentType, $documentNumber, $taxCondition, $address], 'items' => $items], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

    $pdo->beginTransaction();
    try {
        $pdo->prepare('UPDATE lartisan_sales SET customer_name = ?, customer_document_type = ?, customer_document_number = ?, customer_tax_condition = ?, customer_address = ? WHERE id = ?')->execute([$legalName ?: null, $documentType ?: null, $documentNumber ?: null, $taxCondition ?: null, $address ?: null, $saleId]);
        $upsert = $pdo->prepare("INSERT INTO arca_fiscal_documents (sale_reference, site_name, point_of_sale, voucher_type, environment, status, request_reference, response_summary, created_by) VALUES (?, ?, ?, ?, ?, 'pending_homologation', ?, 'Preparado internamente; pendiente de prueba en homologación.', ?) ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP");
        $upsert->execute([$saleId, (string) $sale['site'], $pointOfSale, $voucherType, (string) ($arca['environment'] ?? 'homologacion'), $requestReference, $userId]);
        $documentQuery = $pdo->prepare('SELECT id, sale_reference, site_name, point_of_sale, voucher_type, environment, status, created_at, updated_at FROM arca_fiscal_documents WHERE sale_reference = ? LIMIT 1');
        $documentQuery->execute([$saleId]);
        $document = $documentQuery->fetch();
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
    return $document ?: [];
}
