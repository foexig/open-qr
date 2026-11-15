<?php
/**
 * open-qr PHP edition — upload this folder to your web space and open it in the browser.
 */

declare(strict_types=1);

define('OQ_ROOT', __DIR__);

if (PHP_VERSION_ID < 80100) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'open-qr needs PHP 8.1 or newer (this server runs PHP ' . PHP_VERSION . ").\n"
        . "Strato: Hosting-Verwaltung > Einstellungen > PHP-Version.\n";
    exit;
}

require __DIR__ . '/lib/app.php';
oq_main();
