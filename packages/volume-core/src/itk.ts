// Ported from ITK-Wasm interface-types (image.ts, image-type.ts, mesh.ts,
// binary-file.ts, pixel-types.ts). Verbatim shapes, no Wasm runtime.

export type PixelType = 'Scalar' | 'RGB' | 'RGBA' | 'Vector';
export type ComponentType =
  | 'uint8' | 'int8' | 'uint16' | 'int16'
  | 'uint32' | 'int32' | 'float32' | 'float64';

export interface ItkImageType {
  dimension: number;
  componentType: ComponentType;
  pixelType: PixelType;
  components: number;
}

export interface ItkImage {
  imageType: ItkImageType;
  origin: number[];
  spacing: number[];
  /** row-major direction matrix */
  direction: number[];
  size: number[];
  metadata: Map<string, string>;
  data: Uint8Array | Int16Array | Float32Array | null;
}

export interface BinaryFile {
  path: string;
  data: Uint8Array;
}

/** Pipeline I/O contract: args + desiredOutputs + inputs (--memory-io style). */
export interface PipelineInput {
  type: 'BinaryFile' | 'Image' | 'JsonCompatible' | 'TextFile';
  data: BinaryFile | ItkImage | unknown;
}

export interface PipelineOutput {
  type: 'Image' | 'JsonCompatible' | 'BinaryFile';
  data?: ItkImage | unknown;
}
