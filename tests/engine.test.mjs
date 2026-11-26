// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveIds, resolveLevels, periodAt, forPeriod, bucketFor, parseHM, dayNightReady,
    normalizeRule, normalizeBound, migrateGlobal, nearestHours, defaultRule, classifyOpen,
} from '../engine.js';

const at = (h, m = 0, day = 26) => new Date(2026, 10, day, h, m); // 26 พ.ย. 2026
const DN = { day: '06:00', night: '18:00' };
const TAGS = { d1: 'day', d2: 'day', n1: 'night', n2: 'night', b1: '', b2: '' };
const tagOf = (id) => TAGS[id] || '';
const rule = (extra = {}) => normalizeRule({ ...defaultRule(), ...extra });
const opts = (o = {}) => ({ tagOf, period: periodAt(o.dn ?? DN, o.now ?? at(10)), now: at(10), trigger: 'open', ...o });

test('parseHM', () => {
    assert.equal(parseHM('06:30'), 390);
    assert.equal(parseHM(''), null);
    assert.equal(parseHM('24:00'), null);
});

test('day/night: unset or equal times = not ready', () => {
    assert.equal(dayNightReady({ day: '', night: '18:00' }), false);
    assert.equal(dayNightReady({ day: '06:00', night: '06:00' }), false);
    assert.equal(periodAt({ day: '', night: '' }, at(10)), null);
    assert.equal(dayNightReady(DN), true);
});

test('day/night periods, including the overnight wrap', () => {
    assert.equal(periodAt(DN, at(10)).period, 'day');
    assert.equal(periodAt(DN, at(18)).period, 'night');
    assert.equal(periodAt(DN, at(3)).period, 'night');
    // ตี 3 วันที่ 26 อยู่ในกลางคืนที่เริ่ม 18:00 วันที่ 25
    assert.equal(periodAt(DN, at(3)).start, at(18, 0, 25).getTime());
    // ผู้ใช้ตั้งกลางวันข้ามเที่ยงคืนก็ได้ (เช่นคนทำงานกะดึก)
    const odd = { day: '20:00', night: '08:00' };
    assert.equal(periodAt(odd, at(23)).period, 'day');
    assert.equal(periodAt(odd, at(10)).period, 'night');
});

test('forPeriod: both day and night bound → follows time', () => {
    const p = periodAt(DN, at(20));
    const r = forPeriod(['d1', 'n1'], tagOf, p);
    assert.deepEqual(r.ids, ['n1']);
    assert.equal(r.aware, true);
    assert.equal(r.missing, '');
});

test('forPeriod: only day sets bound → uses them at night too and reports missing night', () => {
    const r = forPeriod(['d1', 'd2'], tagOf, periodAt(DN, at(20)));
    assert.deepEqual(r.ids, ['d1', 'd2']);
    assert.equal(r.aware, false);
    assert.equal(r.missing, 'night');
});

test('forPeriod: "both" sets count for day and night', () => {
    const night = forPeriod(['d1', 'b1'], tagOf, periodAt(DN, at(20)));
    assert.deepEqual(night.ids, ['b1']);
    assert.equal(night.missing, '');
    const untagged = forPeriod(['b1', 'b2'], tagOf, periodAt(DN, at(20)));
    assert.equal(untagged.aware, false);
    assert.equal(untagged.missing, '');
});

test('forPeriod: time not set → no filtering (time rule off)', () => {
    const r = forPeriod(['d1', 'n1'], tagOf, null);
    assert.deepEqual(r.ids, ['d1', 'n1']);
    assert.equal(r.aware, false);
});

test('open mode: re-rolls on open, keeps on refresh, avoids repeat', () => {
    const r = rule({ mode: 'open' });
    const r1 = resolveIds(['b1', 'b2'], null, opts({ rule: r, rng: () => 0 }));
    assert.equal(r1.setId, 'b1');
    const r2 = resolveIds(['b1', 'b2'], r1.state, opts({ rule: r, trigger: 'refresh' }));
    assert.equal(r2.rolled, false);
    const r3 = resolveIds(['b1', 'b2'], r1.state, opts({ rule: r, rng: () => 0 }));
    assert.equal(r3.setId, 'b2');
});

test('interval buckets start at 0:00 on the real clock', () => {
    const r6 = rule({ mode: 'interval', hours: 6 });
    assert.equal(bucketFor(r6, at(0, 0)), bucketFor(r6, at(5, 59)));
    assert.notEqual(bucketFor(r6, at(5, 59)), bucketFor(r6, at(6, 0)));
    const r24 = rule({ mode: 'interval', hours: 24 });
    assert.equal(bucketFor(r24, at(0, 1)), bucketFor(r24, at(23, 59)));
    assert.notEqual(bucketFor(r24, at(23, 59)), bucketFor(r24, at(0, 0, 27)));
});

