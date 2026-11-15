<?php
/**
 * First-run installer. Active only while data/config.php does not exist.
 *
 *   GET  install page          -> static/install.html
 *   GET  api/install/check     -> environment checks
 *   POST api/install/run       -> create schema + admin, write config, sign in
 *
 * Every API call also works as index.php?r=api/install/... so the installer runs without mod_rewrite.
 */

declare(strict_types=1);

function oq_install_dispatch(string $route): void
{
    $method = oq_method();
    if ($route === 'api/install/check' && $method === 'GET') {
        oq_json(oq_install_checks());
        return;
    }
    if ($route === 'api/install/run' && $method === 'POST') {
        oq_install_run(oq_body());
        return;
    }
    if ($route === 'api' || str_starts_with($route, 'api/')) {
        throw new HttpError(503, 'open-qr is not installed yet');
    }
    if (str_starts_with($route, 'r/')) {
        oq_error_page(503, 'Not set up yet', 'This open-qr instance has not been set up yet.');
        return;
    }
    if ($route === '' || $route === 'install' || $route === 'index.html') {
        oq_serve_page('install.html');
        return;
    }
    header('Location: ' . oq_base_path() . '/', true, 302);
}

// ---------------------------------------------------------------- checks

function oq_install_checks(): array
{
    $drivers = class_exists('PDO') ? PDO::getAvailableDrivers() : [];
    $items = [
        ['id' => 'php', 'ok' => PHP_VERSION_ID >= 80100, 'required' => true, 'value' => PHP_VERSION],
        ['id' => 'pdo_sqlite', 'ok' => in_array('sqlite', $drivers, true), 'required' => false, 'value' => null],
        ['id' => 'pdo_mysql', 'ok' => in_array('mysql', $drivers, true), 'required' => false, 'value' => null],
        ['id' => 'zlib', 'ok' => function_exists('gzcompress'), 'required' => true, 'value' => null],
        ['id' => 'mbstring', 'ok' => function_exists('mb_strlen'), 'required' => true, 'value' => null],
        ['id' => 'data_writable', 'ok' => oq_install_data_writable(), 'required' => true, 'value' => 'data/'],
        ['id' => 'argon2', 'ok' => defined('PASSWORD_ARGON2ID'), 'required' => false, 'value' => null],
        ['id' => 'https', 'ok' => oq_is_https(), 'required' => false, 'value' => null],
    ];
    $ok = !in_array(false, array_map(fn ($i) => $i['ok'] || !$i['required'], $items), true)
        && ($items[1]['ok'] || $items[2]['ok']);
    return [
        'ok' => $ok,
        'version' => OQ_VERSION,
        'items' => $items,
        'base_url' => oq_detected_base_url(),
        'drivers' => ['sqlite' => $items[1]['ok'], 'mysql' => $items[2]['ok']],
    ];
}

function oq_install_data_writable(): bool
{
    $dir = oq_data_dir();
    if (!is_dir($dir) && !@mkdir($dir, 0750, true)) {
        return false;
    }
    $probe = $dir . '/.write-test-' . bin2hex(random_bytes(4));
    if (@file_put_contents($probe, 'ok') !== 2) {
        return false;
    }
    @unlink($probe);
    return true;
}

// ---------------------------------------------------------------- validation

function oq_install_input(array $body): array
{
    $baseUrl = rtrim(trim((string) oq_str_field($body, 'base_url', true, 8, 255)), '/');
    $p = parse_url($baseUrl);
    if ($p === false || !in_array(strtolower($p['scheme'] ?? ''), ['http', 'https'], true) || empty($p['host'])
        || isset($p['query']) || isset($p['fragment']) || isset($p['user'])) {
        throw oq_invalid('base_url', 'Enter the full address, e.g. https://qr.example.com');
    }

    $username = oq_username($body);
    $email = oq_email($body);
    $password = oq_new_password($body, 'password');

    $tz = (string) ($body['timezone'] ?? 'UTC');
    if (!in_array($tz, DateTimeZone::listIdentifiers(), true)) {
        $tz = 'UTC';
    }

    $dbIn = is_array($body['db'] ?? null) ? $body['db'] : ['driver' => 'sqlite'];
    $driver = $dbIn['driver'] ?? 'sqlite';
    if ($driver === 'mysql') {
        $db = [
            'driver' => 'mysql',
            'host' => trim((string) ($dbIn['host'] ?? '')),
            'port' => (int) ($dbIn['port'] ?? 3306) ?: 3306,
            'name' => trim((string) ($dbIn['name'] ?? '')),
            'user' => trim((string) ($dbIn['user'] ?? '')),
            'password' => (string) ($dbIn['password'] ?? ''),
        ];
        foreach (['host', 'name', 'user'] as $f) {
            if ($db[$f] === '') {
                throw oq_invalid("db_$f", 'Field required');
            }
        }
    } else {
        // Random file name: even if data/ were ever reachable, the database cannot be guessed.
        $db = ['driver' => 'sqlite', 'file' => 'openqr-' . bin2hex(random_bytes(6)) . '.sqlite'];
    }
    return compact('baseUrl', 'username', 'email', 'password', 'tz', 'db');
}

