/* Read the first sheet of an .xlsx, .xls, or CSV file into rows of text. */
function readU16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function findZipEnd(bytes) {
  const start = Math.max(0, bytes.length - 22 - 65536);
  for (let i = bytes.length - 22; i >= start; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return i;
  }
  return -1;
}

async function inflateRaw(data) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("เบราว์เซอร์นี้เปิดไฟล์ Excel ไม่ได้ ลองบันทึกเป็น CSV");
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(bytes) {
  const end = findZipEnd(bytes);
  if (end < 0) throw new Error("ไฟล์นี้ไม่ใช่ Excel (.xlsx)");
  const count = readU16(bytes, end + 10);
  let offset = readU32(bytes, end + 16);
  const files = {};
  const decoder = new TextDecoder("utf-8");
  for (let i = 0; i < count; i++) {
    if (readU32(bytes, offset) !== 0x02014b50) throw new Error("โครงสร้างไฟล์ Excel ไม่ถูกต้อง");
    const flags = readU16(bytes, offset + 8);
    const method = readU16(bytes, offset + 10);
    const compressedSize = readU32(bytes, offset + 20);
    const nameLength = readU16(bytes, offset + 28);
    const extraLength = readU16(bytes, offset + 30);
    const commentLength = readU16(bytes, offset + 32);
    const localOffset = readU32(bytes, offset + 42);
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const name = decoder.decode(nameBytes).replace(/\\/g, "/");
    offset += 46 + nameLength + extraLength + commentLength;
    if (!name || name.endsWith("/")) continue;
    if (compressedSize === 0) {
      files[name] = new Uint8Array();
      continue;
    }
    if (compressedSize === 0xffffffff) throw new Error("ไฟล์ใหญ่เกินกว่าที่ระบบจะอ่านได้");
    if (flags & 1) throw new Error("ไฟล์ Excel นี้มีรหัสผ่าน");
    const localNameLength = readU16(bytes, localOffset + 26);
    const localExtraLength = readU16(bytes, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) files[name] = compressed;
    else if (method === 8) files[name] = await inflateRaw(compressed);
    else throw new Error("ไฟล์ Excel ใช้การบีบอัดที่ระบบยังไม่รองรับ");
  }
  return files;
}

function xmlText(bytes) {
  return bytes ? new TextDecoder("utf-8").decode(bytes) : "";
}

function decodeXml(value) {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, num) => String.fromCodePoint(parseInt(num, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function columnIndex(ref) {
  const letters = String(ref || "").replace(/\d+/g, "");
  let number = 0;
  for (let i = 0; i < letters.length; i++) number = number * 26 + (letters.charCodeAt(i) - 64);
  return Math.max(0, number - 1);
}

function readSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  const items = xml.split(/<(?:[\w]+:)?si\b/);
  items.slice(1).forEach((block) => {
    const body = block.split(/<\/(?:[\w]+:)?si>/)[0];
    const texts = [];
    const pattern = /<(?:[\w]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w]+:)?t>/g;
    let match;
    while ((match = pattern.exec(body))) texts.push(decodeXml(match[1]));
    strings.push(texts.join(""));
  });
  return strings;
}

function cellValue(body, type, shared) {
  if (type === "inlineStr") {
    const texts = [];
    const pattern = /<(?:[\w]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w]+:)?t>/g;
    let match;
    while ((match = pattern.exec(body))) texts.push(decodeXml(match[1]));
    return texts.join("");
  }
  const raw = (body.match(/<(?:[\w]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w]+:)?v>/) || [])[1] || "";
  if (type === "s") return shared[Number(raw)] || "";
  return decodeXml(raw);
}

