import { createHash } from 'node:crypto';
import { create } from 'qrcode';
import { BinaryBitmap, HybridBinarizer, NotFoundException, QRCodeReader, RGBLuminanceSource, ResultMetadataType } from '@zxing/library';
import { describe, expect, it } from 'vitest';
import { MatrixQrReader } from './MatrixQrReader';

function syntheticCode(seed: number, size = 560) {
  const bytes = new Uint8ClampedArray([77, 65, 84, 82, 73, 88, 2, 0,
    ...Buffer.concat(Array.from({ length: 4 }, (_, block) => createHash('sha256')
      .update(`Synthetic QR ${seed}:${block}`).digest())).subarray(0, 100)]);
  const qr = create([{ data: bytes, mode: 'byte' }], { errorCorrectionLevel: 'L' });
  // Element renders a 196px PNG; reproduce its module sampling and the
  // synthetic camera's nearest-neighbor scaling into a 640px video frame.
  const pixels = new Uint8ClampedArray(640 * 640).fill(255);
  const start = Math.floor((640 - size) / 2);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sourceX = Math.floor((x + 0.5) * 196 / size);
    const sourceY = Math.floor((y + 0.5) * 196 / size);
    const column = Math.floor(sourceX * (qr.modules.size + 8) / 196) - 4;
    const row = Math.floor(sourceY * (qr.modules.size + 8) / 196) - 4;
    if (row >= 0 && column >= 0 && row < qr.modules.size && column < qr.modules.size && qr.modules.get(row, column)) {
      pixels[(start + y) * 640 + start + x] = 0;
    }
  }
  return { bytes, bitmap: new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, 640, 640))) };
}

const decodedBytes = (result: ReturnType<MatrixQrReader['decodeBitmap']>) => {
  const segments = result.getResultMetadata().get(ResultMetadataType.BYTE_SEGMENTS) as Uint8Array[] | undefined;
  expect(segments).toHaveLength(1);
  return new Uint8ClampedArray(segments![0]);
};

describe('Matrix QR image decoding', () => {
  it.each([12, 18, 26, 28, 39, 53, 78, 80, 82])('decodes a clean binary code that confuses the normal detector (seed %s)', (seed) => {
    const { bytes, bitmap } = syntheticCode(seed);
    expect(() => new QRCodeReader().decode(bitmap)).toThrow();
    expect(decodedBytes(new MatrixQrReader().decodeBitmap(bitmap))).toEqual(bytes);
  });

  it.each([196, 392, 560])('preserves exact binary bytes at frame size %s', (size) => {
    const reader = new MatrixQrReader();
    for (let seed = 0; seed < 100; seed++) {
      const { bytes, bitmap } = syntheticCode(seed, size);
      expect(decodedBytes(reader.decodeBitmap(bitmap))).toEqual(bytes);
    }
  });

  it('keeps normal detector behavior for ordinary camera frames', () => {
    const { bytes, bitmap } = syntheticCode(0);
    expect(new QRCodeReader().decode(bitmap).getResultPoints().length).toBeGreaterThan(0);
    const result = new MatrixQrReader().decodeBitmap(bitmap);
    expect(result.getResultPoints().length).toBeGreaterThan(0);
    expect(decodedBytes(result)).toEqual(bytes);
  });

  it('rejects a frame without a valid code', () => {
    const white = new Uint8ClampedArray(640 * 640).fill(255);
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(white, 640, 640)));
    expect(() => new MatrixQrReader().decodeBitmap(bitmap)).toThrow(NotFoundException);
  });

  it('rejects a code whose data exceeds QR error correction', () => {
    const { bitmap } = syntheticCode(12);
    const matrix = bitmap.getBlackMatrix();
    for (let y = 200; y < 440; y++) for (let x = 200; x < 440; x++) matrix.flip(x, y);
    expect(() => new MatrixQrReader().decodeBitmap(bitmap)).toThrow();
  });
});
