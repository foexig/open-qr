<?php
/**
 * Authenticated management API for QR codes and statistics (port of routes/qrcodes.py + stats.py).
 */

declare(strict_types=1);

require __DIR__ . '/stats.php';

function oq_api_dispatch(string $route, string $method): void
{
    if (str_starts_with($route, 'api/auth/')) {
        oq_auth_dispatch(substr($route, 9), $method);
        return;
    }
    if ($route === 'api/qr-codes') {
        [$user] = oq_require_auth();
        if ($method === 'GET') {
            oq_json(oq_list_qr_codes((int) $user['id']));
            return;
        }
        if ($method === 'POST') {
            oq_json(oq_create_qr_code((int) $user['id'], oq_body()), 201);
            return;
        }
        throw new HttpError(405, 'Method Not Allowed');
    }
    if (preg_match('#^api/qr-codes/(\d{1,18})(?:/(.+))?$#', $route, $m)) {
        [$user] = oq_require_auth();
        $uid = (int) $user['id'];
        $id = (int) $m[1];
        $sub = $m[2] ?? '';
        if ($sub === '') {
            switch ($method) {
                case 'GET':
                    oq_json(oq_get_qr_out($uid, $id));
                    return;
                case 'PATCH':
                    oq_json(oq_update_qr_code($uid, $id, oq_body()));
                    return;
                case 'DELETE':
                    oq_owned($uid, $id);
                    oq_q('DELETE FROM qr_codes WHERE id = ? AND user_id = ?', [$id, $uid]);
                    oq_no_content();
                    return;
            }
            throw new HttpError(405, 'Method Not Allowed');
        }
        if (preg_match('#^image\.(png|svg)$#', $sub, $f) && $method === 'GET') {
            oq_qr_image($uid, $id, $f[1]);
            return;
        }
        if ($sub === 'stats' && $method === 'GET') {
            $qr = oq_owned($uid, $id);
            oq_json(oq_qr_code_stats((int) $qr['id'], oq_tz(), oq_int_query('days', 30, 7, 365)));
            return;
        }
        throw new HttpError(404, 'Not Found');
    }
    if ($route === 'api/stats/overview' && $method === 'GET') {
        [$user] = oq_require_auth();
        oq_json(oq_overview((int) $user['id'], oq_int_query('days', 30, 7, 365)));
        return;
    }
    throw new HttpError(404, 'Not Found');
}

function oq_tz(): string
{
    return (string) oq_config()['stats_timezone'];
}

function oq_int_query(string $name, int $default, int $min, int $max): int
{
    if (!isset($_GET[$name]) || $_GET[$name] === '') {
        return $default;
    }
    $v = filter_var($_GET[$name], FILTER_VALIDATE_INT);
    if ($v === false || $v < $min || $v > $max) {
        throw new HttpError(422, [[
            'loc' => ['query', $name],
            'msg' => "Input should be an integer between $min and $max",
            'type' => 'value_error',
        ]]);
    }
    return $v;
}

// ---------------------------------------------------------------- queries

const OQ_QR_SELECT = 'SELECT q.id, q.code, q.name, q.description, q.target_url, q.is_active, q.created_at,
    q.updated_at, q.style, CASE WHEN q.logo IS NULL THEN 0 ELSE 1 END AS has_logo, COALESCE(c.n, 0) AS scan_count, c.last_scan AS last_scan_at
    FROM qr_codes q
    LEFT JOIN (SELECT qr_code_id, COUNT(*) AS n, MAX(scanned_at) AS last_scan FROM scans GROUP BY qr_code_id) c
    ON c.qr_code_id = q.id';

