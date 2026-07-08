// Capture le rendu réel du jeu dans Chrome headless pour vérifier le cadrage.
// Usage : node scripts/browser-check.mjs [url] [outPrefix]
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://127.0.0.1:5174/';
const prefix = process.argv[3] ?? 'shot';

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: 875, height: 1024 } });

page.on('console', (msg) => {
  if (['error', 'warning'].includes(msg.type())) console.log(`[console.${msg.type()}]`, msg.text());
});
page.on('pageerror', (err) => console.log('[pageerror]', err.message));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(9000);
await page.screenshot({ path: `.tmp-shots/${prefix}-1-initial.png` });

// Regarde vers le bas (drag souris vers le bas simulé sans pointer lock :
// on injecte directement dans le contrôleur si exposé, sinon drag).
await page.mouse.move(600, 500);
await page.mouse.down();
await page.mouse.move(600, 700, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(800);
await page.screenshot({ path: `.tmp-shots/${prefix}-2-pitch-down.png` });

// Regarde vers le haut.
await page.mouse.move(600, 700);
await page.mouse.down();
await page.mouse.move(600, 300, { steps: 40 });
await page.mouse.up();
await page.waitForTimeout(800);
await page.screenshot({ path: `.tmp-shots/${prefix}-3-pitch-up.png` });

// Rotation yaw 180°.
await page.mouse.move(300, 500);
await page.mouse.down();
await page.mouse.move(860, 500, { steps: 40 });
await page.mouse.up();
await page.waitForTimeout(800);
await page.screenshot({ path: `.tmp-shots/${prefix}-4-yaw.png` });

await browser.close();
console.log('Captures écrites dans .tmp-shots/');
