// ui.js — แผงใน Extensions และหน้าจัดการเซท
import {
    settings, save, ctx, scope, status, onStatus, evaluate, preview, rerollLevel, stateOf,
    getPool, ensurePool, savePool, clearPool, getSet, usageOf, removeSetEverywhere,
    listThemes, listBackgrounds, bgThumb, setBgCss, setFromCurrent, newSet, restoreBase,
    log, note, EXT_URL, bgModuleLoaded,
} from './core.js';
import { defaultEntry, describeWindow, newId } from './engine.js';

export const VERSION = '1.0.0';

const DAY_NAMES = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const LEVEL_LABEL = { chat: 'แชทนี้', bot: 'บอทนี้', time: 'ตามเวลา', preview: 'ลองใช้' };
const MODE_LABEL = {
    open: 'ทุกครั้งที่เปิดแชท',
    interval: 'ตามรอบเวลา',
    daily: 'รายวัน',
    time: 'ตามช่วงเวลา',
};
const MODE_HINT = {
    open: 'สุ่มเซทใหม่ทุกครั้งที่เข้าแชท',
    interval: 'สุ่มใหม่เมื่อข้ามรอบ (นับตามนาฬิกา เช่นทุกชั่วโมงตรง) · ไม่เปลี่ยนระหว่างที่แชทยังเปิดค้าง จะเปลี่ยนตอนเข้าแชทครั้งถัดไป',
    daily: 'สุ่มวันละครั้ง · ทั้งวันใช้เซทเดิม',
    time: 'ใช้เซทตามช่วงเวลาที่ตั้งในแต่ละรายการ · ถ้าหลายรายการตรงเวลาเดียวกันจะสุ่มครั้งเดียวต่อรอบ · นอกช่วงเวลาจะส่งต่อให้ระดับถัดไป',
};
const FIT_LABEL = { '': 'ตามที่ตั้งใน ST', cover: 'เต็มจอ (cover)', contain: 'พอดีภาพ (contain)', stretch: 'ยืด (stretch)', center: 'กลางจอ (center)', classic: 'คลาสสิก' };

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

let refreshTimer = null;
function refreshSoon() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => evaluate('refresh'), 350);
}

function lsGet(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

// ================================================================ drawer in Extensions
export function renderDrawer() {
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host || document.getElementById('kls_settings')) return;
    const html = `
<div class="kls-settings" id="kls_settings">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>Kaleidoscope</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <div class="kls-status" id="kls_status"></div>
      <div class="kls-actions">
        <div class="menu_button kls-btn" id="kls_open"><i class="fa-solid fa-shapes"></i><span>จัดการเซท</span></div>
        <div class="menu_button kls-btn" id="kls_reroll"><i class="fa-solid fa-shuffle"></i><span>สุ่มใหม่</span></div>
      </div>
      <label class="checkbox_label"><input type="checkbox" id="kls_enabled"><span>เปิดใช้ Kaleidoscope</span></label>
      <label class="checkbox_label"><input type="checkbox" id="kls_lock"><span>เคารพ BG ที่ล็อกกับแชท</span></label>
      <small class="kls-hint">BG ที่ล็อกด้วยปุ่มล็อกของ ST ชนะเซทจากระดับบอทและเวลา แต่แพ้เซทที่กำหนดให้แชทนี้</small>
      <label class="checkbox_label"><input type="checkbox" id="kls_live"><span>เปลี่ยนตามช่วงเวลาทันที</span></label>
      <small class="kls-hint">เฉพาะโหมด "ตามช่วงเวลา" · ถ้าปิดไว้ จะเปลี่ยนตอนเข้าแชทครั้งถัดไป</small>
      <label class="checkbox_label"><input type="checkbox" id="kls_notify"><span>แจ้งเตือนเมื่อเปลี่ยนเซท</span></label>
      <div class="kls-foot">
        <div class="menu_button kls-btn" id="kls_diag"><i class="fa-solid fa-stethoscope"></i><span>ตรวจสอบ</span></div>
        <small class="kls-ver">v${VERSION}</small>
      </div>
      <div class="kls-diag" id="kls_diag_box" hidden>
        <textarea class="text_pole" id="kls_diag_text" rows="8" readonly></textarea>
        <div class="menu_button kls-btn" id="kls_diag_copy"><i class="fa-solid fa-copy"></i><span>คัดลอก</span></div>
      </div>
    </div>
  </div>
</div>`;
    host.insertAdjacentHTML('beforeend', html);
    const s = settings();
    const $root = $('#kls_settings');
    $root.find('#kls_enabled').prop('checked', s.enabled).on('change', async function () {
        s.enabled = this.checked;
        save();
        if (s.enabled) await evaluate('open');
        else await restoreBase();
        updateDrawer();
    });
    $root.find('#kls_lock').prop('checked', s.respectChatBgLock).on('change', function () {
        s.respectChatBgLock = this.checked; save(); refreshSoon();
    });
    $root.find('#kls_live').prop('checked', s.liveTime).on('change', function () {
        s.liveTime = this.checked; save();
    });
    $root.find('#kls_notify').prop('checked', s.notify).on('change', function () {
        s.notify = this.checked; save();
    });
    $root.find('#kls_open').on('click', () => openManager());
    $root.find('#kls_reroll').on('click', async () => {
        if (!settings().enabled) return toastr.info('เปิดใช้ Kaleidoscope ก่อน', 'Kaleidoscope');
        const res = await evaluate('force');
        if (!res) toastr.info('ยังไม่มีกติกาที่ตรงกับตอนนี้ · กด จัดการเซท เพื่อตั้งค่า', 'Kaleidoscope');
    });
    $root.find('#kls_diag').on('click', async () => {
        $('#kls_diag_box').prop('hidden', false);
        $('#kls_diag_text').val('กำลังรวบรวม…');
        $('#kls_diag_text').val(await diagnose());
    });
    $root.find('#kls_diag_copy').on('click', async () => {
        const text = String($('#kls_diag_text').val());
        try { await navigator.clipboard.writeText(text); toastr.success('คัดลอกแล้ว', 'Kaleidoscope'); } catch {
            $('#kls_diag_text').trigger('select');
            document.execCommand?.('copy');
        }
    });
    onStatus(updateDrawer);
    updateDrawer();
}

