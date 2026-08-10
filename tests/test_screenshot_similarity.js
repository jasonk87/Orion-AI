'use strict';

const test = require('tape');
const { compareBitmaps, DEFAULT_MAX_CHANGED_FRACTION } = require('../lib/screenshot-similarity');

function makeSolidBitmap(width, height, r, g, b, a = 255) {
  const buf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = a;
  }
  return buf;
}

function paintRect(bitmap, width, x0, y0, x1, y1, r, g, b) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * width + x) * 4;
      bitmap[offset] = r;
      bitmap[offset + 1] = g;
      bitmap[offset + 2] = b;
      bitmap[offset + 3] = 255;
    }
  }
  return bitmap;
}

test('compareBitmaps: identical solid images report unchanged with zero changed fraction', (t) => {
  const a = makeSolidBitmap(320, 240, 40, 40, 40);
  const b = makeSolidBitmap(320, 240, 40, 40, 40);
  const result = compareBitmaps(a, 320, 240, b, 320, 240);
  t.ok(result.comparable, 'comparable');
  t.ok(result.identical, 'identical');
  t.equal(result.changedFraction, 0, 'zero changed fraction');
  t.equal(result.reason, 'unchanged');
  t.end();
});

test('compareBitmaps: a large new region (dialog-sized) is detected as changed', (t) => {
  const width = 320;
  const height = 240;
  const a = makeSolidBitmap(width, height, 40, 40, 40);
  const b = makeSolidBitmap(width, height, 40, 40, 40);
  // Paint roughly a quarter of the frame a different color, simulating a new dialog appearing.
  paintRect(b, width, 40, 40, 200, 160, 255, 255, 255);
  const result = compareBitmaps(a, width, height, b, width, height);
  t.ok(result.comparable, 'comparable');
  t.notOk(result.identical, 'not identical — large region changed');
  t.ok(result.changedFraction > DEFAULT_MAX_CHANGED_FRACTION, 'changed fraction exceeds the conservative threshold');
  t.equal(result.reason, 'changed');
  t.end();
});

test('compareBitmaps: a single-pixel-scale change (cursor blink) stays under the conservative threshold', (t) => {
  const width = 320;
  const height = 240;
  const a = makeSolidBitmap(width, height, 40, 40, 40);
  const b = makeSolidBitmap(width, height, 40, 40, 40);
  // Flip a tiny 2x2 patch — smaller than a single comparison block — to simulate a blinking cursor.
  paintRect(b, width, 10, 10, 12, 12, 255, 255, 255);
  const result = compareBitmaps(a, width, height, b, width, height);
  t.ok(result.comparable, 'comparable');
  t.ok(result.identical, 'tiny localized change still rounds to unchanged');
  t.end();
});

test('compareBitmaps: dimension mismatch is never treated as unchanged', (t) => {
  const a = makeSolidBitmap(320, 240, 10, 10, 10);
  const b = makeSolidBitmap(640, 480, 10, 10, 10);
  const result = compareBitmaps(a, 320, 240, b, 640, 480);
  t.notOk(result.comparable, 'not comparable');
  t.notOk(result.identical, 'never identical on dimension mismatch');
  t.equal(result.changedFraction, 1, 'changed fraction forced to 1 (fail safe)');
  t.equal(result.reason, 'dimension_mismatch');
  t.end();
});

test('compareBitmaps: missing bitmaps fail safe to "not identical"', (t) => {
  const b = makeSolidBitmap(320, 240, 10, 10, 10);
  const result1 = compareBitmaps(null, 320, 240, b, 320, 240);
  t.notOk(result1.comparable, 'not comparable when A missing');
  t.notOk(result1.identical, 'not identical when A missing');

  const result2 = compareBitmaps(b, 320, 240, null, 320, 240);
  t.notOk(result2.comparable, 'not comparable when B missing');
  t.notOk(result2.identical, 'not identical when B missing');
  t.end();
});

test('compareBitmaps: truncated buffer fails safe rather than throwing', (t) => {
  const a = makeSolidBitmap(320, 240, 10, 10, 10);
  const truncated = a.subarray(0, 100);
  t.doesNotThrow(() => {
    const result = compareBitmaps(a, 320, 240, truncated, 320, 240);
    t.notOk(result.comparable, 'not comparable when truncated');
    t.notOk(result.identical, 'not identical when truncated');
  });
  t.end();
});

test('compareBitmaps: invalid (zero/negative) dimensions fail safe', (t) => {
  const a = makeSolidBitmap(1, 1, 10, 10, 10);
  const result = compareBitmaps(a, 0, 240, a, 0, 240);
  t.notOk(result.comparable, 'not comparable');
  t.notOk(result.identical, 'not identical');
  t.equal(result.reason, 'invalid_dimensions');
  t.end();
});

test('compareBitmaps: a full-frame color change is always detected regardless of stride', (t) => {
  const width = 800;
  const height = 600;
  const a = makeSolidBitmap(width, height, 20, 20, 20);
  const b = makeSolidBitmap(width, height, 220, 220, 220);
  const result = compareBitmaps(a, width, height, b, width, height);
  t.ok(result.comparable, 'comparable');
  t.notOk(result.identical, 'full-frame brightness change detected');
  t.equal(result.changedFraction, 1, 'every block differs');
  t.end();
});

test('compareBitmaps: respects a custom maxChangedFraction option', (t) => {
  const width = 320;
  const height = 240;
  const a = makeSolidBitmap(width, height, 40, 40, 40);
  const b = makeSolidBitmap(width, height, 40, 40, 40);
  paintRect(b, width, 0, 0, 40, 40, 255, 255, 255); // one block changed out of many
  const strict = compareBitmaps(a, width, height, b, width, height, { maxChangedFraction: 0 });
  t.notOk(strict.identical, 'zero-tolerance threshold rejects any change');
  const lenient = compareBitmaps(a, width, height, b, width, height, { maxChangedFraction: 0.5 });
  t.ok(lenient.identical, 'lenient threshold accepts a small localized change');
  t.end();
});