function parseSheetXml(xml, shared) {
  const rows = [];
  const rowPattern = /<(?:[\w]+:)?row\b[^>]*>([\s\S]*?)<\/(?:[\w]+:)?row>/g;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(xml))) {
    const cells = [];
    const cellPattern = /<(?:[\w]+:)?c\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:[\w]+:)?c>)/g;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowMatch[1]))) {
      const attrs = cellMatch[1];
      const ref = (attrs.match(/\br="([A-Z]+)\d+"/i) || [])[1] || "";
      const type = (attrs.match(/\bt="([^"]+)"/) || [])[1] || "";
      cells[columnIndex(ref)] = cellValue(cellMatch[2] || "", type, shared);
    }
    if (cells.some((cell) => String(cell || "").trim())) {
      const line = [];
      for (let i = 0; i < cells.length; i++) line.push(cells[i] == null ? "" : String(cells[i]));
      rows.push(line);
    }
  }
  return rows;
}

function sheetPath(files) {
  const rels = xmlText(files["xl/_rels/workbook.xml.rels"]);
  const workbook = xmlText(files["xl/workbook.xml"]);
  const sheet = workbook.match(/<(?:[\w]+:)?sheet\b[^>]*\br:id="([^"]+)"/);
  if (rels && sheet) {
    const id = sheet[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rel =
      rels.match(new RegExp('Id="' + id + '"[^>]*Target="([^"]+)"')) ||
      rels.match(new RegExp('Target="([^"]+)"[^>]*Id="' + id + '"'));
    if (rel) {
      let target = decodeXml(rel[1]);
      if (target.charAt(0) === "/") return target.slice(1);
      if (target.indexOf("xl/") !== 0) target = "xl/" + target.replace(/^\.\//, "");
      return target;
    }
  }
  return Object.keys(files).find((name) => /xl\/worksheets\/sheet\d+\.xml$/.test(name)) || "";
}

function parseXlsxFiles(files) {
  const path = sheetPath(files);
  const sheet = files[path];
  if (!sheet) throw new Error("ไม่พบตารางในไฟล์ Excel");
  const shared = readSharedStrings(xmlText(files["xl/sharedStrings.xml"]));
  return parseSheetXml(xmlText(sheet), shared);
}

function parseSpreadsheetMl(xml) {
  const rows = [];
  const rowPattern = /<(?:[\w]+:)?Row\b[^>]*>([\s\S]*?)<\/(?:[\w]+:)?Row>/g;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(xml))) {
    const cells = [];
    let column = 0;
    const cellPattern = /<(?:[\w]+:)?Cell\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:[\w]+:)?Cell>)/g;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowMatch[1]))) {
      const index = (cellMatch[1].match(/\b(?:ss:)?Index="(\d+)"/) || [])[1];
      if (index) column = Number(index) - 1;
      const data = (cellMatch[2] || "").match(/<(?:[\w]+:)?Data\b[^>]*>([\s\S]*?)<\/(?:[\w]+:)?Data>/);
      cells[column] = data ? decodeXml(data[1]) : "";
      column += 1;
    }
    if (cells.some((cell) => String(cell || "").trim())) {
      const line = [];
      for (let i = 0; i < cells.length; i++) line.push(cells[i] == null ? "" : String(cells[i]));
      rows.push(line);
    }
  }
  return rows;
}

function decodeCsvBytes(bytes) {
  let offset = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) offset = 3;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset));
  } catch (err) {
    try {
      return new TextDecoder("windows-874").decode(bytes);
    } catch (fallback) {
      return new TextDecoder("utf-8").decode(bytes.subarray(offset));
    }
  }
}

function parseDelimited(text) {
  const source = String(text).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const first = source.split("\n")[0] || "";
  const commas = (first.match(/,/g) || []).length;
  const semis = (first.match(/;/g) || []).length;
  const tabs = (first.match(/\t/g) || []).length;
  const delimiter = semis > commas && semis >= tabs ? ";" : tabs > commas ? "\t" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((line) => line.some((value) => String(value).trim()));
}

