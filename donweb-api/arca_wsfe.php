<?php

declare(strict_types=1);

/**
 * Base segura de Factura Electrónica ARCA (WSFE).
 *
 * Esta capa no emite comprobantes por sí sola. Primero expone el estado de
 * preparación y reserva la trazabilidad necesaria para una posterior prueba en
 * homologación. Las credenciales permanecen siempre fuera del directorio web.
 */
function ensure_arca_wsfe_schema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS arca_fiscal_documents (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        sale_reference VARCHAR(100) NOT NULL,
        site_name VARCHAR(100) NOT NULL,
        point_of_sale SMALLINT UNSIGNED NOT NULL,
        voucher_type SMALLINT UNSIGNED NOT NULL,
        voucher_number BIGINT UNSIGNED NULL,
        cae VARCHAR(32) NULL,
        cae_expires_on DATE NULL,
        environment VARCHAR(20) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'pending',
        request_reference CHAR(64) NOT NULL,
        response_summary VARCHAR(1000) NULL,
        created_by BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_arca_sale_reference (sale_reference),
        UNIQUE KEY uq_arca_request_reference (request_reference),
        INDEX idx_arca_document_site_date (site_name, created_at),
        INDEX idx_arca_document_status (status, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

function arca_wsaa_endpoint(string $environment): string
{
    return $environment === 'produccion'
        ? 'https://wsaa.afip.gov.ar/ws/services/LoginCms'
        : 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms';
}

function arca_wsfe_endpoint(string $environment): string
{
    return $environment === 'produccion'
        ? 'https://servicios1.afip.gov.ar/wsfev1/service.asmx'
        : 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx';
}

function arca_xml(string $value): string
{
    return htmlspecialchars($value, ENT_XML1 | ENT_COMPAT, 'UTF-8');
}

function arca_read_private_file(string $path, string $label): string
{
    if ($path === '' || !is_file($path) || !is_readable($path)) {
        throw new RuntimeException($label . ' no está configurado de forma privada.');
    }
    $content = file_get_contents($path);
    if (!is_string($content) || trim($content) === '') {
        throw new RuntimeException('No se pudo leer ' . mb_strtolower($label, 'UTF-8') . '.');
    }
    return $content;
}

function arca_wsaa_create_cms(array $arca, string $service = 'wsfe'): string
{
    if (!function_exists('openssl_pkcs7_sign')) {
        throw new RuntimeException('El servidor no tiene OpenSSL para firmar la solicitud ARCA.');
    }
    $certificate = arca_read_private_file(trim((string) ($arca['certificate_path'] ?? '')), 'El certificado ARCA');
    $privateKey = arca_read_private_file(trim((string) ($arca['private_key_path'] ?? '')), 'La clave privada ARCA');
    $cuit = trim((string) ($arca['cuit'] ?? ''));
    if (preg_match('/^\d{11}$/', $cuit) !== 1) throw new RuntimeException('CUIT ARCA inválido.');

    $now = new DateTimeImmutable('now', new DateTimeZone('America/Argentina/Buenos_Aires'));
    $uniqueId = (string) random_int(100000000, 999999999);
    $tra = '<?xml version="1.0" encoding="UTF-8"?>'
        . '<loginTicketRequest version="1.0"><header>'
        . '<uniqueId>' . $uniqueId . '</uniqueId>'
        . '<generationTime>' . $now->modify('-5 minutes')->format('c') . '</generationTime>'
        . '<expirationTime>' . $now->modify('+10 hours')->format('c') . '</expirationTime>'
        . '</header><service>' . arca_xml($service) . '</service></loginTicketRequest>';

    $temporaryBase = tempnam(sys_get_temp_dir(), 'lartisan_wsaa_');
    if ($temporaryBase === false) throw new RuntimeException('No se pudo preparar la firma WSAA.');
    $signedPath = $temporaryBase . '.p7s';
    try {
        if (file_put_contents($temporaryBase, $tra, LOCK_EX) === false) {
            throw new RuntimeException('No se pudo preparar el pedido WSAA.');
        }
        $signed = openssl_pkcs7_sign($temporaryBase, $signedPath, $certificate, $privateKey, [], PKCS7_BINARY | PKCS7_DETACHED);
        if (!$signed) throw new RuntimeException('ARCA no pudo firmar el pedido WSAA.');
        $smime = file_get_contents($signedPath);
        if (!is_string($smime) || !preg_match('/\r?\n\r?\n(.+)$/s', $smime, $matches)) {
            throw new RuntimeException('La firma WSAA generada no tiene formato válido.');
        }
        return preg_replace('/\s+/', '', $matches[1]) ?: '';
    } finally {
        @unlink($temporaryBase);
        @unlink($signedPath);
    }
}

function arca_wsaa_request_ticket(array $config): array
{
    $arca = is_array($config['arca'] ?? null) ? $config['arca'] : [];
    $status = arca_wsfe_configuration_status($config);
    if (!$status['readyForHomologation'] && $status['environment'] === 'homologacion') {
        throw new RuntimeException('Falta configurar el certificado o la clave privada de ARCA.');
    }
    if ($status['environment'] !== 'homologacion') {
        throw new RuntimeException('La prueba está permitida únicamente en homologación.');
    }
    if (!function_exists('curl_init')) throw new RuntimeException('El servidor no tiene cURL para comunicar con ARCA.');

    $cms = arca_wsaa_create_cms($arca);
    $body = '<?xml version="1.0" encoding="UTF-8"?>'
        . '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov/">'
        . '<soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>' . arca_xml($cms) . '</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>';
    $handle = curl_init(arca_wsaa_endpoint('homologacion'));
    curl_setopt_array($handle, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_HTTPHEADER => ['Content-Type: text/xml; charset=utf-8', 'SOAPAction: ""'],
    ]);
    $response = curl_exec($handle);
    $statusCode = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
    $curlError = curl_error($handle);
    curl_close($handle);
    if (!is_string($response) || $statusCode < 200 || $statusCode >= 300) {
        throw new RuntimeException('WSAA de homologación no respondió correctamente' . ($curlError !== '' ? ': ' . $curlError : '.'));
    }
    if (!preg_match('/<loginCmsReturn>(.*?)<\/loginCmsReturn>/s', $response, $matches)) {
        throw new RuntimeException('WSAA no devolvió un Ticket de Acceso válido.');
    }
    $ticketXml = html_entity_decode($matches[1], ENT_QUOTES | ENT_XML1, 'UTF-8');
    $ticket = @simplexml_load_string($ticketXml);
    if (!$ticket || !isset($ticket->credentials->token, $ticket->credentials->sign, $ticket->header->expirationTime)) {
        throw new RuntimeException('El Ticket de Acceso de ARCA es inválido.');
    }
    return [
        'token' => (string) $ticket->credentials->token,
        'sign' => (string) $ticket->credentials->sign,
        'expiresAt' => (new DateTimeImmutable((string) $ticket->header->expirationTime))->format('Y-m-d H:i:s'),
    ];
}

function arca_wsfe_configuration_status(array $config): array
{
    $arca = is_array($config['arca'] ?? null) ? $config['arca'] : [];
    $environment = (string) ($arca['environment'] ?? 'homologacion');
    if (!in_array($environment, ['homologacion', 'produccion'], true)) {
        $environment = 'homologacion';
    }

    $certificatePath = trim((string) ($arca['certificate_path'] ?? ''));
    $privateKeyPath = trim((string) ($arca['private_key_path'] ?? ''));
    $points = is_array($arca['points_of_sale'] ?? null) ? $arca['points_of_sale'] : [];
    $validPoints = [];
    foreach ($points as $site => $point) {
        $site = trim((string) $site);
        $point = (int) $point;
        if ($site !== '' && $point > 0 && $point <= 99999) {
            $validPoints[$site] = str_pad((string) $point, 5, '0', STR_PAD_LEFT);
        }
    }

    $certificateReady = $certificatePath !== '' && is_file($certificatePath) && is_readable($certificatePath);
    $keyReady = $privateKeyPath !== '' && is_file($privateKeyPath) && is_readable($privateKeyPath);
    $enabled = (bool) ($arca['enabled'] ?? false);

    return [
        'enabled' => $enabled,
        'environment' => $environment,
        'cuitConfigured' => preg_match('/^\d{11}$/', (string) ($arca['cuit'] ?? '')) === 1,
        'certificateConfigured' => $certificateReady,
        'privateKeyConfigured' => $keyReady,
        'pointsOfSale' => $validPoints,
        // Producción queda deliberadamente bloqueada hasta que se complete una
        // prueba WSAA/WSFE en homologación y se configure la emisión fiscal.
        'readyForHomologation' => $environment === 'homologacion'
            && $certificateReady && $keyReady && count($validPoints) > 0,
        'productionIssuanceEnabled' => false,
    ];
}
