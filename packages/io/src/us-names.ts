// Ultrasound region code tables (PS3.3 C.8.5.5.1), apart from us.ts so a
// UI can label a region without bundling the dataset reader. Dependency-free.

/** Region Data Type (0018,6014): the tissue/flow/spectral set. */
export function regionDataTypeName(t: number | null): string {
  switch (t) {
    case 0: return 'None';
    case 1: return 'Tissue';
    case 2: return 'Color Flow';
    case 3: return 'PW Spectral Doppler';
    case 4: return 'CW Spectral Doppler';
    default: return t == null ? 'Unknown' : `type-${t}`;
  }
}

/** Region Spatial Format (0018,6012). */
export function regionSpatialFormatName(f: number | null): string {
  switch (f) {
    case 0: return 'None';
    case 1: return '2D';
    case 2: return 'M-Mode';
    case 3: return 'Spectral';
    case 4: return 'Waveform';
    default: return f == null ? 'Unknown' : `format-${f}`;
  }
}

/** Physical Units X/Y Direction (0018,6024/6026) table. */
export function physicalUnitsName(u: number | null): string {
  switch (u) {
    case 0: return 'px';
    case 1: return 'percent';
    case 2: return 'dB';
    case 3: return 'cm';
    case 4: return 'seconds';
    case 5: return 'hertz';
    case 6: return 'dB/seconds';
    case 7: return 'cm/sec';
    case 8: return 'cm²';
    case 9: return 'cm²/s';
    case 0x0c: return 'degrees';
    default: return u == null ? 'unknown' : `unit-${u}`;
  }
}