export function statusText() {
    const s = settings();
    if (!s.enabled) return 'ปิดอยู่ · ใช้ธีมและ BG ปกติ';
    if (!s.sets.length) return 'ยังไม่มีเซท · กด จัดการเซท เพื่อเริ่ม';
    if (status.level === 'preview') return `กำลังลองเซท <b>${esc(status.setName)}</b> · กลับเป็นปกติเมื่อเข้าแชทใหม่`;
    if (!status.setId) return 'ไม่มีกติกาที่ตรงกับตอนนี้ · ใช้ธีมและ BG ปกติ';
    const mode = status.mode ? ` · ${MODE_LABEL[status.mode] || status.mode}` : '';
    return `ใช้อยู่: <b>${esc(status.setName)}</b><br><span class="kls-muted">จาก${LEVEL_LABEL[status.level] || status.level}${mode}</span>`;
}

function updateDrawer() {
    $('#kls_status').html(statusText());
    $('#kls_enabled').prop('checked', settings().enabled);
    $('.kls-mgr .kls-now').html(statusText());
}

// ================================================================ manager popup
const ui = { tab: 'sets', view: 'main', pickSetId: '', bgQuery: '', bgFolder: '', root: null, popup: null, lastWhere: '' };

export async function openManager(tab) {
    const c = ctx();
    if (ui.popup) return;
    ui.tab = tab || lsGet('kls_tab', 'sets');
    if (!['sets', 'chat', 'bot', 'time'].includes(ui.tab)) ui.tab = 'sets';
    ui.view = 'main';
    ui.lastWhere = '';

    const root = document.createElement('div');
    root.className = 'kls-mgr';
    root.innerHTML = `
<div class="kls-mgr-head">
  <div class="kls-tabs" role="tablist">
    <button type="button" class="kls-tab" data-tab="sets" role="tab">เซท</button>
    <button type="button" class="kls-tab" data-tab="chat" role="tab">แชทนี้</button>
    <button type="button" class="kls-tab" data-tab="bot" role="tab">บอทนี้</button>
    <button type="button" class="kls-tab" data-tab="time" role="tab">ตามเวลา</button>
  </div>
  <div class="kls-now"></div>
  <small class="kls-hint">ลำดับความสำคัญ: แชทนี้ › บอทนี้ › ตามเวลา · ระดับไหนไม่มีเซทที่ใช้ได้ตอนนี้ จะส่งต่อให้ระดับถัดไป</small>
</div>
<div class="kls-body"></div>`;
    ui.root = root;
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    root.addEventListener('touchstart', () => { }, { passive: true }); // ให้ :active ทำงานบน iPhone

    const popup = new c.Popup(root, c.POPUP_TYPE.TEXT, '', {
        okButton: 'ปิด',
        cancelButton: false,
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        leftAlign: true,
        animation: 'fast',
        onClosing: (p) => {
            // Escape ในหน้าย่อย → ย้อนกลับก่อน ไม่ปิดทั้งหน้าต่าง
            if (ui.view !== 'main' && p.result === c.POPUP_RESULT.CANCELLED) {
                ui.view = 'main';
                render();
                return false;
            }
            return true;
        },
    });
    ui.popup = popup;
    popup.dlg?.classList.add('kls-popup');
    updateDrawer();
    render();
    try {
        await popup.show();
    } finally {
        ui.popup = null;
        ui.root = null;
        evaluate('refresh');
    }
}

