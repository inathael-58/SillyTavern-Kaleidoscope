// North Star — เซทธีม+BG ที่เลือกตามแชท › บอท › เวลา สำหรับ SillyTavern
import {
    ctx, settings, normalizeAll, evaluate, preview, status, getSet, note, onCharacterRenamed,
} from './core.js';
import { renderDrawer, openManager, diagnose } from './ui.js';
import { installThemePalette } from './theme-palette.js';

let tickTimer = null;

function startTick() {
    clearInterval(tickTimer);
    // ตรวจทุก 30 วินาที แต่ทำงานจริงเฉพาะเมื่อเปิด "เปลี่ยนตามช่วงเวลาทันที" และมีกติกาโหมด time
    tickTimer = setInterval(() => {
        const s = settings();
        if (s.enabled && s.liveTime && document.visibilityState !== 'hidden') evaluate('tick');
    }, 30000);
}

function addWandItem() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('nst_wand')) return;
    const item = document.createElement('div');
    item.id = 'nst_wand';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.innerHTML = '<div class="fa-solid fa-compass extensionsMenuExtensionButton"></div><span>North Star</span>';
    item.addEventListener('click', () => openManager());
    menu.appendChild(item);
}

function registerCommands() {
    const c = ctx();
    const { SlashCommandParser, SlashCommand, SlashCommandArgument } = c;
    if (!SlashCommandParser || !SlashCommand) return;

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'ns-reroll',
        callback: async () => {
            const res = await evaluate('force');
            return res ? (getSet(res.setId)?.name || '') : '';
        },
        helpString: 'North Star: สุ่มเซทใหม่ตามกติกาของแชท/บอท/เวลาที่ใช้อยู่ คืนชื่อเซทที่ได้',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'ns-set',
        callback: async (_args, value) => {
            const name = String(value ?? '').trim();
            if (!name) return status.setName || '';
            const sets = settings().sets;
            const set = sets.find(x => x.name === name) || sets.find(x => x.name.toLowerCase().includes(name.toLowerCase()));
            if (!set) { toastr.warning(`ไม่พบเซท "${name}"`, 'North Star'); return ''; }
            await preview(set.id);
            return set.name;
        },
        unnamedArgumentList: SlashCommandArgument ? [SlashCommandArgument.fromProps({
            description: 'ชื่อเซท (เว้นว่าง = คืนชื่อเซทที่ใช้อยู่)',
            typeList: ['string'],
            isRequired: false,
            enumProvider: () => settings().sets.map(x => new c.SlashCommandEnumValue(x.name)),
        })] : [],
        helpString: 'North Star: ลองใช้เซทตามชื่อจนกว่าจะเข้าแชทใหม่ · ไม่ใส่ชื่อ = คืนชื่อเซทที่ใช้อยู่',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'ns-open',
        callback: async () => { openManager(); return ''; },
        helpString: 'North Star: เปิดหน้าจัดการเซท',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'ns-debug',
        callback: async () => diagnose(),
        helpString: 'North Star: คืนรายงานตรวจสอบ (ใช้ส่งให้ผู้พัฒนาเมื่อมีปัญหา)',
    }));
}

async function init() {
    const c = ctx();
    settings();
    normalizeAll();

    try { installThemePalette({ prefix: 'nst' }); } catch (err) { console.warn('[North Star] theme palette', err); }

    try { renderDrawer(); } catch (err) { note('error', `drawer: ${err?.stack || err}`); }
    try { addWandItem(); } catch (err) { note('error', `wand: ${err?.message || err}`); }
    try { registerCommands(); } catch (err) { note('error', `commands: ${err?.message || err}`); }

    const ev = c.eventTypes || c.event_types;
    c.eventSource.on(ev.CHAT_CHANGED, () => evaluate('open'));
    if (ev.CHARACTER_RENAMED) c.eventSource.on(ev.CHARACTER_RENAMED, onCharacterRenamed);
    c.eventSource.on(ev.APP_READY, () => evaluate('open'));

    // กลับมาที่แท็บหลังจากทิ้งไว้นาน → ถือเป็นการตรวจเวลาแบบ tick (ไม่สุ่มใหม่ถ้าแชทยังเปิดอยู่)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && settings().liveTime) evaluate('tick');
    });
    startTick();
}

jQuery(async () => {
    try {
        await init();
    } catch (err) {
        console.error('[North Star] init failed', err);
        toastr.error(`North Star เริ่มทำงานไม่ได้: ${err?.message || err}`);
    }
});
