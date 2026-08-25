'use strict';

// Phase 3 (state-freshness optimization, item 6's harder half). Today, computer_action enforces a
// simple, safe rule: every action requires a screen capture inspected by a full model-vision call
// (inspect_screenshot_with_model) taken AFTER the capture, and every action invalidates that
// inspection so the next one needs a fresh capture+inspect cycle too. That is correct but
// expensive - a sequence of several small actions against a screen that barely changes (typing
// across a few form fields, watching a progress bar) burns one full model-vision call per action.
//
// This module adds a CHEAP, LOCAL check that runs before asking the model to look again: compare
// the new capture's pixels against the last screenshot the model actually inspected. If they are
// close enough to call "the same picture," the old inspection can cover the new capture too,
// skipping a redundant model call. It must fail safe - any uncertainty (different dimensions, no
// prior inspection to compare against, a computation error) must return "not confirmed unchanged,"
// never "assume unchanged." Getting this wrong would let Operator act on a stale understanding of
// the screen, which is exactly the hazard the existing freshness gate exists to prevent.
//
// Deliberately a coarse block-average comparison, not a full per-pixel diff: it needs to be cheap
// enough that running it on every capture is clearly worth it relative to skipping a model call,
// while still being sensitive enough to catch a real UI change (a new dialog, updated text, a
// different page). A block-luminance comparison catches "this looks like a different screen" at a
// small fraction of the cost of comparing every pixel, and errs toward reporting a change when in
// doubt rather than a tighter but slower algorithm that might blur past something real.

const DEFAULT_BLOCK_SIZE = 40;
const DEFAULT_PIXEL_STRIDE = 4;
// Conservative on purpose: only skip a real model inspection when the two captures are almost
// indistinguishable. A cursor blink or a clock ticking over a digit should still round to "no
// meaningful change"; a new dialog, a page navigation, or a form actually being filled in should
// not.
const DEFAULT_MAX_CHANGED_FRACTION = 0.01;
const DEFAULT_LUMINANCE_THRESHOLD = 10;
// The coarse pass can average away a tiny but meaningful local change. A second full-resolution
// pass counts materially changed pixels whenever the coarse pass would reuse old semantics. It
// ignores a handful of pixels (capture/cursor noise) but catches small checkboxes, selected rows,
// short labels, badges, and toast state that occupy far less than one percent of the frame.
const DEFAULT_PIXEL_DELTA_THRESHOLD = 24;
const DEFAULT_MAX_FINE_CHANGED_PIXELS = 24;

function countChangedPixels(bitmapA, bitmapB, expectedPixels, bytesPerPixel, deltaThreshold, stopAfter) {
  let changed = 0;
  for (let pixel = 0; pixel < expectedPixels; pixel += 1) {
    const offset = pixel * bytesPerPixel;
    const delta0 = Math.abs(bitmapA[offset] - bitmapB[offset]);
    const delta1 = Math.abs(bitmapA[offset + 1] - bitmapB[offset + 1]);
    const delta2 = Math.abs(bitmapA[offset + 2] - bitmapB[offset + 2]);
    if (Math.max(delta0, delta1, delta2) < deltaThreshold) continue;
    changed += 1;
    if (changed > stopAfter) break;
  }
  return changed;
}

function averageBlockLuminance(bitmap, bytesPerPixel, imageWidth, blockX0, blockY0, blockX1, blockY1, stride) {
  let total = 0;
  let count = 0;
  for (let y = blockY0; y < blockY1; y += stride) {
    const rowOffset = y * imageWidth * bytesPerPixel;
    for (let x = blockX0; x < blockX1; x += stride) {
      const pixelOffset = rowOffset + x * bytesPerPixel;
      // Channel order (RGBA vs BGRA) does not matter here - both captures are decoded the same
      // way, so a consistent (if not colorimetrically exact) luminance proxy is all a same-vs-
      // different comparison needs.
      const b0 = bitmap[pixelOffset];
      const b1 = bitmap[pixelOffset + 1];
      const b2 = bitmap[pixelOffset + 2];
      if (b0 === undefined || b1 === undefined || b2 === undefined) continue;
      total += b0 + b1 + b2;
      count += 1;
    }
  }
  return count > 0 ? total / (count * 3) : 0;
}

/**
 * Compares two raw RGBA/BGRA bitmaps of the same declared dimensions and reports how much of the
 * image looks different, using a coarse grid of block-average-luminance comparisons.
 *
 * @param {Buffer|Uint8Array} bitmapA
 * @param {number} widthA
 * @param {number} heightA
 * @param {Buffer|Uint8Array} bitmapB
 * @param {number} widthB
 * @param {number} heightB
 * @param {object} [options]
 * @returns {{ comparable: boolean, identical: boolean, changedFraction: number, reason: string }}
 */
