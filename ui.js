// ui.js — แผงใน Extensions และหน้าจัดการเซท
import {
    settings, save, ctx, scope, status, onStatus, evaluate, preview, rerollLevel, stateOf,
    getPool, ensurePool, savePool, clearPool, getSet, usageOf, removeSetEverywhere,
    timeReady, currentPeriod, boundMissing, randomIds, tagOf,
    listThemes, listBackgrounds, bgThumb, setBgCss, setFromCurrent, newSet, restoreBase,
    log, note, EXT_URL, bgModuleLoaded, bgInfo,
} from './core.js';
import { newId, HOURS } from './engine.js';
import { pullLatest, serverVersion, compareVersions } from './updater.js';

export const VERSION = '1.3.0';

const LEVEL_LABEL = { chat: 'แชทนี้', bot: 'บอทนี้', rule: 'กฎสุ่ม', preview: 'ลองใช้' };
const TAG_LABEL = { '': 'ทั้งคู่', day: 'กลางวัน', night: 'กลางคืน' };
const TAG_ICON = { '': 'fa-circle-half-stroke', day: 'fa-sun', night: 'fa-moon' };
const PERIOD_LABEL = { day: 'กลางวัน', night: 'กลางคืน' };

function modeLabel(mode) {
    if (!mode) return '';
    if (mode === 'open') return 'สุ่มทุกครั้งที่เปิดแชท';
    const h = Number(String(mode).split(':')[1]) || 6;
    return `ทุก ${h} ชม.`;
}

function ruleFreqText() {
    const r = settings().rule;
    return r.mode === 'interval' ? `ทุก ${r.hours} ชม. (นับจาก 0:00)` : 'สุ่มใหม่ทุกครั้งที่เปิดแชท';
}

function dnRangeText() {
    const dn = settings().dayNight;
    return `กลางวัน ${dn.day}–${dn.night} · กลางคืน ${dn.night}–${dn.day}`;
}

const FIT_LABEL = { '': 'ตามที่ตั้งใน ST', cover: 'เต็มจอ (cover)', contain: 'พอดีภาพ (contain)', stretch: 'ยืด (stretch)', center: 'กลางจอ (center)', classic: 'คลาสสิก' };

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

let refreshTimer = null;
function refreshSoon() {
    // ระหว่างเปิดหน้าจัดการ ห้ามเปลี่ยนธีม/BG ใต้มือผู้ใช้ — จดไว้ แล้วใส่ทีเดียวตอนปิดหน้า
    if (ui.popup) { ui.dirty = true; return; }
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
      <b>Kaleidoscope <small class="kls-vertag" id="kls_vertag">v${VERSION}</small></b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
     <div class="kls-drawer-body">
      <div class="kls-status" id="kls_status"></div>
      <div class="kls-actions">
        <div class="menu_button kls-btn" id="kls_open"><i class="fa-solid fa-shapes"></i><span>จัดการเซท</span></div>
        <div class="menu_button kls-btn" id="kls_reroll"><i class="fa-solid fa-shuffle"></i><span>สุ่มใหม่</span></div>
      </div>
      <label class="checkbox_label"><input type="checkbox" id="kls_enabled"><span>เปิดใช้ Kaleidoscope</span></label>
      <label class="checkbox_label"><input type="checkbox" id="kls_lock"><span>เคารพ BG ที่ล็อกกับแชท</span></label>
      <small class="kls-hint">BG ที่ล็อกด้วยปุ่มล็อกของ ST ชนะเซทจากบอทและกฎสุ่ม แต่แพ้เซทที่ผูกกับแชทนี้</small>
      <label class="checkbox_label"><input type="checkbox" id="kls_notify"><span>แจ้งเตือนเมื่อเปลี่ยนเซท</span></label>
      <div class="kls-foot">
        <div class="menu_button kls-btn" id="kls_update"><i class="fa-solid fa-cloud-arrow-down"></i><span>ดึงเวอร์ชันล่าสุด</span></div>
        <div class="menu_button kls-btn" id="kls_diag"><i class="fa-solid fa-stethoscope"></i><span>ตรวจสอบ</span></div>
      </div>
      <small class="kls-ver" id="kls_ver" hidden></small>
      <div class="kls-diag" id="kls_diag_box" hidden>
        <textarea class="text_pole" id="kls_diag_text" rows="8" readonly></textarea>
        <div class="menu_button kls-btn" id="kls_diag_copy"><i class="fa-solid fa-copy"></i><span>คัดลอก</span></div>
      </div>
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
    $root.find('#kls_update').on('click', onUpdateClick);
    onStatus(updateDrawer);
    updateDrawer();
    checkVersion();
}

