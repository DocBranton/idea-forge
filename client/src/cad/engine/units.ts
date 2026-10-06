// Length, area, volume and mass formatting in the display unit.
export type DisplayUnit = "in" | "mm";

const MM_PER: Record<DisplayUnit, number> = { in: 25.4, mm: 1 };

export class Units {
  constructor(
    public display: DisplayUnit = "in",
    /** Millimetres per model unit for the open model. */
    public mmPerUnit = 1,
  ) {}

  toDisplay(v: number, power = 1): number {
    const f = this.mmPerUnit / MM_PER[this.display];
    return v * Math.pow(f, power);
  }

  digits(): number {
    return this.display === "in" ? 3 : 2;
  }

  len(v: number, withUnit = true): string {
    const s = roundHalfUp(this.toDisplay(v), this.digits()).toFixed(this.digits());
    return withUnit ? `${s} ${this.display}` : s;
  }

  dia(r: number, withUnit = true): string {
    return `Ø${this.len(2 * r, withUnit)}`;
  }

  area(v: number): string {
    return `${num(this.toDisplay(v, 2), this.display === "in" ? 3 : 1)} ${this.display}²`;
  }

  vol(v: number): string {
    return `${num(this.toDisplay(v, 3), this.display === "in" ? 3 : 1)} ${this.display}³`;
  }

  /** Grams, from a volume in model units and a density in g/cm³. */
  massGrams(volModel: number, density: number): number {
    const mm3 = volModel * Math.pow(this.mmPerUnit, 3);
    return (mm3 / 1000) * density;
  }

  mass(g: number): string {
    if (this.display === "in") return `${num(g / 453.59237, 3)} lb`;
    return g >= 1000 ? `${num(g / 1000, 3)} kg` : `${num(g, 1)} g`;
  }
}

/**
 * Round half away from zero. Plain toFixed rounds 9.525 down to 9.52 because the
 * binary value is 9.52499…; a drawing must show the same size the same way every time.
 */
export function roundHalfUp(x: number, digits: number): number {
  const f = 10 ** digits;
  return (Math.sign(x) * Math.round(Math.abs(x) * f + 1e-7)) / f;
}

export function num(n: number, digits = 2): string {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
