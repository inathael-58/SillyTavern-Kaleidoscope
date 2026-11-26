// core.js — การตั้งค่า, การตัดสินเซท และการใส่ธีม/BG ให้ SillyTavern
import {
    normalizeBound, normalizeRule, normalizeDayNight, dayNightReady, periodAt, forPeriod,
    resolveLevels, resolveIds, migrateGlobal, defaultRule, classifyOpen, newId, TAGS,
} from './engine.js';

export const MODULE = 'kaleidoscope';
export const META_KEY = 'kaleidoscope';
export const EXT_URL = new URL('.', import.meta.url).pathname.replace(/\/$/, '');

const ST_BG_LOCK_KEY = 'custom_background';
const FITTINGS = ['classic', 'cover', 'contain', 'stretch', 'center'];
const CHAT_STATE_LIMIT = 300;

export const ctx = () => SillyTavern.getContext();

// ---------------------------------------------------------------- log (ใช้ในหน้าตรวจสอบ)
export const log = [];
export function note(kind, msg) {
    log.push(`${new Date().toLocaleTimeString()} ${kind} ${msg}`);
    if (log.length > 40) log.shift();
    if (kind === 'error') console.error('[Kaleidoscope]', msg);
    else console.debug('[Kaleidoscope]', kind, msg);
}

// ---------------------------------------------------------------- settings
const DEFAULTS = {
    version: 3,
    enabled: true,
    respectChatBgLock: true,
    liveTime: false,    // เปลี่ยนทันทีเมื่อข้ามกลางวัน/กลางคืน ขณะแชทเปิดค้าง
    notify: false,
    sets: [],
    characters: {},     // 'char:<avatar>' | 'group:<id>' → bound { enabled, entries: [{ setId }] }
    rule: null,         // กฎการเปลี่ยนเซท (ระดับล่างสุด + ความถี่ของทุกระดับ)
    dayNight: { day: '', night: '' },
    botState: {},       // botKey → state
    globalState: null,  // state ของกฎสุ่ม
    lastChat: '',       // แชทที่เปิดล่าสุด (กันการสุ่มใหม่ตอนโหลดหน้าแล้ว ST เปิดแชทเดิม)
    chatState: {},      // `${botKey}|${chatId}` → state
    baseTheme: '',      // ธีมปกติของผู้ใช้ (ใช้คืนเมื่อไม่มีเซทกำหนดธีม)
    appliedTheme: '',   // ธีมที่เราใส่ไว้ล่าสุด ('' = ไม่ได้ใส่)
};

export function settings() {
    const all = ctx().extensionSettings;
    if (!all[MODULE] || typeof all[MODULE] !== 'object') all[MODULE] = {};
    const s = all[MODULE];
    for (const [k, v] of Object.entries(DEFAULTS)) {
        if (s[k] === undefined) s[k] = structuredClone(v);
    }
    if (!Array.isArray(s.sets)) s.sets = [];
    if (!s.characters || typeof s.characters !== 'object') s.characters = {};
    if (!s.botState || typeof s.botState !== 'object') s.botState = {};
    if (!s.chatState || typeof s.chatState !== 'object') s.chatState = {};
    return s;
}

export const save = () => ctx().saveSettingsDebounced();