function oq_qr_out(array $r): array
{
    $style = isset($r['style']) && $r['style'] !== null ? json_decode((string) $r['style'], true) : null;
    return [
        'id' => (int) $r['id'],
        'code' => $r['code'],
        'short_url' => oq_short_url($r['code']),
        'name' => $r['name'],
        'description' => (string) $r['description'],
        'target_url' => $r['target_url'],
        'is_active' => (bool) $r['is_active'],
        'created_at' => oq_iso((int) $r['created_at']),
        'updated_at' => oq_iso((int) $r['updated_at']),
        'scan_count' => (int) ($r['scan_count'] ?? 0),
        'last_scan_at' => isset($r['last_scan_at']) ? oq_iso((int) $r['last_scan_at']) : null,
        'style' => is_array($style) ? $style : null,
        'has_logo' => !empty($r['has_logo']),
    ];
}

function oq_owned(int $uid, int $id): array
{
    $qr = oq_one('SELECT id, code, name, target_url, is_active, style FROM qr_codes WHERE id = ? AND user_id = ?', [$id, $uid]);
    if (!$qr) {
        throw new HttpError(404, 'QR code not found');
    }
    return $qr;
}

function oq_get_qr_out(int $uid, int $id): array
{
    $row = oq_one(OQ_QR_SELECT . ' WHERE q.id = ? AND q.user_id = ?', [$id, $uid]);
    if (!$row) {
        throw new HttpError(404, 'QR code not found');
    }
    return oq_qr_out($row);
}

function oq_list_qr_codes(int $uid): array
{
    $q = isset($_GET['q']) && is_string($_GET['q']) ? trim($_GET['q']) : '';
    if (mb_strlen($q) > 200) {
        throw new HttpError(422, [['loc' => ['query', 'q'], 'msg' => 'String should have at most 200 characters', 'type' => 'value_error']]);
    }
    $sort = $_GET['sort'] ?? 'created';
    if (!in_array($sort, ['created', 'name', 'scans'], true)) {
        throw new HttpError(422, [['loc' => ['query', 'sort'], 'msg' => "Input should be 'created', 'name' or 'scans'", 'type' => 'literal_error']]);
    }
    $limit = oq_int_query('limit', 500, 1, 1000);

    $sql = OQ_QR_SELECT . ' WHERE q.user_id = ?';
    $params = [$uid];
    if ($q !== '') {
        $like = '%' . mb_strtolower($q) . '%';
        $sql .= ' AND (LOWER(q.name) LIKE ? OR LOWER(q.target_url) LIKE ? OR LOWER(q.code) LIKE ?)';
        array_push($params, $like, $like, $like);
    }
    $sql .= match ($sort) {
        'name' => ' ORDER BY LOWER(q.name)',
        'scans' => ' ORDER BY scan_count DESC, q.id DESC',
        default => ' ORDER BY q.created_at DESC, q.id DESC',
    };
    $sql .= ' LIMIT ' . $limit;
    return array_map('oq_qr_out', oq_q($sql, $params)->fetchAll());
}

function oq_reject_self_redirect(string $url): void
{
    $prefix = strtolower(oq_config()['public_base_url']) . '/r/';
    if (str_starts_with(strtolower($url), $prefix)) {
        throw new HttpError(422, 'Target URL must not point to another QR code');
    }
}

/** Validates QRCodeCreate / QRCodeUpdate fields. Returns only the fields that were sent. */
function oq_qr_fields(array $body, bool $create): array
{
    $out = [];
    $name = oq_str_field($body, 'name', $create, 1, 120);
    if ($name !== null) {
        $name = trim($name);
        if ($name === '') {
            throw oq_invalid('name', 'Value error, Name must not be empty');
        }
        $out['name'] = $name;
    }
    $desc = oq_str_field($body, 'description', false, 0, 2000);
    if ($desc !== null) {
        $out['description'] = trim($desc);
    } elseif ($create) {
        $out['description'] = '';
    }
    $url = oq_str_field($body, 'target_url', $create, 0, 4096);
    if ($url !== null) {
        try {
            $out['target_url'] = oq_validate_target_url($url);
        } catch (InvalidArgumentException $e) {
            throw oq_invalid('target_url', 'Value error, ' . $e->getMessage());
        }
    }
    if (array_key_exists('is_active', $body) && $body['is_active'] !== null) {
        if (!is_bool($body['is_active'])) {
            throw oq_invalid('is_active', 'Input should be a valid boolean');
        }
        $out['is_active'] = $body['is_active'];
    } elseif ($create) {
        $out['is_active'] = true;
    }
    return $out;
}

