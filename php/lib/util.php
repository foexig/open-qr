<?php
/**
 * Small helpers: public code generation, URL validation, user agent classification.
 * Ported 1:1 from app/util.py.
 */

declare(strict_types=1);

// No look-alike characters (0/O, 1/l/I) so codes can be typed from print if needed.
const OQ_CODE_ALPHABET = '23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const OQ_CODE_PATTERN = '/^[A-Za-z0-9]{4,32}$/';
const OQ_MAX_URL_LENGTH = 2048;
const OQ_USERNAME_PATTERN = '/^[A-Za-z0-9_.-]{3,64}$/';
const OQ_MIN_PASSWORD_LENGTH = 10;

function oq_generate_code(int $length): string
{
    $out = '';
    $max = strlen(OQ_CODE_ALPHABET) - 1;
    for ($i = 0; $i < $length; $i++) {
        $out .= OQ_CODE_ALPHABET[random_int(0, $max)];
    }
    return $out;
}

function oq_new_token(): string
{
    return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
}

function oq_hash_token(string $token): string
{
    return hash('sha256', $token);
}

function oq_hash_password(string $password): string
{
    return password_hash($password, defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT);
}

function oq_password_needs_rehash(string $hash): bool
{
    return password_needs_rehash($hash, defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT);
}

/** Returns the trimmed URL or throws InvalidArgumentException with a user-facing message. */
function oq_validate_target_url(string $value): string
{
    $value = trim($value);
    if ($value === '') {
        throw new InvalidArgumentException('URL must not be empty');
    }
    if (mb_strlen($value) > OQ_MAX_URL_LENGTH) {
        throw new InvalidArgumentException('URL must be at most ' . OQ_MAX_URL_LENGTH . ' characters');
    }
    if (preg_match('/[\x00-\x20\x7f]/', $value)) {
        throw new InvalidArgumentException('URL must not contain spaces or control characters');
    }
    $parts = parse_url($value);
    $scheme = strtolower((string) ($parts['scheme'] ?? ''));
    if ($parts === false || !in_array($scheme, ['http', 'https'], true)) {
        throw new InvalidArgumentException('Only http:// and https:// URLs are allowed');
    }
    if (empty($parts['host'])) {
        throw new InvalidArgumentException('URL must contain a host name');
    }
    if (isset($parts['user']) || isset($parts['pass'])) {
        throw new InvalidArgumentException('URLs with embedded credentials are not allowed');
    }
    return $value;
}

function oq_referrer_host(?string $referrer): ?string
{
    if (!$referrer) {
        return null;
    }
    $host = parse_url($referrer, PHP_URL_HOST);
    return is_string($host) && $host !== '' ? substr($host, 0, 255) : null;
}

/** @return array{0:string,1:string,2:bool} [device_type, browser, is_bot] */
function oq_classify_user_agent(?string $ua): array
{
    $ua = trim((string) $ua);
    if ($ua === '') {
        return ['unknown', 'Unknown', false];
    }
    $bot = '/bot\b|bot\/|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|slack|'
        . 'discord|skypeuri|embedly|quora link|pinterest|vkshare|w3c_validator|curl\/|wget\/|'
        . 'python-requests|python-urllib|httpx|aiohttp|go-http-client|okhttp|java\/|libwww|'
        . 'headlesschrome|phantomjs|scrapy|axios|node-fetch|monitor|uptime/i';
    $isBot = (bool) preg_match($bot, $ua);
    if ($isBot) {
        $device = 'bot';
    } elseif (preg_match('/ipad|tablet|kindle|silk|playbook|(android(?!.*mobile))/i', $ua)) {
        $device = 'tablet';
    } elseif (preg_match('/mobi|iphone|ipod|android|blackberry|opera mini|iemobile/i', $ua)) {
        $device = 'mobile';
    } else {
        $device = 'desktop';
    }
    $browsers = [
        'Edge' => '/Edg(e|A|iOS)?\//',
        'Opera' => '/OPR\/|Opera/',
        'Samsung Internet' => '/SamsungBrowser/',
        'Firefox' => '/Firefox|FxiOS/',
        'Chrome' => '/Chrome|CriOS|Chromium/',
        'Safari' => '/Safari|AppleWebKit/',
    ];
    $browser = 'Other';
    foreach ($browsers as $name => $rx) {
        if (preg_match($rx, $ua)) {
            $browser = $name;
            break;
        }
    }
    return [$device, $browser, $isBot];
}

// ---------------------------------------------------------------- input validation (schemas.py)

function oq_str_field(array $body, string $field, bool $required, int $min, int $max): ?string
{
    if (!array_key_exists($field, $body) || $body[$field] === null) {
        if ($required) {
            throw oq_invalid($field, 'Field required');
        }
        return null;
    }
    if (!is_string($body[$field])) {
        throw oq_invalid($field, 'Input should be a valid string');
    }
    $v = $body[$field];
    $len = mb_strlen($v);
    if ($len < $min) {
        throw oq_invalid($field, "String should have at least $min characters");
    }
    if ($len > $max) {
        throw oq_invalid($field, "String should have at most $max characters");
    }
    return $v;
}

function oq_username(array $body): string
{
    $u = (string) oq_str_field($body, 'username', true, 3, 64);
    if (!preg_match(OQ_USERNAME_PATTERN, $u)) {
        throw oq_invalid('username', 'Username may only contain letters, digits, ".", "_" and "-" (3-64 characters)');
    }
    return $u;
}

function oq_new_password(array $body, string $field): string
{
    return (string) oq_str_field($body, $field, true, OQ_MIN_PASSWORD_LENGTH, 1024);
}

function oq_email(array $body): ?string
{
    $e = oq_str_field($body, 'email', false, 0, 254);
    if ($e === null || trim($e) === '') {
        return null;
    }
    $e = strtolower(trim($e));
    if (!filter_var($e, FILTER_VALIDATE_EMAIL)) {
        throw oq_invalid('email', 'value is not a valid email address');
    }
    return $e;
}
