import { createClient } from '@supabase/supabase-js';
import { isMarketOpen, SLOT_SEC, SLOW_SEC, SLOW_BELOW } from '../../../lib/market';

// Twelve Dataの1分足を取得（USD/JPY は常に、AUD/JPY は ?aud=1 のときだけ）。
// ・更新は「区切り」に揃える（全端末が同じタイミングで同じ価格になる）
// ・通常は SLOT_SEC（2分）、APIの残りが少ないときは SLOW_SEC（5分）に自動で切り替え
// ・取得するたびに、通貨の数だけAPI使用量をDBへ加算（UTC0時＝日本時間9時に800へ戻る）
// ・休場中は6時間キャッシュ。取得に失敗したときはエラーを返す（画面側が取引を一時停止）
export const dynamic = 'force-dynamic';

const CLOSED_TTL = 6 * 3600 * 1000, PLAN_LIMIT = 800;
const TD = { USDJPY: 'USD/JPY', AUDJPY: 'AUD/JPY' };
const mems = {}; // { USDJPY: { at, nextAt, candles }, AUDJPY: {...} }
let meta = { interval: SLOT_SEC, mode: 'normal', left: null, manual: null };
let used = { day: '', n: 0 }; // DBが使えないときの予備カウント
let lastFail = 0, lastMsg = '';
const inflight = {};
const symErr = {}; // 通貨ごとの直近のエラー（画面の「接続情報」に出す）

const fail = msg => Response.json({ error: msg }, { status: 502, headers: { 'Cache-Control': 'no-store' } });

// 更新間隔の決め方：管理者の手動指定があればそれを優先。なければ、APIの残りが SLOW_BELOW 未満のときだけ節約（5分）
function pickInterval(left, manualMode) {
  if (manualMode === 'slow') return SLOW_SEC;
  if (manualMode === 'normal') return SLOT_SEC;
  if (left == null) return SLOT_SEC;
  return left < SLOW_BELOW ? SLOW_SEC : SLOT_SEC;
}

async function refresh(syms, now, key) {
  const url = `https://api.twelvedata.com/time_series?symbol=${syms.map(s => TD[s]).join(',')}&interval=1min&outputsize=240&timezone=UTC&apikey=${key}`;
  const res = await fetch(url, { cache: 'no-store' });
  const j = await res.json();
  let okN = 0, msg = null;
  for (const s of syms) {
    const o = syms.length === 1 ? j : j[TD[s]];
    if (o && o.values && o.values.length) {
      const candles = o.values.map(v => ({ t: new Date(v.datetime.replace(' ', 'T') + 'Z').getTime(), o: +v.open, h: +v.high, l: +v.low, c: +v.close })).reverse();
      mems[s] = { at: now, nextAt: 0, candles }; okN++; delete symErr[s];
    } else { symErr[s] = (o && (o.message || o.status)) || j.message || '空のデータが返りました'; if (!msg) msg = symErr[s]; }
  }
  if (!okN) throw new Error(msg || '価格を取得できません');
  // API使用量：取得するたびにDBへ加算。DBが使えないときは、このサーバーでの回数から推定
  let usedToday = null;
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data } = await sb.rpc('api_budget_add', { n: okN });
    if (typeof data === 'number') usedToday = data;
  } catch {}
  if (usedToday === null) {
    const day = new Date(now).toISOString().slice(0, 10);
    if (used.day !== day) used = { day, n: 0 };
    used.n += okN; usedToday = used.n;
  }
  const left = Math.max(0, PLAN_LIMIT - usedToday);
  // 管理者が手動で切り替えているか（1時間で自動判定に戻る）
  let ov = null;
  try {
    const sb2 = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data } = await sb2.rpc('get_fetch_override');
    if (data && data.mode) ov = data;
  } catch {}
  const interval = pickInterval(left, ov && ov.mode);
  const nextAt = (Math.floor(now / (interval * 1000)) + 1) * interval * 1000;
  for (const s of syms) if (mems[s] && mems[s].at === now) mems[s].nextAt = nextAt;
  meta = { interval, mode: interval === SLOT_SEC ? 'normal' : 'slow', left, manual: ov ? { mode: ov.mode, until: ov.until } : null };
  if (okN < syms.length) lastMsg = msg || '';
}

export async function GET(req) {
  const key = process.env.TWELVE_DATA_KEY;
  if (!key) return fail('TWELVE_DATA_KEY が未設定です');
  const want = new URL(req.url).searchParams.get('aud') ? ['USDJPY', 'AUDJPY'] : ['USDJPY'];
  const now = Date.now(), open = isMarketOpen();
  const stale = want.filter(s => !mems[s] || (open ? now >= mems[s].nextAt : now - mems[s].at >= CLOSED_TTL));
  if (stale.length) {
    const k = stale.join('+');
    if (!inflight[k] && now - lastFail < 15000) { if (!mems.USDJPY) return fail('価格データを一時的に取得できません'); }
    else {
      try {
        if (!inflight[k]) inflight[k] = refresh(stale, now, key).finally(() => { delete inflight[k]; });
        await inflight[k];
      } catch (e) { lastFail = Date.now(); lastMsg = String(e.message || e); }
    }
  }
  const t = Date.now();
  const ready = want.filter(s => mems[s] && (open ? t < mems[s].nextAt : true));
  if (!ready.length) return fail(lastMsg || '価格を取得できません');
  const missing = want.filter(s => !ready.includes(s));
  const nextAt = open ? Math.min(...ready.map(s => mems[s].nextAt)) : null;
  const maxAge = missing.length ? 15 : open ? Math.max(1, Math.ceil((nextAt - t) / 1000)) : 21600;
  const cdl = Object.fromEntries(ready.map(s => [s, mems[s].candles]));
  return Response.json(
    { serverTime: t, cdl, candles: cdl.USDJPY || null, nextAt, intervalSec: meta.interval, mode: open ? meta.mode : 'closed', left: meta.left, manual: open ? meta.manual : null, missing, errors: Object.fromEntries(want.filter(s => symErr[s]).map(s => [s, symErr[s]])) },
    { headers: { 'Cache-Control': `public, s-maxage=${maxAge}, stale-while-revalidate=0` } });
}
