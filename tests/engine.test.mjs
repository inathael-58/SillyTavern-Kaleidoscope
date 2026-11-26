// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePool, resolveLevels, activeStart, bucketFor, normalizePool, parseHM } from '../engine.js';

const at = (h, m = 0, day = 26) => new Date(2026, 10, day, h, m); // พฤ. 26 พ.ย. 2026
const pool = (mode, entries, extra = {}) => normalizePool({ mode, entries, ...extra });
const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };

test('parseHM', () => {
    assert.equal(parseHM('06:30'), 390);
    assert.equal(parseHM('24:00'), 1440);
    assert.equal(parseHM(''), null);
    assert.equal(parseHM('25:00'), null);
});

test('time window: normal, overnight, days', () => {
    const night = { setId: 'a', from: '22:00', to: '06:00', days: [] };
    assert.notEqual(activeStart(night, at(23)), null);
    assert.notEqual(activeStart(night, at(2)), null);
    assert.equal(activeStart(night, at(12)), null);
    // 02:00 วันพฤ. เป็นรอบที่เริ่ม 22:00 วันพุธ
    assert.equal(new Date(activeStart(night, at(2))).getDate(), 25);
    const wedNight = { ...night, days: [3] };
    assert.notEqual(activeStart(wedNight, at(2)), null); // คืนวันพุธ
    assert.equal(activeStart(wedNight, at(23)), null);   // คืนวันพฤ.
    assert.equal(activeStart({ setId: 'a', from: '', to: '', days: [] }, at(5)), 0);
    assert.equal(activeStart({ setId: 'a', from: '', to: '', days: [0] }, at(5)), null);
});

test('open mode re-rolls on open, keeps on refresh, avoids repeat', () => {
    const p = pool('open', [{ setId: 'a' }, { setId: 'b' }]);
    const r1 = resolvePool(p, null, { now: at(10), trigger: 'open', rng: () => 0 });
    assert.equal(r1.setId, 'a');
    const r2 = resolvePool(p, r1.state, { now: at(10), trigger: 'refresh' });
    assert.equal(r2.setId, 'a');
    assert.equal(r2.rolled, false);
    const r3 = resolvePool(p, r1.state, { now: at(10), trigger: 'open', rng: () => 0 });
    assert.equal(r3.setId, 'b'); // noRepeat
});

test('interval mode: same hour keeps, next hour re-rolls on open only', () => {
    const p = pool('interval', [{ setId: 'a' }, { setId: 'b' }], { intervalMin: 60 });
    const r1 = resolvePool(p, null, { now: at(10, 5), trigger: 'open', rng: () => 0 });
    const r2 = resolvePool(p, r1.state, { now: at(10, 55), trigger: 'open', rng: () => 0.9 });
    assert.equal(r2.setId, r1.setId);
    assert.equal(r2.rolled, false);
    // แชทเปิดค้างข้ามชั่วโมง → tick ไม่เปลี่ยน
    const r3 = resolvePool(p, r1.state, { now: at(11, 5), trigger: 'tick', rng: () => 0.9 });
    assert.equal(r3.setId, r1.setId);
    // เข้าแชทใหม่หลังข้ามชั่วโมง → สุ่มใหม่ (และไม่ซ้ำ)
    const r4 = resolvePool(p, r1.state, { now: at(11, 5), trigger: 'open', rng: () => 0 });
    assert.equal(r4.rolled, true);
    assert.notEqual(r4.setId, r1.setId);
});

test('interval buckets align to the clock (every 3h)', () => {
    const p = pool('interval', [{ setId: 'a' }], { intervalMin: 180 });
    assert.equal(bucketFor(p, at(0, 10), []), bucketFor(p, at(2, 59), []));
    assert.notEqual(bucketFor(p, at(2, 59), []), bucketFor(p, at(3, 0), []));
});

test('daily mode with day start hour', () => {
    const p = pool('daily', [{ setId: 'a' }, { setId: 'b' }], { dayStartHour: 4 });
    const r1 = resolvePool(p, null, { now: at(23), trigger: 'open', rng: () => 0 });
    const r2 = resolvePool(p, r1.state, { now: at(3, 0, 27), trigger: 'open', rng: () => 0.9 });
    assert.equal(r2.setId, r1.setId); // ยังไม่ถึงตี 4 = วันเดิม
    const r3 = resolvePool(p, r1.state, { now: at(4, 0, 27), trigger: 'open', rng: () => 0 });
    assert.equal(r3.rolled, true);
});

