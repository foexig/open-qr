<?php
/**
 * Sessions, CSRF, login rate limiting and the /api/auth endpoints (port of routes/auth.py + deps.py).
 */

declare(strict_types=1);

const OQ_SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

function oq_user_out(array $u): array
{
    return [
        'id' => (int) $u['id'],
        'username' => $u['username'],
        'email' => $u['email'],
        'is_admin' => (bool) $u['is_admin'],
        'created_at' => oq_iso((int) $u['created_at']),
    ];
}

function oq_cookie_path(): string
{
    return oq_base_path() . '/';
}

function oq_set_session_cookie(string $value, int $maxAge): void
{
    setcookie(OQ_SESSION_COOKIE, $value, [
        'expires' => $maxAge > 0 ? time() + $maxAge : time() - 3600,
        'path' => oq_cookie_path(),
        'secure' => oq_secure_cookies(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

/** Creates a session for $user, sets the cookie and returns SessionOut. */
function oq_start_session(array $user): array
{
    $now = time();
    $hours = (int) oq_config()['session_lifetime_hours'];
    oq_q('DELETE FROM sessions WHERE expires_at <= ?', [$now]);
    $token = oq_new_token();
    $csrf = oq_new_token();
    oq_q(
        'INSERT INTO sessions (user_id, token_hash, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
        [(int) $user['id'], oq_hash_token($token), $csrf, $now, $now + $hours * 3600]
    );
    oq_set_session_cookie($token, $hours * 3600);
    return ['user' => oq_user_out($user), 'csrf_token' => $csrf];
}

/** @return array{0:array,1:array}|null [user, session] */
function oq_current_session(): ?array
{
    $token = $_COOKIE[OQ_SESSION_COOKIE] ?? '';
    if (!is_string($token) || $token === '') {
        return null;
    }
    $sess = oq_one(
        'SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?',
        [oq_hash_token($token), time()]
    );
    if (!$sess) {
        return null;
    }
    $user = oq_one('SELECT * FROM users WHERE id = ?', [(int) $sess['user_id']]);
    if (!$user || !$user['is_active']) {
        return null;
    }
    return [$user, $sess];
}

/** Like deps.get_auth: 401 without a valid session, 403 on a bad CSRF header for unsafe methods. */
function oq_require_auth(): array
{
    if (($_COOKIE[OQ_SESSION_COOKIE] ?? '') === '') {
        throw new HttpError(401, 'Not authenticated');
    }
    $ctx = oq_current_session();
    if ($ctx === null) {
        throw new HttpError(401, 'Session expired or invalid');
    }
    if (!in_array(oq_method(), OQ_SAFE_METHODS, true)) {
        $sent = (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
        if (!hash_equals($ctx[1]['csrf_token'], $sent)) {
            throw new HttpError(403, 'CSRF token missing or invalid');
        }
    }
    return $ctx;
}

// ---------------------------------------------------------------- rate limiting (DB-backed)

function oq_limiter_blocked(string $key): bool
{
    $cfg = oq_config();
    $since = time() - (int) $cfg['login_window_seconds'];
    oq_q('DELETE FROM login_attempts WHERE attempted_at < ?', [$since]);
    $n = (int) oq_scalar('SELECT COUNT(*) FROM login_attempts WHERE attempt_key = ?', [$key]);
    return $n >= (int) $cfg['login_max_attempts'];
}

function oq_limiter_fail(string $key): void
{
    oq_q('INSERT INTO login_attempts (attempt_key, attempted_at) VALUES (?, ?)', [$key, time()]);
}

function oq_limiter_reset(string $key): void
{
    oq_q('DELETE FROM login_attempts WHERE attempt_key = ?', [$key]);
}

// ---------------------------------------------------------------- endpoints

function oq_auth_dispatch(string $action, string $method): void
{
    switch ("$method $action") {
        case 'GET status':
            $usersExist = (int) oq_scalar('SELECT COUNT(*) FROM users') > 0;
            $ctx = $usersExist ? oq_current_session() : null;
            if ($ctx) {
                oq_json([
                    'setup_required' => false,
                    'authenticated' => true,
                    'user' => oq_user_out($ctx[0]),
                    'csrf_token' => $ctx[1]['csrf_token'],
                ]);
            } else {
                oq_json(['setup_required' => !$usersExist, 'authenticated' => false, 'user' => null, 'csrf_token' => null]);
            }
            return;

        case 'POST setup':
            // The PHP edition creates the admin in the installer.
            throw new HttpError(409, 'Setup has already been completed');

        case 'POST login':
            $key = 'login:' . oq_client_ip();
            if (oq_limiter_blocked($key)) {
                throw new HttpError(429, 'Too many attempts, try later');
            }
            $body = oq_body();
            $username = (string) oq_str_field($body, 'username', true, 1, 64);
            $password = (string) oq_str_field($body, 'password', true, 1, 1024);
            $user = oq_one('SELECT * FROM users WHERE username = ?', [$username]);
            // Always run a hash verification so timing does not reveal unknown usernames.
            $ok = password_verify($password, $user['password_hash'] ?? oq_dummy_hash()) && $user !== null;
            if (!$user || !$ok || !$user['is_active']) {
                oq_limiter_fail($key);
                throw new HttpError(401, 'Invalid username or password');
            }
            oq_limiter_reset($key);
            if (oq_password_needs_rehash($user['password_hash'])) {
                oq_q('UPDATE users SET password_hash = ? WHERE id = ?', [oq_hash_password($password), (int) $user['id']]);
            }
            oq_json(oq_start_session($user));
            return;

        case 'POST logout':
            [, $sess] = oq_require_auth();
            oq_q('DELETE FROM sessions WHERE id = ?', [(int) $sess['id']]);
            oq_set_session_cookie('', 0);
            oq_no_content();
            return;

        case 'GET me':
            [$user, $sess] = oq_require_auth();
            oq_json(['user' => oq_user_out($user), 'csrf_token' => $sess['csrf_token']]);
            return;

        case 'POST change-password':
            [$user, $sess] = oq_require_auth();
            $body = oq_body();
            $current = (string) oq_str_field($body, 'current_password', true, 1, 1024);
            $new = oq_new_password($body, 'new_password');
            if (!password_verify($current, $user['password_hash'])) {
                throw new HttpError(400, 'Current password is incorrect');
            }
            oq_q('UPDATE users SET password_hash = ? WHERE id = ?', [oq_hash_password($new), (int) $user['id']]);
            // Sign out every other session of this user.
            oq_q('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [(int) $user['id'], (int) $sess['id']]);
            oq_no_content();
            return;
    }
    throw new HttpError(404, 'Not Found');
}

function oq_dummy_hash(): string
{
    static $h = null;
    return $h ??= oq_hash_password(oq_new_token());
}