// ---------------------------------------------------------------- schema

function oq_install_schema(string $driver): array
{
    if ($driver === 'mysql') {
        $t = ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
        return [
            'CREATE TABLE IF NOT EXISTS users (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(64) NOT NULL UNIQUE,
                email VARCHAR(254) NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                is_admin TINYINT(1) NOT NULL DEFAULT 0,
                created_at BIGINT NOT NULL)' . $t,
            'CREATE TABLE IF NOT EXISTS sessions (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                user_id BIGINT NOT NULL,
                token_hash CHAR(64) NOT NULL UNIQUE,
                csrf_token VARCHAR(64) NOT NULL,
                created_at BIGINT NOT NULL,
                expires_at BIGINT NOT NULL,
                INDEX ix_sessions_expires (expires_at),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)' . $t,
            'CREATE TABLE IF NOT EXISTS qr_codes (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                code VARCHAR(32) NOT NULL UNIQUE,
                name VARCHAR(120) NOT NULL,
                description TEXT NOT NULL,
                target_url VARCHAR(2048) NOT NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL,
                user_id BIGINT NOT NULL,
                style MEDIUMTEXT NULL,
                logo MEDIUMBLOB NULL,
                INDEX ix_qr_codes_user (user_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)' . $t,
            'CREATE TABLE IF NOT EXISTS scans (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                qr_code_id BIGINT NOT NULL,
                scanned_at BIGINT NOT NULL,
                user_agent VARCHAR(512) NULL,
                device_type VARCHAR(16) NULL,
                browser VARCHAR(32) NULL,
                referrer VARCHAR(255) NULL,
                is_bot TINYINT(1) NOT NULL DEFAULT 0,
                INDEX ix_scans_qr_time (qr_code_id, scanned_at),
                FOREIGN KEY (qr_code_id) REFERENCES qr_codes(id) ON DELETE CASCADE)' . $t,
            'CREATE TABLE IF NOT EXISTS login_attempts (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                attempt_key VARCHAR(128) NOT NULL,
                attempted_at BIGINT NOT NULL,
                INDEX ix_login_attempts_key (attempt_key, attempted_at))' . $t,
        ];
    }
    return [
        'CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            email TEXT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL)',
        'CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL UNIQUE,
            csrf_token TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL)',
        'CREATE INDEX IF NOT EXISTS ix_sessions_expires ON sessions (expires_at)',
        'CREATE TABLE IF NOT EXISTS qr_codes (
            id INTEGER PRIMARY KEY,
            code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT \'\',
            target_url TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            style TEXT NULL,
            logo BLOB NULL)',
        'CREATE INDEX IF NOT EXISTS ix_qr_codes_user ON qr_codes (user_id)',
        'CREATE TABLE IF NOT EXISTS scans (
            id INTEGER PRIMARY KEY,
            qr_code_id INTEGER NOT NULL REFERENCES qr_codes(id) ON DELETE CASCADE,
            scanned_at INTEGER NOT NULL,
            user_agent TEXT NULL,
            device_type TEXT NULL,
            browser TEXT NULL,
            referrer TEXT NULL,
            is_bot INTEGER NOT NULL DEFAULT 0)',
        'CREATE INDEX IF NOT EXISTS ix_scans_qr_time ON scans (qr_code_id, scanned_at)',
        'CREATE TABLE IF NOT EXISTS login_attempts (
            id INTEGER PRIMARY KEY,
            attempt_key TEXT NOT NULL,
            attempted_at INTEGER NOT NULL)',
        'CREATE INDEX IF NOT EXISTS ix_login_attempts_key ON login_attempts (attempt_key, attempted_at)',
    ];
}

// ---------------------------------------------------------------- run

