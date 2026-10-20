<?php

// Router para `php -S`: reproduce localmente las reglas de donweb-api/.htaccess.
// La API responde bajo /sistema-api/, igual que en producción.
declare(strict_types=1);

$path = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$prefix = '/sistema-api';
if ($path !== $prefix && !str_starts_with($path, $prefix . '/')) {
    http_response_code(404);
    exit;
}
$relative = ltrim(substr($path, strlen($prefix)), '/');
$apiDirectory = dirname(__DIR__) . '/donweb-api';

// Igual que el .htaccess: solo index.php se sirve; cualquier otro archivo
// existente de la carpeta queda denegado. (backup.php no se usa localmente.)
if ($relative !== '' && $relative !== 'index.php' && is_file($apiDirectory . '/' . $relative)) {
    http_response_code(403);
    exit;
}

$_GET['route'] = $relative === 'index.php' ? '' : $relative;
chdir($apiDirectory);
require $apiDirectory . '/index.php';
