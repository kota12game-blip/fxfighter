'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

const LEV = 25, SP = 0.01;
const fresh = () => ({ bal: 1e6, pos: [], ord: [], hist: [], bonusDay: '', bonusTotal: 0, bonusCount: 0, start: Date.now(), id: 1 });
const yen = n => (n < 0 ? '-' : '') + '¥' + Math.round(Math.abs(n)).toLocaleString('ja-JP');
const sgn = n => (n > 0 ? '+' : n < 0 ? '-' : '') + '¥' + Math.round(Math.abs(n)).toLocaleString('ja-JP');
const cl = n => (n > 0 ? 'up' : n < 0 ? 'dn' : '');
const today = () => new Date().toLocaleDateString('sv-SE');
const TABS = [['home', 'ホーム'], ['market', '市場'], ['assets', '保有資産'], ['rank', 'ランキング'], ['set', '設定']];

export default function App() {
  const [user, setUser] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [S, setS] = useState(null);
  const [candles, setCandles] = useState([]);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('home');
  const [tf, setTf] = useState(1);
  const [otype, setOtype] = useState('market');
  const [qty, setQty] = useState(10000);
  const [lp, setLp] = useState('');
  const [board, setBoard] = useState([]);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [gname, setGname] = useState('');
  const [nm, setNm] = useState('');
  const Sref = useRef(null), midRef = useRef(0), timer = useRef(null), cv = useRef(null);

  const mid = candles.length ? candles[candles.length - 1].c : 0;
  const bid = mid - SP / 2, ask = mid + SP / 2;
  midRef.current = mid;
  const toast = m => { setMsg(m); setTimeout(() => setMsg(''), 2600); };

  const calcOf = (s, m) => {
    let u = 0, mg = 0;
    s.pos.forEach(p => { u += p.side === 'buy' ? (m - SP / 2 - p.entry) * p.units : (p.entry - (m + SP / 2)) * p.units; mg += p.units * p.entry / LEV; });
    const eq = s.bal + u;
    return { u, mg, eq, free: eq - mg, lvl: mg > 0 ? eq / mg * 100 : null };
  };
  const C = S && mid ? calcOf(S, mid) : { u: 0, mg: 0, eq: S ? S.bal : 0, free: S ? S.bal : 0, lvl: null };

  const commit = n => {
    Sref.current = n; setS({ ...n });
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const eq = calcOf(n, midRef.current || 155).eq;
      await supabase.from('game_state').upsert({ user_id: user.id, data: n, updated_at: new Date().toISOString() });
      await supabase.from('profiles').update({ equity: eq, updated_at: new Date().toISOString() }).eq('id', user.id);
    }, 1500);
  };

  // ログイン状態
  useEffect(() => {
    try { const f = new URLSearchParams(location.search).get('f'); if (f) localStorage.setItem('vm_f', f); } catch {}
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);
  // セーブデータ読込
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      setProfile(p); setNm(p?.name || '');
      try { const f = localStorage.getItem('vm_f'); if (f) { localStorage.removeItem('vm_f'); await supabase.rpc('add_friend', { c: f }); history.replaceState(null, '', location.pathname); } } catch {}
      const { data: g } = await supabase.from('game_state').select('data').eq('user_id', user.id).maybeSingle();
      const s = g?.data ?? fresh(); Sref.current = s; setS(s);
    })();
  }, [user]);
  // 価格取得（20秒ごと。サーバー側キャッシュは120秒）
  useEffect(() => {
    const go = async () => {
      try { const r = await fetch('/api/candles'); const j = await r.json(); if (j.candles) { setCandles(j.candles); setErr(''); } else setErr(j.error || '価格取得エラー'); }
      catch { setErr('通信できません'); }
    };
    go(); const i = setInterval(go, 20000);
    const vis = () => { if (!document.hidden) go(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', vis); };
  }, []);
  // 指値約定・ロスカット判定（価格更新ごと）
  useEffect(() => {
    const s = Sref.current; if (!s || !candles.length) return;
    const n = structuredClone(s); let ch = false;
    n.ord = n.ord.filter(o => {
      const hit = candles.some(c => c.t >= o.t - 60000 && (o.side === 'buy' ? c.l + SP / 2 <= o.price : c.h - SP / 2 >= o.price));
      if (hit) { n.pos.push({ id: n.id++, side: o.side, units: o.units, entry: o.price, t: Date.now() }); ch = true; toast('指値約定 @' + o.price.toFixed(3)); return false; }
      return true;
    });
    const c = calcOf(n, mid);
    if (c.lvl !== null && c.lvl < 50) { n.pos.slice().forEach(p => close(n, p.id, true)); ch = true; toast('証拠金維持率50%未満のため強制ロスカット'); }
    if (ch) commit(n);
  }, [candles]);
  // ランキング
  useEffect(() => {
    if (tab !== 'rank' || !user) return;
    const go = async () => { const { data } = await supabase.from('profiles').select('id,name,equity,code').order('equity', { ascending: false }); setBoard(data || []); };
    go(); const i = setInterval(go, 20000); return () => clearInterval(i);
  }, [tab, user]);
  // ランキングに載る自分の総資産は価格更新に合わせて保存
  useEffect(() => { if (S && user && mid) commit(S); }, [mid]);

  function close(n, id, auto) {
    const i = n.pos.findIndex(p => p.id === id); if (i < 0) return;
    const p = n.pos[i], ex = p.side === 'buy' ? bid : ask;
    const pl = p.side === 'buy' ? (ex - p.entry) * p.units : (p.entry - ex) * p.units;
    n.bal += pl; n.hist.unshift({ t: Date.now(), side: p.side, units: p.units, entry: p.entry, exit: ex, pnl: pl, auto: !!auto });
    n.hist = n.hist.slice(0, 200); n.pos.splice(i, 1);
  }
  function place(side) {
    if (!mid) return toast('価格を取得中です');
    if (qty < 1000 || qty % 1000) return toast('数量は1,000通貨単位で入力してください');
    const n = structuredClone(S);
    if (otype === 'market') {
      const px = side === 'buy' ? ask : bid;
      if (qty * px / LEV > C.free) return toast('使用可能資金が足りません');
      n.pos.push({ id: n.id++, side, units: qty, entry: px, t: Date.now() }); toast((side === 'buy' ? '買い' : '売り') + '約定 @' + px.toFixed(3));
    } else {
      const p = parseFloat(lp); if (!p) return toast('指値価格を入力してください');
      if ((side === 'buy' && p >= ask) || (side === 'sell' && p <= bid)) return toast(side === 'buy' ? '買い指値はAskより下に設定してください' : '売り指値はBidより上に設定してください');
      if (qty * p / LEV > C.free) return toast('使用可能資金が足りません');
      n.ord.push({ id: n.id++, side, units: qty, price: p, t: Date.now() }); toast('指値注文を受け付けました');
    }
    commit(n);
  }
  const claim = () => { const n = structuredClone(S); n.bonusDay = today(); n.bal += 20000; n.bonusTotal += 20000; n.bonusCount++; commit(n); toast('ログインボーナス ¥20,000'); };
  const addFriend = async () => {
    const { data, error } = await supabase.rpc('add_friend', { c: code });
    toast(error ? '失敗しました' : data === 'ok' ? 'フレンドになりました' : data === 'self' ? '自分のIDです' : 'IDが見つかりません');
    if (data === 'ok') setCode('');
  };

  // チャート描画
  useEffect(() => {
    const el = cv.current; if (!el || tab !== 'market' || !candles.length) return;
    const r = window.devicePixelRatio || 1, w = el.clientWidth, h = el.clientHeight; el.width = w * r; el.height = h * r;
    const g = el.getContext('2d'); g.scale(r, r);
    const css = getComputedStyle(document.documentElement), up = css.getPropertyValue('--up'), dn = css.getPropertyValue('--dn'), ln = css.getPropertyValue('--line'), sb = css.getPropertyValue('--sub');
    const b = tf * 60000, m = new Map();
    candles.forEach(c => { const k = Math.floor(c.t / b); const x = m.get(k); if (!x) m.set(k, { ...c }); else { x.h = Math.max(x.h, c.h); x.l = Math.min(x.l, c.l); x.c = c.c; } });
    const d = [...m.values()].slice(-42);
    let hi = Math.max(...d.map(c => c.h)), lo = Math.min(...d.map(c => c.l)); const pad = (hi - lo) * .08 || .01; hi += pad; lo -= pad;
    const pw = 44, cw = (w - pw) / d.length, y = v => 6 + (hi - v) / (hi - lo) * (h - 12);
    g.font = '10px sans-serif'; g.lineWidth = 1;
    for (let i = 0; i < 4; i++) { const v = lo + (hi - lo) * i / 3, yy = y(v); g.strokeStyle = ln; g.beginPath(); g.moveTo(0, yy); g.lineTo(w - pw, yy); g.stroke(); g.fillStyle = sb; g.fillText(v.toFixed(3), w - pw + 4, yy + 3); }
    d.forEach((c, i) => { const x = i * cw + cw / 2, col = c.c >= c.o ? up : dn; g.strokeStyle = col; g.fillStyle = col; g.beginPath(); g.moveTo(x, y(c.h)); g.lineTo(x, y(c.l)); g.stroke(); g.fillRect(x - cw * .35, y(Math.max(c.o, c.c)), cw * .7, Math.max(1, Math.abs(y(c.o) - y(c.c)))); });
  }, [candles, tf, tab]);

  if (user === undefined) return <main><p className="sm">読み込み中…</p></main>;
  const guest = async () => { const { error } = await supabase.auth.signInAnonymously({ options: { data: { name: gname.trim() || 'ゲスト' } } }); if (error) alert('ゲストログインに失敗: ' + error.message); };
  const google = () => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin } });
  const link = async () => { const { error } = await supabase.auth.linkIdentity({ provider: 'google', options: { redirectTo: location.origin } }); if (error) toast('連携に失敗: ' + error.message); };
  const saveName = async () => { const n = nm.trim(); if (!n) return; await supabase.from('profiles').update({ name: n }).eq('id', user.id); setProfile({ ...profile, name: n }); toast('名前を変更しました'); };
  const invite = profile ? location.origin + '/?f=' + profile.code : '';
  const copy = async () => { try { await navigator.clipboard.writeText(invite); toast('招待リンクをコピーしました'); } catch { toast(invite); } };
  if (!user) return (<main style={{ paddingTop: 50, textAlign: 'center' }}><h1>VIRTUAL MARKET</h1><p className="sm">本物のドル円の価格で遊べる仮想トレード</p>
    <div className="card"><input value={gname} onChange={e => setGname(e.target.value)} placeholder="ニックネーム" maxLength={12} /><button className="btn" style={{ marginTop: 8, width: '100%' }} onClick={guest}>ゲストで始める</button>
      <p className="sm">登録不要。データはこの端末に紐づいて保存されます。あとからGoogleと連携すれば、他の端末でも続けられます。</p></div>
    <div className="card"><button className="btn g" style={{ width: '100%' }} onClick={google}>Googleでログイン</button><p className="sm">すでにGoogle連携したアカウントで、別の端末から続けるとき用です。</p></div></main>);
  if (!S) return <main><p className="sm">データを読み込み中…</p></main>;

  const real = S.hist.reduce((a, h) => a + h.pnl, 0);
  const left = (() => { const e = new Date(S.start); e.setMonth(e.getMonth() + 6); return Math.max(0, Math.ceil((e - Date.now()) / 864e5)); })();
  const canBonus = S.bonusDay !== today();
  const at = candles.length ? new Date(candles[candles.length - 1].t + 60000) : null;
  const hhmm = at ? String(at.getHours()).padStart(2, '0') + ':' + String(at.getMinutes()).padStart(2, '0') : '--:--';

  return (<>
    <header><b>VIRTUAL MARKET</b><span>{err ? '⚠ ' + err : '最終更新 ' + hhmm + '（最大2分遅れ）'}</span></header>
    <main>
      {tab === 'home' && <>
        <div className="card"><div className="sm">総資産</div><div className="big num">{yen(C.eq)}</div><div className={'sm num ' + cl(C.eq - 1e6)}>スタート比 {sgn(C.eq - 1e6)}</div></div>
        <div className="card">
          <div className="row"><span>現金残高</span><b className="num">{yen(S.bal)}</b></div>
          <div className="row"><span>含み損益</span><b className={'num ' + cl(C.u)}>{sgn(C.u)}</b></div>
          <div className="row"><span>確定損益</span><b className={'num ' + cl(real)}>{sgn(real)}</b></div>
          <div className="row"><span>シーズン残り</span><b>{left}日</b></div></div>
        <div className="card"><h2>ログインボーナス</h2><div className="sm" style={{ marginBottom: 8 }}>1日1回 ¥20,000（受取{S.bonusCount}回・累計{yen(S.bonusTotal)}）</div>
          <button className="btn" disabled={!canBonus} onClick={claim}>{canBonus ? '¥20,000を受け取る' : '本日は受取済み'}</button></div>
      </>}
      {tab === 'market' && <>
        <div className="card"><div className="sm">USD/JPY　米ドル／日本円</div>
          <div className="big num">{mid ? mid.toFixed(3) : '—'}</div>
          <div className="sm num">Bid {bid.toFixed(3)} / Ask {ask.toFixed(3)}　スプレッド{SP.toFixed(2)}円</div>
          <div className="seg">{[1, 5, 15].map(k => <button key={k} className={tf === k ? 'on' : ''} onClick={() => setTf(k)}>{k}分</button>)}</div>
          <canvas ref={cv} /></div>
        <div className="card">
          <div className="seg">{[['market', '成行'], ['limit', '指値']].map(([k, l]) => <button key={k} className={otype === k ? 'on' : ''} onClick={() => setOtype(k)}>{l}</button>)}</div>
          <div className="sm">数量（通貨・1,000単位）</div><input type="number" inputMode="numeric" step="1000" value={qty} onChange={e => setQty(parseInt(e.target.value) || 0)} />
          {otype === 'limit' && <><div className="sm" style={{ marginTop: 8 }}>指値価格（円）</div><input type="number" inputMode="decimal" step="0.001" value={lp} onChange={e => setLp(e.target.value)} placeholder="例 155.000" /></>}
          <div className="sm num" style={{ marginTop: 8 }}>必要証拠金 {yen(qty * (otype === 'limit' && parseFloat(lp) ? parseFloat(lp) : mid) / LEV)}　使用可能 {yen(C.free)}　手数料 ¥0</div>
          <div className="trade"><button className="s" onClick={() => place('sell')}><small>売り（Bid）</small><br />{bid.toFixed(3)}</button><button className="b" onClick={() => place('buy')}><small>買い（Ask）</small><br />{ask.toFixed(3)}</button></div>
          <details className="sm" style={{ marginTop: 8 }}><summary>用語の説明</summary><p>Bid/Ask：売る価格/買う価格。差がスプレッド（実質コスト）。レバレッジ：証拠金の{LEV}倍まで取引可。維持率が50%未満で強制ロスカット。</p></details></div>
      </>}
      {tab === 'assets' && <>
        <div className="card">
          <div className="row"><span>現金残高</span><b className="num">{yen(S.bal)}</b></div>
          <div className="row"><span>必要証拠金</span><b className="num">{yen(C.mg)}</b></div>
          <div className="row"><span>使用可能資金</span><b className="num">{yen(C.free)}</b></div>
          <div className="row"><span>含み損益</span><b className={'num ' + cl(C.u)}>{sgn(C.u)}</b></div>
          <div className="row"><span>証拠金維持率</span><b className={'num ' + (C.lvl !== null && C.lvl < 100 ? 'warn' : '')}>{C.lvl === null ? '―' : C.lvl.toFixed(0) + '%'}</b></div></div>
        <h2>保有ポジション</h2>
        {S.pos.length ? S.pos.map(p => { const pl = p.side === 'buy' ? (bid - p.entry) * p.units : (p.entry - ask) * p.units;
          return <div className="card" key={p.id}><div className="row"><b>{p.side === 'buy' ? '買い' : '売り'} {p.units.toLocaleString()}通貨</b><b className={'num ' + cl(pl)}>{sgn(pl)}</b></div><div className="sm num">建値 {p.entry.toFixed(3)}</div>
            <button className="btn g" style={{ marginTop: 8 }} onClick={() => { const n = structuredClone(S); close(n, p.id); commit(n); }}>決済する</button></div>; }) : <div className="card sm">ポジションはありません</div>}
        <h2>注文一覧</h2>
        {S.ord.length ? S.ord.map(o => <div className="card" key={o.id}><div className="row"><span>{o.side === 'buy' ? '買い' : '売り'}指値 {o.units.toLocaleString()}通貨</span><b className="num">{o.price.toFixed(3)}</b></div>
          <button className="btn g" onClick={() => { const n = structuredClone(S); n.ord = n.ord.filter(x => x.id !== o.id); commit(n); }}>取消</button></div>) : <div className="card sm">待機中の注文はありません</div>}
        <h2>取引履歴</h2>
        <div className="card">{S.hist.length ? S.hist.slice(0, 30).map((x, i) => <div className="row" key={i}><span className="sm">{new Date(x.t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}<br />{x.side === 'buy' ? '買い' : '売り'} {x.units.toLocaleString()}{x.auto ? '（ロスカット）' : ''}<br />{x.entry.toFixed(3)} → {x.exit.toFixed(3)}</span><b className={'num ' + cl(x.pnl)}>{sgn(x.pnl)}</b></div>) : <span className="sm">まだありません</span>}</div>
      </>}
      {tab === 'rank' && <>
        <div className="card"><h2>フレンドランキング（総資産）</h2>
          {board.map((r, i) => <div key={r.id} className={'row' + (r.id === user.id ? ' me' : '')}><span>{i + 1}位　{r.id === user.id ? 'あなた' : r.name}</span><b className="num">{yen(r.id === user.id ? C.eq : r.equity)}</b></div>)}
          {board.length <= 1 && <div className="sm">フレンドを追加すると順位が表示されます</div>}</div>
        <div className="card"><h2>フレンドを追加</h2><div className="sm" style={{ marginBottom: 6 }}>あなたのフレンドID：<b>{profile?.code}</b></div><button className="btn g" style={{ marginBottom: 10 }} onClick={copy}>招待リンクをコピー</button><div className="sm" style={{ marginBottom: 6 }}>リンクを送ると、相手は開くだけで（ゲストでOK）フレンドになります。IDを直接入力して追加もできます。</div>
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="相手のフレンドID" /><button className="btn" style={{ marginTop: 8 }} onClick={addFriend}>追加する</button></div>
      </>}
      {tab === 'set' && <>
        <div className="card"><h2>プロフィール</h2><input value={nm} onChange={e => setNm(e.target.value)} maxLength={12} /><button className="btn g" style={{ marginTop: 8 }} onClick={saveName}>名前を変更</button></div>
        <div className="card"><h2>アカウント</h2>
          {user.is_anonymous ? <><p className="sm warn">ゲストでプレイ中です。ブラウザのデータを消したり端末を変えるとデータを失います。</p><button className="btn" onClick={link}>Googleと連携する</button><p className="sm">連携すると、PCなど他の端末からもGoogleログインで続きから遊べます。</p></>
            : <><div className="sm" style={{ marginBottom: 8 }}>{user.email}（Google連携済み）</div><button className="btn g" onClick={() => supabase.auth.signOut()}>ログアウト</button></>}
          {user.is_anonymous && <button className="btn g" style={{ marginTop: 8 }} onClick={() => { if (confirm('ゲストのままログアウトするとこのデータには戻れません。よろしいですか？')) supabase.auth.signOut(); }}>ログアウト</button>}</div>
        <div className="card"><button className="btn g" onClick={() => { if (confirm('最初からやり直しますか？')) commit(fresh()); }}>データをリセット</button></div>
      </>}
    </main>
    {msg && <div className="toast" role="status">{msg}</div>}
    <nav>{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
  </>);
}
