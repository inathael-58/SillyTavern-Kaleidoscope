// core.js — การตั้งค่า, การตัดสินเซท และการใส่ธีม/BG ให้ SillyTavern
import {
    defaultPool, normalizePool, resolveLevels, newId, LEVELS,
} from './engine.js';

export const MODULE = 'north_star';
export const META_KEY = 'north_star';
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
    if (kind === 'error') console.error('[North Star]', msg);
    else console.debug('[North Star]', kind, msg);
}

// ---------------------------------------------------------------- settings
const DEFAULTS = {
    version: 1,
    enabled: true,
    respectChatBgLock: true,
    liveTime: false,
    notify: false,
    sets: [],
    characters: {},     // 'char:<avatar>' | 'group:<id>' → pool
    global: null,       // pool ระดับเวลา (ล่างสุด)
    botState: {},       // botKey → state
    globalState: null,
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
    s.sets = s.sets.filter(x => x && typeof x === 'object').map(x => ({
        id: x.id || newId(),
        name: String(x.name ?? 'เซท'),
        theme: String(x.theme ?? ''),
        bg: String(x.bg ?? ''),
        bgCustom: String(x.bgCustom ?? ''),
        fitting: FITTINGS.includes(x.fitting) ? x.fitting : '',
    }));
    for (const k of Object.keys(s.characters)) s.characters[k] = normalizePool(s.characters[k], 'daily');
    if (s.global) s.global = normalizePool(s.global, 'time');
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
        return meta?.pool ? normalizePool(meta.pool, 'open') : null;
    }
    if (level === 'bot') return sc.botKey && s.characters[sc.botKey] ? s.characters[sc.botKey] : null;
    return s.global;
}

/** สร้าง pool ใหม่ถ้ายังไม่มี แล้วคืนตัวที่แก้ได้ */
export function ensurePool(level) {
    const s = settings();
    const sc = scope();
    if (level === 'chat') {
        if (!sc.chatId) return null;
        const md = ctx().chatMetadata;
        if (!md[META_KEY] || typeof md[META_KEY] !== 'object') md[META_KEY] = {};
        md[META_KEY].pool = normalizePool(md[META_KEY].pool, 'open');
        return md[META_KEY].pool;
    }
    if (level === 'bot') {
        if (!sc.botKey) return null;
        s.characters[sc.botKey] = normalizePool(s.characters[sc.botKey], 'daily');
        return s.characters[sc.botKey];
    }
    s.global = normalizePool(s.global, 'time');
    return s.global;
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
    } else {
        s.global = null;
        s.globalState = null;
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
    if (s.global?.entries?.some(e => e.setId === setId)) out.push('ตามเวลา');
    return out;
}

export function removeSetEverywhere(setId) {
    const s = settings();
    s.sets = s.sets.filter(x => x.id !== setId);
    const strip = (p) => { if (p?.entries) p.entries = p.entries.filter(e => e.setId !== setId); };
    Object.values(s.characters).forEach(strip);
    strip(s.global);
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
    const blockedByLock = base.locked && s.respectChatBgLock && level !== 'chat' && level !== 'preview';
    const url = own && !blockedByLock ? own : base.url;
    if (url) $(el).css('background-image', url);
    setFitting(own && !blockedByLock ? set.fitting : '');
}

export const status = { level: '', setId: '', setName: '', mode: '', at: 0, trigger: '', note: '' };

function modeOf(level) {
    return getPool(level)?.mode || '';
}

async function apply(set, level, why = {}) {
    applyTheme(set);
    await applyBg(set, level);
    Object.assign(status, {
        level, setId: set?.id || '', setName: set?.name || '', mode: why.mode || '',
        at: Date.now(), trigger: why.trigger || '', note: why.note || '',
    });
    save();
    for (const fn of listeners) { try { fn(status); } catch { /* ignore */ } }
}

const listeners = new Set();
export function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// กันการสุ่มซ้ำสองรอบตอนเปิดหน้า (APP_READY + CHAT_CHANGED ของแชทเดียวกัน)
let lastOpen = { key: null, at: 0 };

/**
 * ตัดสินแล้วใส่เซท
 * @param {'open'|'refresh'|'tick'|'force'} trigger
 */
export async function evaluate(trigger = 'refresh') {
    const s = settings();
    if (!s.enabled) return null;
    try {
        const sc = scope();
        if (trigger === 'open') {
            const key = sc.chatKey || '(none)';
            if (lastOpen.key === key && Date.now() - lastOpen.at < 2000) trigger = 'refresh';
            lastOpen = { key, at: Date.now() };
        }
        const validIds = new Set(s.sets.map(x => x.id));
        const levels = LEVELS
            .map(level => ({ level, pool: getPool(level), state: getState(level, sc) }))
            .filter(x => x.pool);

        // tick: ถ้าไม่มีระดับไหนเป็นโหมด time ก็ไม่มีอะไรต้องตรวจ
        if (trigger === 'tick' && !levels.some(x => x.pool.mode === 'time' && x.pool.enabled)) return null;

        const res = resolveLevels(levels, { trigger, validIds });
        if (res?.rolled) setState(res.level, sc, res.state);

        const set = res ? getSet(res.setId) : null;
        const prevKey = `${status.level}|${status.setId}`;
        const nextKey = `${res?.level || ''}|${set?.id || ''}`;
        if (trigger === 'tick' && prevKey === nextKey) return res;

        await apply(set, res?.level || '', { trigger, mode: res ? modeOf(res.level) : '' });
        if (set && s.notify && prevKey !== nextKey && trigger !== 'refresh') {
            toastr.info(set.name, 'North Star', { timeOut: 2500 });
        }
        note('ok', `${trigger} → ${res ? `${res.level}:${set?.name}` : 'ค่าปกติ'}`);
        return res;
    } catch (err) {
        note('error', err?.stack || String(err));
        return null;
    }
}

/** สุ่มใหม่เฉพาะระดับที่เลือก แล้วตัดสินทั้งหมดอีกรอบ */
export async function rerollLevel(level) {
    const sc = scope();
    const pool = getPool(level);
    if (!pool) return null;
    const validIds = new Set(settings().sets.map(x => x.id));
    const res = resolveLevels([{ level, pool, state: getState(level, sc) }], { trigger: 'force', validIds });
    if (res) setState(level, sc, res.state);
    return evaluate('refresh');
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
        bg, bgCustom, fitting,
    };
}

export function newSet() {
    return { id: newId(), name: `เซท ${settings().sets.length + 1}`, theme: '', bg: '', bgCustom: '', fitting: '' };
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

export { defaultPool };
