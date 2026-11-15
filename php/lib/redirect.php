<?php
/**
 * Public short-link redirect /r/{code} (port of routes/redirect.py).
 */

declare(strict_types=1);

function oq_redirect(string $code): void
{
    $notFound = fn () => oq_error_page(404, 'QR code not found', 'This QR code does not exist.');
    if (!preg_match(OQ_CODE_PATTERN, $code)) {
        $notFound();
        return;
    }
    $qr = oq_one('SELECT id, target_url, is_active FROM qr_codes WHERE code = ?', [$code]);
    if (!$qr) {
        $notFound();
        return;
    }
    if (!$qr['is_active']) {
        oq_error_page(410, 'QR code deactivated', 'This QR code has been deactivated by its owner.');
        return;
    }

    // Only real GET requests count as scans (HEAD comes from link checkers).
    if (oq_method() === 'GET') {
        try {
            $cfg = oq_config();
            $ua = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
            [$device, $browser, $isBot] = oq_classify_user_agent($ua);
            oq_q(
                'INSERT INTO scans (qr_code_id, scanned_at, user_agent, device_type, browser, referrer, is_bot)
                 VALUES (?, ?, ?, ?, ?, ?, ?)',
                [
                    (int) $qr['id'],
                    time(),
                    $cfg['store_user_agent'] && $ua !== '' ? mb_substr($ua, 0, 512) : null,
                    $device,
                    $browser,
                    $cfg['store_referrer'] ? oq_referrer_host($_SERVER['HTTP_REFERER'] ?? null) : null,
                    $isBot,
                ]
            );
        } catch (Throwable $e) {
            // A failed scan record must never break the redirect.
            error_log('open-qr: could not record scan: ' . $e->getMessage());
        }
    }

    http_response_code(302);
    header('Location: ' . $qr['target_url']);
    header('Cache-Control: no-store, private');
    header('Referrer-Policy: no-referrer');
}
