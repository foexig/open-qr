<?php
/**
 * Scan statistics (port of app/stats.py). Bucketing happens in PHP so it works the same on SQLite and MySQL.
 */

declare(strict_types=1);

// $where is always [SQL condition on scans, params].

function oq_period_start(DateTimeImmutable $d, string $unit): DateTimeImmutable
{
    $d = $d->setTime(0, 0);
    if ($unit === 'week') {
        return $d->modify('-' . ((int) $d->format('N') - 1) . ' days');
    }
    if ($unit === 'month') {
        return $d->setDate((int) $d->format('Y'), (int) $d->format('m'), 1);
    }
    return $d;
}

function oq_shift(DateTimeImmutable $d, string $unit, int $n): DateTimeImmutable
{
    $sign = $n < 0 ? '-' : '+';
    $n = abs($n);
    return match ($unit) {
        'day' => $d->modify("$sign$n days"),
        'week' => $d->modify("$sign$n weeks"),
        default => $d->modify("first day of this month")->modify("$sign$n months"),
    };
}

function oq_today(string $tz): DateTimeImmutable
{
    return (new DateTimeImmutable('now', new DateTimeZone($tz)))->setTime(0, 0);
}

function oq_count_since(array $where, ?int $since, bool $botsOnly = false): int
{
    [$cond, $params] = $where;
    $sql = "SELECT COUNT(*) FROM scans WHERE $cond";
    if ($botsOnly) {
        $sql .= ' AND is_bot = 1';
    }
    if ($since !== null) {
        $sql .= ' AND scanned_at >= ?';
        $params[] = $since;
    }
    return (int) oq_scalar($sql, $params);
}

function oq_time_series(array $where, string $unit, int $periods, string $tz): array
{
    $last = oq_period_start(oq_today($tz), $unit);
    $first = oq_shift($last, $unit, -($periods - 1));
    $buckets = [];
    $d = $first;
    for ($i = 0; $i < $periods; $i++) {
        $buckets[$d->format('Y-m-d')] = [0, 0];
        $d = oq_shift($d, $unit, 1);
    }
    [$cond, $params] = $where;
    $params[] = $first->getTimestamp();
    $st = oq_q("SELECT scanned_at, is_bot FROM scans WHERE $cond AND scanned_at >= ?", $params);
    $zone = new DateTimeZone($tz);
    while ($row = $st->fetch(PDO::FETCH_NUM)) {
        $local = (new DateTimeImmutable('@' . $row[0]))->setTimezone($zone);
        $key = oq_period_start($local, $unit)->format('Y-m-d');
        if (isset($buckets[$key])) {
            $buckets[$key][0]++;
            $buckets[$key][1] += $row[1] ? 1 : 0;
        }
    }
    $out = [];
    foreach ($buckets as $period => [$count, $bots]) {
        $out[] = ['period' => $period, 'count' => $count, 'bots' => $bots];
    }
    return $out;
}

function oq_breakdown(array $where, string $column, int $limit = 8): array
{
    [$cond, $params] = $where;
    $rows = oq_q(
        "SELECT $column AS label, COUNT(*) AS n FROM scans WHERE $cond AND $column IS NOT NULL
         GROUP BY $column ORDER BY n DESC LIMIT $limit",
        $params
    )->fetchAll();
    return array_map(fn ($r) => ['label' => $r['label'], 'count' => (int) $r['n']], $rows);
}

function oq_summary(array $where, string $tz): array
{
    $today = oq_today($tz);
    [$cond, $params] = $where;
    $last = oq_scalar("SELECT MAX(scanned_at) FROM scans WHERE $cond", $params);
    return [
        'total' => oq_count_since($where, null),
        'likely_bots' => oq_count_since($where, null, true),
        'today' => oq_count_since($where, $today->getTimestamp()),
        'this_week' => oq_count_since($where, oq_period_start($today, 'week')->getTimestamp()),
        'this_month' => oq_count_since($where, oq_period_start($today, 'month')->getTimestamp()),
        'last_scan_at' => $last === null ? null : oq_iso((int) $last),
    ];
}

function oq_qr_code_stats(int $qrId, string $tz, int $days): array
{
    $where = ['qr_code_id = ?', [$qrId]];
    return oq_summary($where, $tz) + [
        'timezone' => $tz,
        'daily' => oq_time_series($where, 'day', $days, $tz),
        'weekly' => oq_time_series($where, 'week', 12, $tz),
        'monthly' => oq_time_series($where, 'month', 12, $tz),
        'devices' => oq_breakdown($where, 'device_type'),
        'browsers' => oq_breakdown($where, 'browser'),
        'referrers' => oq_breakdown($where, 'referrer'),
    ];
}

function oq_user_overview(int $uid, string $tz, int $days): array
{
    $where = ['qr_code_id IN (SELECT id FROM qr_codes WHERE user_id = ?)', [$uid]];
    return [
        'total_codes' => (int) oq_scalar('SELECT COUNT(*) FROM qr_codes WHERE user_id = ?', [$uid]),
        'active_codes' => (int) oq_scalar('SELECT COUNT(*) FROM qr_codes WHERE user_id = ? AND is_active = 1', [$uid]),
        'scans' => oq_summary($where, $tz),
        'timezone' => $tz,
        'daily' => oq_time_series($where, 'day', $days, $tz),
    ];
}
