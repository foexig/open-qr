<?php
/**
 * open-qr PHP edition: bootstrap, routing, responses and database access.
 */

declare(strict_types=1);

const OQ_VERSION = '0.1.0';
const OQ_SESSION_COOKIE = 'openqr_session';

require __DIR__ . '/util.php';
require __DIR__ . '/qr.php';

final class HttpError extends Exception
{
    /** @param string|array $detail */
    public function __construct(public int $status, public $detail)
    {
        parent::__construct(is_string($detail) ? $detail : 'Validation error');
    }
}

/** 422 in FastAPI's shape: [{loc, msg, type}] */
function oq_invalid(string $field, string $msg): HttpError
{
    return new HttpError(422, [['loc' => ['body', $field], 'msg' => $msg, 'type' => 'value_error']]);
}

// ---------------------------------------------------------------- paths

function oq_data_dir(): string
{
    return OQ_ROOT . '/data';
}

function oq_config_file(): string
{
    return oq_data_dir() . '/config.php';
}

/** URL path the app lives under, without trailing slash ("" for the domain root). */
function oq_base_path(): string
{
    $dir = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/index.php'));
    $dir = rtrim($dir, '/');
    return $dir === '.' ? '' : $dir;
}

function oq_is_https(): bool
{
    if (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off') {
        return true;
    }
    if (($_SERVER['SERVER_PORT'] ?? '') === '443') {
        return true;
    }
    // Strato and most shared hosts terminate TLS in front of Apache.
    return strtolower($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
}

function oq_detected_base_url(): string
{
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    return (oq_is_https() ? 'https' : 'http') . '://' . $host . oq_base_path();
}

/** Route relative to the base path, e.g. "api/qr-codes/3". "?r=" overrides (works without mod_rewrite). */
function oq_route(): string
{
    if (isset($_GET['r']) && is_string($_GET['r'])) {
        return trim($_GET['r'], '/');
    }
    $path = rawurldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
    $base = oq_base_path();
    if ($base !== '' && str_starts_with($path, $base)) {
        $path = substr($path, strlen($base));
    }
    $path = trim($path, '/');
    return $path === 'index.php' ? '' : $path;
}

// ---------------------------------------------------------------- config

function oq_config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $loaded = is_file(oq_config_file()) ? require oq_config_file() : null;
        if (!is_array($loaded)) {
            throw new RuntimeException('open-qr is not installed');
        }
        $cfg = $loaded + [
            'code_length' => 7,
            'session_lifetime_hours' => 168,
            'cookie_secure' => null,
            'store_user_agent' => false,
            'store_referrer' => true,
            'stats_timezone' => 'UTC',
            'login_max_attempts' => 10,
            'login_window_seconds' => 900,
        ];
        $cfg['public_base_url'] = rtrim((string) $cfg['public_base_url'], '/');
    }
    return $cfg;
}

function oq_installed(): bool
{
    return is_file(oq_config_file());
}

function oq_short_url(string $code): string
{
    return oq_config()['public_base_url'] . '/r/' . $code;
}

function oq_secure_cookies(): bool
{
    $v = oq_config()['cookie_secure'];
    return $v === null ? str_starts_with(oq_config()['public_base_url'], 'https://') : (bool) $v;
}

// ---------------------------------------------------------------- database

function oq_connect(array $db): PDO
{
    $opts = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ];
    if ($db['driver'] === 'sqlite') {
        $pdo = new PDO('sqlite:' . oq_data_dir() . '/' . $db['file'], null, null, $opts);
        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec('PRAGMA busy_timeout = 5000');
        return $pdo;
    }
    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
        $db['host'],
        (int) ($db['port'] ?? 3306),
        $db['name']
    );
    return new PDO($dsn, $db['user'], $db['password'], $opts);
}

function oq_db(): PDO
{
    static $pdo = null;
    return $pdo ??= oq_connect(oq_config()['db']);
}

function oq_q(string $sql, array $params = []): PDOStatement
{
    $st = oq_db()->prepare($sql);
    foreach ($params as $k => $v) {
        $type = is_int($v) ? PDO::PARAM_INT : (is_bool($v) ? PDO::PARAM_INT : ($v === null ? PDO::PARAM_NULL : PDO::PARAM_STR));
        $st->bindValue(is_int($k) ? $k + 1 : $k, is_bool($v) ? (int) $v : $v, $type);
    }
    $st->execute();
    return $st;
}

