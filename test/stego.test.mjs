import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

vm.runInThisContext(readFileSync(new URL("../shared/stego.js", import.meta.url), "utf8"));
const { capacity, embed, extract, crc32 } = globalThis.Stego;

function picture(width, height, seed = 7) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 1) data[i] = (i * seed) % 256;
  return { data, width, height };
}

test("capacity leaves room for the header", () => {
  // 64x64 pixels, three colour channels each, one bit per channel.
  assert.equal(capacity(picture(64, 64)), Math.floor((64 * 64 * 3) / 8) - 12);
});

test("a message survives a round trip", () => {
  const image = picture(96, 96);
  const hidden = embed(image, "Meet me at the second bench, 8pm.");
  assert.equal(hidden.ok, true);
  assert.equal(hidden.bytes, 33);

  const found = extract(image);
  assert.equal(found.ok, true);
  assert.equal(found.text, "Meet me at the second bench, 8pm.");
});

test("unicode comes back unchanged", () => {
  const image = picture(64, 64);
  const text = "kunci ada di pot bunga — 明日 08:00 🌿";
  embed(image, text);
  assert.equal(extract(image).text, text);
});

test("the picture is left visually intact", () => {
  const before = picture(64, 64);
  const after = picture(64, 64);
  embed(after, "quiet");
  for (let i = 0; i < after.data.length; i += 1) {
    assert.ok(Math.abs(after.data[i] - before.data[i]) <= 1, `channel ${i} moved too far`);
    if (i % 4 === 3) assert.equal(after.data[i], before.data[i], "alpha must not change");
  }
});

test("a picture without a message says so", () => {
  assert.deepEqual(extract(picture(64, 64)), { ok: false, reason: "no-message" });
});

test("damage in the payload is reported, not guessed", () => {
  const image = picture(64, 64);
  embed(image, "the bridge is out");
  image.data[200] ^= 1; // flip one bit of hidden data
  assert.equal(extract(image).reason, "corrupt");
});

test("a message longer than the picture is refused", () => {
  const image = picture(32, 32);
  const result = embed(image, "x".repeat(capacity(image) + 1));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "too-long");
  assert.equal(extract(image).reason, "no-message");
});

test("empty messages are refused", () => {
  assert.equal(embed(picture(64, 64), "   ").ok, true); // whitespace is still a message
  assert.equal(embed(picture(64, 64), "").reason, "empty");
});

test("crc32 matches the reference value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});
