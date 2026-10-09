// Crop (and scale) a region of an image, e.g. to make an end frame from a startframe
// for a push-in.
//
//   node .claude/skills/promo-video/scripts/crop.mjs <image> <out.jpg> <x> <y> <w> <h> <outW> <outH>
//
// x/y/w/h are in source pixels (the source size is printed); keep w/h in the
// target aspect ratio (16:9 or 9:16) so nothing is stretched. Uses headless Edge
// through Playwright and a canvas, so no image library is needed.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const [image, out, ...nums] = process.argv.slice(2);
const [x, y, w, h, outW, outH] = nums.map(Number);
if (!image || !out || nums.length !== 6 || nums.some((n) => Number.isNaN(Number(n)))) {
  console.error('usage: crop.mjs <image> <out.jpg> <x> <y> <w> <h> <outW> <outH>');
  process.exit(1);
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(resolve(image)).href);
  const result = await page.evaluate(
    ([x, y, w, h, outW, outH]) => {
      const img = document.querySelector('img');
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, x, y, w, h, 0, 0, outW, outH);
      return { url: canvas.toDataURL('image/jpeg', 0.95), nw: img.naturalWidth, nh: img.naturalHeight };
    },
    [x, y, w, h, outW, outH],
  );
  console.log(`source ${result.nw}x${result.nh}`);
  writeFileSync(out, Buffer.from(result.url.split(',')[1], 'base64'));
  console.log(resolve(out));
} finally {
  await browser.close();
}
