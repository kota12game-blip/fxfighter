// 為替市場の開閉判定（ニューヨーク時間 金曜17時〜日曜17時が休み。夏時間にも自動対応）
// ※クリスマス・年末年始などの特別休場は考慮していません
export function isMarketOpen(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  const h = parseInt(p.hour, 10), w = p.weekday;
  if (w === 'Sat') return false;
  if (w === 'Fri' && h >= 17) return false;
  if (w === 'Sun' && h < 17) return false;
  return true;
}

// 価格の更新間隔（秒）。全端末でこの区切り（例: 120秒なら 12:00:00, 12:02:00 …）に合わせて同時に更新する
export const SLOT_SEC = 120;
// 節約モード（APIの残りが少ないとき）の更新間隔（秒）
export const SLOW_SEC = 300;