export function normalizeAll() {
    const s = settings();
    // v1 → v2: กติกา "ตามเวลา" กลายเป็นกฎการเปลี่ยนเซท · เซทที่ไม่ได้อยู่ในกติกาเดิมจะไม่ถูกสุ่ม
    let inRandom = null;
    if (!s.rule || (Number(s.version) || 1) < 2) {
        const m = migrateGlobal(s.global);
        // ติดตั้งใหม่ (ยังไม่มีเซท) → เปิดกฎสุ่มไว้ · ผู้ใช้เดิมที่ไม่เคยตั้งกติกาตามเวลา → ปิดไว้เหมือนเดิม
        if (!s.rule) s.rule = !s.global && !s.sets.length ? defaultRule() : m.rule;
        inRandom = m.inRandom;
        if (s.global) note('ok', `ย้ายกติกาตามเวลาเดิมเป็นกฎ: ${s.rule.mode}/${s.rule.hours} enabled=${s.rule.enabled}`);
        delete s.global;
        s.globalState = null;
        s.version = 2;
    }
    s.sets = s.sets.filter(x => x && typeof x === 'object').map(x => ({
        id: x.id || newId(),
        name: String(x.name ?? 'เซท'),
        theme: String(x.theme ?? ''),
        bg: String(x.bg ?? ''),
        bgCustom: String(x.bgCustom ?? ''),
        fitting: FITTINGS.includes(x.fitting) ? x.fitting : '',
        tag: TAGS.includes(x.tag) ? x.tag : '',
        noRandom: inRandom ? !inRandom.has(x.id) : x.noRandom === true,
    }));
    for (const k of Object.keys(s.characters)) s.characters[k] = normalizeBound(s.characters[k]);
    s.rule = normalizeRule(s.rule);
    s.dayNight = normalizeDayNight(s.dayNight);
    // v2 → v3: ตั้งเวลากลางวัน/กลางคืนไว้แล้วแต่กฎสุ่มยังเป็น "ทุกเซท" (ค่าเริ่มต้นเดิม) → เปิดตามกลางวัน/กลางคืนให้
    if ((Number(s.version) || 1) < 3) {
        if (dayNightReady(s.dayNight) && !s.rule.byDayNight) {
            s.rule.byDayNight = true;
            note('ok', 'เปิดกฎสุ่มตามกลางวัน/กลางคืนให้ (ตั้งเวลาไว้แล้ว)');
        }
        s.version = 3;
    }
}

export const tagOf = (id) => getSet(id)?.tag || '';
export const timeReady = () => dayNightReady(settings().dayNight);
export const currentPeriod = (now = new Date()) => periodAt(settings().dayNight, now);

/** เซทที่ผูกไว้ขาดช่วงไหน ('' = ครบ/ไม่ได้แยก) — ใช้เตือนว่าจะชนะกฎเวลาเสมอ */
export function boundMissing(level) {
    const pool = getPool(level);
    if (!pool) return '';
    return forPeriod(boundIds(pool), tagOf, null).missing;
}

function boundIds(pool) {
    const valid = new Set(settings().sets.map(x => x.id));
    return pool && pool.enabled !== false ? pool.entries.map(e => e.setId).filter(id => valid.has(id)) : [];
}

/** เซทที่เข้ากฎสุ่ม */
export function randomIds() {
    const s = settings();
    return s.rule?.enabled ? s.sets.filter(x => !x.noRandom).map(x => x.id) : [];
}

export function getSet(id) {
    return settings().sets.find(x => x.id === id) || null;
}

// ---------------------------------------------------------------- scope (แชท / บอท ที่เปิดอยู่)
export function scope() {
    const c = ctx();
    const chatId = c.getCurrentChatId?.() || '';
    let botKey = '';
    let botName = '';
    if (c.groupId) {
        botKey = `group:${c.groupId}`;
        botName = c.groups?.find(g => String(g.id) === String(c.groupId))?.name || 'กลุ่ม';
    } else if (c.characterId !== undefined && c.characterId !== null && c.characters?.[c.characterId]) {
        const ch = c.characters[c.characterId];
        botKey = `char:${ch.avatar}`;
        botName = ch.name;
    }
    return { chatId, botKey, botName, chatKey: chatId ? `${botKey}|${chatId}` : '' };
}

/** pool ของระดับนั้นสำหรับแชท/บอทปัจจุบัน (null = ยังไม่กำหนด) */
export function getPool(level) {
    const s = settings();
    const sc = scope();
    if (level === 'chat') {
        if (!sc.chatId) return null;
        const meta = ctx().chatMetadata?.[META_KEY];
        return meta?.pool ? normalizeBound(meta.pool) : null;
    }
    if (level === 'bot') return sc.botKey && s.characters[sc.botKey] ? s.characters[sc.botKey] : null;
    return null;
}

