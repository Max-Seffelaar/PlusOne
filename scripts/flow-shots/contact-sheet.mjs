// QA-0 contact sheet: one page per flow with every variant's screenshots as a
// filmstrip and the handoff asserts as a table. Built from what the harness
// (tests/flows/harness.ts) wrote into flow-screenshots/<flow>/<variant>/.
//
//   node scripts/flow-shots/contact-sheet.mjs [flow …]   # default: every flow dir present
//
// Writes:
//   flow-screenshots/<flow>/contact-sheet.html + .png   the sheet (PNG = one image to eyeball)
//   flow-screenshots/index.html                          links to every sheet
//   flow-screenshots/summary.md                          markdown for the CI step summary / PR comment
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const OUT = join(process.cwd(), 'flow-screenshots');
const VARIANT_ORDER = ['desktop-browser', 'phone-browser', 'phone-native', 'ipad-native'];
const ICON = { passed: '✅', failed: '❌', skipped: '–' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const order = (a, b) => (VARIANT_ORDER.indexOf(a) + 1 || 99) - (VARIANT_ORDER.indexOf(b) + 1 || 99);

function readFlow(flow) {
  const dir = join(OUT, flow);
  const variants = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort(order)
    .map((v) => {
      const file = join(dir, v, 'flow.json');
      // No flow.json = the run died before teardown (or the variant is skipped): show what exists.
      if (!existsSync(file)) {
        const steps = readdirSync(join(dir, v))
          .filter((f) => f.endsWith('.png'))
          .sort()
          .map((f, i) => ({ n: i + 1, label: f.replace(/^\d+-|\.png$/g, ''), file: f }));
        return { variant: v, status: steps.length ? 'failed' : 'skipped', steps, asserts: [] };
      }
      return JSON.parse(readFileSync(file, 'utf8'));
    })
    .filter((r) => r.status !== 'skipped' || r.steps.length);
  return { flow, variants };
}

function assertRows(variants) {
  const byQ = new Map();
  for (const v of variants) for (const a of v.asserts) if (!byQ.has(a.q) || byQ.get(a.q).status === 'skipped') byQ.set(a.q, a);
  return [...byQ.keys()].sort((a, b) => a - b).map((q) => ({
    q,
    text: byQ.get(q).text,
    cells: variants.map((v) => v.asserts.find((a) => a.q === q)),
  }));
}

function sheetHtml({ flow, variants }) {
  const rows = assertRows(variants);
  const head = variants.map((v) => `<th>${esc(v.variant)}</th>`).join('');
  const table = rows
    .map(
      (r) =>
        `<tr><td class="q">Q${r.q}</td><td>${esc(r.text)}</td>${r.cells
          .map((c) => `<td class="c" title="${esc(c?.error ?? c?.text ?? 'not reached')}">${c ? ICON[c.status] : '·'}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  const strips = variants
    .map(
      (v) => `<section><h2>${esc(v.variant)} <span class="${v.status}">${esc(v.status)}</span></h2>
${v.error ? `<p class="err">${esc(v.error)}</p>` : ''}<div class="strip">${v.steps
        .map(
          (s) => `<figure class="${(v.viewport?.width ?? 390) < 700 ? 'narrow' : 'wide'}"><a href="${esc(`${v.variant}/${s.file}`)}"><img src="${esc(`${v.variant}/${s.file}`)}" loading="eager"></a>
<figcaption>${String(s.n).padStart(2, '0')} ${esc(s.label)}${s.overflowX ? ' ⚠ overflow-x' : ''}</figcaption></figure>`,
        )
        .join('')}</div></section>`,
    )
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>QA-0 · ${esc(flow)}</title><style>
body{margin:0;padding:24px;background:#0B0B0D;color:#eee;font:14px/1.4 system-ui,sans-serif}
h1{margin:0 0 16px;font-size:22px}h2{font-size:15px;margin:22px 0 8px}
table{border-collapse:collapse;margin-bottom:8px}td,th{border:1px solid #333;padding:4px 8px;text-align:left;vertical-align:top}
th{color:#B5A6FF;font-weight:600}.q{color:#B5A6FF;white-space:nowrap}.c{text-align:center}
.strip{display:flex;gap:10px;overflow-x:auto;align-items:flex-start}
figure{margin:0;flex:0 0 auto}figure.narrow,figure.narrow img{width:200px}figure.wide,figure.wide img{width:300px}
img{max-height:420px;object-fit:cover;object-position:top;border:1px solid #333;border-radius:6px;display:block}
figcaption{font-size:12px;color:#aaa;margin-top:4px}.passed{color:#7ee787}.failed{color:#ff7b72}.err{color:#ff7b72;font-family:monospace;font-size:12px}
</style></head><body><h1>QA-0 flow · ${esc(flow)}</h1>
<table><tr><th>#</th><th>Handoff question (✅ automatic)</th>${head}</tr>${table}</table>
${strips}</body></html>`;
}

function summaryMd(flows) {
  const out = [];
  for (const f of flows) {
    out.push(`### ${f.flow}`);
    out.push('');
    out.push(`| Variant | Result | Steps |`);
    out.push(`|---|---|---|`);
    for (const v of f.variants) out.push(`| ${v.variant} | ${v.status === 'passed' ? '✅ passed' : `❌ ${v.status}`} | ${v.steps.length} |`);
    const rows = assertRows(f.variants);
    if (rows.length) {
      out.push('');
      out.push(`| # | Automatic check | ${f.variants.map((v) => v.variant).join(' | ')} |`);
      out.push(`|---|---|${f.variants.map(() => '---').join('|')}|`);
      for (const r of rows) out.push(`| Q${r.q} | ${r.text.replace(/\|/g, '\\|')} | ${r.cells.map((c) => (c ? ICON[c.status] : '·')).join(' | ')} |`);
    }
    out.push('');
  }
  return out.join('\n');
}

if (!existsSync(OUT)) {
  console.error('contact sheet: no flow-screenshots/ yet — run `pnpm qa:flows` first');
  process.exit(1);
}
const wanted = process.argv.slice(2);
const flows = readdirSync(OUT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && (!wanted.length || wanted.includes(d.name)))
  .map((d) => readFlow(d.name))
  .filter((f) => f.variants.length);

const browser = await chromium.launch(
  process.env.PW_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE } : {},
);
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
for (const f of flows) {
  const html = join(OUT, f.flow, 'contact-sheet.html');
  writeFileSync(html, sheetHtml(f));
  await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
  // Width = the widest filmstrip, so one PNG shows every step without scrolling.
  const width = await page.evaluate(() => Math.max(1000, ...[...document.querySelectorAll('.strip')].map((s) => s.scrollWidth + 48)));
  await page.setViewportSize({ width: Math.min(width, 4000), height: 800 });
  await page.screenshot({ path: join(OUT, f.flow, 'contact-sheet.png'), fullPage: true });
  console.log(`contact sheet: flow-screenshots/${f.flow}/contact-sheet.png`);
}
await browser.close();

writeFileSync(
  join(OUT, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>QA-0 flows</title><body style="background:#0B0B0D;color:#eee;font:15px system-ui;padding:24px">
<h1>QA-0 flows</h1><ul>${flows.map((f) => `<li><a style="color:#B5A6FF" href="${esc(f.flow)}/contact-sheet.html">${esc(f.flow)}</a></li>`).join('')}</ul>`,
);
writeFileSync(join(OUT, 'summary.md'), summaryMd(flows));
console.log('summary: flow-screenshots/summary.md');