function oq_install_run(array $body): void
{
    $checks = oq_install_checks();
    if (!$checks['ok']) {
        throw new HttpError(400, 'The server does not meet the requirements (see checks)');
    }
    $in = oq_install_input($body);
    if (!$checks['drivers'][$in['db']['driver']]) {
        throw oq_invalid('db_driver', 'This database driver is not available on the server');
    }

    // One installer run at a time; the loser of a race sees "already installed".
    $lock = fopen(oq_data_dir() . '/install.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
        throw new HttpError(409, 'Installation is already running');
    }
    $log = [];
    $sqliteFile = null;
    try {
        if (oq_installed()) {
            throw new HttpError(409, 'open-qr is already installed');
        }
        $db = $in['db'];

        try {
            $pdo = oq_connect($db);
        } catch (PDOException $e) {
            throw new HttpError(400, 'Database connection failed: ' . oq_install_pdo_msg($e));
        }
        if ($db['driver'] === 'sqlite') {
            $sqliteFile = oq_data_dir() . '/' . $db['file'];
            $log[] = ['step' => 'db', 'detail' => 'SQLite · data/' . $db['file']];
        } else {
            $ver = (string) $pdo->query('SELECT VERSION()')->fetchColumn();
            $log[] = ['step' => 'db', 'detail' => "MySQL $ver · {$db['user']}@{$db['host']}/{$db['name']}"];
        }

        $schema = oq_install_schema($db['driver']);
        foreach ($schema as $sql) {
            $pdo->exec($sql);
        }
        $log[] = ['step' => 'schema', 'detail' => count($schema) . ' statements · users, sessions, qr_codes, scans, login_attempts'];

        if ((int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn() > 0) {
            throw new HttpError(409, 'This database already contains open-qr users. Use an empty database.');
        }
        $hash = oq_hash_password($in['password']);
        $st = $pdo->prepare('INSERT INTO users (username, email, password_hash, is_active, is_admin, created_at) VALUES (?, ?, ?, 1, 1, ?)');
        $st->execute([$in['username'], $in['email'], $hash, time()]);
        $log[] = ['step' => 'admin', 'detail' => $in['username'] . ' · ' . (str_starts_with($hash, '$argon2id$') ? 'argon2id' : 'bcrypt')];

        oq_install_protect_data();
        $log[] = ['step' => 'protect', 'detail' => 'data/.htaccess · Require all denied'];

        oq_install_write_config([
            'public_base_url' => $in['baseUrl'],
            'stats_timezone' => $in['tz'],
            'db' => $db,
            'code_length' => 7,
            'session_lifetime_hours' => 168,
            'cookie_secure' => null,
            'store_user_agent' => false,
            'store_referrer' => true,
            'login_max_attempts' => 10,
            'login_window_seconds' => 900,
            'installed_at' => gmdate('c'),
            'version' => OQ_VERSION,
        ]);
        $log[] = ['step' => 'config', 'detail' => 'data/config.php'];
        $sqliteFile = null; // success: keep the database

        require_once __DIR__ . '/auth.php';
        $user = oq_one('SELECT * FROM users WHERE username = ?', [$in['username']]);
        $session = oq_start_session($user);
        $log[] = ['step' => 'login', 'detail' => $in['baseUrl'] . '/'];

        oq_json(['ok' => true, 'log' => $log, 'session' => $session, 'base_url' => $in['baseUrl']]);
    } finally {
        if ($sqliteFile !== null) {
            // Failed before the config was written: remove the half-built database so a retry starts clean.
            $pdo = null;
            @unlink($sqliteFile);
        }
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function oq_install_pdo_msg(PDOException $e): string
{
    // Driver messages can be long; keep the useful first line.
    $msg = preg_replace('/^SQLSTATE\[[^\]]*\]\s*(\[\d+\]\s*)?/', '', $e->getMessage());
    return mb_substr(strtok((string) $msg, "\n") ?: 'unknown error', 0, 200);
}

function oq_install_protect_data(): void
{
    $file = oq_data_dir() . '/.htaccess';
    if (!is_file($file)) {
        $rules = "# open-qr: nothing in here may be served\n"
            . "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n"
            . "<IfModule !mod_authz_core.c>\n  Order deny,allow\n  Deny from all\n</IfModule>\n";
        if (@file_put_contents($file, $rules) === false) {
            throw new RuntimeException('Could not write data/.htaccess');
        }
    }
}

function oq_install_write_config(array $cfg): void
{
    $php = "<?php\n"
        . "// open-qr configuration, written by the installer. Edit with care.\n"
        . "// Deleting this file re-runs the installer (SQLite: with a fresh database).\n"
        . "return " . var_export($cfg, true) . ";\n";
    $tmp = oq_config_file() . '.tmp-' . bin2hex(random_bytes(4));
    if (@file_put_contents($tmp, $php, LOCK_EX) === false || !@rename($tmp, oq_config_file())) {
        @unlink($tmp);
        throw new RuntimeException('Could not write data/config.php');
    }
    @chmod(oq_config_file(), 0640);
    if (function_exists('opcache_invalidate')) {
        @opcache_invalidate(oq_config_file(), true);
    }
}
