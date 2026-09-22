// Ported from Papaya src/js/viewer/colortable.js (238 lines, MIT).
// Faithful TS port: knot tables, updateLUT lerp, lookupRed/Green/Blue.
// Skipped: ARROW_ICON/ICON_SIZE/COLOR_BAR_* canvas icon painting.

export type LutKnot = [number, number, number, number]; // [pos 0..1, r, g, b]

export interface LutDef {
  name: string;
  data: LutKnot[];
  gradation?: boolean;
}

export const TABLE_GRAYSCALE: LutDef = {
  name: 'Grayscale',
  data: [[0, 0, 0, 0], [1, 1, 1, 1]],
  gradation: true,
};
export const TABLE_SPECTRUM: LutDef = {
  name: 'Spectrum',
  data: [[0, 0, 0, 0], [0.1, 0, 0, 1], [0.33, 0, 1, 1], [0.5, 0, 1, 0],
    [0.66, 1, 1, 0], [0.9, 1, 0, 0], [1, 1, 1, 1]],
  gradation: true,
};
export const TABLE_RED2YELLOW: LutDef = {
  name: 'Overlay (Positives)', data: [[0, 1, 0, 0], [1, 1, 1, 0]], gradation: true,
};
export const TABLE_BLUE2GREEN: LutDef = {
  name: 'Overlay (Negatives)', data: [[0, 0, 0, 1], [1, 0, 1, 0]], gradation: true,
};
export const TABLE_HOTANDCOLD: LutDef = {
  name: 'Hot-and-Cold',
  data: [[0, 0, 0, 1], [0.15, 0, 1, 1], [0.3, 0, 1, 0], [0.45, 0, 0, 0],
    [0.5, 0, 0, 0], [0.55, 0, 0, 0], [0.7, 1, 1, 0], [0.85, 1, 0, 0], [1, 1, 1, 1]],
  gradation: true,
};
export const TABLE_GOLD: LutDef = {
  name: 'Gold',
  data: [[0, 0, 0, 0], [0.13, 0.19, 0.03, 0], [0.25, 0.39, 0.12, 0],
    [0.38, 0.59, 0.26, 0], [0.5, 0.8, 0.46, 0.08], [0.63, 0.99, 0.71, 0.21],
    [0.75, 0.99, 0.88, 0.34], [0.88, 0.99, 0.99, 0.48], [1, 0.9, 0.95, 0.61]],
  gradation: true,
};
export const TABLE_RED2WHITE: LutDef = {
  name: 'Red Overlay',
  data: [[0, 0.75, 0, 0], [0.5, 1, 0.5, 0], [0.95, 1, 1, 0], [1, 1, 1, 1]],
  gradation: true,
};
export const TABLE_GREEN2WHITE: LutDef = {
  name: 'Green Overlay',
  data: [[0, 0, 0.75, 0], [0.5, 0.5, 1, 0], [0.95, 1, 1, 0], [1, 1, 1, 1]],
  gradation: true,
};
export const TABLE_BLUE2WHITE: LutDef = {
  name: 'Blue Overlay',
  data: [[0, 0, 0, 1], [0.5, 0, 0.5, 1], [0.95, 0, 1, 1], [1, 1, 1, 1]],
  gradation: true,
};
export const TABLE_DTI_SPECTRUM: LutDef = {
  name: 'Spectrum', data: [[0, 1, 0, 0], [0.5, 0, 1, 0], [1, 0, 0, 1]], gradation: true,
};
export const TABLE_FIRE: LutDef = {
  name: 'Fire',
  data: [[0, 0, 0, 0], [0.06, 0, 0, 0.36], [0.16, 0.29, 0, 0.75],
    [0.22, 0.48, 0, 0.89], [0.31, 0.68, 0, 0.6], [0.37, 0.76, 0, 0.36],
    [0.5, 0.94, 0.31, 0], [0.56, 1, 0.45, 0], [0.81, 1, 0.91, 0],
    [0.88, 1, 1, 0.38], [1, 1, 1, 1]],
  gradation: true,
};
export const TABLE_INVERT: LutDef = {
  name: 'Inverted', data: [[0, 1, 1, 1], [1, 0, 0, 0]], gradation: true,
};

export const PARAMETRIC_COLOR_TABLES = [TABLE_RED2YELLOW, TABLE_BLUE2GREEN];
export const OVERLAY_COLOR_TABLES = [TABLE_RED2WHITE, TABLE_GREEN2WHITE, TABLE_BLUE2WHITE];