function oq_one(string $sql, array $params = []): ?array
{
    $row = oq_q($sql, $params)->fetch();
    return $row === false ? null : $row;
}

function oq_scalar(string $sql, array $params = [])
{
    $v = oq_q($sql, $params)->fetchColumn();
    return $v === false ? null : $v;
}

function oq_is_unique_violation(PDOException $e): bool
{
    // SQLSTATE 23000 (MySQL, SQLite constraint) / 23505
    return str_starts_with((string) $e->getCode(), '23');
}

// ---------------------------------------------------------------- responses

function oq_security_headers(): void
{
    header("Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; style-src 'self'; "
        . "script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; "
        . "form-action 'self'; frame-ancestors 'none'");
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: same-origin');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()');
}

function oq_json($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}

function oq_no_content(): void
{
    http_response_code(204);
    header('Cache-Control: no-store');
}

function oq_html_escape(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function oq_error_page(int $status, string $title, string $message): void
{
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    $base = oq_html_escape(oq_base_path() . '/');
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">'
        . '<title>' . oq_html_escape($title) . ' · open-qr</title><base href="' . $base . '">'
        . '<link rel="icon" href="static/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="static/styles.css">'
        . '</head><body class="error-body"><main class="error-card"><div class="error-code">' . $status . '</div>'
        . '<h1>' . oq_html_escape($title) . '</h1><p>' . oq_html_escape($message) . '</p></main></body></html>';
}

/** Serve an HTML file from static/ with <base href> injected so relative asset paths work in subfolders. */
function oq_serve_page(string $file): void
{
    $html = @file_get_contents(OQ_ROOT . '/static/' . $file);
    if ($html === false) {
        oq_error_page(500, 'Missing file', "static/$file is missing. Please re-upload open-qr.");
        return;
    }
    $base = '<base href="' . oq_html_escape(oq_base_path() . '/') . '">';
    $html = preg_replace('/<head([^>]*)>/i', '<head$1>' . $base, $html, 1);
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-cache');
    echo $html;
}

function oq_iso(?int $ts): ?string
{
    return $ts === null ? null : gmdate('Y-m-d\TH:i:s', $ts) . '+00:00';
}

/** Decoded JSON request body as an object-like array. */
function oq_body(): array
{
    $raw = file_get_contents('php://input') ?: '';
    $data = json_decode($raw, true);
    if (!is_array($data) || array_is_list($data) && $data !== []) {
        throw new HttpError(422, [['loc' => ['body'], 'msg' => 'Request body must be a JSON object', 'type' => 'json_invalid']]);
    }
    return $data;
}

function oq_method(): string
{
    return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
}

function oq_client_ip(): string
{
    return (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
}

// ---------------------------------------------------------------- main

function oq_main(): void
{
    oq_security_headers();
    $route = oq_route();
    $isApi = $route === 'api' || str_starts_with($route, 'api/') || $route === 'healthz';

    try {
        if ($route === 'api/ping' || $route === 'healthz') {
            oq_json(['status' => 'ok']);
            return;
        }
        if (!oq_installed()) {
            require __DIR__ . '/install.php';
            oq_install_dispatch($route);
            return;
        }
        if ($route === '' || $route === 'index.html') {
            oq_serve_page('index.html');
            return;
        }
        if ($route === 'install' || str_starts_with($route, 'api/install')) {
            if ($isApi) {
                throw new HttpError(409, 'open-qr is already installed');
            }
            header('Location: ' . oq_base_path() . '/', true, 302);
            return;
        }
        if (preg_match('#^r/([^/]+)$#', $route, $m)) {
            require __DIR__ . '/redirect.php';
            oq_redirect($m[1]);
            return;
        }
        if ($isApi) {
            require __DIR__ . '/auth.php';
            require __DIR__ . '/api.php';
            oq_api_dispatch($route, oq_method());
            return;
        }
        oq_error_page(404, 'Not found', 'This page does not exist.');
    } catch (HttpError $e) {
        if ($isApi) {
            oq_json(['detail' => $e->detail], $e->status);
        } else {
            oq_error_page($e->status, 'Error', is_string($e->detail) ? $e->detail : 'Request failed');
        }
    } catch (Throwable $e) {
        error_log('open-qr: ' . $e);
        if ($isApi) {
            oq_json(['detail' => 'Internal server error'], 500);
        } else {
            oq_error_page(500, 'Something went wrong', 'An internal error occurred. Check the PHP error log.');
        }
    }
}
