// Pixel-level steganography: a message packed into the least significant bit of
// every colour channel, so the picture looks unchanged. Pure functions over
// ImageData-shaped objects ({data: Uint8ClampedArray}), so they run in a page
// and in node tests without a canvas.
(function () {
  const MAGIC = [0x43, 0x53, 0x47, 0x31]; // "CSG1"
  const HEADER = 12; // magic(4) + length(4) + crc32(4)

  const TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let value = i;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[i] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  // Alpha is left alone: some encoders treat it specially, and three channels
  // per pixel already hold a quarter of a kilobyte in a 32x32 image.
  function channels(image) {
    const total = image.data.length / 4;
    return Math.floor(total * 3);
  }

  function capacity(image) {
    return Math.max(0, Math.floor(channels(image) / 8) - HEADER);
  }

  function utf8(text) {
    return new TextEncoder().encode(text);
  }

  function pack(payload) {
    const crc = crc32(payload);
    const out = new Uint8Array(HEADER + payload.length);
    out.set(MAGIC, 0);
    new DataView(out.buffer).setUint32(4, payload.length, false);
    new DataView(out.buffer).setUint32(8, crc, false);
    out.set(payload, HEADER);
    return out;
  }

  function write(image, bytes) {
    let channel = 0;
    for (let index = 0; index < image.data.length; index += 1) {
      if (index % 4 === 3) continue; // skip alpha
      const byte = bytes[channel >> 3];
      const bit = (byte >> (7 - (channel & 7))) & 1;
      image.data[index] = (image.data[index] & 0xfe) | bit;
      channel += 1;
    }
  }

  function read(image, byteCount) {
    const out = new Uint8Array(byteCount);
    let channel = 0;
    for (let index = 0; index < image.data.length && channel < byteCount * 8; index += 1) {
      if (index % 4 === 3) continue;
      out[channel >> 3] |= (image.data[index] & 1) << (7 - (channel & 7));
      channel += 1;
    }
    return out;
  }

  // Mutates the image in place and reports what it wrote.
  function embed(image, text) {
    const payload = utf8(String(text));
    const room = capacity(image);
    if (!payload.length) return { ok: false, reason: "empty", capacity: room };
    if (payload.length > room) return { ok: false, reason: "too-long", capacity: room, bytes: payload.length };
    write(image, pack(payload));
    return { ok: true, bytes: payload.length, capacity: room };
  }

  function extract(image) {
    const room = capacity(image);
    if (room <= 0) return { ok: false, reason: "too-small", capacity: room };
    const header = read(image, HEADER);
    if (MAGIC.some((byte, i) => header[i] !== byte)) return { ok: false, reason: "no-message" };
    const view = new DataView(header.buffer);
    const length = view.getUint32(4, false);
    const crc = view.getUint32(8, false);
    if (!length || length > room) return { ok: false, reason: "corrupt" };
    const payload = read(image, HEADER + length).slice(HEADER);
    if (crc32(payload) !== crc) return { ok: false, reason: "corrupt" };
    try {
      return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(payload), bytes: length };
    } catch {
      return { ok: false, reason: "corrupt" };
    }
  }

  globalThis.Stego = { capacity, embed, extract, crc32, HEADER };
})();
