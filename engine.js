// engine.js — ตรรกะเลือกเซท (ไม่แตะ DOM ไม่แตะ SillyTavern จึงเทสใน node ได้)
//
// คำศัพท์
//   set    เซทธีม+BG ที่ผู้ใช้สร้างไว้ { id, name, theme, bg, bgCustom, fitting }
//   pool   กติกาของแต่ละระดับ (แชท / บอท / เวลา) ว่าใช้เซทไหนได้บ้าง และเปลี่ยนบ่อยแค่ไหน
//          { enabled, mode, intervalMin, dayStartHour, noRepeat, entries: [entry] }
//   entry  { setId, weight, from: 'HH:MM'|'', to: 'HH:MM'|'', days: [0..6] }  (days ว่าง = ทุกวัน)
//   state  สิ่งที่สุ่มได้ล่าสุดของระดับนั้น { setId, bucket, at }
//
// โหมด (mode)
//   open      สุ่มใหม่ทุกครั้งที่เปิดแชท
//   interval  สุ่มใหม่เมื่อข้ามช่วงเวลา (ทุก N นาที นับตามนาฬิกา เช่นทุกชั่วโมงตรง)
//   daily     สุ่มใหม่วันละครั้ง (เริ่มวันใหม่ที่ dayStartHour)
//   time      ใช้ตามช่วงเวลาของแต่ละ entry · ถ้าหลายอันตรงเวลาเดียวกันจะสุ่มครั้งเดียวต่อรอบช่วงเวลา
//
// ทุกโหมดเคารพช่วงเวลา/วันของ entry: entry ที่ไม่อยู่ในช่วงเวลาจะไม่ถูกเลือก
// ถ้าไม่มี entry ไหนใช้ได้เลย ระดับนั้นคืน null แล้วระดับถัดไปจะตัดสินแทน
//
// trigger ที่ส่งเข้ามา
//   open     เปิดแชท (หรือโหลดหน้าใหม่) — เวลาเดียวที่โหมด open/interval/daily สุ่มใหม่ได้
//   refresh  ผู้ใช้แก้การตั้งค่า — คงของเดิมถ้ายังใช้ได้
//   tick     ตรวจเวลาขณะแชทเปิดค้าง (เมื่อเปิดตัวเลือก "เปลี่ยนตามเวลาทันที") — มีผลกับโหมด time เท่านั้น
//   force    ผู้ใช้กดสุ่มใหม่

export const MODES = Object.freeze(['open', 'interval', 'daily', 'time']);
export const LEVELS = Object.freeze(['chat', 'bot', 'time']);