export const TABLE_ALL: LutDef[] = [
  TABLE_GRAYSCALE, TABLE_SPECTRUM, TABLE_FIRE, TABLE_HOTANDCOLD, TABLE_GOLD,
  TABLE_RED2YELLOW, TABLE_BLUE2GREEN, TABLE_RED2WHITE, TABLE_GREEN2WHITE,
  TABLE_BLUE2WHITE, TABLE_INVERT,
];

export const LUT_MIN = 0;
export const LUT_MAX = 255;

export function findLUT(name: string): LutDef {
  for (const t of TABLE_ALL) {
    // Papaya compares loosely here; both operands are typed `string`, so
    // `===` is the same comparison without the lint exception.
    if (t.name === name) return t;
  }
  return TABLE_GRAYSCALE;
}

export class ColorTable {
  lutData: LutKnot[];
  minLUT = LUT_MIN;
  maxLUT = LUT_MAX;
  knotThresholds: number[] = [];
  knotRangeRatios: number[] = [];
  LUTarrayR = new Array<number>(256).fill(0);
  LUTarrayG = new Array<number>(256).fill(0);
  LUTarrayB = new Array<number>(256).fill(0);
  isBaseImage: boolean;
  knotMin: LutKnot;
  knotMax: LutKnot;
  useGradation: boolean;

  constructor(lutName: string, baseImage: boolean, custom?: LutDef) {
    const lut = custom ?? findLUT(lutName);
    this.lutData = lut.data;
    this.isBaseImage = baseImage;
    this.knotMin = this.lutData[0];
    this.knotMax = this.lutData[this.lutData.length - 1];
    this.useGradation = lut.gradation === undefined ? true : lut.gradation;
    this.updateLUT(LUT_MIN, LUT_MAX);
  }

  updateLUT(minLUTnew: number, maxLUTnew: number): void {
    this.maxLUT = maxLUTnew;
    this.minLUT = minLUTnew;
    const range = this.maxLUT - this.minLUT;
    for (let ctr = 0; ctr < this.lutData.length; ctr++) {
      this.knotThresholds[ctr] = this.lutData[ctr][0] * range + this.minLUT;
    }
    for (let ctr = 0; ctr < this.lutData.length - 1; ctr++) {
      this.knotRangeRatios[ctr] =
        LUT_MAX / (this.knotThresholds[ctr + 1] - this.knotThresholds[ctr]);
    }
    for (let ctr = 0; ctr < 256; ctr++) {
      if (ctr <= this.minLUT) {
        this.LUTarrayR[ctr] = this.knotMin[1] * LUT_MAX;
        this.LUTarrayG[ctr] = this.knotMin[2] * LUT_MAX;
        this.LUTarrayB[ctr] = this.knotMin[3] * LUT_MAX;
      } else if (ctr > this.maxLUT) {
        this.LUTarrayR[ctr] = this.knotMax[1] * LUT_MAX;
        this.LUTarrayG[ctr] = this.knotMax[2] * LUT_MAX;
        this.LUTarrayB[ctr] = this.knotMax[3] * LUT_MAX;
      } else {
        for (let k = 0; k < this.lutData.length - 1; k++) {
          if (ctr > this.knotThresholds[k] && ctr <= this.knotThresholds[k + 1]) {
            if (this.useGradation) {
              const value =
                ((ctr - this.knotThresholds[k]) * this.knotRangeRatios[k] + 0.5) / LUT_MAX;
              this.LUTarrayR[ctr] =
                ((1 - value) * this.lutData[k][1] + value * this.lutData[k + 1][1]) * LUT_MAX;
              this.LUTarrayG[ctr] =
                ((1 - value) * this.lutData[k][2] + value * this.lutData[k + 1][2]) * LUT_MAX;
              this.LUTarrayB[ctr] =
                ((1 - value) * this.lutData[k][3] + value * this.lutData[k + 1][3]) * LUT_MAX;
            } else {
              this.LUTarrayR[ctr] = this.lutData[k][1] * LUT_MAX;
              this.LUTarrayG[ctr] = this.lutData[k][2] * LUT_MAX;
              this.LUTarrayB[ctr] = this.lutData[k][3] * LUT_MAX;
            }
          }
        }
      }
    }
  }

  lookupRed(index: number): number {
    if (index >= 0 && index < 256) return this.LUTarrayR[index] & 0xff;
    return 0;
  }
  lookupGreen(index: number): number {
    if (index >= 0 && index < 256) return this.LUTarrayG[index] & 0xff;
    return 0;
  }
  lookupBlue(index: number): number {
    if (index >= 0 && index < 256) return this.LUTarrayB[index] & 0xff;
    return 0;
  }
}
