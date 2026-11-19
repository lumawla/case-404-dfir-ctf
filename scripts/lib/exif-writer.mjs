// Minimal big-endian EXIF (TIFF) writer used to embed real metadata in the evidence JPEGs.

const TYPES = { ascii: 2, short: 3, long: 4, rational: 5 };

function valueBytes(entry) {
  const { type, value } = entry;
  if (type === "ascii") return Buffer.from(`${value}\0`, "latin1");
  if (type === "short") {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(value);
    return b;
  }
  if (type === "long") {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(value);
    return b;
  }
  if (type === "rational") {
    const b = Buffer.alloc(8);
    b.writeUInt32BE(value[0]);
    b.writeUInt32BE(value[1], 4);
    return b;
  }
  throw new Error(`Unsupported EXIF type ${type}`);
}

function ifdSize(entries) {
  let data = 0;
  for (const e of entries) {
    const len = valueBytes(e).length;
    if (len > 4) data += len + (len % 2);
  }
  return 2 + entries.length * 12 + 4 + data;
}

function writeIfd(buf, offset, entries) {
  const sorted = [...entries].sort((a, b) => a.tag - b.tag);
  buf.writeUInt16BE(sorted.length, offset);
  let dataOffset = offset + 2 + sorted.length * 12 + 4;
  sorted.forEach((e, i) => {
    const p = offset + 2 + i * 12;
    const bytes = valueBytes(e);
    const count = e.type === "ascii" ? bytes.length : e.type === "rational" ? 1 : 1;
    buf.writeUInt16BE(e.tag, p);
    buf.writeUInt16BE(TYPES[e.type], p + 2);
    buf.writeUInt32BE(count, p + 4);
    if (bytes.length <= 4) bytes.copy(buf, p + 8);
    else {
      buf.writeUInt32BE(dataOffset, p + 8);
      bytes.copy(buf, dataOffset);
      dataOffset += bytes.length + (bytes.length % 2);
    }
  });
  buf.writeUInt32BE(0, offset + 2 + sorted.length * 12);
}

/** Builds a complete APP1 segment (marker included) from IFD0 and Exif sub-IFD entries. */
export function buildExifApp1(ifd0, exif) {
  const ifd0Entries = [...ifd0, { tag: 0x8769, type: "long", value: 0 }];
  const ifd0Bytes = ifdSize(ifd0Entries);
  const exifOffset = 8 + ifd0Bytes;
  ifd0Entries[ifd0Entries.length - 1].value = exifOffset;
  const tiffLength = exifOffset + ifdSize(exif);
  const tiff = Buffer.alloc(tiffLength);
  tiff.write("MM", 0, "latin1");
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  writeIfd(tiff, 8, ifd0Entries);
  writeIfd(tiff, exifOffset, exif);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0xffe1, 0);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

/** Inserts an APP1 segment after SOI (and after APP0/JFIF when present). */
export function insertApp1(jpeg, app1) {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("Not a JPEG");
  let at = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + jpeg.readUInt16BE(4);
  return Buffer.concat([jpeg.subarray(0, at), app1, jpeg.subarray(at)]);
}

export const ascii = (tag, value) => ({ tag, type: "ascii", value });
export const short = (tag, value) => ({ tag, type: "short", value });
export const long = (tag, value) => ({ tag, type: "long", value });
export const rational = (tag, num, den) => ({ tag, type: "rational", value: [num, den] });