function isOleFile(bytes) {
  return bytes.length > 512 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

function concatViews(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

function readSectorChain(bytes, fat, sectorSize, start, byteLength) {
  const chunks = [];
  let sector = start;
  let got = 0;
  let guard = 0;
  while (sector < 0xfffffff0 && got < byteLength && guard < 100000) {
    const offset = (sector + 1) * sectorSize;
    const take = Math.min(sectorSize, byteLength - got);
    chunks.push(bytes.subarray(offset, offset + take));
    got += take;
    sector = fat[sector];
    guard += 1;
  }
  return concatViews(chunks);
}

function readMiniChain(miniStream, miniFat, miniSize, start, byteLength) {
  const chunks = [];
  let sector = start;
  let got = 0;
  let guard = 0;
  while (sector < 0xfffffff0 && got < byteLength && guard < 100000) {
    const offset = sector * miniSize;
    const take = Math.min(miniSize, byteLength - got);
    chunks.push(miniStream.subarray(offset, offset + take));
    got += take;
    sector = miniFat[sector];
    guard += 1;
  }
  return concatViews(chunks);
}

function readOleStream(bytes, streamName) {
  const sectorShift = readU16(bytes, 0x1e);
  const miniShift = readU16(bytes, 0x20);
  const sectorSize = 1 << sectorShift;
  const miniSize = 1 << miniShift;
  const fatCount = readU32(bytes, 0x2c);
  const firstDir = readU32(bytes, 0x30);
  const cutoff = readU32(bytes, 0x38) || 4096;
  const fatSectors = [];
  for (let i = 0; i < 109 && fatSectors.length < fatCount; i++) {
    const id = readU32(bytes, 0x4c + i * 4);
    if (id === 0xffffffff) break;
    fatSectors.push(id);
  }
  let difat = readU32(bytes, 0x44);
  let guard = 0;
  while (difat < 0xfffffff0 && fatSectors.length < fatCount && guard < 10000) {
    const offset = (difat + 1) * sectorSize;
    const entries = sectorSize / 4 - 1;
    for (let i = 0; i < entries && fatSectors.length < fatCount; i++) fatSectors.push(readU32(bytes, offset + i * 4));
    difat = readU32(bytes, offset + entries * 4);
    guard += 1;
  }
  const fat = [];
  fatSectors.forEach((sector) => {
    const offset = (sector + 1) * sectorSize;
    for (let i = 0; i < sectorSize / 4; i++) fat.push(readU32(bytes, offset + i * 4));
  });
  const dirBytes = readSectorChain(bytes, fat, sectorSize, firstDir, 1e7);
  const entries = [];
  for (let offset = 0; offset + 128 <= dirBytes.length; offset += 128) {
    const entry = dirBytes.subarray(offset, offset + 128);
    const type = entry[66];
    if (!type) continue;
    const nameBytes = readU16(entry, 64);
    const chars = nameBytes >= 2 ? nameBytes / 2 - 1 : 0;
    const name = new TextDecoder("utf-16le").decode(entry.subarray(0, chars * 2));
    entries.push({ name, type, start: readU32(entry, 116), size: readU32(entry, 120) });
  }
  const book = entries.find((entry) => entry.type === 2 && /^(workbook|book)$/i.test(entry.name));
  if (!book) throw new Error("ไม่พบตารางในไฟล์ .xls");
  if (book.size < cutoff) {
    const root = entries.find((entry) => entry.type === 5);
    const miniStream = root && root.size ? readSectorChain(bytes, fat, sectorSize, root.start, root.size) : new Uint8Array();
    const miniFat = [];
    let sector = readU32(bytes, 0x3c);
    const miniFatCount = readU32(bytes, 0x40);
    for (let n = 0; n < miniFatCount && sector < 0xfffffff0; n++) {
      const offset = (sector + 1) * sectorSize;
      for (let i = 0; i < sectorSize / 4; i++) miniFat.push(readU32(bytes, offset + i * 4));
      sector = fat[sector];
    }
    return readMiniChain(miniStream, miniFat, miniSize, book.start, book.size);
  }
  return readSectorChain(bytes, fat, sectorSize, book.start, book.size);
}

function decodeCodepage(data, codepage) {
  const label = codepage === 874 ? "windows-874" : codepage === 65001 ? "utf-8" : codepage === 1200 ? "utf-16le" : "windows-1252";
  try {
    return new TextDecoder(label).decode(data);
  } catch (err) {
    return new TextDecoder("windows-874").decode(data);
  }
}

function XlsCursor(parts) {
  this.parts = parts.filter((part) => part && part.length);
  this.part = 0;
  this.offset = 0;
}

XlsCursor.prototype.available = function () {
  if (this.part >= this.parts.length) return 0;
  return this.parts[this.part].length - this.offset;
};

XlsCursor.prototype.nextPart = function () {
  this.part += 1;
  this.offset = 0;
};

XlsCursor.prototype.readBytes = function (count) {
  const out = new Uint8Array(count);
  let filled = 0;
  while (filled < count) {
    if (this.part >= this.parts.length) throw new Error("ไฟล์ .xls ไม่สมบูรณ์");
    const avail = this.available();
    if (!avail) {
      this.nextPart();
      continue;
    }
    const take = Math.min(avail, count - filled);
    out.set(this.parts[this.part].subarray(this.offset, this.offset + take), filled);
    this.offset += take;
    filled += take;
  }
  return out;
};

XlsCursor.prototype.readU16 = function () {
  const data = this.readBytes(2);
  return data[0] | (data[1] << 8);
};

XlsCursor.prototype.readU32 = function () {
  const data = this.readBytes(4);
  return (data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24)) >>> 0;
};

XlsCursor.prototype.readChars = function (count, flags, codepage) {
  let unicode = (flags & 1) === 1;
  let left = count;
  let text = "";
  while (left > 0) {
    const width = unicode ? 2 : 1;
    const can = Math.floor(this.available() / width);
    if (!can) {
      this.nextPart();
      if (this.part >= this.parts.length) throw new Error("ไฟล์ .xls ไม่สมบูรณ์");
      unicode = (this.parts[this.part][this.offset] & 1) === 1;
      this.offset += 1;
      continue;
    }
    const take = Math.min(left, can);
    const raw = this.parts[this.part].subarray(this.offset, this.offset + take * width);
    text += unicode ? new TextDecoder("utf-16le").decode(raw) : decodeCodepage(raw, codepage);
    this.offset += take * width;
    left -= take;
  }
  return text;
};

function parseSharedStrings(record, codepage) {
  const cursor = new XlsCursor([record.data, ...record.continues]);
  cursor.readU32();
  const unique = cursor.readU32();
  const strings = [];
  for (let i = 0; i < unique; i++) {
    const count = cursor.readU16();
    const flags = cursor.readBytes(1)[0];
    let runs = 0;
    let extra = 0;
    if (flags & 8) runs = cursor.readU16();
    if (flags & 4) extra = cursor.readU32();
    strings.push(cursor.readChars(count, flags, codepage));
    if (runs) cursor.readBytes(runs * 4);
    if (extra) cursor.readBytes(extra);
  }
  return strings;
}

function decodeRk(rk) {
  const value = rk >>> 0;
  let number;
  if (value & 2) number = (value | 0) >> 2;
  else {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setUint32(4, (value & 0xfffffffc) >>> 0, true);
    number = view.getFloat64(0, true);
  }
  if (value & 1) number /= 100;
  return number;
}

function numberText(value) {
  if (!isFinite(value)) return "";
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 1e-6) return String(rounded);
  return String(value);
}

