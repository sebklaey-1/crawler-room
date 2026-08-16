/**
 * Image sanitisation, entirely in pure JS (Workers-safe, no native codecs).
 *
 * - The real file signature is sniffed from the bytes; the declared MIME type
 *   is never trusted.
 * - All metadata containers (EXIF/GPS, XMP, ICC, comments, ancillary chunks)
 *   are removed by rebuilding the container from the pixel data only.
 * - Dimensions are parsed from the rebuilt bytes.
 */

export type ImageMime = "image/jpeg" | "image/png" | "image/webp";

export const ALLOWED_MIME: ImageMime[] = ["image/jpeg", "image/png", "image/webp"];

export interface SanitizedImage {
  bytes: Uint8Array;
  mime: ImageMime;
  width: number | null;
  height: number | null;
}

/* ------------------------------ signatures ------------------------------ */

export function sniffMime(bytes: Uint8Array): ImageMime | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length > 8 && png.every((byte, index) => bytes[index] === byte)) return "image/png";
  if (
    bytes.length > 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/* --------------------------------- JPEG --------------------------------- */

function stripJpeg(bytes: Uint8Array): SanitizedImage | null {
  const output: number[] = [0xff, 0xd8];
  let width: number | null = null;
  let height: number | null = null;
  let offset = 2;

  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    if (marker === 0xd8) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9) break;
    if (marker === 0xda) {
      // Start of scan: copy the rest verbatim (entropy-coded data).
      for (let i = offset; i < bytes.length; i += 1) output.push(bytes[i]!);
      offset = bytes.length;
      break;
    }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 2 || offset + 2 + length > bytes.length) return null;

    const isMetadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame && offset + 9 < bytes.length) {
      height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
    }
    if (!isMetadata) {
      for (let i = offset; i < offset + 2 + length; i += 1) output.push(bytes[i]!);
    }
    offset += 2 + length;
  }

  return { bytes: Uint8Array.from(output), mime: "image/jpeg", width, height };
}

/* ---------------------------------- PNG ---------------------------------- */

const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS"]);

function stripPng(bytes: Uint8Array): SanitizedImage | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const output: number[] = [];
  for (let i = 0; i < 8; i += 1) output.push(bytes[i]!);

  let width: number | null = null;
  let height: number | null = null;
  let offset = 8;

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    const total = 12 + length;
    if (offset + total > bytes.length) return null;

    if (type === "IHDR" && length >= 8) {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
    }
    if (PNG_KEEP.has(type)) {
      for (let i = offset; i < offset + total; i += 1) output.push(bytes[i]!);
    }
    offset += total;
    if (type === "IEND") break;
  }

  return { bytes: Uint8Array.from(output), mime: "image/png", width, height };
}

/* --------------------------------- WebP ---------------------------------- */

const WEBP_KEEP = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF"]);

function stripWebp(bytes: Uint8Array): SanitizedImage | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const payload: number[] = [0x57, 0x45, 0x42, 0x50]; // "WEBP"
  let width: number | null = null;
  let height: number | null = null;
  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const type = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    const padded = size + (size % 2);
    if (offset + 8 + padded > bytes.length) break;

    if (type === "VP8X" && size >= 10) {
      width =
        (view.getUint8(offset + 12) |
          (view.getUint8(offset + 13) << 8) |
          (view.getUint8(offset + 14) << 16)) +
        1;
      height =
        (view.getUint8(offset + 15) |
          (view.getUint8(offset + 16) << 8) |
          (view.getUint8(offset + 17) << 16)) +
        1;
    }
    if (type === "VP8 " && size >= 10 && width === null) {
      const base = offset + 8 + 6;
      width = view.getUint16(base, true) & 0x3fff;
      height = view.getUint16(base + 2, true) & 0x3fff;
    }
    if (type === "VP8L" && size >= 5 && width === null) {
      const b1 = view.getUint8(offset + 9);
      const b2 = view.getUint8(offset + 10);
      const b3 = view.getUint8(offset + 11);
      const b4 = view.getUint8(offset + 12);
      width = ((b1 | (b2 << 8)) & 0x3fff) + 1;
      height = (((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)) & 0x3fff) + 1;
    }

    if (WEBP_KEEP.has(type)) {
      for (let i = offset; i < offset + 8 + padded; i += 1) payload.push(bytes[i]!);
    }
    offset += 8 + padded;
  }

  const size = payload.length;
  const header = [
    0x52,
    0x49,
    0x46,
    0x46, // "RIFF"
    size & 0xff,
    (size >> 8) & 0xff,
    (size >> 16) & 0xff,
    (size >> 24) & 0xff,
  ];
  return { bytes: Uint8Array.from([...header, ...payload]), mime: "image/webp", width, height };
}

/**
 * Verifies the real signature and rebuilds the file without any metadata.
 * Returns null when the bytes are not a supported, well-formed image.
 */
export function sanitizeImage(bytes: Uint8Array): SanitizedImage | null {
  const mime = sniffMime(bytes);
  if (!mime) return null;
  try {
    if (mime === "image/jpeg") return stripJpeg(bytes);
    if (mime === "image/png") return stripPng(bytes);
    return stripWebp(bytes);
  } catch {
    return null;
  }
}
