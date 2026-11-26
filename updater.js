// updater.js — ดึงเวอร์ชันล่าสุด: git pull ผ่าน ST → ล้างแคชไฟล์ของเราในเบราว์เซอร์ → โหลดหน้าใหม่
import { ctx, EXT_URL, note } from './core.js';

// ไฟล์ทั้งหมดที่เบราว์เซอร์ต้องโหลดใหม่ (เพิ่มไฟล์ใหม่ที่นี่ทุกครั้ง)
export const FILES = ['manifest.json', 'index.js', 'core.js', 'engine.js', 'ui.js', 'updater.js', 'theme-palette.js', 'style.css'];

/** ชื่อโฟลเดอร์ของ extension ตามที่ ST ติดตั้งไว้ เช่น SillyTavern-Kaleidoscope */
export const folderName = () => decodeURIComponent(EXT_URL.split('/').pop() || '');

/** เวอร์ชันใน manifest.json บนเซิร์ฟเวอร์ (ไม่ใช้แคช) */
export async function serverVersion() {
    const r = await fetch(`${EXT_URL}/manifest.json`, { cache: 'reload' });
    if (!r.ok) throw new Error(`อ่าน manifest ไม่ได้ (HTTP ${r.status})`);
    return String((await r.json()).version || '');
}

/** เทียบเวอร์ชันแบบ 1.2.10 > 1.2.9 */
export function compareVersions(a, b) {
    const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d) return d > 0 ? 1 : -1;
    }
    return 0;
}

async function gitPull() {
    const name = folderName();
    const headers = ctx().getRequestHeaders();
    // ลองแบบติดตั้งให้ผู้ใช้คนเดียวก่อน ถ้าไม่เจอค่อยลองแบบติดตั้งให้ทุกคน (global)
    for (const global of [false, true]) {
        const r = await fetch('/api/extensions/update', {
            method: 'POST',
            headers,
            body: JSON.stringify({ extensionName: name, global }),
        });
        if (r.status === 404) continue;
        if (r.status === 403) throw new Error('ไม่มีสิทธิ์อัปเดต extension ที่ติดตั้งให้ทุกคน · ให้แอดมินกดอัปเดตแทน');
        if (!r.ok) {
            const text = (await r.text()).slice(0, 200);
            throw new Error(`ST ดึงเวอร์ชันไม่สำเร็จ (HTTP ${r.status}) ${text}`);
        }
        return await r.json(); // { isUpToDate, shortCommitHash, remoteUrl }
    }
    throw new Error(`ไม่พบโฟลเดอร์ "${name}" ใน extensions`);
}

async function bustCache() {
    await Promise.all(FILES.map(f => fetch(`${EXT_URL}/${f}`, { cache: 'reload' }).catch(() => null)));
}

/**
 * ดึงเวอร์ชันล่าสุด
 * @param {string} running เวอร์ชันที่กำลังทำงานอยู่ในหน้านี้
 * @returns {Promise<{ pulled: boolean, commit: string, from: string, to: string, needsReload: boolean }>}
 */
export async function pullLatest(running) {
    let pulled = false;
    let commit = '';
    try {
        const res = await gitPull();
        pulled = !res.isUpToDate;
        commit = res.shortCommitHash || '';
    } catch (err) {
        // ดึงจาก GitHub ไม่ได้ (ไม่ได้ติดตั้งด้วย git / ไม่มีเน็ต) → ยังล้างแคชได้ ถ้าไฟล์บนเครื่องใหม่กว่า
        note('warn', `update: ${err?.message || err}`);
        await bustCache();
        const to = await serverVersion().catch(() => '');
        if (to && compareVersions(to, running) !== 0) {
            return { pulled: false, commit: '', from: running, to, needsReload: true };
        }
        throw err;
    }
    await bustCache();
    const to = await serverVersion().catch(() => running);
    return { pulled, commit, from: running, to, needsReload: pulled || compareVersions(to, running) !== 0 };
}
