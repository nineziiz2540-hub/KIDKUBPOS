import { test } from "node:test";
import assert from "node:assert/strict";
import { logoWorkSize, logoTrimBox, logoOutputSize, logoPath } from "./logo-image.ts";

function image(w: number, h: number, px: [number, number, number, number]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set(px, i * 4);
  return d;
}
function block(d: Uint8ClampedArray, w: number, x: number, y: number, bw: number, bh: number, px: [number, number, number, number]) {
  for (let j = y; j < y + bh; j++) for (let i = x; i < x + bw; i++) d.set(px, (j * w + i) * 4);
}

test("logoWorkSize scales down to 2000 and never up", () => {
  assert.deepEqual(logoWorkSize(4334, 4334), { width: 2000, height: 2000 });
  assert.deepEqual(logoWorkSize(500, 300), { width: 500, height: 300 });
});

test("logoOutputSize caps the longer side at 800, never upscales", () => {
  assert.deepEqual(logoOutputSize(2000, 1000), { width: 800, height: 400 });
  assert.deepEqual(logoOutputSize(300, 200), { width: 300, height: 200 });
});

test("white margins are trimmed", () => {
  const d = image(10, 10, [255, 255, 255, 255]);
  block(d, 10, 4, 3, 2, 3, [0, 0, 0, 255]);
  assert.deepEqual(logoTrimBox(d, 10, 10), { x: 4, y: 3, width: 2, height: 3 });
});

test("transparent margins are trimmed", () => {
  const d = image(10, 10, [0, 0, 0, 0]);
  block(d, 10, 4, 3, 2, 3, [10, 20, 30, 255]);
  assert.deepEqual(logoTrimBox(d, 10, 10), { x: 4, y: 3, width: 2, height: 3 });
});

test("padding is 2% of the longer side, clamped to the image", () => {
  const d = image(1000, 500, [255, 255, 255, 255]);
  block(d, 1000, 0, 100, 300, 50, [0, 0, 0, 255]);
  // pad = 20; left clamps to 0, right 320, top 80, bottom 170
  assert.deepEqual(logoTrimBox(d, 1000, 500), { x: 0, y: 80, width: 320, height: 90 });
});

test("a solid coloured background is kept whole", () => {
  const d = image(10, 10, [0, 0, 0, 255]);
  assert.deepEqual(logoTrimBox(d, 10, 10), { x: 0, y: 0, width: 10, height: 10 });
});

test("all white gives null", () => {
  assert.equal(logoTrimBox(image(10, 10, [255, 255, 255, 255]), 10, 10), null);
});

test("all transparent gives null", () => {
  assert.equal(logoTrimBox(image(10, 10, [0, 0, 0, 0]), 10, 10), null);
});

test("near-white (250,250,250) counts as empty", () => {
  assert.equal(logoTrimBox(image(10, 10, [250, 250, 250, 255]), 10, 10), null);
});

test("logoPath", () => {
  assert.equal(logoPath("t1", 5), "t1/logo-5.png");
});
