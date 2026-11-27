// engine.js — ตรรกะเลือกเซท (ไม่แตะ DOM ไม่แตะ SillyTavern จึงเทสใน node ได้)
//
// คำศัพท์
//   set       เซทธีม+BG { id, name, theme, bg, bgCustom, fitting, tag, noRandom }
//             tag: 'day' | 'night' | '' (ใช้ได้ทั้งคู่) · noRandom: ไม่เอาเข้ากฎสุ่ม
//   dayNight  ช่วงกลางวัน/กลางคืนของผู้ใช้ { day: 'HH:MM', night: 'HH:MM' }
//             กลางวัน = day → night, กลางคืน = night → day · ว่างข้างใดข้างหนึ่ง = ไม่ได้ตั้ง (กฎเวลาไม่ทำงาน)
//   rule      กฎการเปลี่ยนเซท (ใช้กับทุกระดับ) { enabled, minutes, byDayNight, noRepeat }
//             minutes          สุ่มใหม่ทุกกี่นาที (15/30/60/360/720/1440) นับจาก 0:00 ตามนาฬิกาจริง
//                              (เลิกใช้โหมด "สุ่มทุกครั้งที่เปิดแชท" แล้ว — เปลี่ยนธีมทุกครั้งที่เข้าแชททำให้โหลดแชทช้า)
//             byDayNight       กฎสุ่ม (ระดับล่างสุด) เลือกเฉพาะเซทที่ตรงกับกลางวัน/กลางคืน
//   bound     เซทที่ผูกกับแชท/บอท { enabled, entries: [{ setId }] }
//             ชนะกฎสุ่มเสมอ · ใช้ความถี่ของ rule แต่ดูแท็กกลางวัน/กลางคืนเสมอ (ถ้าตั้งเวลาไว้)
//             ถ้าผูกแต่เซทกลางวันหรือกลางคืนอย่างเดียว จะใช้เซทนั้นทุกช่วงเวลา
//   state     ที่สุ่มได้ล่าสุดของระดับนั้น { setId, bucket, pk, at } · pk = จุดเริ่มช่วงกลางวัน/กลางคืน
//
// trigger
//   open     เปิดแชท — สุ่มใหม่ถ้าข้ามรอบเวลา/กลางวัน-กลางคืนไปแล้ว
//   tick     ตรวจเวลาขณะแชทเปิดค้าง (ตัวเลือก "เปลี่ยนทันที") — เหมือน open
//   refresh  ผู้ใช้แก้การตั้งค่า — คงของเดิมถ้ายังใช้ได้
//   force    ผู้ใช้กดสุ่มใหม่

export const MINUTES = Object.freeze([15, 30, 60, 360, 720, 1440]);
export const DEFAULT_MINUTES = 30;
/** HOURS ของเวอร์ชันเก่า (ใช้แปลงข้อมูลเดิม) */
export const HOURS = Object.freeze([1, 6, 12, 24]);
export const LEVELS = Object.freeze(['chat', 'bot', 'rule']);
export const TAGS = Object.freeze(['', 'day', 'night']);