export function newId() {
    return 'ns' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function defaultPool(mode = 'daily') {
    return { enabled: true, mode, intervalMin: 60, dayStartHour: 0, noRepeat: true, entries: [] };
}

export function defaultEntry(setId = '') {
    return { setId, weight: 1, from: '', to: '', days: [] };
}

/** 'HH:MM' → นาทีนับจากเที่ยงคืน, ค่าว่าง/ผิดรูป → null */
export function parseHM(str) {
    if (typeof str !== 'string') return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(str.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
    return h * 60 + min;
}

function startOfDay(d) {
    const x = new Date(d.getTime());
    x.setHours(0, 0, 0, 0);
    return x;
}

function addDays(d, n) {
    const x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
}

function atMinutes(day, minutes) {
    const x = startOfDay(day);
    x.setMinutes(minutes);
    return x;
}

export function hasWindow(entry) {
    return parseHM(entry?.from) !== null || parseHM(entry?.to) !== null;
}

/**
 * เวลาเริ่มของรอบช่วงเวลาที่ entry นี้กำลังใช้ได้อยู่
 * @returns {number|null} timestamp ของจุดเริ่มรอบ · 0 = ใช้ได้ตลอด (ไม่มีช่วงเวลา) · null = ตอนนี้ใช้ไม่ได้
 */
export function activeStart(entry, now) {
    const days = Array.isArray(entry?.days) ? entry.days : [];
    const dayOk = (d) => days.length === 0 || days.includes(d.getDay());

    if (!hasWindow(entry)) {
        if (days.length === 0) return 0;
        return dayOk(now) ? startOfDay(now).getTime() : null;
    }

    const from = parseHM(entry.from) ?? 0;
    const to = parseHM(entry.to) ?? 1440;
    const m = now.getHours() * 60 + now.getMinutes();
    let startDay = null;

    if (from < to) {
        if (m >= from && m < to) startDay = now;
    } else if (from > to) {
        // ข้ามเที่ยงคืน เช่น 22:00–06:00
        if (m >= from) startDay = now;
        else if (m < to) startDay = addDays(now, -1);
    } else {
        // from == to → ทั้งวัน เริ่มนับที่ from
        startDay = m >= from ? now : addDays(now, -1);
    }

    if (!startDay || !dayOk(startDay)) return null;
    return atMinutes(startDay, from).getTime();
}

function localMinutes(now) {
    return Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / 60000);
}

function ymd(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** รหัสของ "รอบ" ปัจจุบัน — ถ้ารหัสเท่าเดิมและเซทเดิมยังใช้ได้ จะไม่สุ่มใหม่ */
export function bucketFor(pool, now, eligible) {
    switch (pool.mode) {
        case 'interval': {
            const step = Math.max(1, Math.round(Number(pool.intervalMin) || 60));
            return `i${step}:${Math.floor(localMinutes(now) / step)}`;
        }
        case 'daily': {
            const h = Math.min(23, Math.max(0, Number(pool.dayStartHour) || 0));
            return `d${h}:${ymd(new Date(now.getTime() - h * 3600000))}`;
        }
        case 'time': {
            const ids = [...new Set(eligible.map(x => x.entry.setId))].sort().join(',');
            const start = Math.max(0, ...eligible.map(x => x.start));
            return `t:${ids}@${start}`;
        }
        default:
            return 'open';
    }
}

/** สุ่มแบบถ่วงน้ำหนัก rng() คืน 0..1 */
export function weightedPick(items, rng = Math.random) {
    const total = items.reduce((s, x) => s + x.weight, 0);
    if (total <= 0) return items[0] ?? null;
    let r = rng() * total;
    for (const x of items) {
        r -= x.weight;
        if (r < 0) return x;
    }
    return items[items.length - 1];
}

function entryWeight(e) {
    const w = Number(e?.weight);
    return Number.isFinite(w) ? Math.max(0, w) : 1;
}

/**
 * ตัดสินว่า pool นี้ใช้เซทไหน
 * @param {object} pool
 * @param {{setId?: string, bucket?: string}|null} state
 * @param {{ now?: Date, trigger?: string, rng?: () => number, validIds?: Set<string> }} opts
 * @returns {null | { setId: string, state: object, rolled: boolean, changed: boolean }}
 */
export function resolvePool(pool, state, { now = new Date(), trigger = 'open', rng = Math.random, validIds } = {}) {
    if (!pool || pool.enabled === false || !Array.isArray(pool.entries)) return null;
    const mode = MODES.includes(pool.mode) ? pool.mode : 'daily';
    const usable = pool.entries.filter(e => e && e.setId && (!validIds || validIds.has(e.setId)) && entryWeight(e) > 0);
    if (!usable.length) return null;

    const prev = state?.setId || '';
    const prevInPool = !!prev && usable.some(e => e.setId === prev);

    // แชทเปิดค้าง: โหมดที่ไม่ใช่ time ห้ามเปลี่ยนอะไรเลย — คงของเดิม หรือไม่ออกความเห็น
    if (trigger === 'tick' && mode !== 'time') {
        return prevInPool ? { setId: prev, state, rolled: false, changed: false } : null;
    }

    const eligible = usable
        .map(entry => ({ entry, start: activeStart(entry, now), weight: entryWeight(entry) }))
        .filter(x => x.start !== null);
    if (!eligible.length) return null;

    const ids = new Set(eligible.map(x => x.entry.setId));
    const bucket = bucketFor({ ...pool, mode }, now, eligible);
    const prevOk = !!prev && ids.has(prev);

    let keep = false;
    if (trigger !== 'force' && prevOk) {
        if (mode === 'open') keep = trigger !== 'open';
        else keep = state?.bucket === bucket;
    }
    if (keep) {
        return { setId: prev, state, rolled: false, changed: false };
    }

    let candidates = eligible;
    if (pool.noRepeat !== false && prev && ids.size > 1) {
        candidates = eligible.filter(x => x.entry.setId !== prev);
    }
    const picked = weightedPick(candidates, rng);
    const setId = picked.entry.setId;
    const next = { setId, bucket, at: now.getTime() };
    return { setId, state: next, rolled: true, changed: setId !== prev };
}

/**
 * ไล่ระดับตามลำดับความสำคัญ แชท > บอท > เวลา
 * @param {Array<{ level: string, pool: object, state: object|null }>} levels
 * @returns {{ level: string, setId: string, state: object, rolled: boolean, changed: boolean } | null}
 */
export function resolveLevels(levels, opts = {}) {
    for (const lv of levels) {
        const res = resolvePool(lv.pool, lv.state, opts);
        if (res) return { level: lv.level, ...res };
    }
    return null;
}

/** ข้อความสั้นอธิบายช่วงเวลา/วันของ entry */
export function describeWindow(entry, dayNames = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']) {
    const parts = [];
    if (hasWindow(entry)) parts.push(`${entry.from || '00:00'}–${entry.to || '24:00'}`);
    if (Array.isArray(entry?.days) && entry.days.length && entry.days.length < 7) {
        parts.push([...entry.days].sort((a, b) => a - b).map(d => dayNames[d]).join(' '));
    }
    return parts.join(' · ');
}

/** ทำให้ข้อมูลที่โหลดมามีรูปร่างครบ (กันค่าที่หายไปจากเวอร์ชันเก่า/ไฟล์ที่ถูกแก้มือ) */
export function normalizePool(pool, fallbackMode = 'daily') {
    const base = defaultPool(fallbackMode);
    if (!pool || typeof pool !== 'object') return base;
    const out = { ...base, ...pool };
    if (!MODES.includes(out.mode)) out.mode = fallbackMode;
    out.intervalMin = Math.max(1, Math.round(Number(out.intervalMin) || 60));
    out.dayStartHour = Math.min(23, Math.max(0, Math.round(Number(out.dayStartHour) || 0)));
    out.noRepeat = out.noRepeat !== false;
    out.enabled = out.enabled !== false;
    out.entries = (Array.isArray(out.entries) ? out.entries : []).filter(e => e && typeof e === 'object').map(e => ({
        ...defaultEntry(),
        ...e,
        weight: entryWeight(e),
        from: parseHM(e.from) !== null ? e.from : '',
        to: parseHM(e.to) !== null ? e.to : '',
        days: Array.isArray(e.days) ? [...new Set(e.days.map(Number).filter(d => d >= 0 && d <= 6))] : [],
    }));
    return out;
}