function oq_create_qr_code(int $uid, array $body): array
{
    $f = oq_qr_fields($body, true);
    oq_reject_self_redirect($f['target_url']);
    $length = (int) oq_config()['code_length'];
    $now = time();
    for ($i = 0; $i < 8; $i++) {
        try {
            oq_q(
                'INSERT INTO qr_codes (code, name, description, target_url, is_active, created_at, updated_at, user_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [oq_generate_code($length), $f['name'], $f['description'], $f['target_url'], $f['is_active'], $now, $now, $uid]
            );
        } catch (PDOException $e) {
            if (oq_is_unique_violation($e)) {
                continue; // code collision, try again
            }
            throw $e;
        }
        return oq_get_qr_out($uid, (int) oq_db()->lastInsertId());
    }
    throw new HttpError(500, 'Could not allocate a unique code');
}

function oq_update_qr_code(int $uid, int $id, array $body): array
{
    oq_owned($uid, $id);
    $f = oq_qr_fields($body, false);
    if (isset($f['target_url'])) {
        oq_reject_self_redirect($f['target_url']);
    }
    if ($f) {
        $sets = [];
        $params = [];
        foreach ($f as $col => $val) {
            $sets[] = "$col = ?";
            $params[] = $val;
        }
        $sets[] = 'updated_at = ?';
        $params[] = time();
        array_push($params, $id, $uid);
        oq_q('UPDATE qr_codes SET ' . implode(', ', $sets) . ' WHERE id = ? AND user_id = ?', $params);
    }
    return oq_get_qr_out($uid, $id);
}

function oq_filename(string $name, string $code, string $ext): string
{
    $slug = trim((string) preg_replace('/[^a-z0-9]+/', '-', strtolower($name)), '-');
    $slug = substr($slug, 0, 40) ?: 'qr';
    return "$slug-$code.$ext";
}

function oq_qr_image(int $uid, int $id, string $fmt): void
{
    $qr = oq_owned($uid, $id);
    $size = oq_int_query('size', 512, 64, 4096);
    $border = oq_int_query('border', 4, 0, 20);
    $ec = $_GET['ec'] ?? 'M';
    if (!in_array($ec, ['L', 'M', 'Q', 'H'], true)) {
        throw new HttpError(422, [['loc' => ['query', 'ec'], 'msg' => "Input should be 'L', 'M', 'Q' or 'H'", 'type' => 'literal_error']]);
    }
    $data = oq_short_url($qr['code']);
    $content = $fmt === 'png' ? qr_render_png($data, $size, $ec, $border) : qr_render_svg($data, $size, $ec, $border);
    header('Content-Type: ' . ($fmt === 'png' ? 'image/png' : 'image/svg+xml'));
    header('Cache-Control: private, max-age=300');
    $download = strtolower((string) ($_GET['download'] ?? ''));
    if (in_array($download, ['1', 'true', 'yes', 'on'], true)) {
        header('Content-Disposition: attachment; filename="' . oq_filename($qr['name'], $qr['code'], $fmt) . '"');
    }
    echo $content;
}

function oq_overview(int $uid, int $days): array
{
    $data = oq_user_overview($uid, oq_tz(), $days);
    $recent = oq_q(OQ_QR_SELECT . ' WHERE q.user_id = ? ORDER BY q.created_at DESC, q.id DESC LIMIT 5', [$uid])->fetchAll();
    $top = oq_q(OQ_QR_SELECT . ' WHERE q.user_id = ? ORDER BY scan_count DESC, q.id DESC LIMIT 5', [$uid])->fetchAll();
    $data['recent'] = array_map('oq_qr_out', $recent);
    $data['top'] = array_values(array_map('oq_qr_out', array_filter($top, fn ($r) => (int) $r['scan_count'] > 0)));
    return $data;
}