test('interval: same slot keeps on open, next slot re-rolls on open but not on tick', () => {
    const r = rule({ mode: 'interval', hours: 1 });
    const ids = ['b1', 'b2'];
    const r1 = resolveIds(ids, null, opts({ rule: r, now: at(10, 5), rng: () => 0 }));
    const r2 = resolveIds(ids, r1.state, opts({ rule: r, now: at(10, 55), rng: () => 0.9 }));
    assert.equal(r2.rolled, false);
    const tick = resolveIds(ids, r1.state, opts({ rule: r, now: at(11, 5), trigger: 'tick', rng: () => 0.9 }));
    assert.equal(tick.setId, r1.setId); // ข้ามรอบธรรมดา → รอเปิดแชทครั้งถัดไป
    const refresh = resolveIds(ids, r1.state, opts({ rule: r, now: at(11, 5), trigger: 'refresh' }));
    assert.equal(refresh.setId, r1.setId);
    const r4 = resolveIds(ids, r1.state, opts({ rule: r, now: at(11, 5), rng: () => 0 }));
    assert.equal(r4.rolled, true);
    assert.notEqual(r4.setId, r1.setId);
});

test('interval 12h + day/night: changes at slot edges and at day/night edges', () => {
    const r = rule({ mode: 'interval', hours: 12, byDayNight: true });
    const ids = ['d1', 'd2', 'n1', 'n2'];
    const o = (h, extra = {}) => opts({ rule: r, useTags: true, now: at(h), period: periodAt(DN, at(h)), ...extra });
    const r1 = resolveIds(ids, null, o(13, { rng: () => 0 }));
    assert.equal(TAGS[r1.setId], 'day');
    // 17:00 ยังรอบเดียวกัน กลางวันเดียวกัน → คงไว้
    assert.equal(resolveIds(ids, r1.state, o(17)).rolled, false);
    // 19:00 ยังรอบ 12:00–24:00 แต่เข้ากลางคืนแล้ว → เปิดแชทได้เซทกลางคืน
    const r2 = resolveIds(ids, r1.state, o(19, { rng: () => 0 }));
    assert.equal(TAGS[r2.setId], 'night');
    // ตี 1 รอบใหม่ (00:00) กลางคืนเดิม → สุ่มเซทกลางคืนใหม่
    const r3 = resolveIds(ids, r2.state, opts({ rule: r, useTags: true, now: at(1, 0, 27), period: periodAt(DN, at(1, 0, 27)), rng: () => 0 }));
    assert.equal(r3.rolled, true);
    assert.equal(TAGS[r3.setId], 'night');
});

test('interval 24h + day/night: one day set and one night set per day', () => {
    const r = rule({ mode: 'interval', hours: 24, byDayNight: true });
    const ids = ['d1', 'd2', 'n1', 'n2'];
    const o = (h, extra = {}) => opts({ rule: r, useTags: true, now: at(h), period: periodAt(DN, at(h)), ...extra });
    const day = resolveIds(ids, null, o(9, { rng: () => 0 }));
    assert.equal(resolveIds(ids, day.state, o(15)).setId, day.setId);
    const night = resolveIds(ids, day.state, o(20, { rng: () => 0 }));
    assert.equal(TAGS[night.setId], 'night');
});

test('tick (live switch) changes only when crossing day/night', () => {
    const r = rule({ mode: 'open' });
    const ids = ['d1', 'n1'];
    const r1 = resolveIds(ids, null, opts({ rule: r, useTags: true, now: at(17, 59), period: periodAt(DN, at(17, 59)) }));
    assert.equal(r1.setId, 'd1');
    const same = resolveIds(ids, r1.state, opts({ rule: r, useTags: true, trigger: 'tick', now: at(17, 59), period: periodAt(DN, at(17, 59)) }));
    assert.equal(same.rolled, false);
    const cross = resolveIds(ids, r1.state, opts({ rule: r, useTags: true, trigger: 'tick', now: at(18, 0), period: periodAt(DN, at(18, 0)) }));
    assert.equal(cross.setId, 'n1');
    assert.equal(cross.changed, true);
});

test('tick never re-rolls a list that does not split by day/night', () => {
    const r = rule({ mode: 'open' });
    const r1 = resolveIds(['d1', 'd2'], null, opts({ rule: r, useTags: true, now: at(17, 59), period: periodAt(DN, at(17, 59)), rng: () => 0 }));
    const r2 = resolveIds(['d1', 'd2'], r1.state, opts({ rule: r, useTags: true, trigger: 'tick', now: at(18, 0), period: periodAt(DN, at(18, 0)), rng: () => 0.9 }));
    assert.equal(r2.setId, r1.setId);
});

