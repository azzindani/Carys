// Compressed-frame decode for the pixel pipeline — RLE / JPEG Baseline /
// JPEG Lossless frame selection over the encapsulated fragments. Split out
// of dicom-parse.ts when the US color fold pushed it over the 700-line
// gate; the pixel contract is unchanged (same named errors, same order).
import {
  TS_JPEG_BASELINE_8, TS_JPEG_LOSSLESS_1, TS_JPEG_LS_LOSSLESS, TS_RLE,
} from './dicom-tags.js';
import { DicomParseError } from './dicom-parse.js';
import type { EncapFrames } from './dicom-encap.js';
import { concatFragments, groupJpegFrames } from './dicom-encap.js';
import { decodeRLEFrame } from './dicom-rle.js';
import { decodeJpegBaseline } from './jpeg-baseline.js';
import { decodeJpegLossless } from './jpeg-lossless.js';
import { decodeJpegLs } from './jpeg-ls.js';

export function isCompressedSyntax(ts: string): boolean {
  return ts === TS_RLE || ts === TS_JPEG_BASELINE_8 || ts === TS_JPEG_LOSSLESS_1 ||
    ts === TS_JPEG_LS_LOSSLESS;
}

/**
 * Decode frame `frameIndex` (of `frameCount`) to raw LE pixel bytes. RLE
 * frames slice via the basic offset table — or one-fragment-per-frame when
 * the BOT is empty (the common writer layout); JPEG frames group by SOI.
 * Codec errors surface as DicomParseError so every caller sees one type.
 */