function compareBitmaps(bitmapA, widthA, heightA, bitmapB, widthB, heightB, options = {}) {
  const blockSize = Number(options.blockSize) > 0 ? Number(options.blockSize) : DEFAULT_BLOCK_SIZE;
  const stride = Number(options.pixelStride) > 0 ? Number(options.pixelStride) : DEFAULT_PIXEL_STRIDE;
  const bytesPerPixel = Number(options.bytesPerPixel) > 0 ? Number(options.bytesPerPixel) : 4;
  const luminanceThreshold = Number.isFinite(Number(options.luminanceThreshold))
    ? Number(options.luminanceThreshold) : DEFAULT_LUMINANCE_THRESHOLD;
  const maxChangedFraction = Number.isFinite(Number(options.maxChangedFraction))
    ? Number(options.maxChangedFraction) : DEFAULT_MAX_CHANGED_FRACTION;
  const pixelDeltaThreshold = Number.isFinite(Number(options.pixelDeltaThreshold))
    ? Number(options.pixelDeltaThreshold) : DEFAULT_PIXEL_DELTA_THRESHOLD;
  const maxFineChangedPixels = Number.isFinite(Number(options.maxFineChangedPixels))
    ? Number(options.maxFineChangedPixels) : DEFAULT_MAX_FINE_CHANGED_PIXELS;

  if (!bitmapA || !bitmapB) {
    return { comparable: false, identical: false, changedFraction: 1, reason: 'missing_bitmap' };
  }
  if (widthA !== widthB || heightA !== heightB) {
    // A dimension change (window resize, different monitor, different app) is itself meaningful -
    // never treated as "no change," and never even attempted block-by-block.
    return { comparable: false, identical: false, changedFraction: 1, reason: 'dimension_mismatch' };
  }
  if (widthA <= 0 || heightA <= 0) {
    return { comparable: false, identical: false, changedFraction: 1, reason: 'invalid_dimensions' };
  }
  const expectedBytes = widthA * heightA * bytesPerPixel;
  if (bitmapA.length < expectedBytes || bitmapB.length < expectedBytes) {
    return { comparable: false, identical: false, changedFraction: 1, reason: 'truncated_bitmap' };
  }

  const blockCols = Math.max(1, Math.ceil(widthA / blockSize));
  const blockRows = Math.max(1, Math.ceil(heightA / blockSize));
  let changedBlocks = 0;
  const totalBlocks = blockCols * blockRows;

  for (let row = 0; row < blockRows; row += 1) {
    const blockY0 = row * blockSize;
    const blockY1 = Math.min(heightA, blockY0 + blockSize);
    for (let col = 0; col < blockCols; col += 1) {
      const blockX0 = col * blockSize;
      const blockX1 = Math.min(widthA, blockX0 + blockSize);
      const lumA = averageBlockLuminance(bitmapA, bytesPerPixel, widthA, blockX0, blockY0, blockX1, blockY1, stride);
      const lumB = averageBlockLuminance(bitmapB, bytesPerPixel, widthA, blockX0, blockY0, blockX1, blockY1, stride);
      if (Math.abs(lumA - lumB) > luminanceThreshold) changedBlocks += 1;
    }
  }

  const changedFraction = totalBlocks > 0 ? changedBlocks / totalBlocks : 1;
  const coarseUnchanged = changedFraction <= maxChangedFraction;
  const fineChangedPixels = coarseUnchanged
    ? countChangedPixels(
        bitmapA,
        bitmapB,
        widthA * heightA,
        bytesPerPixel,
        pixelDeltaThreshold,
        maxFineChangedPixels
      )
    : 0;
  const localizedChange = coarseUnchanged && fineChangedPixels > maxFineChangedPixels;
  const identical = coarseUnchanged && !localizedChange;
  return {
    comparable: true,
    identical,
    changedFraction,
    fineChangedPixels,
    reason: localizedChange ? 'localized_change' : (identical ? 'unchanged' : 'changed')
  };
}

module.exports = {
  compareBitmaps,
  DEFAULT_BLOCK_SIZE,
  DEFAULT_PIXEL_STRIDE,
  DEFAULT_MAX_CHANGED_FRACTION,
  DEFAULT_LUMINANCE_THRESHOLD,
  DEFAULT_PIXEL_DELTA_THRESHOLD,
  DEFAULT_MAX_FINE_CHANGED_PIXELS
};
