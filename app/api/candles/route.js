import { isMarketOpen, SLOT_SEC, SLOW_SEC } from '../../../lib/market';

// Twelve Dataの1分足を取得。
// ・更新は「区切り」に揃える（全端末が同じタイミングで同じ価格になる）
// ・通常は SLOT_SEC（2分）、APIの残りが少ないときは SLOW_SEC（5分）に自動で切り替え
// ・休場中は6時間キャッシュ。取得に失敗したときはエラーを返す（画面側が取引を一時停止）
export const dynamic = 'force-dynamic';

const CLOSED_TTL = 6 * 3600 * 1000, PLAN_LIMIT = 800;
let mem = { at: 0, nextAt: 0, candles: null, interval: SLOT_SEC, mode: 'normal', left: null };
let used = { day: '', n: 0 };
let lastFail = 0;

const ok = (m, maxAge, open) => Response.json(
  { serverTime: Date.now(), candles: m.candles, nextAt: open ? m.nextAt : null, intervalSec: m.interval, mode: open ? m.mode : 'closed', left: m.left },
  { headers: { 'Cache-Control': `public, s-maxage=${maxAge}, stale-while-revalidate=0` } });
const fail = msg => Response.json({ error: msg }, { status: 502, headers: { 'Cache-Control': 'no-store' } });

// 残りクレジットで、今日の終わりまで通常ペースを保てるか
function pickInterval(left, now) {
  if (left == null) return SLOT_SEC;
  const d = new Date(now), end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  const need = (end - now) / 1000 / SLOT_SEC;
  return left >= need * 1.1 ? SLOT_SEC : SLOW_SEC;
}

async function refresh(now, key) {
  const url = `https://api.twelvedata.com/time_series?symbol=USD/JPY&interval=1min&outputsize=240&timezone=UTC&apikey=${key}`;
  const res = await fetch(url, { cache: 'no-store' });
  const j = await res.json();
  if (!j.values) throw new Error(j.message || '価格を取得できません');
  const candles = j.values.map(v => ({ t: new Date(v.datetime.replace(' ', 'T') + 'Z').getTime(), o: +v.open, h: +v.high, l: +v.low, c: +v.close })).reverse();
  // 残りクレジット：APIのヘッダーがあればそれを使い、なければこのサーバーでの回数から推定
  const day = new Date(now).toISOString().slice(0, 10);
  if (used.day !== day) used = { day, n: 0 };
  used.n++;
  // ※ヘッダーの値は「1分あたりの残り」の可能性があり、1日の残りと取り違えると常に節約モードになるため使わない
  const left = Math.max(0, PLAN_LIMIT - used.n);
  const interval = pickInterval(left, now);
  const nextAt = (Math.floor(now / (interval * 1000)) + 1) * interval * 1000;
  mem = { at: now, nextAt, candles, interval, mode: interval === SLOT_SEC ? 'normal' : 'slow', left };
}

let inflight = null; // 同時に来た要求は、1回の取得を共有する（無料枠の無駄づかいを防ぐ）

export async function GET() {
  const key = process.env.TWELVE_DATA_KEY;
  if (!key) return fail('TWELVE_DATA_KEY が未設定です');
  const now = Date.now(), open = isMarketOpen();
  if (mem.candles) {
    if (open && now < mem.nextAt) return ok(mem, Math.max(1, Math.ceil((mem.nextAt - now) / 1000)), true);
    if (!open && now - mem.at < CLOSED_TTL) return ok(mem, 21600, false);
  }
  if (!inflight && now - lastFail < 15000) return fail('価格データを一時的に取得できません');
  try {
    if (!inflight) inflight = refresh(now, key).finally(() => { inflight = null; });
    await inflight;
    return ok(mem, open ? Math.max(1, Math.ceil((mem.nextAt - Date.now()) / 1000)) : 21600, open);
  } catch (e) {
    lastFail = Date.now();
    return fail(String(e.message || e));
  }
}