function render() {
    const root = ui.root;
    if (!root) return;
    root.querySelectorAll('.kls-tab').forEach(b => {
        const on = b.dataset.tab === ui.tab;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
    });
    root.querySelector('.kls-now').innerHTML = statusText();
    const body = root.querySelector('.kls-body');
    // วาดใหม่ในหน้าเดิม → คงตำแหน่งเลื่อนไว้
    const scroller = root.closest('.popup-content') || root.parentElement;
    const where = `${ui.tab}|${ui.view}`;
    const keep = scroller && ui.lastWhere === where ? scroller.scrollTop : 0;
    ui.lastWhere = where;
    try {
        if (ui.view === 'bgpick') body.innerHTML = renderBgPicker();
        else if (ui.tab === 'sets') body.innerHTML = renderSets();
        else body.innerHTML = renderPool(ui.tab);
        if (ui.view === 'bgpick') loadBgGrid();
        if (scroller) scroller.scrollTop = keep;
    } catch (err) {
        note('error', err?.stack || String(err));
        body.innerHTML = `<div class="kls-error">แสดงหน้านี้ไม่ได้: ${esc(err?.message || err)} · กด ตรวจสอบ ในแผง Extensions แล้วส่งรายงานให้ผู้พัฒนา</div>`;
        if (ui.tab !== 'sets') { ui.tab = 'sets'; lsSet('kls_tab', 'sets'); }
    }
}

// ---------------------------------------------------------------- sets tab
function themeOptions(selected) {
    const themes = listThemes();
    const opts = [`<option value="">ธีมปกติของฉัน</option>`];
    if (selected && !themes.includes(selected)) opts.push(`<option value="${esc(selected)}" selected>${esc(selected)} (ไม่พบ)</option>`);
    for (const t of themes) opts.push(`<option value="${esc(t)}" ${t === selected ? 'selected' : ''}>${esc(t)}</option>`);
    return opts.join('');
}

function setOptions(selected) {
    const sets = settings().sets;
    const opts = [];
    if (!sets.some(x => x.id === selected)) opts.push(`<option value="" selected>เลือกเซท</option>`);
    for (const x of sets) opts.push(`<option value="${esc(x.id)}" ${x.id === selected ? 'selected' : ''}>${esc(x.name)}</option>`);
    return opts.join('');
}

function bgLabel(set) {
    if (set.bgCustom) return 'ลิงก์รูปเอง';
    if (set.bg) return set.bg;
    return 'BG ปกติ';
}

function thumbStyle(set) {
    if (set.bgCustom) return `background-image:url("${esc(encodeURI(set.bgCustom))}")`;
    if (set.bg) return `background-image:url("${esc(bgThumb(set.bg))}")`;
    return '';
}