// ---------------------------------------------------------------- ดึงเวอร์ชัน
/** บรรทัดสถานะเวอร์ชันใต้ปุ่ม ('' = ซ่อน) */
function verLine(text, kind = '') {
    $('#kls_ver')
        .prop('hidden', !text)
        .removeClass('kls-warn kls-bad')
        .addClass(kind ? `kls-${kind}` : '')
        .text(text);
}

let staleToastShown = false;
async function checkVersion() {
    try {
        const server = await serverVersion();
        const stale = compareVersions(server, VERSION) !== 0;
        $('#kls_vertag')
            .toggleClass('kls-warn', stale)
            .text(stale ? `v${VERSION} → v${server}` : `v${VERSION}`)
            .attr('title', stale ? `บนเซิร์ฟเวอร์เป็น v${server} แล้ว แต่หน้านี้ยังรัน v${VERSION}` : '');
        verLine(stale ? `ติดตั้ง v${server} ไว้แล้ว แต่หน้านี้ยังรัน v${VERSION} · กด ดึงเวอร์ชันล่าสุด` : '', stale ? 'warn' : '');
        if (stale && !staleToastShown) {
            staleToastShown = true;
            toastr.info(`ติดตั้ง v${server} ไว้แล้ว แต่หน้านี้ยังรัน v${VERSION} · แตะเพื่อโหลดตัวใหม่`, 'Kaleidoscope', {
                timeOut: 0, extendedTimeOut: 0, closeButton: true, onclick: () => onUpdateClick(),
            });
        }
    } catch { /* ออฟไลน์ ก็แสดงแค่เวอร์ชันที่รันอยู่ */ }
}

let updating = false;
async function onUpdateClick() {
    if (updating) return;
    updating = true;
    const $btn = $('#kls_update');
    $btn.addClass('disabled').find('span').text('กำลังดึง…');
    verLine('กำลังตรวจหาเวอร์ชันใหม่…');
    try {
        const res = await pullLatest(VERSION);
        if (!res.needsReload) {
            verLine(`v${VERSION} เป็นเวอร์ชันล่าสุดแล้ว`);
            toastr.success(`เป็นเวอร์ชันล่าสุดแล้ว (v${VERSION})`, 'Kaleidoscope');
            return;
        }
        const what = `v${res.to}${res.commit ? ` (${res.commit})` : ''}`;
        $('#kls_vertag').addClass('kls-warn').text(`v${VERSION} → v${res.to}`);
        verLine(`ดึง ${what} แล้ว · โหลดหน้าใหม่เพื่อใช้งาน`, 'warn');
        const c = ctx();
        const ok = await c.Popup.show.confirm('ดึงเวอร์ชันใหม่แล้ว', `Kaleidoscope ${what} · โหลดหน้าใหม่ตอนนี้เลยไหม`, { okButton: 'โหลดหน้าใหม่', cancelButton: 'ไว้ทีหลัง' });
        if (ok === c.POPUP_RESULT.AFFIRMATIVE) location.reload();
    } catch (err) {
        verLine(String(err?.message || err), 'bad');
        toastr.error(String(err?.message || err), 'Kaleidoscope');
    } finally {
        updating = false;
        $btn.removeClass('disabled').find('span').text('ดึงเวอร์ชันล่าสุด');
    }
}

