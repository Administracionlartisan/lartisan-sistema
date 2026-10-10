<?php

declare(strict_types=1);

/** Capacitación versionada: el contenido es independiente de las operaciones. */
function ensure_training_schema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS training_chapters (
        id VARCHAR(64) PRIMARY KEY, title VARCHAR(160) NOT NULL, description TEXT NOT NULL,
        role_targets TEXT NOT NULL, version_label VARCHAR(40) NOT NULL, duration_seconds INT NOT NULL DEFAULT 0,
        script_text MEDIUMTEXT NOT NULL, video_url VARCHAR(500) NULL, captions_vtt MEDIUMTEXT NULL,
        sort_order INT NOT NULL, published TINYINT(1) NOT NULL DEFAULT 0, mandatory TINYINT(1) NOT NULL DEFAULT 0,
        created_by INT NULL, updated_by INT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_training_published (published, sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS training_chapter_versions (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, chapter_id VARCHAR(64) NOT NULL, version_label VARCHAR(40) NOT NULL,
        snapshot_json MEDIUMTEXT NOT NULL, changed_by INT NULL, change_kind VARCHAR(30) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_training_versions (chapter_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS training_progress (
        user_id INT NOT NULL, chapter_id VARCHAR(64) NOT NULL, watched_seconds INT NOT NULL DEFAULT 0,
        completed_at DATETIME NULL, last_viewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, chapter_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $count = (int) $pdo->query('SELECT COUNT(*) FROM training_chapters')->fetchColumn();
    if ($count > 0) return;
    $chapters = [
        ['introduccion-navegacion','Introducción y navegación','Ingreso seguro, menú, local asignado y secciones principales.',300,'Ingresá con tu usuario personal y nunca compartas la contraseña. Confirmá el local que te corresponde. El menú agrupa Ventas, Caja, Stock, Pedidos, Fichaje, Clientes y Chat. Si no encontrás una función, no pruebes opciones al azar: usá Ayuda o escribí a Supervisión.'],
        ['apertura-caja','Apertura y gestión de caja','Responsable, fondo inicial, turno y restricciones.',360,'Antes de vender, verificá que no haya otra caja abierta. Declarás el fondo inicial real y quedás como responsable del turno. Una caja abierta no se transfiere: para relevar se realiza arqueo y cierre completo; recién entonces abre la siguiente responsable.'],
        ['ventas-medios-pago','Ventas, productos y medios de pago','Productos, stock, cliente, cobro, descuentos y comprobantes.',480,'Buscá el producto y verificá presentación, cantidad y stock antes de cobrar. Asociá el cliente cuando corresponda y elegí el medio de pago real. Los descuentos solo se aplican dentro de tu autorización. Revisá el total antes de confirmar y nunca repitas una venta por una duda de conexión.'],
        ['clientes','Clientes','Búsqueda, alta, edición, asociación e historial.',300,'Primero buscá por documento para evitar duplicados. Si no existe, cargá solo los datos obligatorios y verificá documento, correo y CUIT. Desde el historial podés ver compras y devoluciones; no edites datos para corregir una venta ya realizada.'],
        ['stock-pedidos-devoluciones','Stock, pedidos, recepción y devoluciones','Movimientos, pedidos, transferencias, recepción y devoluciones.',420,'Consultá stock antes de prometer un producto. Para pedidos, transferencias o recepciones, registrá remito o motivo y confirmá cantidades reales. Una devolución debe vincularse a la venta y especificar si vuelve al stock.'],
        ['egresos-incidencias','Egresos e incidencias','Registro, permisos, evidencia y trazabilidad.',270,'Un egreso se carga con concepto, importe, medio de pago y comprobante cuando exista. Una incidencia explica un problema y no reemplaza un ajuste de caja. Si requiere autorización, dejala pendiente y avisá por Chat.'],
        ['fichaje','Fichaje','Entrada, salida, geocerca y solicitudes de excepción.',300,'Al llegar, marcá entrada desde el local y autorizá la ubicación. Si el GPS no está disponible, tiene baja precisión o estás fuera del radio, se crea una solicitud de excepción: no intentes falsear la ubicación. Al terminar el turno, repetí el proceso para salida.'],
        ['chat-interno','Chat Interno','Conversaciones autorizadas, grupos, adjuntos y avisos.',240,'Usá Chat Interno para coordinar con Administración, Supervisión y el grupo de tu local. Verificá destinatario antes de enviar. Solo adjuntá imágenes o PDF permitidos, sin contraseñas, datos bancarios ni documentos personales.'],
        ['cierre-sincronizacion','Cierre de caja y situaciones especiales','Arqueo, sincronización, pendientes, anulaciones y qué no hacer.',480,'Antes del cierre, controlá medios de pago, efectivo físico, sobre y diferencias. Confirmá una sola vez y esperá el estado de sincronización. Si luego se anula una venta, se conserva el cierre histórico y se genera un ajuste auditado; no edites filas de Drive ni históricos.'],
    ];
    // Los capítulos nacen como borradores. Sólo pueden publicarse tras adjuntar
    // grabación real y WebVTT, para que una capacitación no prometa contenido
    // que todavía no fue validado.
    $insert = $pdo->prepare('INSERT INTO training_chapters (id,title,description,role_targets,version_label,duration_seconds,script_text,sort_order,published,mandatory) VALUES (?,?,?,?,?,?,?,?,0,0)');
    foreach ($chapters as $index => $chapter) {
        $script = "Capacitación L’ARTISAN — {$chapter[1]}. Esta demostración utiliza exclusivamente datos de prueba. {$chapter[4]}";
        $insert->execute([$chapter[0],$chapter[1],$chapter[2],json_encode(['vendedora','supervisora','administracion'],JSON_UNESCAPED_UNICODE),'1.0',$chapter[3],$script,$index + 1]);
    }
}

function training_roles(array $raw): array {
    $valid = ['vendedora','supervisora','compras','administracion'];
    return array_values(array_unique(array_filter($raw, static fn($role): bool => is_string($role) && in_array($role,$valid,true))));
}
function training_is_ready_for_publication(string $video, string $captions, int $duration): bool {
    return $duration > 0
        && filter_var($video, FILTER_VALIDATE_URL)
        && str_starts_with(strtolower($video), 'https://')
        // Los subtítulos publicados se sirven como recurso HTTPS separado.
        // WEBVTT inline se conserva sólo para borradores e importaciones anteriores.
        && (str_starts_with(ltrim($captions), 'WEBVTT')
            || (filter_var($captions, FILTER_VALIDATE_URL) && str_starts_with(strtolower($captions), 'https://')));
}
function training_video_url_allowed(string $video, array $config): bool {
    if (filter_var($video, FILTER_VALIDATE_URL) && str_starts_with(strtolower($video), 'https://')) return true;
    // Sólo el entorno audiovisual local puede enlazar sus MP4 por HTTP. La
    // bandera no existe en Producción y nunca habilita dominios remotos.
    return !empty($config['allow_local_training_media'])
        && (bool) preg_match('#^http://(127\.0\.0\.1|\[::1\]|localhost):\d+/#i', $video);
}
function training_chapter_payload(array $row, ?array $progress = null): array {
    return ['id'=>$row['id'],'title'=>$row['title'],'description'=>$row['description'], 'roles'=>json_decode((string)$row['role_targets'],true) ?: [], 'version'=>$row['version_label'], 'durationSeconds'=>(int)$row['duration_seconds'], 'script'=>$row['script_text'], 'videoUrl'=>$row['video_url'], 'captionsVtt'=>$row['captions_vtt'], 'order'=>(int)$row['sort_order'], 'published'=>(bool)$row['published'], 'mandatory'=>(bool)$row['mandatory'], 'updatedAt'=>$row['updated_at'], 'progress'=>$progress ? ['watchedSeconds'=>(int)$progress['watched_seconds'],'completedAt'=>$progress['completed_at']] : null];
}
function training_audit(PDO $pdo, int $userId, string $event, string $chapter): void { audit($pdo,$userId,'training_'.$event,'chapter='.$chapter); }