function renderSets() {
    const s = settings();
    const tools = `
<div class="kls-toolbar">
  <button type="button" class="menu_button kls-btn" data-act="set-add"><i class="fa-solid fa-plus"></i><span>เซทใหม่</span></button>
  <button type="button" class="menu_button kls-btn" data-act="set-current"><i class="fa-solid fa-camera"></i><span>จากที่ใช้อยู่</span></button>
</div>`;
    if (!s.sets.length) {
        return tools + `<div class="kls-empty">ยังไม่มีเซท · เซทหนึ่งคือธีมคู่กับ BG · กด <b>จากที่ใช้อยู่</b> เพื่อเก็บหน้าตาตอนนี้ไว้เป็นเซทแรก หรือ <b>เซทใหม่</b> เพื่อเลือกเอง</div>`;
    }
    const cards = s.sets.map(set => {
        const usage = usageOf(set.id);
        const active = status.setId === set.id;
        return `
<div class="kls-card ${active ? 'is-active' : ''}" data-set="${esc(set.id)}">
  <div class="kls-card-top">
    <button type="button" class="kls-thumb ${set.bg || set.bgCustom ? '' : 'is-empty'}" data-act="bg-pick" title="เลือก BG" style='${thumbStyle(set)}'>
      ${set.bg || set.bgCustom ? '' : '<i class="fa-solid fa-image"></i>'}
    </button>
    <div class="kls-card-main">
      <input type="text" class="text_pole kls-name" data-field="name" value="${esc(set.name)}" placeholder="ชื่อเซท">
      <small class="kls-muted">${active ? '<i class="fa-solid fa-circle-check"></i> ใช้อยู่ · ' : ''}${usage.length ? `ใช้ใน: ${esc(usage.join(' · '))}` : 'ยังไม่ได้ใช้ในกติกาไหน'}</small>
    </div>
  </div>
  <div class="kls-row"><span>ธีม</span><select data-field="theme">${themeOptions(set.theme)}</select></div>
  <div class="kls-row"><span>BG</span><button type="button" class="kls-linkbtn" data-act="bg-pick">${esc(bgLabel(set))}</button></div>
  <div class="kls-row"><span>การวางภาพ</span><select data-field="fitting">${Object.entries(FIT_LABEL).map(([k, v]) => `<option value="${k}" ${k === set.fitting ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
  <details class="kls-details" ${set.bgCustom ? 'open' : ''}>
    <summary>ใช้ลิงก์รูปเอง</summary>
    <input type="url" class="text_pole" data-field="bgCustom" value="${esc(set.bgCustom)}" placeholder="https://… หรือ user/images/…">
    <small class="kls-hint">ถ้าใส่ลิงก์ จะใช้แทน BG ที่เลือกจากรายการ</small>
  </details>
  <div class="kls-card-actions">
    <button type="button" class="menu_button kls-btn" data-act="set-preview"><i class="fa-solid fa-eye"></i><span>ลองใช้</span></button>
    <button type="button" class="menu_button kls-btn" data-act="set-dup"><i class="fa-solid fa-clone"></i><span>ทำสำเนา</span></button>
    <button type="button" class="menu_button kls-btn kls-danger" data-act="set-del"><i class="fa-solid fa-trash-can"></i><span>ลบ</span></button>
  </div>
</div>`;
    }).join('');
    return tools + `<div class="kls-cards">${cards}</div>`;
}

// ---------------------------------------------------------------- bg picker view
function renderBgPicker() {
    const set = getSet(ui.pickSetId);
    return `
<div class="kls-view-head">
  <button type="button" class="menu_button kls-btn" data-act="back"><i class="fa-solid fa-arrow-left"></i><span>กลับ</span></button>
  <b class="kls-view-title">เลือก BG · ${esc(set?.name || '')}</b>
</div>
<div class="kls-row kls-bgfilter">
  <input type="search" class="text_pole" data-bg="query" value="${esc(ui.bgQuery)}" placeholder="ค้นหาชื่อไฟล์">
  <select data-bg="folder" hidden></select>
</div>
<div class="kls-bggrid"><div class="kls-empty">กำลังโหลดรายการ BG…</div></div>`;
}

async function loadBgGrid(force = false) {
    const grid = ui.root?.querySelector('.kls-bggrid');
    if (!grid) return;
    let data;
    try {
        data = await listBackgrounds(force);
    } catch (err) {
        grid.innerHTML = `<div class="kls-error">${esc(err?.message || err)} · <button type="button" class="kls-linkbtn" data-act="bg-retry">ลองใหม่</button></div>`;
        return;
    }
    if (!ui.root || ui.view !== 'bgpick') return;
    const folderSel = ui.root.querySelector('[data-bg="folder"]');
    if (folderSel && data.folders.length) {
        folderSel.hidden = false;
        folderSel.innerHTML = `<option value="">ทุกโฟลเดอร์</option>` + data.folders
            .map(f => `<option value="${esc(f.id)}" ${f.id === ui.bgFolder ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
    }
    drawBgGrid(data);
}

function drawBgGrid(data) {
    const grid = ui.root?.querySelector('.kls-bggrid');
    if (!grid) return;
    const set = getSet(ui.pickSetId);
    const q = ui.bgQuery.trim().toLowerCase();
    const files = data.files.filter(f => (!q || f.toLowerCase().includes(q))
        && (!ui.bgFolder || (data.folderMap[f] || []).includes(ui.bgFolder)));
    const none = `<button type="button" class="kls-bgitem is-none ${set && !set.bg && !set.bgCustom ? 'is-picked' : ''}" data-act="bg-choose" data-file="">
      <span class="kls-bgimg"><i class="fa-solid fa-ban"></i></span><span class="kls-bgname">BG ปกติ</span></button>`;
    const items = files.map(f => `
<button type="button" class="kls-bgitem ${set?.bg === f && !set?.bgCustom ? 'is-picked' : ''}" data-act="bg-choose" data-file="${esc(f)}" title="${esc(f)}">
  <img class="kls-bgimg" loading="lazy" decoding="async" src="${esc(bgThumb(f))}" alt="">
  <span class="kls-bgname">${esc(f)}</span>
</button>`).join('');
    grid.innerHTML = none + (items || `<div class="kls-empty">ไม่พบ BG ที่ตรงกับคำค้น</div>`);
}

// ---------------------------------------------------------------- pool tabs
function scopeLine(level) {
    const sc = scope();
    if (level === 'chat') return sc.chatId ? `<b>แชท: ${esc(sc.chatId)}</b><small class="kls-muted">กติกานี้เก็บไว้ในไฟล์แชทนี้</small>` : '';
    if (level === 'bot') {
        const kind = sc.botKey.startsWith('group:') ? 'กลุ่ม' : 'บอท';
        return sc.botKey ? `<b>${kind}: ${esc(sc.botName)}</b><small class="kls-muted">ใช้กับทุกแชทของ${kind}นี้ ที่ไม่ได้กำหนดระดับแชทไว้</small>` : '';
    }
    return '<b>ทุกแชท</b><small class="kls-muted">ใช้เมื่อแชทและบอทไม่ได้กำหนดไว้ หรือเซทที่กำหนดไม่อยู่ในช่วงเวลา</small>';
}

function renderPool(level) {
    const s = settings();
    const sc = scope();
    if (level === 'chat' && !sc.chatId) return `<div class="kls-empty">ยังไม่ได้เปิดแชท · เปิดแชทก่อน แล้วกลับมาที่แท็บนี้</div>`;
    if (level === 'bot' && !sc.botKey) return `<div class="kls-empty">ยังไม่ได้เลือกบอท · เปิดแชทกับบอทก่อน แล้วกลับมาที่แท็บนี้</div>`;
    const head = `<div class="kls-ctx">${scopeLine(level)}</div>`;
    if (!s.sets.length) {
        return head + `<div class="kls-empty">ยังไม่มีเซท · ไปที่แท็บ <button type="button" class="kls-linkbtn" data-act="go-sets">เซท</button> เพื่อสร้างก่อน</div>`;
    }
    const pool = getPool(level);
    if (!pool) {
        return head + `<div class="kls-empty">ยังไม่ได้กำหนดเซทให้${LEVEL_LABEL[level]} · ระดับนี้จะส่งต่อให้ระดับถัดไป
<div class="kls-toolbar"><button type="button" class="menu_button kls-btn" data-act="entry-add"><i class="fa-solid fa-plus"></i><span>เพิ่มเซท</span></button></div></div>`;
    }
    const isHour = pool.intervalMin % 60 === 0;
    const intervalVal = isHour ? pool.intervalMin / 60 : pool.intervalMin;
    const st = stateOf(level);
    const lastSet = st?.setId ? getSet(st.setId) : null;
    const multi = pool.entries.length > 1;

    const entries = pool.entries.map((e, i) => {
        const win = describeWindow(e, DAY_NAMES);
        return `
<div class="kls-entry ${lastSet && e.setId === lastSet.id ? 'is-active' : ''}" data-idx="${i}">
  <div class="kls-row kls-entry-top">
    <select data-entry="setId">${setOptions(e.setId)}</select>
    <button type="button" class="kls-iconbtn" data-act="entry-del" title="ลบรายการนี้" aria-label="ลบรายการนี้"><i class="fa-solid fa-xmark"></i></button>
  </div>
  <div class="kls-row ${multi ? '' : 'kls-dim'}"><span>น้ำหนัก</span><input type="number" class="text_pole" data-entry="weight" min="0" step="1" value="${esc(e.weight)}"></div>
  <div class="kls-row kls-time"><span>ช่วงเวลา</span><input type="time" class="text_pole" data-entry="from" value="${esc(e.from)}"><span class="kls-sep">–</span><input type="time" class="text_pole" data-entry="to" value="${esc(e.to)}"></div>
  <div class="kls-days" role="group" aria-label="วัน">
    ${DAY_NAMES.map((d, di) => `<button type="button" class="kls-day ${e.days.includes(di) ? 'on' : ''}" data-act="entry-day" data-day="${di}" aria-pressed="${e.days.includes(di)}">${d}</button>`).join('')}
  </div>
  <small class="kls-muted">${win ? `ใช้ได้: ${esc(win)}` : 'ใช้ได้ทุกเวลา'}</small>
</div>`;
    }).join('');

    return head + `
<label class="checkbox_label"><input type="checkbox" data-pool="enabled" ${pool.enabled ? 'checked' : ''}><span>ใช้กติกาของ${LEVEL_LABEL[level]}</span></label>
<div class="kls-row"><span>เปลี่ยนเซท</span><select data-pool="mode">${Object.entries(MODE_LABEL).map(([k, v]) => `<option value="${k}" ${k === pool.mode ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
<small class="kls-hint">${MODE_HINT[pool.mode]}</small>
${pool.mode === 'interval' ? `<div class="kls-row"><span>ทุก</span><input type="number" class="text_pole" data-pool="intervalVal" min="1" step="1" value="${intervalVal}"><select data-pool="intervalUnit"><option value="60" ${isHour ? 'selected' : ''}>ชั่วโมง</option><option value="1" ${isHour ? '' : 'selected'}>นาที</option></select></div>` : ''}
${pool.mode === 'daily' ? `<div class="kls-row"><span>เริ่มวันใหม่</span><select data-pool="dayStartHour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === pool.dayStartHour ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></div>` : ''}
${pool.mode !== 'time' ? `<label class="checkbox_label"><input type="checkbox" data-pool="noRepeat" ${pool.noRepeat ? 'checked' : ''}><span>ไม่ซ้ำเซทเดิมติดกัน</span></label>` : ''}
<div class="kls-subhead">เซทที่ใช้ได้ <small class="kls-muted">${multi ? 'น้ำหนักมาก = ออกบ่อย · ช่วงเวลาและวันเว้นว่างได้' : 'เพิ่มได้หลายเซทเพื่อสุ่ม · ช่วงเวลาและวันเว้นว่างได้'}</small></div>
<div class="kls-entries">${entries || '<div class="kls-empty">ยังไม่มีเซทในกติกานี้ · กด เพิ่มเซท</div>'}</div>
<div class="kls-toolbar">
  <button type="button" class="menu_button kls-btn" data-act="entry-add"><i class="fa-solid fa-plus"></i><span>เพิ่มเซท</span></button>
</div>
<div class="kls-pool-foot">
  <small class="kls-muted">${lastSet ? `สุ่มได้ล่าสุด: <b>${esc(lastSet.name)}</b> · ${esc(new Date(st.at).toLocaleString())}` : 'ยังไม่เคยสุ่มในระดับนี้'}</small>
  <div class="kls-toolbar">
    <button type="button" class="menu_button kls-btn" data-act="pool-reroll"><i class="fa-solid fa-shuffle"></i><span>สุ่มใหม่</span></button>
    <button type="button" class="menu_button kls-btn kls-danger" data-act="pool-clear"><i class="fa-solid fa-eraser"></i><span>ล้างกติกานี้</span></button>
  </div>
</div>`;
}

// ---------------------------------------------------------------- events
function cardSet(el) {
    const id = el.closest('[data-set]')?.dataset.set;
    return id ? getSet(id) : null;
}

function entryOf(el) {
    const idx = Number(el.closest('[data-idx]')?.dataset.idx);
    const pool = ensurePool(ui.tab);
    return { pool, idx, entry: pool?.entries[idx] };
}

async function onClick(ev) {
    const tabBtn = ev.target.closest('.kls-tab');
    if (tabBtn) {
        ui.tab = tabBtn.dataset.tab;
        ui.view = 'main';
        lsSet('kls_tab', ui.tab);
        render();
        return;
    }
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const s = settings();
    const c = ctx();

    switch (act) {
        case 'go-sets':
            ui.tab = 'sets'; render(); break;
        case 'set-add':
            s.sets.push(newSet()); save(); render(); break;
        case 'set-current': {
            const set = setFromCurrent();
            s.sets.push(set); save(); render();
            toastr.success(`เก็บ "${set.name}" เป็นเซทแล้ว`, 'Kaleidoscope');
            break;
        }
        case 'set-dup': {
            const set = cardSet(btn);
            if (!set) break;
            const copy = { ...set, id: newId(), name: `${set.name} (สำเนา)` };
            s.sets.splice(s.sets.indexOf(set) + 1, 0, copy);
            save(); render();
            break;
        }
        case 'set-preview': {
            const set = cardSet(btn);
            if (set) { await preview(set.id); render(); }
            break;
        }
        case 'set-del': {
            const set = cardSet(btn);
            if (!set) break;
            const usage = usageOf(set.id);
            const msg = usage.length ? `เซทนี้ถูกใช้ใน ${usage.join(' · ')} · จะถูกเอาออกจากกติกาเหล่านั้นด้วย` : 'ลบแล้วกู้คืนไม่ได้';
            const ok = await c.Popup.show.confirm(`ลบเซท "${set.name}"?`, msg, { okButton: 'ลบ', cancelButton: 'ยกเลิก' });
            if (ok !== c.POPUP_RESULT.AFFIRMATIVE) break;
            removeSetEverywhere(set.id);
            render(); refreshSoon();
            break;
        }
        case 'bg-pick': {
            const set = cardSet(btn);
            if (!set) break;
            ui.pickSetId = set.id; ui.view = 'bgpick'; render();
            break;
        }
        case 'bg-retry':
            loadBgGrid(true); break;
        case 'bg-choose': {
            const set = getSet(ui.pickSetId);
            if (set) {
                set.bg = btn.dataset.file || '';
                set.bgCustom = '';
                save();
                if (status.setId === set.id) refreshSoon();
            }
            ui.view = 'main'; render();
            break;
        }
        case 'back':
            ui.view = 'main'; render(); break;
        case 'entry-add': {
            const pool = ensurePool(ui.tab);
            if (!pool) break;
            const used = new Set(pool.entries.map(e => e.setId));
            const next = s.sets.find(x => !used.has(x.id)) || s.sets[0];
            pool.entries.push(defaultEntry(next?.id || ''));
            savePool(ui.tab); render(); refreshSoon();
            break;
        }
        case 'entry-del': {
            const { pool, idx } = entryOf(btn);
            if (!pool) break;
            pool.entries.splice(idx, 1);
            savePool(ui.tab); render(); refreshSoon();
            break;
        }
        case 'entry-day': {
            const { entry } = entryOf(btn);
            if (!entry) break;
            const d = Number(btn.dataset.day);
            entry.days = entry.days.includes(d) ? entry.days.filter(x => x !== d) : [...entry.days, d].sort();
            savePool(ui.tab); render(); refreshSoon();
            break;
        }
        case 'pool-reroll':
            await rerollLevel(ui.tab); render(); break;
        case 'pool-clear': {
            const ok = await c.Popup.show.confirm(`ล้างกติกาของ${LEVEL_LABEL[ui.tab]}?`, 'เซทยังอยู่ครบ เอาออกแค่กติกาของระดับนี้', { okButton: 'ล้าง', cancelButton: 'ยกเลิก' });
            if (ok !== c.POPUP_RESULT.AFFIRMATIVE) break;
            clearPool(ui.tab); render(); refreshSoon();
            break;
        }
    }
}

function onChange(ev) {
    const el = ev.target;
    // ฟิลด์ของเซท
    if (el.dataset.field) {
        const set = cardSet(el);
        if (!set) return;
        set[el.dataset.field] = el.value.trim();
        save();
        if (el.dataset.field !== 'name') { render(); if (status.setId === set.id) refreshSoon(); }
        return;
    }
    if (el.dataset.pool) {
        const pool = ensurePool(ui.tab);
        if (!pool) return;
        const k = el.dataset.pool;
        if (k === 'enabled' || k === 'noRepeat') pool[k] = el.checked;
        else if (k === 'mode') pool.mode = el.value;
        else if (k === 'dayStartHour') pool.dayStartHour = Number(el.value) || 0;
        else if (k === 'intervalVal' || k === 'intervalUnit') {
            const val = Math.max(1, Number(ui.root.querySelector('[data-pool="intervalVal"]')?.value) || 1);
            const unit = Number(ui.root.querySelector('[data-pool="intervalUnit"]')?.value) || 60;
            pool.intervalMin = Math.round(val * unit);
        }
        savePool(ui.tab); render(); refreshSoon();
        return;
    }
    if (el.dataset.entry) {
        const { entry } = entryOf(el);
        if (!entry) return;
        const k = el.dataset.entry;
        if (k === 'weight') entry.weight = Math.max(0, Number(el.value) || 0);
        else entry[k] = el.value;
        savePool(ui.tab); render(); refreshSoon();
        return;
    }
    if (el.dataset.bg === 'folder') {
        ui.bgFolder = el.value;
        listBackgrounds().then(drawBgGrid).catch(() => { });
    }
}

function onInput(ev) {
    const el = ev.target;
    if (el.dataset.field === 'name') {
        const set = cardSet(el);
        if (set) { set.name = el.value; save(); }
    } else if (el.dataset.bg === 'query') {
        ui.bgQuery = el.value;
        listBackgrounds().then(drawBgGrid).catch(() => { });
    }
}

// ================================================================ diagnostics
export async function diagnose() {
    const s = settings();
    const c = ctx();
    const sc = scope();
    const lines = [];
    let serverVer = '?';
    try {
        const r = await fetch(`${EXT_URL}/manifest.json`, { cache: 'reload' });
        serverVer = (await r.json()).version;
    } catch (err) { serverVer = `อ่านไม่ได้ (${err?.message || err})`; }
    const bg1 = document.getElementById('bg1');
    lines.push(`Kaleidoscope ${VERSION} · server manifest ${serverVer}`);
    lines.push(`UA: ${navigator.userAgent}`);
    lines.push(`viewport: ${innerWidth}x${innerHeight}`);
    lines.push(`enabled=${s.enabled} lock=${s.respectChatBgLock} live=${s.liveTime} notify=${s.notify}`);
    lines.push(`sets=${s.sets.length} bots=${Object.keys(s.characters).length} global=${s.global ? s.global.mode + '/' + s.global.entries.length : 'none'}`);
    lines.push(`chat=${sc.chatId || '-'} bot=${sc.botKey || '-'}`);
    for (const lv of ['chat', 'bot', 'time']) {
        const p = getPool(lv);
        const st = stateOf(lv);
        lines.push(`  ${lv}: ${p ? `${p.enabled ? 'on' : 'off'} ${p.mode} entries=${p.entries.length}` : '-'} state=${st ? `${getSet(st.setId)?.name || st.setId}@${st.bucket}` : '-'}`);
    }
    lines.push(`status: level=${status.level || '-'} set=${status.setName || '-'} trigger=${status.trigger}`);
    lines.push(`theme: current=${c.powerUserSettings?.theme} base=${s.baseTheme} applied=${s.appliedTheme || '-'} themes=${listThemes().length}`);
    lines.push(`bg1: ${bg1 ? bg1.style.backgroundImage || '(none)' : 'missing'} class=${bg1?.className || ''}`);
    lines.push(`st lock: ${c.chatMetadata?.custom_background || '-'} · bgModule=${bgModuleLoaded()}`);
    lines.push('log:');
    lines.push(...log.slice(-20).map(x => '  ' + x));
    return lines.join('\n');
}

export { setBgCss };
