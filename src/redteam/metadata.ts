/**
 * Container-level metadata inspection for exported images.
 *
 * Detects residual EXIF/GPS/XMP data in JPEG files and textual/eXIf
 * chunks in PNG files by parsing the container bytes directly — no
 * decoder required. Used by the red-team pass to verify that exported
 * redactions do not leak metadata from the source image.
 */

export interface MetadataCheck {
  hasExif: boolean;
  hasGps: boolean;
  hasXmp: boolean;
  /** Keyword names of textual PNG chunks (tEXt/zTXt/iTXt), deduplicated, first-seen order. */
  pngTextChunks: string[];
  /**
   * Bytes occupied by removable metadata segments/chunks that were found,
   * or null when the container format could not be recognized.
   */
  bytesStripped: number | null;
}

const EMPTY: MetadataCheck = {
  hasExif: false,
  hasGps: false,
  hasXmp: false,
  pngTextChunks: [],
  bytesStripped: null,
};

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const XMP_HEADER = "http://ns.adobe.com/xap/1.0/\x00";
const PNG_XMP_KEY = "xml:com.adobe.xmp";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, offset: number, sig: number[]): boolean {
  if (offset + sig.length > bytes.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  let s = "";
  for (let i = 0; i < length && offset + i < bytes.length; i++) {
    s += String.fromCharCode(bytes[offset + i]);
  }
  return s;
}

/**
 * Returns true when the TIFF payload at `offset` (big- or little-endian,
 * without the "Exif\0\0" header) contains a GPS Info IFD pointer
 * (tag 0x8825) in IFD0. Fails closed on malformed input.
 */
function tiffHasGpsIfd(bytes: Uint8Array, offset: number): boolean {
  if (offset + 8 > bytes.length) return false;
  const byteOrder = asciiAt(bytes, offset, 2);
  const little = byteOrder === "II";
  if (!little && byteOrder !== "MM") return false;
  const u16 = (p: number) =>
    little ? bytes[p] | (bytes[p + 1] << 8) : (bytes[p] << 8) | bytes[p + 1];
  const u32 = (p: number) =>
    little
      ? bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)
      : ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
  if (u16(offset + 2) !== 42) return false;
  const ifd0 = offset + u32(offset + 4);
  if (ifd0 + 2 > bytes.length) return false;
  const count = u16(ifd0);
  const entriesEnd = ifd0 + 2 + count * 12;
  if (entriesEnd > bytes.length || count > 512) return false;
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (u16(entry) === 0x8825) return true; // GPSInfo IFD pointer
  }
  return false;
}

function inspectJpeg(bytes: Uint8Array): MetadataCheck {
  const result: MetadataCheck = { ...EMPTY, pngTextChunks: [], bytesStripped: 0 };
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return { ...EMPTY };
  }
  let pos = 2;
  let metadataBytes = 0;
  // Standalone markers carry no length field.
  const isStandalone = (m: number) =>
    m === 0x01 || m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7);
  while (pos + 1 < bytes.length) {
    if (bytes[pos] !== 0xff) {
      pos += 1; // tolerate fill bytes between segments
      continue;
    }
    const marker = bytes[pos + 1];
    if (marker === 0xda) break; // SOS: scan data begins, metadata is over
    if (isStandalone(marker)) {
      pos += 2;
      continue;
    }
    if (pos + 4 > bytes.length) break;
    const segLen = (bytes[pos + 2] << 8) | bytes[pos + 3]; // includes its own 2 bytes
    if (segLen < 2) break;
    const payload = pos + 4;
    const payloadLen = Math.min(segLen - 2, bytes.length - payload);
    if (marker === 0xe1 && payloadLen > 0) {
      if (startsWith(bytes, payload, EXIF_HEADER)) {
        result.hasExif = true;
        if (tiffHasGpsIfd(bytes, payload + EXIF_HEADER.length)) result.hasGps = true;
        metadataBytes += segLen + 2;
      } else if (asciiAt(bytes, payload, XMP_HEADER.length) === XMP_HEADER) {
        result.hasXmp = true;
        metadataBytes += segLen + 2;
      }
    }
    pos += 2 + segLen;
  }
  result.bytesStripped = metadataBytes;
  return result;
}

function inspectPng(bytes: Uint8Array): MetadataCheck {
  const result: MetadataCheck = { ...EMPTY, pngTextChunks: [], bytesStripped: 0 };
  if (!startsWith(bytes, 0, PNG_SIGNATURE)) return { ...EMPTY };
  const keys = new Set<string>();
  let metadataBytes = 0;
  let pos = PNG_SIGNATURE.length;
  while (pos + 12 <= bytes.length) {
    const dataLen =
      ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0;
    const type = asciiAt(bytes, pos + 4, 4);
    const data = pos + 8;
    if (data + dataLen > bytes.length) break;
    if (type === "tEXt" || type === "zTXt" || type === "iTXt") {
      let end = data;
      while (end < data + dataLen && bytes[end] !== 0x00) end += 1;
      const key = asciiAt(bytes, data, end - data);
      if (key) keys.add(key);
      if (type === "iTXt" && key.toLowerCase() === PNG_XMP_KEY) result.hasXmp = true;
      metadataBytes += dataLen + 12; // length + type + data + CRC
    } else if (type === "eXIf") {
      result.hasExif = true;
      if (tiffHasGpsIfd(bytes, data)) result.hasGps = true; // eXIf payload is a bare TIFF
      metadataBytes += dataLen + 12;
    }
    pos = data + dataLen + 4; // skip CRC
  }
  result.pngTextChunks = [...keys];
  result.bytesStripped = metadataBytes;
  return result;
}

function looksJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

/**
 * Inspect encoded image bytes for residual metadata. `mime` is a hint;
 * magic bytes win when both are present and disagree.
 */
export function inspectMetadata(bytes: Uint8Array, mime: string): MetadataCheck {
  if (bytes.length === 0) return { ...EMPTY };
  const m = mime.toLowerCase();
  if (looksJpeg(bytes) || (m.includes("jpeg") && !startsWith(bytes, 0, PNG_SIGNATURE))) {
    return inspectJpeg(bytes);
  }
  if (startsWith(bytes, 0, PNG_SIGNATURE) || m.includes("png")) {
    return inspectPng(bytes);
  }
  return { ...EMPTY };
}