export function newId() {
    return 'ks' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function defaultRule() {
    return { enabled: true, minutes: DEFAULT_MINUTES, byDayNight: false, noRepeat: true };
}

export function defaultBound() {
    return { enabled: true, entries: [] };
}

/** 'HH:MM' → นาทีนับจากเที่ยงคืน, ค่าว่าง/ผิดรูป → null */
export function parseHM(str) {
    if (typeof str !== 'string') return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(str.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
}

// ---------------------------------------------------------------- กลางวัน / กลางคืน
export function normalizeDayNight(dn) {
    const day = parseHM(dn?.day) !== null ? String(dn.day).trim() : '';
    const night = parseHM(dn?.night) !== null ? String(dn.night).trim() : '';
    return { day, night };
}

/** ตั้งเวลากลางวัน/กลางคืนครบและไม่ซ้ำกัน = กฎเวลาทำงาน */
export function dayNightReady(dn) {
    const d = parseHM(dn?.day);
    const n = parseHM(dn?.night);
    return d !== null && n !== null && d !== n;
}

function atMinutes(base, dayOffset, minutes) {
    const x = new Date(base.getTime());
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() + dayOffset);
    x.setMinutes(minutes);
    return x.getTime();
}

/**
 * ตอนนี้เป็นกลางวันหรือกลางคืน และช่วงนี้เริ่มเมื่อไร
 * @returns {null | { period: 'day'|'night', start: number }} null = ยังไม่ได้ตั้งเวลา
 */
export function periodAt(dn, now) {
    if (!dayNightReady(dn)) return null;
    const d = parseHM(dn.day);
    const n = parseHM(dn.night);
    const m = now.getHours() * 60 + now.getMinutes();
    const inDay = d < n ? (m >= d && m < n) : (m >= d || m < n);
    const startMin = inDay ? d : n;
    // ช่วงนี้เริ่มวันนี้ หรือเริ่มเมื่อวาน (ถ้ายังไม่ถึงเวลาเริ่มของวันนี้)
    const start = atMinutes(now, m >= startMin ? 0 : -1, startMin);
    return { period: inDay ? 'day' : 'night', start };
}

/**
 * เลือกเซทที่ใช้ได้ในช่วงเวลานี้
 * @param {string[]} ids
 * @param {(id: string) => string} tagOf
 * @param {null | { period: string }} period
 * @returns {{ ids: string[], aware: boolean, missing: ''|'day'|'night' }}
 *   aware = รายการนี้เปลี่ยนตามกลางวัน/กลางคืนจริง (มีเซทของทั้งสองช่วงและไม่เหมือนกัน)
 *   missing = ช่วงที่ไม่มีเซทของตัวเอง (จะใช้เซทที่มีทุกช่วงเวลา)
 */
export function forPeriod(ids, tagOf, period) {
    const day = ids.filter(id => tagOf(id) !== 'night');
    const night = ids.filter(id => tagOf(id) !== 'day');
    const tagged = ids.some(id => tagOf(id));
    const missing = !tagged || !ids.length ? '' : !day.length ? 'day' : !night.length ? 'night' : '';
    const aware = !!period && tagged && day.length > 0 && night.length > 0;
    if (!aware) return { ids, aware: false, missing };
    return { ids: period.period === 'day' ? day : night, aware: true, missing };
}

// ---------------------------------------------------------------- รอบเวลา
function localMinutes(now) {
    return Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / 60000);
}

export const minutesOf = (rule) => (MINUTES.includes(Number(rule?.minutes)) ? Number(rule.minutes) : DEFAULT_MINUTES);

/** รหัสของ "รอบ" ปัจจุบัน — ถ้ารหัสเท่าเดิมและเซทเดิมยังใช้ได้ จะไม่สุ่มใหม่ */
export function bucketFor(rule, now, pk = '') {
    const minutes = minutesOf(rule);
    const slot = Math.floor(localMinutes(now) / minutes);
    // รอบที่เป็นชั่วโมงเต็มใช้รหัสแบบเดิม (h6:…) เซทที่สุ่มไว้ก่อนอัปเดตจึงไม่ถูกสุ่มใหม่
    const head = minutes % 60 === 0 ? `h${minutes / 60}` : `m${minutes}`;
    return `${head}:${slot}${pk ? `@${pk}` : ''}`;
}

function pick(items, rng) {
    return items[Math.min(items.length - 1, Math.floor(rng() * items.length))] ?? null;
}

/**
 * ตัดสินว่าระดับนี้ใช้เซทไหน
 * @param {string[]} ids เซทที่ระดับนี้ใช้ได้ (ก่อนกรองกลางวัน/กลางคืน)
 * @param {{ setId?: string, bucket?: string, pk?: string } | null} state
 * @param {object} opts
 * @param {object} opts.rule
 * @param {boolean} opts.useTags ระดับนี้ดูแท็กกลางวัน/กลางคืนไหม
 * @param {null | { period: string, start: number }} opts.period
 * @param {(id: string) => string} opts.tagOf
 * @returns {null | { setId: string, state: object, rolled: boolean, changed: boolean, aware: boolean }}
 */
export function resolveIds(ids, state, { rule = defaultRule(), useTags = false, period = null, tagOf = () => '', now = new Date(), trigger = 'open', rng = Math.random } = {}) {
    if (!ids.length) return null;
    const scoped = forPeriod(ids, tagOf, useTags ? period : null);
    const list = scoped.ids;
    const aware = scoped.aware;
    const pk = aware ? String(period.start) : '';
    const bucket = bucketFor(rule, now, pk);

    const prev = state?.setId || '';
    const prevOk = !!prev && list.includes(prev);

    let keep = false;
    if (prevOk && trigger !== 'force') {
        // open/tick: สุ่มใหม่เมื่อข้ามรอบเวลาหรือข้ามกลางวัน/กลางคืน (รหัสรอบรวม pk ไว้แล้ว)
        // refresh: ของเดิมยังใช้ได้ ก็คงไว้
        keep = trigger === 'refresh' || state?.bucket === bucket;
    }
    if (keep) return { setId: prev, state, rolled: false, changed: false, aware };

    let candidates = list;
    if (rule.noRepeat !== false && prev && list.length > 1) candidates = list.filter(id => id !== prev);
    const setId = pick(candidates, rng);
    return { setId, state: { setId, bucket, pk, at: now.getTime() }, rolled: true, changed: setId !== prev, aware };
}

