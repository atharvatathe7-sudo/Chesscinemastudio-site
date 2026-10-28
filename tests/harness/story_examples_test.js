// Usage: node story_examples_test.js <html>
// Phase 5A: the storytelling example packets and validation cases (docs/chess-cinema/examples), run on the real page.
//  - Positive packets (a directory with plan.json): the game header in the plan and in input.md equals what the page's
//    "Copy game header" gives (no fingerprint is written by hand); illustrative analysis is labelled as such in
//    input.md and in analysis.source; Validate and Apply give exactly the recorded result and entries; the applied
//    timeline (start, landing, end, hold and its reason, the inspector's camera fields, total frames, ending) equals
//    expected.json; story lint gives no hard failure and exactly the recorded quality warnings and notes, and every
//    quality warning is explained in accepted_quality_warnings.
//  - negative/cases.json: each case gives exactly the recorded result, applied state and entries (severity, code,
//    path); lint cases give exactly the recorded hard/quality/note ids.
//  - The prompt lists every field of the page's executable schema (PLAN_FIELDS) and every recognised-but-unsupported
//    one (PLAN_UNSUPPORTED), so the prompt cannot silently drift from the application.
// The expected values were observed on the build named in each expected.json; on another build this test reports
// the page hash check as FAIL and the differences, it does not adapt.
const fs = require('fs');
const path = require('path');
const S = require('./story_lint');
const [, , HTML] = process.argv;
const EX = process.env.EXAMPLES || path.resolve(__dirname, '../../docs/chess-cinema/examples');
const PROMPT = path.resolve(EX, '../storytelling-prompt.md');
const results = [];
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fmt = (entries) => JSON.stringify(entries.map((e) => `${e.severity[0]}:${e.code}@${e.path}`));
const ids = (list) => list.map((x) => x.id);
const ROW = (m) => [m.ply, m.start, m.land, m.end, m.holdMs, m.holdReason, m.camEntry, m.camEntryFrames, m.camAfter, m.camOwn, m.camEnding, m.camReturn];

async function withGame(pgn, fn) {
  const { browser, page, errors } = await S.openPage(HTML);
  try { await S.loadGame(page, pgn); return await fn(page, errors); } finally { await browser.close(); }
}