function readPlainString(record, start, codepage) {
  const cursor = new XlsCursor([record.data.subarray(start), ...record.continues]);
  const count = cursor.readU16();
  const flags = cursor.readBytes(1)[0];
  return cursor.readChars(count, flags, codepage);
}

function formulaText(data) {
  if (data.length < 14) return "";
  if (data[12] === 0xff && data[13] === 0xff) {
    if (data[6] === 0) return null;
    if (data[6] === 1) return data[8] ? "TRUE" : "FALSE";
    return "";
  }
  const view = new DataView(data.buffer, data.byteOffset + 6, 8);
  return numberText(view.getFloat64(0, true));
}

function biffRecords(bytes) {
  const records = [];
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const type = readU16(bytes, offset);
    const length = readU16(bytes, offset + 2);
    const data = bytes.subarray(offset + 4, offset + 4 + length);
    offset += 4 + length;
    if (type === 0x003c && records.length) records[records.length - 1].continues.push(data);
    else records.push({ type, data, continues: [] });
    if (type === 0 && length === 0) break;
  }
  return records;
}

function parseBiffWorkbook(bytes) {
  const records = biffRecords(bytes);
  let phase = "start";
  let codepage = 874;
  let shared = [];
  const table = [];
  let pending = null;

  function put(row, col, text) {
    if (row > 20000 || col > 64) return;
    if (!table[row]) table[row] = [];
    table[row][col] = text == null ? "" : String(text);
  }

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (pending && record.type !== 0x0207) pending = null;
    if (record.type === 0x0809) {
      const kind = readU16(record.data, 2);
      if (kind === 0x0010) phase = "sheet";
      else if (phase === "sheet") break;
      continue;
    }
    if (phase !== "sheet" && record.type === 0x0042 && record.data.length >= 2) {
      codepage = readU16(record.data, 0);
      continue;
    }
    if (phase !== "sheet" && record.type === 0x00fc) {
      shared = parseSharedStrings(record, codepage);
      continue;
    }
    if (phase !== "sheet") continue;
    if (record.type === 0x000a) break;
    if (record.type === 0x00fd && record.data.length >= 10) {
      const index = readU32(record.data, 6);
      put(readU16(record.data, 0), readU16(record.data, 2), shared[index] || "");
    } else if (record.type === 0x0204) {
      put(readU16(record.data, 0), readU16(record.data, 2), readPlainString(record, 6, codepage));
    } else if (record.type === 0x0203 && record.data.length >= 14) {
      const view = new DataView(record.data.buffer, record.data.byteOffset + 6, 8);
      put(readU16(record.data, 0), readU16(record.data, 2), numberText(view.getFloat64(0, true)));
    } else if (record.type === 0x027e && record.data.length >= 10) {
      put(readU16(record.data, 0), readU16(record.data, 2), numberText(decodeRk(readU32(record.data, 6))));
    } else if (record.type === 0x00bd && record.data.length >= 6) {
      const row = readU16(record.data, 0);
      let col = readU16(record.data, 2);
      const last = readU16(record.data, record.data.length - 2);
      let offset = 4;
      while (col <= last && offset + 6 <= record.data.length - 2) {
        put(row, col, numberText(decodeRk(readU32(record.data, offset + 2))));
        col += 1;
        offset += 6;
      }
    } else if (record.type === 0x0006) {
      const text = formulaText(record.data);
      if (text === null) pending = { row: readU16(record.data, 0), col: readU16(record.data, 2) };
      else put(readU16(record.data, 0), readU16(record.data, 2), text);
    } else if (record.type === 0x0207 && pending) {
      put(pending.row, pending.col, readPlainString(record, 0, codepage));
      pending = null;
    }
  }

  const rows = [];
  for (let row = 0; row < table.length; row++) {
    const line = table[row];
    if (!line || !line.some((cell) => String(cell || "").trim())) continue;
    const out = [];
    for (let col = 0; col < line.length; col++) out.push(line[col] == null ? "" : String(line[col]));
    rows.push(out);
  }
  if (!rows.length) throw new Error("ไม่พบข้อมูลในไฟล์ .xls");
  return rows;
}

function readXls(bytes) {
  return parseBiffWorkbook(readOleStream(bytes, "Workbook"));
}

async function readTable(buffer, filename) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const name = String(filename || "").toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) return parseDelimited(decodeCsvBytes(bytes));
  const preview = new TextDecoder("utf-8").decode(bytes.subarray(0, 120)).trim();
  if (preview.charAt(0) === "<") {
    const xml = new TextDecoder("utf-8").decode(bytes);
    if (/<(?:[\w]+:)?Workbook\b/.test(xml) || /<(?:[\w]+:)?Row\b/.test(xml)) return parseSpreadsheetMl(xml);
  }
  if (isOleFile(bytes)) return readXls(bytes);
  if (name.endsWith(".xls") && !name.endsWith(".xlsx")) throw new Error("อ่านไฟล์ .xls ไม่ได้ ลองบันทึกเป็น .xlsx");
  return parseXlsxFiles(await unzip(bytes));
}

globalThis.readTable = readTable;