export function statusText() {
    const s = settings();
    if (!s.enabled) return 'ปิดอยู่ · ใช้ธีมและ BG ปกติ';
    if (!s.sets.length) return 'ยังไม่มีเซท · กด จัดการเซท เพื่อเริ่ม';
    if (status.level === 'preview') return `กำลังลองเซท <b>${esc(status.setName)}</b> · กลับเป็นปกติเมื่อเข้าแชทใหม่`;
    if (!status.setId) return 'ไม่มีกติกาที่ตรงกับตอนนี้ · ใช้ธีมและ BG ปกติ';
    const mode = (status.mode ? ` · ${modeLabel(status.mode)}` : '') + (status.period ? ` · ${PERIOD_LABEL[status.period]}` : '');
    const lock = bgInfo.blockedByLock ? '<br><span class="kls-muted">BG ของแชทนี้ถูกล็อกไว้ด้วยปุ่มของ ST จึงใช้ BG ที่ล็อกแทน (ปิด “เคารพ BG ที่ล็อกกับแชท” ถ้าอยากให้เซทชนะ)</span>' : '';
    return `ใช้อยู่: <b>${esc(status.setName)}</b><br><span class="kls-muted">จาก${LEVEL_LABEL[status.level] || status.level}${mode}</span>${lock}`;
}

function updateDrawer() {
    $('#kls_status').html(statusText());
    $('#kls_enabled').prop('checked', settings().enabled);
    $('.kls-mgr .kls-now').html(statusText());
}

// ================================================================ manager popup
const ui = { tab: 'sets', view: 'main', pickSetId: '', bgQuery: '', bgFolder: '', root: null, popup: null, lastWhere: '', dirty: false };

export const managerOpen = () => !!ui.popup;

