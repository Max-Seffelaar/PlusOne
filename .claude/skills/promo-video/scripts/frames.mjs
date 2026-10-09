// Extract still frames from a generated video so they can be reviewed as images.
//
//   node .claude/skills/promo-video/scripts/frames.mjs <video.mp4> <outDir> <seconds...>
//
// Uses headless Microsoft Edge through Playwright: the bundled Chromium has no
// H.264 decoder, Edge does, and no ffmpeg is needed. Writes <outDir>/f_<t>.png per
// time; times past the end clamp to the last frame. The page loading the video is
// written next to the frames so both live on the same file:// origin.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const [video, outDir, ...times] = process.argv.slice(2);
if (!video || !outDir || times.length === 0) {
  console.error('usage: frames.mjs <video.mp4> <outDir> <seconds...>');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const page = resolve(outDir, 'view.html');
writeFileSync(
  page,
  `<body style="margin:0;background:#000"><video id="v" src="${pathToFileURL(resolve(video)).href}" muted preload="auto" style="width:1280px;height:720px;object-fit:contain"></video></body>`,
);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const tab = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  tab.setDefaultTimeout(20000);
  await tab.goto(pathToFileURL(page).href);
  const duration = await tab.evaluate(
    () =>
      new Promise((ok, fail) => {
        const v = document.getElementById('v');
        if (v.readyState >= 2) return ok(v.duration);
        v.onloadeddata = () => ok(v.duration);
        v.onerror = () => fail(new Error(`video error ${v.error?.code}`));
        setTimeout(() => fail(new Error('video did not load')), 15000);
      }),
  );
  console.log(`duration ${duration.toFixed(2)}s`);
  for (const t of times) {
    await tab.evaluate(
      (t) =>
        new Promise((ok) => {
          const v = document.getElementById('v');
          v.onseeked = () => ok();
          v.currentTime = Math.min(Number(t), v.duration - 0.05);
        }),
      t,
    );
    const file = resolve(outDir, `f_${t}.png`);
    await tab.screenshot({ path: file });
    console.log(file);
  }
} finally {
  await browser.close();
}
