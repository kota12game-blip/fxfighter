// Twelve Dataの1分足を取得。サーバー側で120秒キャッシュ → 友達が何人開いても1日720クレジット(無料枠800以内)
export async function GET() {
  const key = process.env.TWELVE_DATA_KEY;
  if (!key) return Response.json({ error: 'TWELVE_DATA_KEY が未設定です' }, { status: 500 });
  const url = `https://api.twelvedata.com/time_series?symbol=USD/JPY&interval=1min&outputsize=240&timezone=UTC&apikey=${key}`;
  const r = await fetch(url, { next: { revalidate: 120 } });
  const j = await r.json();
  if (!j.values) return Response.json({ error: j.message || '価格を取得できません' }, { status: 502 });
  const candles = j.values.map(v => ({ t: new Date(v.datetime.replace(' ', 'T') + 'Z').getTime(), o: +v.open, h: +v.high, l: +v.low, c: +v.close })).reverse();
  return Response.json({ candles }, { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=60' } });
}
