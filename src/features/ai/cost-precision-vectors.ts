/**
 * O1-E → O1-F COST PRECISION VECTORS.
 *
 * The exact values O1-E emits, for the storage owner (O1-F) to prove
 * round-trip preservation against. Shared vectors asserted on both sides, the
 * same pattern as `scripts/normalization-vectors.mjs`.
 *
 * THIS FILE CHOOSES NO DATABASE TYPE. O1-F owns the column type. The contract
 * it must meet:
 *
 *   Every cost O1-E emits is an INTEGER number of picodollars (10^-12 USD).
 *   Token rates are integer micros per 1,000,000 tokens, audio rates integer
 *   micros per second, provider-reported totals integer micros — so no path
 *   produces a fraction of a picodollar.
 *
 *   L0 event cost (`estimated_cost_usd_micros` and the per-meter amounts):
 *     exact decimal, SCALE 6, integer part at most 18 digits.
 *   E→F `estimated_cost_minor`: exact decimal, SCALE 10. NULL = unknown.
 *
 *   A stored value must read back as exactly the emitted value, and a SUM
 *   over stored values must equal the exact sum. Any type that rounds,
 *   truncates or floats a value here fails the contract — the first vector
 *   below is the one a scale-6 minor column would silently turn into zero.
 */

export interface CostPrecisionVector {
  label: string;
  /** The internal amount, as an exact decimal integer string of picodollars. */
  picousd: string | null;
  /** L0 representation (USD micros, scale 6). */
  micros: string | null;
  /** E→F representation (USD minor units, scale 10). */
  minor: string | null;
}

export const COST_PRECISION_VECTORS: readonly CostPrecisionVector[] = Object.freeze([
  {
    label: "smallest positive cost: 1 token at 1 µ$ per million",
    picousd: "1",
    micros: "0.000001",
    minor: "0.0000000001",
  },
  {
    label: "O1-E-R3 example, uncached input: 800 tokens at 250,000 µ$/M",
    picousd: "200000000",
    micros: "200.000000",
    minor: "0.0200000000",
  },
  {
    label: "O1-E-R3 example, cached input: 200 tokens at 25,000 µ$/M",
    picousd: "5000000",
    micros: "5.000000",
    minor: "0.0005000000",
  },
  {
    label: "O1-E-R3 example, output: 38 tokens at 2,500,000 µ$/M",
    picousd: "95000000",
    micros: "95.000000",
    minor: "0.0095000000",
  },
  {
    label: "O1-E-R3 example, total: 300 µ$ = 0.03 cents (not 0, not 1)",
    picousd: "300000000",
    micros: "300.000000",
    minor: "0.0300000000",
  },
  {
    label: "voice: 2,000 ms at 77 µ$ per second",
    picousd: "154000000",
    micros: "154.000000",
    minor: "0.0154000000",
  },
  {
    label: "exactly one cent",
    picousd: "10000000000",
    micros: "10000.000000",
    minor: "1.0000000000",
  },
  {
    label: "authoritative known zero",
    picousd: "0",
    micros: "0.000000",
    minor: "0.0000000000",
  },
  {
    label: "largest L0 amount the event validator admits",
    picousd: "999999999999999999999999",
    micros: "999999999999999999.999999",
    minor: "99999999999999.9999999999",
  },
  {
    label: "unknown — must stay NULL, never 0",
    picousd: null,
    micros: null,
    minor: null,
  },
]);