test('time mode picks by window and falls through when nothing matches', () => {
    const p = pool('time', [
        { setId: 'day', from: '06:00', to: '18:00' },
        { setId: 'night', from: '18:00', to: '06:00' },
    ]);
    assert.equal(resolvePool(p, null, { now: at(9) }).setId, 'day');
    assert.equal(resolvePool(p, null, { now: at(20) }).setId, 'night');
    const partial = pool('time', [{ setId: 'night', from: '20:00', to: '23:00' }]);
    assert.equal(resolvePool(partial, null, { now: at(9) }), null);
});

test('time mode switches on tick (live) but random modes do not', () => {
    const p = pool('time', [{ setId: 'day', from: '06:00', to: '18:00' }, { setId: 'night', from: '18:00', to: '06:00' }]);
    const r1 = resolvePool(p, null, { now: at(17, 59), trigger: 'open' });
    const r2 = resolvePool(p, r1.state, { now: at(18, 0), trigger: 'tick' });
    assert.equal(r2.setId, 'night');
    assert.equal(r2.changed, true);
});

test('time mode with overlapping entries stays stable within the window', () => {
    const p = pool('time', [{ setId: 'a', from: '20:00', to: '23:00' }, { setId: 'b', from: '20:00', to: '23:00' }]);
    const r1 = resolvePool(p, null, { now: at(20, 10), trigger: 'open', rng: () => 0 });
    const r2 = resolvePool(p, r1.state, { now: at(22, 0), trigger: 'open', rng: () => 0.99 });
    assert.equal(r2.setId, r1.setId);
    const r3 = resolvePool(p, r1.state, { now: at(20, 10, 27), trigger: 'open', rng: () => 0.99 });
    assert.equal(r3.rolled, true); // คืนถัดไปคือรอบใหม่
});

test('weights', () => {
    const p = pool('open', [{ setId: 'a', weight: 1 }, { setId: 'b', weight: 3 }], { noRepeat: false });
    assert.equal(resolvePool(p, null, { rng: () => 0.2 }).setId, 'a');
    assert.equal(resolvePool(p, null, { rng: () => 0.3 }).setId, 'b');
    const zero = pool('open', [{ setId: 'a', weight: 0 }, { setId: 'b', weight: 1 }]);
    for (const r of [0, 0.5, 0.99]) assert.equal(resolvePool(zero, null, { rng: () => r }).setId, 'b');
});

test('priority chat > bot > time, with fall-through', () => {
    const chat = pool('time', [{ setId: 'c', from: '20:00', to: '23:00' }]);
    const bot = pool('daily', [{ setId: 'b' }]);
    const time = pool('time', [{ setId: 't' }]);
    const levels = [
        { level: 'chat', pool: chat, state: null },
        { level: 'bot', pool: bot, state: null },
        { level: 'time', pool: time, state: null },
    ];
    assert.equal(resolveLevels(levels, { now: at(21) }).level, 'chat');
    assert.equal(resolveLevels(levels, { now: at(9) }).level, 'bot');
    const noBot = levels.filter(l => l.level !== 'bot');
    assert.equal(resolveLevels(noBot, { now: at(9) }).setId, 't');
    const disabled = [{ level: 'chat', pool: { ...chat, enabled: false }, state: null }, levels[2]];
    assert.equal(resolveLevels(disabled, { now: at(21) }).level, 'time');
});

test('deleted sets are ignored', () => {
    const p = pool('open', [{ setId: 'gone' }, { setId: 'a' }]);
    const r = resolvePool(p, { setId: 'gone', bucket: 'open' }, { trigger: 'refresh', validIds: new Set(['a']) });
    assert.equal(r.setId, 'a');
    assert.equal(resolvePool(pool('open', [{ setId: 'gone' }]), null, { validIds: new Set() }), null);
});

test('tick never lets a random-mode level start deciding mid-chat', () => {
    const p = pool('interval', [{ setId: 'a', from: '20:00', to: '23:00' }]);
    assert.equal(resolvePool(p, null, { now: at(20, 1), trigger: 'tick' }), null);
});
