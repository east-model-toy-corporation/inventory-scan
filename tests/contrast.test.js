const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');

const css = readFileSync(join(__dirname, '../css/app.css'), 'utf8');
const badge = css.match(/\.badge\s*\{([^}]+)\}/)[1];

function colorOf(rule, property) {
  const match = rule.match(new RegExp(`(?:^|[;{])\\s*${property}:\\s*(#[0-9a-f]{6})\\b`, 'i'));
  assert.ok(match, `Missing hex color for ${property}`);
  return match[1];
}

function luminance(hex) {
  const [red, green, blue] = hex.slice(1).match(/../g).map(channel => {
    const srgb = parseInt(channel, 16) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

test('theme text pairs meet WCAG AA contrast for normal text', () => {
  const pairs = [
    ['#ffffff', colorOf(css, '--green')],
    ['#ffffff', colorOf(css, '--dark')],
    [colorOf(badge, 'color'), colorOf(badge, 'background')],
    [colorOf(css, '--muted'), colorOf(css, '--paper')]
  ];
  for (const [foreground, background] of pairs) {
    const levels = [luminance(foreground), luminance(background)];
    const ratio = (Math.max(...levels) + 0.05) / (Math.min(...levels) + 0.05);
    assert.ok(ratio >= 4.5, `${foreground} on ${background} has contrast ${ratio.toFixed(2)}:1`);
  }
});