(async () => {
  const info = S.pageInfo(HTML);
  console.log(`build under test: ${info.path}\nsha256: ${info.sha256}\ngit: ${info.branch} ${info.commit}\nexamples: ${EX}`);
  const packets = fs.readdirSync(EX).filter((d) => fs.existsSync(path.join(EX, d, 'plan.json'))).sort();
  const recorded = new Set(packets.map((d) => JSON.parse(fs.readFileSync(path.join(EX, d, 'expected.json'), 'utf8')).app.page_sha256));
  ok('page = the build the expectations were recorded on', recorded.size === 1 && recorded.has(info.sha256), [...recorded].join(', '));

  // The prompt against the page's executable schema.
  const prompt = fs.readFileSync(PROMPT, 'utf8');
  const schemaBlock = prompt.slice(prompt.indexOf('SCHEMA (chess-cinema-plan/1)'), prompt.indexOf('OUTPUT —'));
  await withGame(fs.readFileSync(path.join(EX, packets[0], 'game.pgn'), 'utf8'), async (page) => {
    const schema = await page.evaluate(() => ({ id: PLAN_SCHEMA_ID, fields: [...new Set(Object.values(PLAN_FIELDS).flatMap((o) => Object.keys(o)))], unsupported: [...PLAN_UNSUPPORTED.root, ...PLAN_UNSUPPORTED.move, 'optional'] }));
    ok('prompt: schema id is the page\'s', schemaBlock.includes(schema.id), schema.id);
    const missing = schema.fields.filter((f) => !new RegExp(`"${f}"`).test(schemaBlock));
    ok('prompt: every field of the page\'s schema is listed', !missing.length, missing.length ? 'missing ' + missing.join(', ') : schema.fields.length + ' fields');
    const notNamed = schema.unsupported.filter((f) => !new RegExp(`\\b${f}\\b`).test(schemaBlock.slice(schemaBlock.indexOf('Do NOT add'))));
    ok('prompt: every recognised-but-unsupported field is named as forbidden', !notNamed.length, notNamed.length ? 'missing ' + notNamed.join(', ') : schema.unsupported.join(', '));
    ok('prompt: stop rule for a missing game header', /STOP RULE[\s\S]*Copy game header/.test(prompt));
  });

  // Positive packets.
  for (const name of packets) {
    const p = S.readPacket(path.join(EX, name)), exp = p.expected, plan = JSON.parse(p.plan);
    const input = fs.readFileSync(path.join(EX, name, 'input.md'), 'utf8');
    const illustrative = /illustrative/i.test((plan.analysis || {}).source || '');
    ok(`${name}: illustrative analysis labelled in input.md and analysis.source alike`, illustrative === input.includes('ILLUSTRATIVE ANALYSIS — NOT A CHESSIS EXPORT'), `source "${(plan.analysis || {}).source}"`);
    const inputHeader = JSON.parse((input.match(/## 1\. Game header[^\n]*\n+```json\n([\s\S]*?)```/) || [])[1] || 'null');
    await withGame(p.pgn, async (page, errors) => {
      const header = await S.copyGameHeader(page);
      ok(`${name}: plan "game" = Copy game header`, same(plan.game, header), JSON.stringify(header));
      ok(`${name}: input.md game header = Copy game header`, same(inputHeader, header));
      const l = await S.lintOnPage(page, p.plan, { storyboard: p.storyboard, ...p.ctx });
      ok(`${name}: Validate as recorded`, l.validate.result === exp.validate.result && same(l.validate.entries, exp.validate.entries), `${l.validate.result} ${fmt(l.validate.entries)}`);
      ok(`${name}: Apply as recorded`, !!l.apply && l.apply.result === exp.apply.result && same(l.apply.entries, exp.apply.entries), l.apply ? `${l.apply.result} ${fmt(l.apply.entries)}` : 'not run');
      if (!l.timeline) { ok(`${name}: timeline`, false, 'no timeline'); return; }
      const T = l.timeline, E = exp.timeline;
      ok(`${name}: total frames, duration and ending as recorded`, T.totalFrames === E.frames && l.metrics.seconds === E.seconds && T.ending === E.ending, `${T.totalFrames} frames, ${l.metrics.seconds} s, ending ${T.ending}`);
      const rows = T.moves.map(ROW), diff = rows.map((r, i) => (same(r, E.moves[i]) ? null : `${JSON.stringify(r)} vs ${JSON.stringify(E.moves[i])}`)).filter(Boolean);
      ok(`${name}: every move's timing, hold reason and camera as recorded`, rows.length === E.moves.length && !diff.length, diff.length ? diff.join('; ') : `${rows.length} moves`);
      ok(`${name}: story lint — no hard failure`, l.hard.length === 0 && same(ids(l.hard), exp.lint.hard), JSON.stringify(l.hard));
      ok(`${name}: story lint — quality warnings and notes as recorded`, same(ids(l.quality), exp.lint.quality) && same(ids(l.notes), exp.lint.notes), `quality ${JSON.stringify(ids(l.quality))}, notes ${JSON.stringify(ids(l.notes))}`);
      const unexplained = [...new Set(ids(l.quality))].filter((q) => !(exp.accepted_quality_warnings || {})[q]);
      ok(`${name}: every quality warning is explained`, !unexplained.length, unexplained.join(', '));
      ok(`${name}: no page errors`, !errors.length, JSON.stringify(errors));
    });
  }

  // Negative, warning and lint cases.
  const neg = JSON.parse(fs.readFileSync(path.join(EX, 'negative', 'cases.json'), 'utf8'));
  for (const c of neg.cases) {
    const pgn = fs.readFileSync(path.join(EX, c.game, 'game.pgn'), 'utf8');
    await withGame(pgn, async (page, errors) => {
      if (c.action === 'lint') {
        const rd = (f) => (f ? fs.readFileSync(path.join(EX, 'negative', f), 'utf8') : null);
        const l = await S.lintOnPage(page, rd(c.plan), { storyboard: rd(c.storyboard), targetS: neg.lint_context.target_s, moments: neg.lint_context.moments });
        ok(`${c.id}: lint tiers as recorded`, same(ids(l.hard), c.expect.hard) && same(ids(l.quality), c.expect.quality) && same(ids(l.notes), c.expect.notes),
          `hard ${JSON.stringify(ids(l.hard))}, quality ${JSON.stringify(ids(l.quality))}, notes ${JSON.stringify(ids(l.notes))}`);
      } else {
        const text = fs.readFileSync(path.join(EX, 'negative', c.file), 'utf8');
        const r = c.action === 'apply' ? await S.applyPlan(page, text) : await S.validatePlan(page, text);
        ok(`${c.id}: ${c.action} gives exactly the recorded entries`, r.result === c.expect.result && r.active === c.expect.applied && same(r.entries, c.expect.entries), `${r.result}, applied ${r.active}, ${fmt(r.entries)}`);
      }
      ok(`${c.id}: no page errors`, !errors.length, JSON.stringify(errors));
    });
  }

  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