/** สร้าง pool ใหม่ถ้ายังไม่มี แล้วคืนตัวที่แก้ได้ */
export function ensurePool(level) {
    const s = settings();
    const sc = scope();
    if (level === 'chat') {
        if (!sc.chatId) return null;
        const md = ctx().chatMetadata;
        if (!md[META_KEY] || typeof md[META_KEY] !== 'object') md[META_KEY] = {};
        md[META_KEY].pool = normalizeBound(md[META_KEY].pool);
        return md[META_KEY].pool;
    }
    if (level === 'bot') {
        if (!sc.botKey) return null;
        s.characters[sc.botKey] = normalizeBound(s.characters[sc.botKey]);
        return s.characters[sc.botKey];
    }
    return null;
}

export function savePool(level) {
    if (level === 'chat') ctx().saveMetadataDebounced();
    else save();
}

export function clearPool(level) {
    const s = settings();
    const sc = scope();
    if (level === 'chat') {
        const md = ctx().chatMetadata;
        if (md?.[META_KEY]) {
            delete md[META_KEY];
            ctx().saveMetadataDebounced();
        }
        if (sc.chatKey) delete s.chatState[sc.chatKey];
    } else if (level === 'bot') {
        delete s.characters[sc.botKey];
        delete s.botState[sc.botKey];
    }
    save();
}

function getState(level, sc) {
    const s = settings();
    if (level === 'chat') return s.chatState[sc.chatKey] || null;
    if (level === 'bot') return s.botState[sc.botKey] || null;
    return s.globalState || null;
}

function setState(level, sc, st) {
    const s = settings();
    if (level === 'chat') {
        s.chatState[sc.chatKey] = st;
        const keys = Object.keys(s.chatState);
        if (keys.length > CHAT_STATE_LIMIT) {
            keys.sort((a, b) => (s.chatState[a]?.at || 0) - (s.chatState[b]?.at || 0));
            for (const k of keys.slice(0, keys.length - CHAT_STATE_LIMIT)) delete s.chatState[k];
        }
    } else if (level === 'bot') {
        s.botState[sc.botKey] = st;
    } else {
        s.globalState = st;
    }
}

/** ระดับไหนใช้เซทนี้อยู่บ้าง (เท่าที่มองเห็นได้: แชทที่เปิดอยู่ + ทุกบอท + เวลา) */
export function usageOf(setId) {
    const s = settings();
    const out = [];
    const chatPool = getPool('chat');
    if (chatPool?.entries.some(e => e.setId === setId)) out.push('แชทนี้');
    const bots = Object.values(s.characters).filter(p => p?.entries?.some(e => e.setId === setId)).length;
    if (bots) out.push(`บอท ${bots} ตัว`);
    if (s.rule?.enabled && !getSet(setId)?.noRandom) out.push('กฎสุ่ม');
    return out;
}

export function removeSetEverywhere(setId) {
    const s = settings();
    s.sets = s.sets.filter(x => x.id !== setId);
    const strip = (p) => { if (p?.entries) p.entries = p.entries.filter(e => e.setId !== setId); };
    Object.values(s.characters).forEach(strip);
    const md = ctx().chatMetadata;
    if (md?.[META_KEY]?.pool) {
        strip(md[META_KEY].pool);
        ctx().saveMetadataDebounced();
    }
    save();
}

// ---------------------------------------------------------------- themes & backgrounds lists
export function listThemes() {
    return Array.from(document.querySelectorAll('#themes option'))
        .map(o => o.value)
        .filter(Boolean);
}

