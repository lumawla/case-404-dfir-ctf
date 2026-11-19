/**
 * Small, dependency-free EXIF reader for the File Inspector.
 * Reads the APP1 "Exif" segment of a JPEG and returns ASCII/SHORT/LONG/RATIONAL tags from IFD0 and the Exif sub-IFD.
 * It parses the real bytes of the evidence file — nothing is simulated.
 */

const TAG_NAMES: Record<number, string> = {
  0x010e: "ImageDescription",
  0x010f: "Make",
  0x0110: "Model",
  0x0112: "Orientation",
  0x0131: "Software",
  0x0132: "DateTime",
  0x013b: "Artist",
  0x8298: "Copyright",
  0x8769: "ExifIFDPointer",
  0x9003: "DateTimeOriginal",
  0x9004: "DateTimeDigitized",
  0x9010: "OffsetTime",
  0x9011: "OffsetTimeOriginal",
  0x9012: "OffsetTimeDigitized",
  0x829a: "ExposureTime",
  0x829d: "FNumber",
  0x8827: "ISOSpeedRatings",
  0x920a: "FocalLength",
  0xa002: "PixelXDimension",
  0xa003: "PixelYDimension",
  0xa434: "LensModel",
  0xa431: "BodySerialNumber",
};

export type ExifTags = Record<string, string>;

export function readExif(bytes: Uint8Array): ExifTags | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) return null; // start of scan / end of image
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker === 0xe1 && length >= 8) {
      const start = offset + 4;
      const header = String.fromCharCode(...bytes.subarray(start, start + 6));
      if (header === "Exif\0\0") return parseTiff(bytes.subarray(start + 6, offset + 2 + length));
    }
    offset += 2 + length;
  }
  return null;
}

function parseTiff(tiff: Uint8Array): ExifTags | null {
  if (tiff.length < 8) return null;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const u16 = (o: number) => view.getUint16(o, little);
  const u32 = (o: number) => view.getUint32(o, little);
  if (u16(2) !== 42) return null;
  const out: ExifTags = {};

  const readIfd = (ifdOffset: number, depth: number) => {
    if (depth > 2 || ifdOffset + 2 > tiff.length) return;
    const count = u16(ifdOffset);
    for (let e = 0; e < count; e++) {
      const entry = ifdOffset + 2 + e * 12;
      if (entry + 12 > tiff.length) return;
      const tag = u16(entry);
      const type = u16(entry + 2);
      const n = u32(entry + 4);
      const valueOffset = entry + 8;
      const name = TAG_NAMES[tag];
      if (tag === 0x8769) {
        readIfd(u32(valueOffset), depth + 1);
        continue;
      }
      if (!name) continue;
      const size = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 } as Record<number, number>)[type] ?? 0;
      if (!size) continue;
      const dataOffset = size * n > 4 ? u32(valueOffset) : valueOffset;
      if (dataOffset + size * n > tiff.length) continue;
      if (type === 2) {
        let s = "";
        for (let c = 0; c < n; c++) {
          const code = tiff[dataOffset + c];
          if (code === 0) break;
          s += String.fromCharCode(code);
        }
        out[name] = s.trim();
      } else if (type === 3) out[name] = String(u16(dataOffset));
      else if (type === 4) out[name] = String(u32(dataOffset));
      else if (type === 5) {
        const num = u32(dataOffset);
        const den = u32(dataOffset + 4) || 1;
        if (num % den === 0) out[name] = String(num / den);
        else out[name] = name === "ExposureTime" ? `${num}/${den}` : String(Number((num / den).toFixed(3)));
      }
    }
  };
  readIfd(u32(4), 0);
  return out;
}