export async function openManager(tab) {
    const c = ctx();
    if (ui.popup) return;
    ui.tab = tab || lsGet('kls_tab', 'sets');
    if (ui.tab === 'time') ui.tab = 'rule';
    if (!['sets', 'chat', 'bot', 'rule'].includes(ui.tab)) ui.tab = 'sets';
    ui.view = 'main';
    ui.lastWhere = '';
    ui.dirty = false;

    const root = document.createElement('div');
    root.className = 'kls-mgr';
    root.innerHTML = `
<div class="kls-mgr-head">
  <div class="kls-tabs" role="tablist">
    <button type="button" class="kls-tab" data-tab="sets" role="tab">เซท</button>
    <button type="button" class="kls-tab" data-tab="chat" role="tab">แชทนี้</button>
    <button type="button" class="kls-tab" data-tab="bot" role="tab">บอทนี้</button>
    <button type="button" class="kls-tab" data-tab="rule" role="tab">กฎการเปลี่ยน</button>
  </div>
  <div class="kls-now"></div>
  <small class="kls-hint">ลำดับความสำคัญ: แชทนี้ › บอทนี้ › กฎสุ่ม · เซทที่ผูกกับแชท/บอทชนะกฎสุ่มเสมอ · สิ่งที่แก้จะมีผลเมื่อปิดหน้านี้ (กด ลองใช้ เพื่อดูเซทก่อน)</small>
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
        // แก้กติกาแล้ว → ใส่ผลทีเดียวตอนปิด · ถ้ากำลังลองเซทอยู่ ให้ลองต่อจนกว่าจะเข้าแชทใหม่ตามที่บอกไว้
        if (ui.dirty && status.level !== 'preview') evaluate('refresh');
        ui.dirty = false;
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
        else if (ui.tab === 'rule') body.innerHTML = renderRule();
        else body.innerHTML = renderBound(ui.tab);
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

function tagSeg(tag) {
    return `<div class="kls-seg" role="group" aria-label="ช่วงเวลาของเซท">${['', 'day', 'night'].map(t => `
<button type="button" class="kls-segbtn ${tag === t ? 'on' : ''}" data-act="set-tag" data-tag="${t}" aria-pressed="${tag === t}"><i class="fa-solid ${TAG_ICON[t]}"></i><span>${TAG_LABEL[t]}</span></button>`).join('')}</div>`;
}

function tagBadge(tag) {
    return tag ? `<span class="kls-tagbadge"><i class="fa-solid ${TAG_ICON[tag]}"></i>${TAG_LABEL[tag]}</span>` : '';
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
      ${set.tag || set.noRandom ? `<div class="kls-badges">${tagBadge(set.tag)}${set.noRandom ? '<span class="kls-tagbadge kls-tag-off">ไม่สุ่ม</span>' : ''}</div>` : ''}
      <small class="kls-muted">${active ? '<i class="fa-solid fa-circle-check"></i> ใช้อยู่ · ' : ''}${usage.length ? `ใช้ใน: ${esc(usage.join(' · '))}` : 'ยังไม่ได้ใช้ในกติกาไหน'}</small>
    </div>
  </div>
  <div class="kls-row"><span>ธีม</span><select data-field="theme">${themeOptions(set.theme)}</select></div>
  <div class="kls-row"><span>BG</span><button type="button" class="kls-linkbtn" data-act="bg-pick">${esc(bgLabel(set))}</button></div>
  <div class="kls-stack"><span>ใช้ช่วงไหน</span>${tagSeg(set.tag)}</div>
  <label class="checkbox_label"><input type="checkbox" data-setflag="noRandom" ${set.noRandom ? 'checked' : ''}><span>ไม่เอาเซทนี้เข้ากฎสุ่ม</span></label>
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

// ---------------------------------------------------------------- แชทนี้ / บอทนี้ (เซทที่ผูก)
function scopeLine(level) {
    const sc = scope();
    if (level === 'chat') return `<b>แชท: ${esc(sc.chatId)}</b><small class="kls-muted">เก็บไว้ในไฟล์แชทนี้ · ชนะเซทของบอทและกฎสุ่มเสมอ</small>`;
    const kind = sc.botKey.startsWith('group:') ? 'กลุ่ม' : 'บอท';
    return `<b>${kind}: ${esc(sc.botName)}</b><small class="kls-muted">ใช้กับทุกแชทของ${kind}นี้ที่ไม่ได้ผูกเซทไว้ · ชนะกฎสุ่มเสมอ</small>`;
}

function poolFoot(level, canClear) {
    const st = stateOf(level);
    const lastSet = st?.setId ? getSet(st.setId) : null;
    return `
<div class="kls-pool-foot">
  <small class="kls-muted">${lastSet ? `สุ่มได้ล่าสุด: <b>${esc(lastSet.name)}</b> · ${esc(new Date(st.at).toLocaleString())}` : 'ยังไม่เคยสุ่มในระดับนี้'}</small>
  <div class="kls-toolbar">
    <button type="button" class="menu_button kls-btn" data-act="pool-reroll"><i class="fa-solid fa-shuffle"></i><span>สุ่มใหม่</span></button>
    ${canClear ? '<button type="button" class="menu_button kls-btn kls-danger" data-act="pool-clear"><i class="fa-solid fa-eraser"></i><span>เลิกผูกทั้งหมด</span></button>' : ''}
  </div>
</div>`;
}

/** คำอธิบายว่าเซทที่ผูกไว้จะเปลี่ยนอย่างไร (และคำเตือน) */
function boundNote(level, ids) {
    if (!ids.length) return '';
    const missing = boundMissing(level);
    const tags = new Set(ids.map(tagOf));
    if (missing) {
        const only = missing === 'night' ? 'กลางวัน' : 'กลางคืน';
        return `<div class="kls-note kls-warn-note"><i class="fa-solid fa-triangle-exclamation"></i><span>ผูกไว้แต่เซท${only} · ช่วง${PERIOD_LABEL[missing]}จะใช้เซท${only}ด้วย <b>ชนะกฎเวลาเสมอ</b> · ถ้าอยากให้สลับตามเวลา ให้ผูกเซท${PERIOD_LABEL[missing]}หรือเซท "ทั้งคู่" เพิ่ม</span></div>`;
    }
    if (tags.has('day') || tags.has('night')) {
        if (!timeReady()) {
            return `<div class="kls-note kls-warn-note"><i class="fa-solid fa-clock"></i><span>มีเซทกลางวัน/กลางคืน แต่ยังไม่ได้ตั้งเวลากลางวัน/กลางคืน · <b>กฎเวลาจะไม่ทำงาน</b> จะสุ่มจากทุกเซทที่ผูกไว้ · ตั้งได้ที่แท็บ <button type="button" class="kls-linkbtn" data-act="go-rule">กฎการเปลี่ยน</button></span></div>`;
        }
        return `<div class="kls-note"><i class="fa-solid fa-circle-half-stroke"></i><span>สลับตามกลางวัน/กลางคืน (${esc(dnRangeText())}) · ${esc(ruleFreqText())}</span></div>`;
    }
    return `<div class="kls-note"><i class="fa-solid fa-shuffle"></i><span>${ids.length > 1 ? `สุ่มจากเซทที่ผูกไว้ · ${esc(ruleFreqText())}` : 'ใช้เซทนี้ตลอด'}</span></div>`;
}

function renderBound(level) {
    const s = settings();
    const sc = scope();
    if (level === 'chat' && !sc.chatId) return `<div class="kls-empty">ยังไม่ได้เปิดแชท · เปิดแชทก่อน แล้วกลับมาที่แท็บนี้</div>`;
    if (level === 'bot' && !sc.botKey) return `<div class="kls-empty">ยังไม่ได้เลือกบอท · เปิดแชทกับบอทก่อน แล้วกลับมาที่แท็บนี้</div>`;
    const head = `<div class="kls-ctx">${scopeLine(level)}</div>`;
    if (!s.sets.length) {
        return head + `<div class="kls-empty">ยังไม่มีเซท · ไปที่แท็บ <button type="button" class="kls-linkbtn" data-act="go-sets">เซท</button> เพื่อสร้างก่อน</div>`;
    }
    const pool = getPool(level);
    const bound = new Set(pool?.entries.map(e => e.setId) || []);
    const ids = s.sets.filter(x => bound.has(x.id)).map(x => x.id);
    const st = stateOf(level);
    const items = s.sets.map(set => {
        const on = bound.has(set.id);
        return `
<button type="button" class="kls-bind ${on ? 'on' : ''} ${st?.setId === set.id && on ? 'is-active' : ''}" data-act="bind-toggle" data-id="${esc(set.id)}" aria-pressed="${on}">
  <span class="kls-bind-thumb" style='${thumbStyle(set)}'></span>
  <span class="kls-bind-main"><span class="kls-bind-name">${esc(set.name)}</span>${tagBadge(set.tag)}</span>
  <i class="fa-solid ${on ? 'fa-square-check' : 'fa-square'} kls-bind-check"></i>
</button>`;
    }).join('');
    const enabled = !pool || pool.enabled !== false;
    return head + `
${pool ? `<label class="checkbox_label"><input type="checkbox" data-bound="enabled" ${enabled ? 'checked' : ''}><span>ใช้เซทที่ผูกกับ${LEVEL_LABEL[level]}</span></label>` : ''}
<div class="kls-subhead">ผูกเซท <small class="kls-muted">${ids.length ? `ผูกไว้ ${ids.length} เซท` : `ยังไม่ได้ผูก · ${LEVEL_LABEL[level]}จะส่งต่อให้ระดับถัดไป`} · แตะเพื่อผูก/เลิกผูก</small></div>
${enabled ? boundNote(level, ids) : '<div class="kls-note"><span>ปิดอยู่ · ส่งต่อให้ระดับถัดไป</span></div>'}
<div class="kls-binds">${items}</div>
${ids.length ? poolFoot(level, true) : ''}`;
}

// ---------------------------------------------------------------- กฎการเปลี่ยน
function renderRule() {
    const s = settings();
    const r = s.rule;
    const dn = s.dayNight;
    const ready = timeReady();
    const per = currentPeriod();
    const pool = randomIds();
    const count = (t) => s.sets.filter(x => !x.noRandom && x.tag === t).length;

    const dnBox = `
<div class="kls-section">
  <div class="kls-subhead">กลางวัน / กลางคืน <small class="kls-muted">ตั้งครั้งเดียว ใช้กับทุกเซทที่ติดแท็ก ทั้งในกฎสุ่ม แชท และบอท</small></div>
  <div class="kls-row kls-time"><span><i class="fa-solid fa-sun"></i> กลางวันเริ่ม</span><input type="time" class="text_pole" data-dn="day" value="${esc(dn.day)}"></div>
  <div class="kls-row kls-time"><span><i class="fa-solid fa-moon"></i> กลางคืนเริ่ม</span><input type="time" class="text_pole" data-dn="night" value="${esc(dn.night)}"></div>
  ${ready
        ? `<div class="kls-note"><i class="fa-solid ${per.period === 'day' ? 'fa-sun' : 'fa-moon'}"></i><span>ตอนนี้เป็น<b>${PERIOD_LABEL[per.period]}</b> · ${esc(dnRangeText())}</span></div>`
        : `<div class="kls-note kls-warn-note"><i class="fa-solid fa-clock"></i><span>${dn.day && dn.night ? 'เวลากลางวันกับกลางคืนต้องไม่ซ้ำกัน' : 'ยังไม่ได้ตั้งเวลา'} · <b>กฎเวลาจะไม่ทำงาน</b> แท็กกลางวัน/กลางคืนของเซทจะยังไม่มีผล</span></div>`}
  <label class="checkbox_label ${ready ? '' : 'kls-dim'}"><input type="checkbox" data-rule="liveTime" ${s.liveTime ? 'checked' : ''} ${ready ? '' : 'disabled'}><span>เปลี่ยนทันทีเมื่อเข้ากลางวัน/กลางคืน</span></label>
  <small class="kls-hint">ขณะแชทเปิดค้าง · ถ้าปิดไว้ หรือเป็นการข้ามรอบเวลาธรรมดา จะรอเปลี่ยนตอนเปิดแชทครั้งถัดไป</small>
  ${dn.day || dn.night ? '<div class="kls-toolbar"><button type="button" class="menu_button kls-btn" data-act="dn-clear"><i class="fa-solid fa-eraser"></i><span>ล้างเวลา</span></button></div>' : ''}
</div>`;

    const dnSeg = `
<div class="kls-seg" role="group" aria-label="สุ่มจาก">
  <button type="button" class="kls-segbtn ${!r.byDayNight ? 'on' : ''}" data-act="rule-dn" data-val="0" aria-pressed="${!r.byDayNight}"><i class="fa-solid fa-layer-group"></i><span>ทุกเซท</span></button>
  <button type="button" class="kls-segbtn ${r.byDayNight ? 'on' : ''}" data-act="rule-dn" data-val="1" aria-pressed="${r.byDayNight}" ${ready ? '' : 'disabled'}><i class="fa-solid fa-circle-half-stroke"></i><span>ตามกลางวัน/กลางคืน</span></button>
</div>
${ready ? '' : '<small class="kls-hint">ตั้งเวลากลางวัน/กลางคืนด้านบนก่อน ถึงจะเลือกตามกลางวัน/กลางคืนได้</small>'}`;

    const card = (mode, icon, title, desc, body) => `
<div class="kls-mode ${r.mode === mode ? 'on' : ''}">
  <button type="button" class="kls-mode-head" data-act="rule-mode" data-mode="${mode}" aria-pressed="${r.mode === mode}">
    <i class="fa-solid ${icon}"></i>
    <span class="kls-mode-text"><b>${title}</b><small>${desc}</small></span>
    <i class="fa-solid ${r.mode === mode ? 'fa-circle-dot' : 'fa-circle'} kls-mode-radio"></i>
  </button>
  ${r.mode === mode ? `<div class="kls-mode-body">${body}</div>` : ''}
</div>`;

    const hoursSeg = `
<div class="kls-seg" role="group" aria-label="ทุกกี่ชั่วโมง">${HOURS.map(h => `
  <button type="button" class="kls-segbtn ${r.hours === h ? 'on' : ''}" data-act="rule-hours" data-val="${h}" aria-pressed="${r.hours === h}"><span>${h} ชม.</span></button>`).join('')}
</div>
<small class="kls-hint">นับจาก 0:00 ตามนาฬิกาจริง${r.hours < 24 ? ` (${Array.from({ length: 24 / r.hours }, (_, i) => `${String(i * r.hours).padStart(2, '0')}:00`).slice(0, 6).join(', ')}${24 / r.hours > 6 ? ' …' : ''})` : ' · วันละครั้ง'} · ข้ามรอบแล้วจะเปลี่ยนตอนเปิดแชทครั้งถัดไป</small>`;

    let poolWarn = '';
    if (r.enabled && !pool.length) poolWarn = '<div class="kls-note kls-warn-note"><i class="fa-solid fa-triangle-exclamation"></i><span>ไม่มีเซทที่เข้ากฎสุ่ม · แชทที่ไม่ได้ผูกเซทจะใช้ธีมและ BG ปกติ</span></div>';
    else if (r.enabled && r.byDayNight && ready) {
        const day = pool.filter(id => tagOf(id) !== 'night').length;
        const night = pool.filter(id => tagOf(id) !== 'day').length;
        if (!day || !night) poolWarn = `<div class="kls-note kls-warn-note"><i class="fa-solid fa-triangle-exclamation"></i><span>ยังไม่มีเซท${!day ? 'กลางวัน' : 'กลางคืน'}ในกฎสุ่ม · ช่วงนั้นจะสุ่มจากทุกเซท</span></div>`;
    }

    return `
<div class="kls-note kls-key-note"><i class="fa-solid fa-crown"></i><span>เซทที่ผูกไว้<b>รายแชท</b>และ<b>รายบอท</b> จะเอาชนะกฎสุ่มเสมอ · กฎนี้สุ่มให้แชทที่ไม่ได้ผูกเซท และความถี่ในการเปลี่ยนด้านล่างใช้กับเซทที่ผูกไว้ด้วย</span></div>
${dnBox}
<div class="kls-section">
  <div class="kls-subhead">โหมดการเปลี่ยนเซท</div>
  <div class="kls-modes">
    ${card('open', 'fa-door-open', 'สุ่มใหม่ทุกครั้งที่เปิดแชท', 'เข้าแชทเมื่อไรก็ได้เซทใหม่', dnSeg)}
    ${card('interval', 'fa-clock-rotate-left', 'ตามรอบเวลา', 'ทุก 1 / 6 / 12 / 24 ชม. ตามนาฬิกา', hoursSeg + dnSeg)}
  </div>
  <label class="checkbox_label"><input type="checkbox" data-rule="noRepeat" ${r.noRepeat ? 'checked' : ''}><span>ไม่ซ้ำเซทเดิมติดกัน</span></label>
</div>
<div class="kls-section">
  <label class="checkbox_label"><input type="checkbox" data-rule="enabled" ${r.enabled ? 'checked' : ''}><span>สุ่มเซทให้แชทที่ไม่ได้ผูกเซทไว้</span></label>
  <small class="kls-hint">${r.enabled
        ? `เซทที่เข้ากฎสุ่ม ${pool.length} เซท (กลางวัน ${count('day')} · กลางคืน ${count('night')} · ทั้งคู่ ${count('')}) · เอาเซทออกได้ที่แท็บ <button type="button" class="kls-linkbtn" data-act="go-sets">เซท</button>`
        : 'ปิดอยู่ · แชทที่ไม่ได้ผูกเซทจะใช้ธีมและ BG ปกติ'}</small>
  ${poolWarn}
</div>
${r.enabled && pool.length ? poolFoot('rule', false) : ''}`;
}

// ---------------------------------------------------------------- events
function cardSet(el) {
    const id = el.closest('[data-set]')?.dataset.set;
    return id ? getSet(id) : null;
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
        case 'go-rule':
            ui.tab = 'rule'; lsSet('kls_tab', 'rule'); render(); break;
        case 'set-tag': {
            const set = cardSet(btn);
            if (!set) break;
            set.tag = btn.dataset.tag || '';
            save(); render(); refreshSoon();
            break;
        }
        case 'bind-toggle': {
            const pool = ensurePool(ui.tab);
            if (!pool) break;
            const id = btn.dataset.id;
            const i = pool.entries.findIndex(e => e.setId === id);
            if (i >= 0) pool.entries.splice(i, 1);
            else pool.entries.push({ setId: id });
            if (!pool.entries.length) clearPool(ui.tab);
            else savePool(ui.tab);
            render(); refreshSoon();
            break;
        }
        case 'rule-mode':
            s.rule.mode = btn.dataset.mode === 'interval' ? 'interval' : 'open';
            save(); render(); refreshSoon();
            break;
        case 'rule-hours':
            s.rule.hours = HOURS.includes(Number(btn.dataset.val)) ? Number(btn.dataset.val) : 6;
            save(); render(); refreshSoon();
            break;
        case 'rule-dn':
            s.rule.byDayNight = btn.dataset.val === '1' && timeReady();
            save(); render(); refreshSoon();
            break;
        case 'dn-clear':
            s.dayNight = { day: '', night: '' };
            s.rule.byDayNight = false;
            save(); render(); refreshSoon();
            break;
        case 'pool-reroll':
            await rerollLevel(ui.tab); render(); break;
        case 'pool-clear': {
            const ok = await c.Popup.show.confirm(`เลิกผูกเซททั้งหมดของ${LEVEL_LABEL[ui.tab]}?`, 'เซทยังอยู่ครบ เอาออกแค่การผูกของระดับนี้', { okButton: 'เลิกผูก', cancelButton: 'ยกเลิก' });
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
    if (el.dataset.setflag) {
        const set = cardSet(el);
        if (!set) return;
        set[el.dataset.setflag] = el.checked;
        save(); render(); refreshSoon();
        return;
    }
    if (el.dataset.bound) {
        const pool = ensurePool(ui.tab);
        if (!pool) return;
        pool.enabled = el.checked;
        savePool(ui.tab); render(); refreshSoon();
        return;
    }
    if (el.dataset.rule) {
        const s = settings();
        const k = el.dataset.rule;
        if (k === 'liveTime') s.liveTime = el.checked;
        else s.rule[k] = el.checked;
        save(); render();
        if (k !== 'liveTime') refreshSoon();
        return;
    }
    if (el.dataset.dn) {
        const s = settings();
        s.dayNight[el.dataset.dn] = el.value || '';
        if (!timeReady()) s.rule.byDayNight = false;
        save(); render(); refreshSoon();
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
    lines.push(`sets=${s.sets.length} (day ${s.sets.filter(x => x.tag === 'day').length} night ${s.sets.filter(x => x.tag === 'night').length} noRandom ${s.sets.filter(x => x.noRandom).length}) bots=${Object.keys(s.characters).length}`);
    lines.push(`rule: ${JSON.stringify(s.rule)} · dayNight=${s.dayNight.day || '-'}/${s.dayNight.night || '-'} ready=${timeReady()} now=${currentPeriod()?.period || '-'}`);
    lines.push(`chat=${sc.chatId || '-'} bot=${sc.botKey || '-'}`);
    for (const lv of ['chat', 'bot', 'rule']) {
        const p = getPool(lv);
        const st = stateOf(lv);
        const what = lv === 'rule' ? `random=${randomIds().length}` : p ? `${p.enabled ? 'on' : 'off'} bound=${p.entries.length} missing=${boundMissing(lv) || '-'}` : '-';
        lines.push(`  ${lv}: ${what} state=${st ? `${getSet(st.setId)?.name || st.setId}@${st.bucket}` : '-'}`);
    }
    lines.push(`status: level=${status.level || '-'} set=${status.setName || '-'} trigger=${status.trigger}`);
    lines.push(`theme: current=${c.powerUserSettings?.theme} base=${s.baseTheme} applied=${s.appliedTheme || '-'} themes=${listThemes().length}`);
    lines.push(`bg1: ${bg1 ? bg1.style.backgroundImage || '(none)' : 'missing'} ${bg1?.style.getPropertyPriority('background-image') || ''} class=${bg1?.className || ''}`);
    if (bg1) lines.push(`bg1 computed: ${getComputedStyle(bg1).backgroundImage} · blockedByLock=${bgInfo.blockedByLock}`);
    lines.push(`st lock: ${c.chatMetadata?.custom_background || '-'} · bgModule=${bgModuleLoaded()}`);
    lines.push('log:');
    lines.push(...log.slice(-20).map(x => '  ' + x));
    return lines.join('\n');
}

export { setBgCss };
