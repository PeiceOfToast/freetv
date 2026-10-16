// A small QR code encoder: byte mode, error correction level M, versions 1 to 10 (up to 213 bytes).
// encodeQr returns the module grid (true = dark, no quiet zone) or null when the text does not fit.
// The layout follows ISO/IEC 18004 and the structure of the common reference implementations.

const MAX_VERSION = 10;

// Per version (index = version - 1), error correction level M:
// [EC codewords per block, group-1 block count, group-1 data codewords, group-2 block count, group-2 data codewords]
const BLOCKS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [10, 1, 16, 0, 0],
  [16, 1, 28, 0, 0],
  [26, 1, 44, 0, 0],
  [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0],
  [18, 4, 31, 0, 0],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
];

// Alignment pattern centres per version.
const ALIGN: ReadonlyArray<readonly number[]> = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

// GF(256) log/antilog tables for the QR field polynomial 0x11d.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

/** Reed-Solomon generator polynomial of degree n, leading coefficient first. */
function rsGenerator(n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= gfMul(g[j], EXP[i]);
    }
    g = next;
  }
  return g;
}

/** Error-correction codewords for one block: the remainder of data * x^n divided by the generator. */
function rsRemainder(data: number[], n: number): number[] {
  const gen = rsGenerator(n);
  const rem = new Array<number>(n).fill(0);
  for (const d of data) {
    const factor = d ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < n; i++) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
}

/** Byte-mode data codewords, terminator and pad bytes, filling the version's data capacity. */
function dataCodewords(bytes: Uint8Array, version: number): number[] {
  const [, g1n, g1d, g2n, g2d] = BLOCKS[version - 1];
  const capacity = g1n * g1d + g2n * g2d;
  const bits: number[] = [];
  const push = (value: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let k = 0; k < 8; k++) v = (v << 1) | bits[i + k];
    out.push(v);
  }
  for (let pad = 0; out.length < capacity; pad++) out.push(pad % 2 ? 0x11 : 0xec);
  return out;
}

/** Splits the data into blocks, adds error correction, and interleaves the codewords. */
function interleave(data: number[], version: number): number[] {
  const [ecLen, g1n, g1d, g2n, g2d] = BLOCKS[version - 1];
  const blocks: number[][] = [];
  let pos = 0;
  for (let i = 0; i < g1n + g2n; i++) {
    const len = i < g1n ? g1d : g2d;
    blocks.push(data.slice(pos, pos + len));
    pos += len;
  }
  const ecc = blocks.map((b) => rsRemainder(b, ecLen));
  const out: number[] = [];
  const maxData = Math.max(g1d, g2d);
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ecLen; i++) for (const e of ecc) out.push(e[i]);
  return out;
}

/** Format information: EC level M (bits 00), mask, BCH(15,5) and XOR 0x5412. */
function formatBits(mask: number): number {
  const data = mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** Version information (versions 7+): version, then BCH(18,6). */
function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0;
  }
}

/** Penalty score from the four rules in the standard: runs, 2x2 blocks, finder-like patterns, balance. */
function penalty(m: Uint8Array, size: number): number {
  let total = 0;
  const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let horiz = 0; horiz < 2; horiz++) {
    for (let a = 0; a < size; a++) {
      const at = (b: number) => (horiz ? m[a * size + b] : m[b * size + a]);
      let run = 1;
      for (let b = 1; b < size; b++) {
        if (at(b) === at(b - 1)) {
          run++;
          if (run === 5) total += 3;
          else if (run > 5) total += 1;
        } else {
          run = 1;
        }
      }
      for (let b = 0; b + 11 <= size; b++) {
        let m1 = true;
        let m2 = true;
        for (let k = 0; k < 11; k++) {
          const v = at(b + k);
          if (v !== P1[k]) m1 = false;
          if (v !== P2[k]) m2 = false;
          if (!m1 && !m2) break;
        }
        if (m1) total += 40;
        if (m2) total += 40;
      }
    }
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = m[y * size + x];
      if (c === m[y * size + x + 1] && c === m[(y + 1) * size + x] && c === m[(y + 1) * size + x + 1]) total += 3;
    }
  }
  let dark = 0;
  for (const v of m) dark += v;
  total += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return total;
}

/** Draws the finder, separator, timing, alignment and version patterns. Marks them in `fixed`. */
function drawFunctionPatterns(version: number, size: number, m: Uint8Array, fixed: Uint8Array): void {
  const set = (x: number, y: number, dark: boolean) => {
    m[y * size + x] = dark ? 1 : 0;
    fixed[y * size + x] = 1;
  };
  const finder = (cx: number, cy: number) => {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const inside = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        set(x, y, inside && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4)));
      }
    }
  };
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);

  for (let i = 8; i <= size - 9; i++) {
    set(i, 6, i % 2 === 0);
    set(6, i, i % 2 === 0);
  }

  const centres = ALIGN[version - 1];
  for (const cy of centres) {
    for (const cx of centres) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  // Format areas are reserved here and filled per mask later.
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      set(8, i, false);
      set(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, false);
  for (let i = 0; i < 7; i++) set(8, size - 7 + i, false);
  set(8, size - 8, true); // the always-dark module

  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit);
      set(b, a, bit);
    }
  }
}

function drawFormat(m: Uint8Array, size: number, mask: number): void {
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  const put = (x: number, y: number, dark: boolean) => {
    m[y * size + x] = dark ? 1 : 0;
  };
  for (let i = 0; i <= 5; i++) put(8, i, bit(i));
  put(8, 7, bit(6));
  put(8, 8, bit(7));
  put(7, 8, bit(8));
  for (let i = 9; i < 15; i++) put(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) put(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) put(8, size - 15 + i, bit(i));
}

function placeData(data: number[], size: number, m: Uint8Array, fixed: Uint8Array): void {
  let i = 0;
  const total = data.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fixed[y * size + x] && i < total) {
          m[y * size + x] = (data[i >>> 3] >>> (7 - (i & 7))) & 1;
          i++;
        }
      }
    }
  }
}

/** Encodes text as a QR code. Returns rows of modules (true = dark), or null if the text is too long. */
export function encodeQr(text: string): boolean[][] | null {
  const bytes = new TextEncoder().encode(text);
  let version = 0;
  for (let v = 1; v <= MAX_VERSION; v++) {
    const [, g1n, g1d, g2n, g2d] = BLOCKS[v - 1];
    const countBits = v <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= (g1n * g1d + g2n * g2d) * 8) {
      version = v;
      break;
    }
  }
  if (!version) return null;

  const size = version * 4 + 17;
  const base = new Uint8Array(size * size);
  const fixed = new Uint8Array(size * size);
  drawFunctionPatterns(version, size, base, fixed);
  placeData(interleave(dataCodewords(bytes, version), version), size, base, fixed);

  let best: Uint8Array | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = Uint8Array.from(base);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!fixed[y * size + x] && maskBit(mask, x, y)) m[y * size + x] ^= 1;
      }
    }
    drawFormat(m, size, mask);
    const score = penalty(m, size);
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
  }
  const grid = best!;
  const rows: boolean[][] = [];
  for (let y = 0; y < size; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < size; x++) row.push(grid[y * size + x] === 1);
    rows.push(row);
  }
  return rows;
}

/** SVG path data for a module grid, one path with horizontal runs merged. Adds a quiet zone of `border` modules. */
export function qrPathData(grid: boolean[][], border = 4): string {
  let d = "";
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      let end = x;
      while (end < row.length && row[end]) end++;
      d += `M${x + border} ${y + border}h${end - x}v1h-${end - x}z`;
      x = end;
    }
  });
  return d;
}