let bgCache = null;
export async function listBackgrounds(force = false) {
    if (bgCache && !force) return bgCache;
    const c = ctx();
    const res = await fetch('/api/backgrounds/all', {
        method: 'POST',
        headers: c.getRequestHeaders(),
        body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`โหลดรายการ BG ไม่ได้ (HTTP ${res.status})`);
    const data = await res.json();
    // ST ใหม่: { images: [{ filename }] } · ST เก่า: [ 'a.jpg', ... ]
    const raw = Array.isArray(data) ? data : (data?.images || []);
    const files = raw.map(x => (typeof x === 'string' ? x : x?.filename)).filter(Boolean);

    let folders = [];
    let folderMap = {};
    try {
        const fr = await fetch('/api/backgrounds/folders', {
            method: 'POST',
            headers: c.getRequestHeaders(),
            body: JSON.stringify({}),
        });
        if (fr.ok) {
            const fd = await fr.json();
            folders = Array.isArray(fd?.folders) ? fd.folders : [];
            folderMap = fd?.imageFolderMap || {};
        }
    } catch { /* ST รุ่นที่ยังไม่มีโฟลเดอร์ */ }

    bgCache = { files, folders, folderMap };
    return bgCache;
}

export function bgThumb(file) {
    const c = ctx();
    return c.getThumbnailUrl ? c.getThumbnailUrl('bg', file) : `/thumbnail?type=bg&file=${encodeURIComponent(file)}`;
}

/** ค่า background-image ของเซท ('' = ไม่กำหนด) */
export function setBgCss(set) {
    if (!set) return '';
    if (set.bgCustom) return `url("${encodeURI(set.bgCustom)}")`;
    if (set.bg) return `url("backgrounds/${encodeURIComponent(set.bg)}")`;
    return '';
}

// background_settings ของ ST ไม่อยู่ใน getContext → import โมดูลตรง (ถ้าไม่ได้ จะใช้ภาพที่จำไว้ก่อนเราเปลี่ยน)
let bgModule = null;
let bgModuleTried = false;
async function stBackgrounds() {
    if (bgModuleTried) return bgModule;
    bgModuleTried = true;
    try {
        bgModule = await import('../../../backgrounds.js');
    } catch (err) {
        note('warn', `import backgrounds.js ไม่ได้: ${err?.message || err}`);
    }
    return bgModule;
}
export const bgModuleLoaded = () => !!bgModule?.background_settings;

let bgSnapshot = null;

function stBaseBg() {
    const lock = ctx().chatMetadata?.[ST_BG_LOCK_KEY];
    if (lock) return { url: lock, locked: true };
    const url = bgModule?.background_settings?.url;
    if (url) return { url, locked: false };
    return { url: bgSnapshot, locked: false };
}

function setFitting(fitting) {
    const el = document.getElementById('bg1');
    if (!el) return;
    const base = bgModule?.background_settings?.fitting || 'classic';
    const f = FITTINGS.includes(fitting) ? fitting : base;
    for (const o of ['cover', 'contain', 'stretch', 'center']) el.classList.toggle(o, o === f);
}

// ---------------------------------------------------------------- apply
let applyingTheme = false;
export const isApplyingTheme = () => applyingTheme;

function switchTheme(name) {
    const sel = document.getElementById('themes');
    if (!sel || !Array.from(sel.options).some(o => o.value === name)) {
        note('warn', `ไม่พบธีม "${name}"`);
        return false;
    }
    applyingTheme = true;
    try {
        $(sel).val(name).trigger('change');
    } finally {
        applyingTheme = false;
    }
    return true;
}

function applyTheme(set) {
    const s = settings();
    const power = ctx().powerUserSettings;
    const cur = power?.theme || '';
    // ผู้ใช้เปลี่ยนธีมเองหลังจากที่เราใส่ไว้ (หรือเรายังไม่เคยใส่) → ธีมปัจจุบันคือธีมปกติของเขา
    if (cur && (!s.appliedTheme || cur !== s.appliedTheme)) s.baseTheme = cur;

    const themes = listThemes();
    const wanted = set?.theme && themes.includes(set.theme) ? set.theme : '';
    if (set?.theme && !wanted) note('warn', `เซท "${set.name}" ใช้ธีม "${set.theme}" ที่ไม่มีแล้ว`);
    const target = wanted || s.baseTheme;
    s.appliedTheme = wanted;
    if (target && target !== cur) switchTheme(target);
}

async function applyBg(set, level) {
    await stBackgrounds();
    const el = document.getElementById('bg1');
    if (!el) return;
    if (bgSnapshot === null) bgSnapshot = el.style.backgroundImage || '';

    const s = settings();
    const base = stBaseBg();
    const own = setBgCss(set);
    // BG ที่ล็อกกับแชทด้วยปุ่มของ ST เอง ถือเป็นการกำหนดระดับแชท → ชนะเซทจากระดับบอท/เวลา
    const blockedByLock = !!own && base.locked && s.respectChatBgLock && level !== 'chat' && level !== 'preview';
    const useOwn = !!own && !blockedByLock;
    bgInfo.blockedByLock = blockedByLock;
    if (useOwn) {
        // !important: ธีมที่มี custom CSS แบบ #bg1 { background-image: … !important } จะทับ BG ของเซทไม่ได้
        // (ST เขียน #bg1 ทีหลังได้ตามปกติ เพราะ jQuery .css เขียนทับค่า inline เดิม)
        el.style.setProperty('background-image', own, 'important');
    } else {
        // คืนให้ ST/ธีมคุมตามเดิม — ล้าง !important ของเราออกก่อน
        el.style.removeProperty('background-image');
        if (base.url) el.style.backgroundImage = base.url;
    }
    setFitting(useOwn ? set.fitting : '');
}

/** ผลการใส่ BG ล่าสุด (ใช้แสดงสถานะ/ตรวจสอบ) */
export const bgInfo = { blockedByLock: false };

export const status = { level: '', setId: '', setName: '', mode: '', period: '', at: 0, trigger: '', note: '' };

function modeOf() {
    const r = settings().rule;
    return r ? (r.mode === 'interval' ? `interval:${r.hours}` : 'open') : '';
}

async function apply(set, level, why = {}) {
    applyTheme(set);
    await applyBg(set, level);
    Object.assign(status, {
        level, setId: set?.id || '', setName: set?.name || '', mode: why.mode || '', period: why.period || '',
        at: Date.now(), trigger: why.trigger || '', note: why.note || '',
    });
    save();
    for (const fn of listeners) { try { fn(status); } catch { /* ignore */ } }
}

const listeners = new Set();
export function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// แชทที่เปิดอยู่ล่าสุด — "เปิดแชท" นับเฉพาะตอนเข้าแชทที่ต่างจากแชทนี้
// null = เพิ่งโหลดหน้า (ใช้ค่าที่จำไว้ใน settings) · '' = อยู่หน้าแรก/ไม่มีแชทเปิดอยู่
let lastOpened = null;

/**
 * ตัดสินแล้วใส่เซท
 * @param {'open'|'refresh'|'tick'|'force'} trigger
 */
export async function evaluate(trigger = 'refresh') {
    const s = settings();
    if (!s.enabled) return null;
    try {
        const sc = scope();
        if (trigger === 'open') trigger = openTrigger(sc.chatKey);
        // tick: เปลี่ยนได้เฉพาะตอนข้ามกลางวัน/กลางคืน → ไม่ได้ตั้งเวลาไว้ก็ไม่มีอะไรต้องตรวจ
        if (trigger === 'tick' && !timeReady()) return null;

        const res = resolveLevels(levelList(sc), resolveOpts(trigger));
        if (res?.rolled) setState(res.level, sc, res.state);

        const set = res ? getSet(res.setId) : null;
        const prevKey = `${status.level}|${status.setId}`;
        const nextKey = `${res?.level || ''}|${set?.id || ''}`;
        if (trigger === 'tick' && prevKey === nextKey) return res;

        await apply(set, res?.level || '', { trigger, mode: res ? modeOf() : '', period: res?.aware ? currentPeriod()?.period || '' : '' });
        if (set && s.notify && prevKey !== nextKey && trigger !== 'refresh') {
            toastr.info(set.name, 'Kaleidoscope', { timeOut: 2500 });
        }
        note('ok', `${trigger} → ${res ? `${res.level}:${set?.name}` : 'ค่าปกติ'}`);
        return res;
    } catch (err) {
        note('error', err?.stack || String(err));
        return null;
    }
}

/**
 * ST ส่ง CHAT_CHANGED หลายจังหวะที่ไม่ใช่การเปิดแชท: กลับหน้าแรก (ไม่มีแชท), โหลดหน้าใหม่แล้ว ST เปิดแชทเดิมให้,
 * เปลี่ยนชื่อแชท ฯลฯ → นับเป็นการเปิดแชท (สุ่มใหม่ได้) เฉพาะตอนเข้าแชทที่ต่างจากแชทที่เปิดอยู่ก่อนหน้า
 * @returns {'open'|'refresh'}
 */
function openTrigger(chatKey) {
    const s = settings();
    const r = classifyOpen(chatKey, lastOpened, s.lastChat || '');
    lastOpened = r.lastOpened;
    s.lastChat = r.remember;
    return r.trigger;
}

/** สุ่มใหม่เฉพาะระดับที่เลือก แล้วตัดสินทั้งหมดอีกรอบ */
export async function rerollLevel(level) {
    const sc = scope();
    const lv = levelList(sc).find(x => x.level === level);
    if (!lv) return null;
    const res = resolveIds(lv.ids, lv.state, { ...resolveOpts('force'), useTags: lv.useTags });
    if (res) setState(level, sc, res.state);
    return evaluate('refresh');
}

/** ระดับทั้งหมดตามลำดับความสำคัญ: แชท › บอท › กฎสุ่ม */
function levelList(sc) {
    const s = settings();
    return [
        { level: 'chat', ids: boundIds(getPool('chat')), state: getState('chat', sc), useTags: true },
        { level: 'bot', ids: boundIds(getPool('bot')), state: getState('bot', sc), useTags: true },
        { level: 'rule', ids: randomIds(), state: getState('rule', sc), useTags: !!s.rule?.byDayNight },
    ];
}

function resolveOpts(trigger) {
    const now = new Date();
    return { rule: settings().rule, period: currentPeriod(now), tagOf, now, trigger };
}

/** state ล่าสุดของระดับนั้น (ใช้แสดงในหน้าจัดการ) */
export function stateOf(level) {
    return getState(level, scope());
}

/** ลองใช้เซทชั่วคราว จนกว่าจะเปิดแชทใหม่ */
export async function preview(setId) {
    const set = getSet(setId);
    if (!set) return false;
    await apply(set, 'preview', { trigger: 'preview' });
    return true;
}

/** คืนค่าปกติของผู้ใช้ (ใช้ตอนปิด extension) */
export async function restoreBase() {
    await apply(null, '', { trigger: 'off' });
}

/** เซทใหม่จากธีม+BG ที่ใช้อยู่ตอนนี้ */
export function setFromCurrent() {
    const power = ctx().powerUserSettings;
    const el = document.getElementById('bg1');
    const css = el?.style.backgroundImage || '';
    let bg = '';
    let bgCustom = '';
    const m = /url\(["']?(.*?)["']?\)/.exec(css);
    if (m) {
        const raw = m[1];
        const sys = /(?:^|\/)backgrounds\/([^?#]+)$/.exec(raw);
        if (sys) bg = decodeURIComponent(sys[1]);
        else bgCustom = decodeURI(raw);
    }
    const fitting = FITTINGS.find(f => el?.classList.contains(f)) || '';
    return {
        id: newId(),
        name: power?.theme || 'เซทใหม่',
        theme: power?.theme || '',
        bg, bgCustom, fitting, tag: '', noRandom: false,
    };
}

export function newSet() {
    return { id: newId(), name: `เซท ${settings().sets.length + 1}`, theme: '', bg: '', bgCustom: '', fitting: '', tag: '', noRandom: false };
}

export function onCharacterRenamed(oldAvatar, newAvatar) {
    const s = settings();
    const o = `char:${oldAvatar}`;
    const n = `char:${newAvatar}`;
    if (s.characters[o]) { s.characters[n] = s.characters[o]; delete s.characters[o]; }
    if (s.botState[o]) { s.botState[n] = s.botState[o]; delete s.botState[o]; }
    for (const k of Object.keys(s.chatState)) {
        if (k.startsWith(`${o}|`)) { s.chatState[n + k.slice(o.length)] = s.chatState[k]; delete s.chatState[k]; }
    }
    save();
}