test('priority: chat beats bot beats the random rule, always', () => {
    const r = rule({ mode: 'open', byDayNight: true });
    const levels = [
        { level: 'chat', ids: ['d1'], state: null, useTags: true },
        { level: 'bot', ids: ['n1'], state: null, useTags: true },
        { level: 'rule', ids: ['b1'], state: null, useTags: true },
    ];
    // กลางคืน แต่แชทผูกแค่เซทกลางวัน → แชทยังชนะ
    const night = opts({ rule: r, now: at(22), period: periodAt(DN, at(22)) });
    assert.equal(resolveLevels(levels, night).setId, 'd1');
    assert.equal(resolveLevels(levels.slice(1), night).setId, 'n1');
    assert.equal(resolveLevels([{ ...levels[0], ids: [] }, ...levels.slice(1)], night).level, 'bot');
    assert.equal(resolveLevels(levels.slice(2), night).level, 'rule');
    assert.equal(resolveLevels([], night), null);
});

test('random rule ignores tags unless byDayNight is on', () => {
    const r = rule({ mode: 'open' });
    const ids = ['d1', 'n1'];
    const at22 = { now: at(22), period: periodAt(DN, at(22)) };
    const plain = resolveLevels([{ level: 'rule', ids, state: null, useTags: false }], opts({ rule: r, ...at22, rng: () => 0 }));
    assert.equal(plain.setId, 'd1');
    const tagged = resolveLevels([{ level: 'rule', ids, state: null, useTags: true }], opts({ rule: r, ...at22, rng: () => 0 }));
    assert.equal(tagged.setId, 'n1');
});

test('normalizeBound accepts v1 pools and drops duplicates and old fields', () => {
    const b = normalizeBound({ enabled: false, mode: 'time', entries: [{ setId: 'a', weight: 3, from: '06:00' }, { setId: 'a' }, { setId: 'b' }, null] });
    assert.deepEqual(b, { enabled: false, entries: [{ setId: 'a' }, { setId: 'b' }] });
});

test('migrating the v1 time-level pool into the rule', () => {
    assert.equal(migrateGlobal(null).rule.enabled, false);
    assert.equal(migrateGlobal(null).inRandom, null);
    const daily = migrateGlobal({ mode: 'daily', entries: [{ setId: 'a' }, { setId: 'z', weight: 0 }] });
    assert.deepEqual([daily.rule.mode, daily.rule.hours, daily.rule.enabled], ['interval', 24, true]);
    assert.deepEqual([...daily.inRandom], ['a']);
    assert.equal(migrateGlobal({ mode: 'interval', intervalMin: 180, entries: [{ setId: 'a' }] }).rule.hours, 1);
    assert.equal(nearestHours(300), 6);
    assert.equal(migrateGlobal({ mode: 'time', entries: [{ setId: 'a' }] }).rule.mode, 'open');
});

test('only entering a different chat counts as opening a chat', () => {
    // โหลดหน้า ไปหน้าแรก (ไม่มีแชท) → ไม่สุ่ม
    let r = classifyOpen('', null, 'A');
    assert.equal(r.trigger, 'refresh');
    // โหลดหน้าแล้ว ST เปิดแชทเดิมให้ → ไม่สุ่ม
    assert.equal(classifyOpen('A', null, 'A').trigger, 'refresh');
    // จากหน้าแรกเข้าแชท (แม้เป็นแชทเดิม) → สุ่ม
    r = classifyOpen('A', r.lastOpened, r.remember);
    assert.equal(r.trigger, 'open');
    // CHAT_CHANGED ซ้ำของแชทเดิม (เปลี่ยนชื่อ ฯลฯ) → ไม่สุ่ม
    assert.equal(classifyOpen('A', r.lastOpened, r.remember).trigger, 'refresh');
    // เปลี่ยนไปแชทอื่น → สุ่ม และจำแชทใหม่ไว้
    r = classifyOpen('B', r.lastOpened, r.remember);
    assert.deepEqual([r.trigger, r.remember], ['open', 'B']);
    // หน้าแรก → กลับแชท B → สุ่ม
    r = classifyOpen('', r.lastOpened, r.remember);
    assert.equal(classifyOpen('B', r.lastOpened, r.remember).trigger, 'open');
});

// ---------------------------------------------------------------- release hygiene
import fs from 'node:fs';
import { compareVersions, FILES } from '../updater.js';

test('compareVersions', () => {
    assert.equal(compareVersions('1.2.10', '1.2.9'), 1);
    assert.equal(compareVersions('1.1', '1.1.0'), 0);
    assert.equal(compareVersions('0.9.9', '1.0.0'), -1);
});

test('manifest version matches the running VERSION', () => {
    const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    const ui = fs.readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
    assert.equal(/export const VERSION = '([^']+)'/.exec(ui)[1], manifest.version);
});

test('updater cache list covers every shipped file', () => {
    const shipped = fs.readdirSync(new URL('..', import.meta.url)).filter(f => /\.(js|css)$/.test(f) || f === 'manifest.json');
    assert.deepEqual([...shipped].sort(), [...FILES].sort());
});
