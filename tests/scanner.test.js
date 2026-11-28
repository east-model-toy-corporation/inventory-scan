const {test} = require('node:test');
const assert = require('node:assert/strict');
const {DECODE_INTERVALS,cropDrawSize} = require('../js/scanner');

test('ZXing has a longer decode interval than BarcodeDetector',() => {
  assert.ok(DECODE_INTERVALS.barcodeDetector >= 100 && DECODE_INTERVALS.barcodeDetector <= 125);
  assert.ok(DECODE_INTERVALS.zxing >= 180 && DECODE_INTERVALS.zxing <= 200);
});

test('crop draw size caps the longest side and preserves aspect ratio',() => {
  assert.deepEqual(cropDrawSize(1920,1080),{width:720,height:405});
  assert.deepEqual(cropDrawSize(1080,1920),{width:405,height:720});
  assert.deepEqual(cropDrawSize(1440,1440),{width:720,height:720});
  assert.deepEqual(cropDrawSize(720,250),{width:720,height:250});
  assert.deepEqual(cropDrawSize(480,270),{width:480,height:270});
  assert.deepEqual(cropDrawSize(1920,1),{width:720,height:1});
});
