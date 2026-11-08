// Generates iOS launch images (iOS has no manifest-driven splash) and links them in index.html.
// Usage: node tools/splash.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const DEVICES = [ // css width, css height, scale
  [375, 667, 2], [414, 896, 2], [375, 812, 3], [414, 896, 3], [390, 844, 3], [393, 852, 3],
  [428, 926, 3], [430, 932, 3], [402, 874, 3], [440, 956, 3], [768, 1024, 2], [820, 1180, 2], [834, 1194, 2], [1024, 1366, 2],
];
mkdirSync('public/splash', { recursive: true });
const icon = readFileSync('public/icons/icon-512.png').toString('base64');
const browser = await chromium.launch();
const links = [];
for (const [w, h, s] of DEVICES) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: s });
  await page.setContent(`<body style="margin:0;height:100vh;display:grid;place-items:center;background:#f6f3ea"><img src="data:image/png;base64,${icon}" style="width:128px;height:128px;border-radius:28px"></body>`);
  const file = `splash-${w * s}x${h * s}.png`;
  await page.screenshot({ path: 'public/splash/' + file });
  await page.close();
  links.push(`  <link rel="apple-touch-startup-image" href="splash/${file}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${s}) and (orientation: portrait)">`);
}
await browser.close();
const html = readFileSync('index.html', 'utf8').replace(/<!-- splash:start -->[\s\S]*<!-- splash:end -->/, `<!-- splash:start -->\n${links.join('\n')}\n  <!-- splash:end -->`);
writeFileSync('index.html', html);
console.log(links.length, 'splash images');
