// Kaleidoscope — เซทธีม+BG ที่เลือกตามแชท › บอท › เวลา สำหรับ SillyTavern
import {
    ctx, settings, normalizeAll, evaluate, preview, status, getSet, note, onCharacterRenamed,
} from './core.js';
import { renderDrawer, openManager, diagnose, managerOpen, rerollNow } from './ui.js';
import { installThemePalette } from './theme-palette.js';

let tickTimer = null;

function startTick() {
    clearInterval(tickTimer);
    // ตรวจทุก 30 วินาที แต่ทำงานจริงเฉพาะเมื่อเปิด "เปลี่ยนตามช่วงเวลาทันที" และมีกติกาโหมด time
    tickTimer = setInterval(() => {
        const s = settings();
        if (s.enabled && s.liveTime && document.visibilityState !== 'hidden' && !managerOpen()) evaluate('tick');
    }, 30000);
}

function wandItem(id, icon, label, onClick) {
    const item = document.createElement('div');
    item.id = id;
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.innerHTML = `<div class="fa-solid ${icon} extensionsMenuExtensionButton"></div><span>${label}</span>`;
    item.addEventListener('click', onClick);
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } });
    return item;
}

function addWandItem() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('kls_wand')) return;
    menu.appendChild(wandItem('kls_wand_reroll', 'fa-shuffle', 'สุ่มธีมใหม่', rerollNow));
    menu.appendChild(wandItem('kls_wand', 'fa-shapes', 'Kaleidoscope', () => openManager()));
}

function registerCommands() {
    const c = ctx();
    const { SlashCommandParser, SlashCommand, SlashCommandArgument } = c;
    if (!SlashCommandParser || !SlashCommand) return;

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'kal-reroll',
        callback: async () => {
            const res = await evaluate('force');
            return res ? (getSet(res.setId)?.name || '') : '';
        },
        helpString: 'Kaleidoscope: สุ่มเซทใหม่ตามกติกาของแชท/บอท/เวลาที่ใช้อยู่ คืนชื่อเซทที่ได้',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'kal-set',
        callback: async (_args, value) => {
            const name = String(value ?? '').trim();
            if (!name) return status.setName || '';
            const sets = settings().sets;
            const set = sets.find(x => x.name === name) || sets.find(x => x.name.toLowerCase().includes(name.toLowerCase()));
            if (!set) { toastr.warning(`ไม่พบเซท "${name}"`, 'Kaleidoscope'); return ''; }
            await preview(set.id);
            return set.name;
        },
        unnamedArgumentList: SlashCommandArgument ? [SlashCommandArgument.fromProps({
            description: 'ชื่อเซท (เว้นว่าง = คืนชื่อเซทที่ใช้อยู่)',
            typeList: ['string'],
            isRequired: false,
            enumProvider: () => settings().sets.map(x => new c.SlashCommandEnumValue(x.name)),
        })] : [],
        helpString: 'Kaleidoscope: ลองใช้เซทตามชื่อจนกว่าจะเข้าแชทใหม่ · ไม่ใส่ชื่อ = คืนชื่อเซทที่ใช้อยู่',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'kal-open',
        callback: async () => { openManager(); return ''; },
        helpString: 'Kaleidoscope: เปิดหน้าจัดการเซท',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'kal-debug',
        callback: async () => diagnose(),
        helpString: 'Kaleidoscope: คืนรายงานตรวจสอบ (ใช้ส่งให้ผู้พัฒนาเมื่อมีปัญหา)',
    }));
}

async function init() {
    const c = ctx();
    settings();
    normalizeAll();

    try { installThemePalette({ prefix: 'kls' }); } catch (err) { console.warn('[Kaleidoscope] theme palette', err); }

    try { renderDrawer(); } catch (err) { note('error', `drawer: ${err?.stack || err}`); }
    try { addWandItem(); } catch (err) { note('error', `wand: ${err?.message || err}`); }
    try { registerCommands(); } catch (err) { note('error', `commands: ${err?.message || err}`); }

    const ev = c.eventTypes || c.event_types;
    // ST โหลด extension ก่อนลงทะเบียนตัวจัดการ BG ของตัวเอง ตัวของ ST จึงทำงานทีหลังเรา
    // แล้วเขียน #bg1 กลับเป็น BG ปกติ/BG ที่ล็อก (ธีมไม่โดนเพราะ ST ไม่แตะธีมตอนเปลี่ยนแชท)
    // → ย้ายตัวเราไปท้ายคิวตอน APP_READY และรอให้ตัวอื่นในคิวเดียวกันทำงานเสร็จก่อนค่อยใส่เซท
    const onChatChanged = () => { setTimeout(() => evaluate('open'), 0); };
    c.eventSource.on(ev.CHAT_CHANGED, onChatChanged);
    if (ev.CHARACTER_RENAMED) c.eventSource.on(ev.CHARACTER_RENAMED, onCharacterRenamed);
    c.eventSource.on(ev.APP_READY, () => {
        try { c.eventSource.makeLast?.(ev.CHAT_CHANGED, onChatChanged); } catch (err) { note('warn', `makeLast: ${err?.message || err}`); }
        evaluate('open');
    });

    // กลับมาที่แท็บหลังจากทิ้งไว้นาน → ถือเป็นการตรวจเวลาแบบ tick (ไม่สุ่มใหม่ถ้าแชทยังเปิดอยู่)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && settings().liveTime && !managerOpen()) evaluate('tick');
    });
    startTick();
}

jQuery(async () => {
    try {
        await init();
    } catch (err) {
        console.error('[Kaleidoscope] init failed', err);
        toastr.error(`Kaleidoscope เริ่มทำงานไม่ได้: ${err?.message || err}`);
    }
});