export function decodeCompressed(
  encap: EncapFrames,
  ts: string,
  rows: number,
  cols: number,
  bitsAllocated: number,
  samples: number,
  photometric: string | null,
  frameCount: number,
  frameIndex: number,
): { bytes: Uint8Array; bits: number } {
  try {
    if (!isCompressedSyntax(ts)) {
      throw new DicomParseError('unsupported-transfer-syntax', ts);
    }
    if (ts === TS_RLE) {
      if (samples !== 1) {
        throw new DicomParseError('unsupported-pixel-layout', `RLE samplesPerPixel=${samples}`);
      }
      if (bitsAllocated !== 8 && bitsAllocated !== 16) {
        throw new DicomParseError('unsupported-pixel-layout', `RLE bitsAllocated=${bitsAllocated}`);
      }
      if (encap.fragments.length === 0) {
        throw new DicomParseError('rle-decode-error', 'no fragments after BOT');
      }
      let src: Uint8Array;
      if (encap.bot.length > 0) {
        const total = concatFragments(encap.fragments);
        const start = encap.bot[frameIndex];
        if (start === undefined) throw new DicomParseError('rle-decode-error', `BOT has no frame ${frameIndex}`);
        const end = encap.bot[frameIndex + 1] ?? total.length;
        if (start > end || end > total.length) {
          throw new DicomParseError('rle-decode-error', `BOT slice ${start}..${end}`);
        }
        src = total.subarray(start, end);
      } else if (frameCount === 1) {
        src = concatFragments(encap.fragments);
      } else {
        if (encap.fragments.length !== frameCount) {
          throw new DicomParseError(
            'rle-decode-error',
            `${encap.fragments.length} fragments for ${frameCount} frames without BOT`,
          );
        }
        src = encap.fragments[frameIndex]!;
      }
      return {
        bytes: decodeRLEFrame(src, rows * cols, bitsAllocated === 16 ? 2 : 1),
        bits: bitsAllocated,
      };
    }
    // JPEG-LS lossless: one SOF55 stream per frame (same SOI grouping as
    // the DCT paths — every CharLS stream starts FFD8, so grouping holds).
    if (ts === TS_JPEG_LS_LOSSLESS) {
      if (samples !== 1) {
        throw new DicomParseError('unsupported-pixel-layout', `JPEG-LS samplesPerPixel=${samples}`);
      }
      const frames = groupJpegFrames(encap.fragments);
      if (frames.length !== frameCount) {
        throw new DicomParseError('jpeg-decode-error', `${frames.length} JPEG-LS frames for ${frameCount} declared`);
      }
      let dec;
      try {
        dec = decodeJpegLs(frames[frameIndex]!);
      } catch (e) {
        throw new DicomParseError('jpeg-decode-error', (e as Error).message);
      }
      if (dec.width !== cols || dec.height !== rows) {
        throw new DicomParseError('jpeg-decode-error', `JPEG-LS ${dec.width}x${dec.height} vs declared ${cols}x${rows}`);
      }
      if (bitsAllocated !== dec.bits) {
        throw new DicomParseError('jpeg-unsupported', `JPEG-LS ${dec.bits}-bit in ${bitsAllocated}-bit container`);
      }
      if (photometric !== 'MONOCHROME1' && photometric !== 'MONOCHROME2' && photometric !== null) {
        throw new DicomParseError('jpeg-unsupported', `JPEG-LS photometric ${photometric}`);
      }
      return { bytes: dec.bytes, bits: dec.bits };
    }
    // JPEG Baseline 8-bit + JPEG Lossless SOF3 (fragment grouping is shared)
    const frames = groupJpegFrames(encap.fragments);
    if (frames.length !== frameCount) {
      throw new DicomParseError('jpeg-decode-error', `${frames.length} JPEG frames for ${frameCount} declared`);
    }
    if (ts === TS_JPEG_LOSSLESS_1) {
      if (samples !== 1) {
        throw new DicomParseError('unsupported-pixel-layout', `lossless samplesPerPixel=${samples}`);
      }
      const dec = decodeJpegLossless(frames[frameIndex]!);
      if (dec.width !== cols || dec.height !== rows) {
        throw new DicomParseError('jpeg-decode-error', `JPEG ${dec.width}x${dec.height} vs declared ${cols}x${rows}`);
      }
      if (bitsAllocated !== dec.bits) {
        throw new DicomParseError('jpeg-unsupported', `lossless ${dec.bits}-bit in ${bitsAllocated}-bit container`);
      }
      if (photometric !== 'MONOCHROME1' && photometric !== 'MONOCHROME2' && photometric !== null) {
        throw new DicomParseError('jpeg-unsupported', `lossless photometric ${photometric}`);
      }
      return { bytes: dec.bytes, bits: dec.bits };
    }
    if (samples !== 1 && samples !== 3) {
      throw new DicomParseError('unsupported-pixel-layout', `JPEG samplesPerPixel=${samples}`);
    }
    if (bitsAllocated !== 8) {
      throw new DicomParseError('jpeg-unsupported', `JPEG bitsAllocated=${bitsAllocated}`);
    }
    const dec = decodeJpegBaseline(frames[frameIndex]!);
    if (dec.width !== cols || dec.height !== rows) {
      throw new DicomParseError('jpeg-decode-error', `JPEG ${dec.width}x${dec.height} vs declared ${cols}x${rows}`);
    }
    if (dec.components === 3 && photometric !== 'YBR_FULL_422' && photometric !== 'RGB') {
      throw new DicomParseError('jpeg-unsupported', `3-component photometric ${photometric}`);
    }
    if (dec.components === 1 && photometric !== 'MONOCHROME1' && photometric !== 'MONOCHROME2' && photometric !== null) {
      throw new DicomParseError('jpeg-unsupported', `1-component photometric ${photometric}`);
    }
    if (dec.components !== 1 && dec.components !== 3) {
      throw new DicomParseError('jpeg-unsupported', `${dec.components} JPEG components`);
    }
    return { bytes: dec.gray, bits: 8 };
  } catch (e) {
    if (e instanceof DicomParseError) throw e;
    throw new DicomParseError(
      ts === TS_RLE ? 'rle-decode-error' : 'jpeg-decode-error',
      e instanceof Error ? e.message : String(e),
    );
  }
}
