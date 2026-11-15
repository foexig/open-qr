<?php
/**
 * Dependency-free QR code encoder (byte mode, versions 1-40, ECC L/M/Q/H)
 * plus PNG (zlib only, no GD) and SVG rendering.
 *
 * Algorithm follows ISO/IEC 18004; structure modelled on Project Nayuki's
 * MIT-licensed QR Code generator.
 */

declare(strict_types=1);

final class QrMatrix
{
    private const ECC_CODEWORDS_PER_BLOCK = [
        'L' => [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
        'M' => [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
        'Q' => [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
        'H' => [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    ];
    private const NUM_ERROR_CORRECTION_BLOCKS = [
        'L' => [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
        'M' => [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
        'Q' => [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
        'H' => [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
    ];
    private const FORMAT_BITS = ['L' => 1, 'M' => 0, 'Q' => 3, 'H' => 2];

    public int $version;
    public int $size;
    /** @var array<int, array<int, bool>> [y][x], true = dark */
    public array $modules = [];
    private array $isFunction = [];
    private string $ecl;

    public function __construct(string $data, string $ecl = 'M', ?int $forceMask = null)
    {
        if (!isset(self::FORMAT_BITS[$ecl])) {
            throw new InvalidArgumentException('Invalid error correction level');
        }
        $this->ecl = $ecl;
        $bytes = array_values(unpack('C*', $data) ?: []);
        $len = count($bytes);

        for ($ver = 1; ; $ver++) {
            if ($ver > 40) {
                throw new InvalidArgumentException('Data too long for a QR code');
            }
            $capacity = self::numDataCodewords($ver, $ecl) * 8;
            $used = 4 + ($ver < 10 ? 8 : 16) + 8 * $len;
            if ($used <= $capacity) {
                break;
            }
        }
        $this->version = $ver;
        $this->size = $ver * 4 + 17;

        // Bit stream: byte mode indicator, count, data, terminator, padding.
        $bits = [];
        $push = static function (int $val, int $n) use (&$bits): void {
            for ($i = $n - 1; $i >= 0; $i--) {
                $bits[] = ($val >> $i) & 1;
            }
        };
        $push(0x4, 4);
        $push($len, $ver < 10 ? 8 : 16);
        foreach ($bytes as $b) {
            $push($b, 8);
        }
        $capacity = self::numDataCodewords($ver, $ecl) * 8;
        $push(0, min(4, $capacity - count($bits)));
        $push(0, (8 - count($bits) % 8) % 8);
        for ($pad = 0xEC; count($bits) < $capacity; $pad ^= 0xEC ^ 0x11) {
            $push($pad, 8);
        }
        $codewords = [];
        foreach (array_chunk($bits, 8) as $chunk) {
            $v = 0;
            foreach ($chunk as $bit) {
                $v = ($v << 1) | $bit;
            }
            $codewords[] = $v;
        }

        $row = array_fill(0, $this->size, false);
        $this->modules = array_fill(0, $this->size, $row);
        $this->isFunction = array_fill(0, $this->size, $row);
        $this->drawFunctionPatterns();
        $this->drawCodewords($this->addEccAndInterleave($codewords));

        if ($forceMask === null) {
            $best = 0;
            $minPenalty = PHP_INT_MAX;
            for ($m = 0; $m < 8; $m++) {
                $this->applyMask($m);
                $this->drawFormatBits($m);
                $p = $this->penalty();
                if ($p < $minPenalty) {
                    $best = $m;
                    $minPenalty = $p;
                }
                $this->applyMask($m); // XOR again = undo
            }
            $forceMask = $best;
        }
        $this->applyMask($forceMask);
        $this->drawFormatBits($forceMask);
        $this->isFunction = [];
    }

    // ---------- capacity ----------

    private static function numRawDataModules(int $ver): int
    {
        $result = (16 * $ver + 128) * $ver + 64;
        if ($ver >= 2) {
            $numAlign = intdiv($ver, 7) + 2;
            $result -= (25 * $numAlign - 10) * $numAlign - 55;
            if ($ver >= 7) {
                $result -= 36;
            }
        }
        return $result;
    }

    private static function numDataCodewords(int $ver, string $ecl): int
    {
        return intdiv(self::numRawDataModules($ver), 8)
            - self::ECC_CODEWORDS_PER_BLOCK[$ecl][$ver] * self::NUM_ERROR_CORRECTION_BLOCKS[$ecl][$ver];
    }

    // ---------- function patterns ----------

    private function setFunction(int $x, int $y, bool $dark): void
    {
        $this->modules[$y][$x] = $dark;
        $this->isFunction[$y][$x] = true;
    }

    private function drawFunctionPatterns(): void
    {
        for ($i = 0; $i < $this->size; $i++) {
            $this->setFunction(6, $i, $i % 2 === 0);
            $this->setFunction($i, 6, $i % 2 === 0);
        }
        $this->drawFinder(3, 3);
        $this->drawFinder($this->size - 4, 3);
        $this->drawFinder(3, $this->size - 4);

        $pos = $this->alignmentPositions();
        $n = count($pos);
        for ($i = 0; $i < $n; $i++) {
            for ($j = 0; $j < $n; $j++) {
                if (($i === 0 && $j === 0) || ($i === 0 && $j === $n - 1) || ($i === $n - 1 && $j === 0)) {
                    continue;
                }
                for ($dy = -2; $dy <= 2; $dy++) {
                    for ($dx = -2; $dx <= 2; $dx++) {
                        $this->setFunction($pos[$i] + $dx, $pos[$j] + $dy, max(abs($dx), abs($dy)) !== 1);
                    }
                }
            }
        }
        $this->drawFormatBits(0); // reserve area, overwritten later
        $this->drawVersion();
    }

    private function drawFinder(int $x, int $y): void
    {
        for ($dy = -4; $dy <= 4; $dy++) {
            for ($dx = -4; $dx <= 4; $dx++) {
                $xx = $x + $dx;
                $yy = $y + $dy;
                if ($xx >= 0 && $xx < $this->size && $yy >= 0 && $yy < $this->size) {
                    $dist = max(abs($dx), abs($dy));
                    $this->setFunction($xx, $yy, $dist !== 2 && $dist !== 4);
                }
            }
        }
    }

    private function alignmentPositions(): array
    {
        if ($this->version === 1) {
            return [];
        }
        $numAlign = intdiv($this->version, 7) + 2;
        $step = intdiv($this->version * 8 + $numAlign * 3 + 5, $numAlign * 4 - 4) * 2;
        $result = [6];
        for ($pos = $this->size - 7; count($result) < $numAlign; $pos -= $step) {
            array_splice($result, 1, 0, [$pos]);
        }
        return $result;
    }

    private function drawFormatBits(int $mask): void
    {
        $data = (self::FORMAT_BITS[$this->ecl] << 3) | $mask;
        $rem = $data;
        for ($i = 0; $i < 10; $i++) {
            $rem = ($rem << 1) ^ (($rem >> 9) * 0x537);
        }
        $bits = (($data << 10) | $rem) ^ 0x5412;
        $bit = static fn (int $i): bool => (($bits >> $i) & 1) !== 0;

        for ($i = 0; $i <= 5; $i++) {
            $this->setFunction(8, $i, $bit($i));
        }
        $this->setFunction(8, 7, $bit(6));
        $this->setFunction(8, 8, $bit(7));
        $this->setFunction(7, 8, $bit(8));
        for ($i = 9; $i < 15; $i++) {
            $this->setFunction(14 - $i, 8, $bit($i));
        }
        for ($i = 0; $i < 8; $i++) {
            $this->setFunction($this->size - 1 - $i, 8, $bit($i));
        }
        for ($i = 8; $i < 15; $i++) {
            $this->setFunction(8, $this->size - 15 + $i, $bit($i));
        }
        $this->setFunction(8, $this->size - 8, true); // dark module
    }

    private function drawVersion(): void
    {
        if ($this->version < 7) {
            return;
        }
        $rem = $this->version;
        for ($i = 0; $i < 12; $i++) {
            $rem = ($rem << 1) ^ (($rem >> 11) * 0x1F25);
        }
        $bits = ($this->version << 12) | $rem;
        for ($i = 0; $i < 18; $i++) {
            $dark = (($bits >> $i) & 1) !== 0;
            $a = $this->size - 11 + $i % 3;
            $b = intdiv($i, 3);
            $this->setFunction($a, $b, $dark);
            $this->setFunction($b, $a, $dark);
        }
    }

    // ---------- error correction ----------

    private static function gfMul(int $x, int $y): int
    {
        $z = 0;
        for ($i = 7; $i >= 0; $i--) {
            $z = (($z << 1) ^ (($z >> 7) * 0x11D)) & 0xFF;
            $z ^= (($y >> $i) & 1) * $x;
        }
        return $z;
    }

    private static function rsDivisor(int $degree): array
    {
        $result = array_fill(0, $degree, 0);
        $result[$degree - 1] = 1;
        $root = 1;
        for ($i = 0; $i < $degree; $i++) {
            for ($j = 0; $j < $degree; $j++) {
                $result[$j] = self::gfMul($result[$j], $root);
                if ($j + 1 < $degree) {
                    $result[$j] ^= $result[$j + 1];
                }
            }
            $root = self::gfMul($root, 0x02);
        }
        return $result;
    }

    private static function rsRemainder(array $data, array $divisor): array
    {
        $result = array_fill(0, count($divisor), 0);
        foreach ($data as $b) {
            $factor = $b ^ array_shift($result);
            $result[] = 0;
            foreach ($divisor as $i => $coef) {
                $result[$i] ^= self::gfMul($coef, $factor);
            }
        }
        return $result;
    }

    private function addEccAndInterleave(array $data): array
    {
        $numBlocks = self::NUM_ERROR_CORRECTION_BLOCKS[$this->ecl][$this->version];
        $eccLen = self::ECC_CODEWORDS_PER_BLOCK[$this->ecl][$this->version];
        $rawCodewords = intdiv(self::numRawDataModules($this->version), 8);
        $numShort = $numBlocks - $rawCodewords % $numBlocks;
        $shortLen = intdiv($rawCodewords, $numBlocks);

        $divisor = self::rsDivisor($eccLen);
        $blocks = [];
        $k = 0;
        for ($i = 0; $i < $numBlocks; $i++) {
            $datLen = $shortLen - $eccLen + ($i < $numShort ? 0 : 1);
            $dat = array_slice($data, $k, $datLen);
            $k += $datLen;
            $ecc = self::rsRemainder($dat, $divisor);
            if ($i < $numShort) {
                $dat[] = 0; // placeholder, skipped below
            }
            $blocks[] = array_merge($dat, $ecc);
        }

        $result = [];
        $blockLen = count($blocks[0]);
        for ($i = 0; $i < $blockLen; $i++) {
            foreach ($blocks as $j => $block) {
                if ($i !== $shortLen - $eccLen || $j >= $numShort) {
                    $result[] = $block[$i];
                }
            }
        }
        return $result;
    }

    // ---------- data placement and masking ----------

    private function drawCodewords(array $data): void
    {
        $total = count($data) * 8;
        $i = 0;
        for ($right = $this->size - 1; $right >= 1; $right -= 2) {
            if ($right === 6) {
                $right = 5;
            }
            for ($vert = 0; $vert < $this->size; $vert++) {
                for ($j = 0; $j < 2; $j++) {
                    $x = $right - $j;
                    $upward = (($right + 1) & 2) === 0;
                    $y = $upward ? $this->size - 1 - $vert : $vert;
                    if (!$this->isFunction[$y][$x] && $i < $total) {
                        $this->modules[$y][$x] = (($data[$i >> 3] >> (7 - ($i & 7))) & 1) !== 0;
                        $i++;
                    }
                }
            }
        }
    }

    private function applyMask(int $mask): void
    {
        for ($y = 0; $y < $this->size; $y++) {
            for ($x = 0; $x < $this->size; $x++) {
                if ($this->isFunction[$y][$x]) {
                    continue;
                }
                switch ($mask) {
                    case 0: $inv = ($x + $y) % 2 === 0; break;
                    case 1: $inv = $y % 2 === 0; break;
                    case 2: $inv = $x % 3 === 0; break;
                    case 3: $inv = ($x + $y) % 3 === 0; break;
                    case 4: $inv = (intdiv($x, 3) + intdiv($y, 2)) % 2 === 0; break;
                    case 5: $inv = $x * $y % 2 + $x * $y % 3 === 0; break;
                    case 6: $inv = ($x * $y % 2 + $x * $y % 3) % 2 === 0; break;
                    default: $inv = (($x + $y) % 2 + $x * $y % 3) % 2 === 0; break;
                }
                if ($inv) {
                    $this->modules[$y][$x] = !$this->modules[$y][$x];
                }
            }
        }
    }

    private function penalty(): int
    {
        $n = $this->size;
        $m = $this->modules;
        $score = 0;
        $dark = 0;
        $patA = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
        $patB = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];

        for ($pass = 0; $pass < 2; $pass++) {
            for ($a = 0; $a < $n; $a++) {
                $line = [];
                for ($b = 0; $b < $n; $b++) {
                    $line[] = $pass === 0 ? ($m[$a][$b] ? 1 : 0) : ($m[$b][$a] ? 1 : 0);
                }
                // Rule 1: runs of 5+ same-colour modules.
                $run = 1;
                for ($b = 1; $b <= $n; $b++) {
                    if ($b < $n && $line[$b] === $line[$b - 1]) {
                        $run++;
                    } else {
                        if ($run >= 5) {
                            $score += 3 + ($run - 5);
                        }
                        $run = 1;
                    }
                }
                // Rule 3: finder-like 1:1:3:1:1 patterns with 4 light modules on one side.
                for ($b = 0; $b + 11 <= $n; $b++) {
                    $slice = array_slice($line, $b, 11);
                    if ($slice === $patA || $slice === $patB) {
                        $score += 40;
                    }
                }
            }
        }
        // Rule 2: 2x2 blocks of one colour.
        for ($y = 0; $y < $n - 1; $y++) {
            for ($x = 0; $x < $n - 1; $x++) {
                $c = $m[$y][$x];
                if ($c === $m[$y][$x + 1] && $c === $m[$y + 1][$x] && $c === $m[$y + 1][$x + 1]) {
                    $score += 3;
                }
            }
        }
        // Rule 4: balance of dark and light modules.
        foreach ($m as $row) {
            foreach ($row as $v) {
                if ($v) {
                    $dark++;
                }
            }
        }
        $total = $n * $n;
        $k = intdiv(abs($dark * 20 - $total * 10) + $total - 1, $total) - 1;
        return $score + max(0, $k) * 10;
    }
}

/** Matrix including the quiet zone, [y][x] booleans. */
function qr_matrix(string $data, string $ecl, int $border): array
{
    $qr = new QrMatrix($data, $ecl);
    $n = $qr->size + 2 * $border;
    $out = array_fill(0, $n, array_fill(0, $n, false));
    foreach ($qr->modules as $y => $row) {
        foreach ($row as $x => $v) {
            $out[$y + $border][$x + $border] = $v;
        }
    }
    return $out;
}

function qr_render_svg(string $data, int $size, string $ecl, int $border): string
{
    $m = qr_matrix($data, $ecl, $border);
    $n = count($m);
    $d = '';
    foreach ($m as $y => $row) {
        $x = 0;
        while ($x < $n) {
            if (!$row[$x]) {
                $x++;
                continue;
            }
            $start = $x;
            while ($x < $n && $row[$x]) {
                $x++;
            }
            $d .= 'M' . $start . ',' . $y . 'h' . ($x - $start) . 'v1h-' . ($x - $start) . 'z';
        }
    }
    return '<?xml version="1.0" encoding="UTF-8"?>' . "\n"
        . '<svg xmlns="http://www.w3.org/2000/svg" width="' . $size . '" height="' . $size
        . '" viewBox="0 0 ' . $n . ' ' . $n . '" shape-rendering="crispEdges">'
        . '<rect width="' . $n . '" height="' . $n . '" fill="#ffffff"/>'
        . '<path d="' . $d . '" fill="#000000"/></svg>' . "\n";
}

/** 1-bit grayscale PNG built with zlib only, nearest-neighbour scaled to $size. */
function qr_render_png(string $data, int $size, string $ecl, int $border): string
{
    $m = qr_matrix($data, $ecl, $border);
    $n = count($m);
    $colModule = [];
    for ($x = 0; $x < $size; $x++) {
        $colModule[$x] = intdiv($x * $n, $size);
    }
    $rowCache = [];
    $raw = '';
    $bytesPerRow = intdiv($size + 7, 8);
    for ($y = 0; $y < $size; $y++) {
        $my = intdiv($y * $n, $size);
        if (!isset($rowCache[$my])) {
            $bytes = array_fill(0, $bytesPerRow, 0);
            for ($x = 0; $x < $size; $x++) {
                if (!$m[$my][$colModule[$x]]) { // light pixel = bit 1
                    $bytes[$x >> 3] |= 0x80 >> ($x & 7);
                }
            }
            $rowCache[$my] = "\0" . pack('C*', ...$bytes);
        }
        $raw .= $rowCache[$my];
    }
    $chunk = static function (string $type, string $body): string {
        return pack('N', strlen($body)) . $type . $body . pack('N', crc32($type . $body));
    };
    return "\x89PNG\r\n\x1a\n"
        . $chunk('IHDR', pack('NNCCCCC', $size, $size, 1, 0, 0, 0, 0))
        . $chunk('IDAT', (string) gzcompress($raw, 9))
        . $chunk('IEND', '');
}
