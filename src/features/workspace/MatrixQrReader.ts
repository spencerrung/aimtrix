import { BrowserQRCodeReader } from '@zxing/browser';
import { ChecksumException, DecodeHintType, FormatException, NotFoundException, QRCodeReader,
  type BinaryBitmap, type Result } from '@zxing/library';

export class MatrixQrReader extends BrowserQRCodeReader {
  private readonly direct = new QRCodeReader();
  private readonly directHints = new Map([[DecodeHintType.PURE_BARCODE, true]]);

  override decodeBitmap(bitmap: BinaryBitmap): Result {
    try { return super.decodeBitmap(bitmap); }
    catch (error) {
      if (!(error instanceof NotFoundException || error instanceof ChecksumException || error instanceof FormatException)) throw error;
      // Dense byte-mode codes can confuse the finder/alignment detector even in
      // a clean, front-facing image. ZXing's direct sampling path still checks
      // QR format/error correction and returns the original byte segments. The
      // Matrix SDK remains responsible for request/key/secret validation.
      try { return this.direct.decode(bitmap, this.directHints); }
      catch { throw error; }
    }
  }
}