/**
 * ไล่ระดับตามลำดับความสำคัญ แชท > บอท > กฎสุ่ม · ระดับแรกที่มีเซทใช้ได้ชนะเสมอ
 * @param {Array<{ level: string, ids: string[], state: object|null, useTags: boolean }>} levels
 */
export function resolveLevels(levels, opts = {}) {
    for (const lv of levels) {
        const res = resolveIds(lv.ids, lv.state, { ...opts, useTags: lv.useTags });
        if (res) return { level: lv.level, ...res };
    }
    return null;
}

/**
 * CHAT_CHANGED / APP_READY นับเป็น "เปิดแชท" (สุ่มใหม่ได้) ไหม
 * ST ส่ง CHAT_CHANGED ตอนกลับหน้าแรก (ไม่มีแชท), ตอนโหลดหน้าแล้วเปิดแชทเดิมให้, ตอนเปลี่ยนชื่อแชท ฯลฯ ด้วย
 * → นับเฉพาะตอนเข้าแชทที่ต่างจากแชทที่เปิดอยู่ก่อนหน้า
 * @param {string} chatKey แชทที่เปิดอยู่ตอนนี้ ('' = ไม่มี)
 * @param {string|null} lastOpened แชทก่อนหน้าในหน้านี้ (null = เพิ่งโหลดหน้า, '' = อยู่หน้าแรก)
 * @param {string} remembered แชทล่าสุดที่จำไว้ข้ามการโหลดหน้า
 * @returns {{ trigger: 'open'|'refresh', lastOpened: string, remember: string }}
 */
export function classifyOpen(chatKey, lastOpened, remembered = '') {
    if (!chatKey) return { trigger: 'refresh', lastOpened: '', remember: remembered };
    const prev = lastOpened ?? remembered ?? '';
    if (chatKey === prev) return { trigger: 'refresh', lastOpened: chatKey, remember: remembered };
    return { trigger: 'open', lastOpened: chatKey, remember: chatKey };
}

// ---------------------------------------------------------------- normalize / ย้ายข้อมูลเก่า
/** รับทั้งรูปแบบใหม่ { minutes } และแบบเก่า { mode: 'open'|'interval', hours } */
export function normalizeRule(rule) {
    const src = rule && typeof rule === 'object' ? rule : {};
    let minutes = Number(src.minutes);
    if (!MINUTES.includes(minutes)) {
        minutes = src.mode === 'interval' && HOURS.includes(Number(src.hours)) ? Number(src.hours) * 60 : DEFAULT_MINUTES;
    }
    return {
        enabled: src.enabled !== false,
        minutes,
        byDayNight: src.byDayNight === true,
        noRepeat: src.noRepeat !== false,
    };
}

/** รับทั้งรูปแบบใหม่และ pool เก่า (v1: mode/weight/from/to/days) → เก็บแค่เซทที่ผูก */
export function normalizeBound(pool) {
    if (!pool || typeof pool !== 'object') return defaultBound();
    const seen = new Set();
    const entries = (Array.isArray(pool.entries) ? pool.entries : [])
        .filter(e => e && typeof e === 'object' && e.setId && !seen.has(e.setId) && seen.add(e.setId))
        .map(e => ({ setId: String(e.setId) }));
    return { enabled: pool.enabled !== false, entries };
}

/** ใกล้ที่สุดใน HOURS (ใช้แปลงรอบเวลาแบบนาทีของเวอร์ชันเก่า) */
export function nearestHours(minutes) {
    const h = (Number(minutes) || 60) / 60;
    return HOURS.reduce((best, x) => (Math.abs(x - h) < Math.abs(best - h) ? x : best), HOURS[0]);
}

/**
 * แปลงกติกา "ตามเวลา" ของ v1 เป็นกฎสุ่มแบบใหม่
 * @returns {{ rule: object, inRandom: Set<string> | null }} inRandom = เซทที่เคยอยู่ในกติกาเดิม (null = ไม่มีกติกาเดิม)
 */
export function migrateGlobal(global) {
    const rule = defaultRule();
    const entries = Array.isArray(global?.entries) ? global.entries.filter(e => e?.setId && Number(e.weight ?? 1) > 0) : [];
    if (!global || !entries.length) return { rule: { ...rule, enabled: false }, inRandom: null };
    rule.enabled = global.enabled !== false;
    rule.noRepeat = global.noRepeat !== false;
    if (global.mode === 'interval') rule.minutes = nearestHours(global.intervalMin) * 60;
    else if (global.mode === 'daily') rule.minutes = 1440;
    else rule.minutes = DEFAULT_MINUTES;
    return { rule, inRandom: new Set(entries.map(e => e.setId)) };
}
