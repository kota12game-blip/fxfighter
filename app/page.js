'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import QRCode from 'qrcode';
import jsQR from 'jsqr';

const LEV = 25, SP = 0.01;
const fresh = () => ({ bal: 1e6, pos: [], ord: [], hist: [], bonusDay: '', bonusTotal: 0, bonusCount: 0, start: Date.now(), id: 1, items: { own: [], guard: 0 }, guardOn: false });
const yen = n => (n < 0 ? '-' : '') + '¥' + Math.round(Math.abs(n)).toLocaleString('ja-JP');
const sgn = n => (n > 0 ? '+' : n < 0 ? '-' : '') + '¥' + Math.round(Math.abs(n)).toLocaleString('ja-JP');
const cl = n => (n > 0 ? 'up' : n < 0 ? 'dn' : '');
const today = () => new Date().toLocaleDateString('sv-SE');
const TITLES = [['見習いトレーダー', 30000], ['相場の旅人', 100000], ['ドル円職人', 300000], ['円安の覇者', 1000000]];
const ICONS = [['🐣', 10000], ['🦊', 50000], ['🐺', 150000], ['🦁', 400000], ['🐉', 1000000]];
const GUARD_PRICE = 60000, GUARD_MAX = 3;
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
  const [tut, setTut] = useState(-1);
  const [rtab, setRtab] = useState('rank');
  const [feed, setFeed] = useState([]);
  const [peer, setPeer] = useState({});
  const [qrUrl, setQrUrl] = useState('');
  const [scan, setScan] = useState(false);
  const [groups, setGroups] = useState([]);
  const [gsel, setGsel] = useState(null);
  const [gboard, setGboard] = useState([]);
  const [gn, setGn] = useState('');
  const [gc, setGc] = useState('');
  const [sendTo, setSendTo] = useState(null);
  const [amt, setAmt] = useState('');
  const [snote, setSnote] = useState('');
  const [tlist, setTlist] = useState([]);
  const Sref = useRef(null), midRef = useRef(0), timer = useRef(null), cv = useRef(null), profRef = useRef(null), vid = useRef(null);

  const mid = candles.length ? candles[candles.length - 1].c : 0;
  const bid = mid - SP / 2, ask = mid + SP / 2;
  midRef.current = mid;
  const toast = m => { setMsg(m); setTimeout(() => setMsg(''), 2600); };
  const post = (text, pnl) => { if (user) supabase.from('feed').insert({ user_id: user.id, text, pnl: pnl ?? null }).then(() => {}); };

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
      const n = Sref.current;
      const eq = calcOf(n, midRef.current || 155).eq;
      await supabase.from('game_state').upsert({ user_id: user.id, data: n, updated_at: new Date().toISOString() });
      await supabase.from('profiles').update({ equity: eq, updated_at: new Date().toISOString() }).eq('id', user.id);
      await supabase.from('public_positions').upsert({ user_id: user.id, pos: profRef.current?.share_pos === false ? [] : n.pos.map(q => ({ side: q.side, units: q.units, entry: q.entry })), updated_at: new Date().toISOString() });
    }, 1500);
  };

  // ログイン状態
  useEffect(() => {
    try { const f = new URLSearchParams(location.search).get('f'); if (f) localStorage.setItem('vm_f', f); const gg = new URLSearchParams(location.search).get('g'); if (gg) localStorage.setItem('vm_g', gg); } catch {}
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);
  // セーブデータ読込
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      setProfile(p); profRef.current = p; setNm(p?.name || '');
      try { if (!localStorage.getItem('vm_tut')) setTut(0); } catch {}
      try { const f = localStorage.getItem('vm_f'); if (f) { localStorage.removeItem('vm_f'); await supabase.rpc('add_friend', { c: f }); history.replaceState(null, '', location.pathname); } } catch {}
      try { const g = localStorage.getItem('vm_g'); if (g) { localStorage.removeItem('vm_g'); await supabase.rpc('join_group', { c: g }); history.replaceState(null, '', location.pathname); } } catch {}
      const { data: g } = await supabase.from('game_state').select('data').eq('user_id', user.id).maybeSingle();
      const s = Object.assign(fresh(), g?.data || {}); Sref.current = s; setS(s);
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
      if (hit) { n.pos.push({ id: n.id++, side: o.side, units: o.units, entry: o.price, t: Date.now() }); ch = true; toast('指値約定 @' + o.price.toFixed(3)); post('指値約定 ' + (o.side === 'buy' ? '買い ' : '売り ') + o.units.toLocaleString() + '通貨 @' + o.price.toFixed(3)); return false; }
      return true;
    });
    const c = calcOf(n, mid);
    if (c.lvl === null) { if (n.guardOn) { n.guardOn = false; ch = true; } }
    else {
      if (n.guardOn && c.lvl >= 50) { n.guardOn = false; ch = true; toast('ロスカット回避券の効果が終わりました'); }
      if (c.lvl < (n.guardOn ? 20 : 50)) {
        if (!n.guardOn && n.items.guard > 0) { n.items.guard--; n.guardOn = true; ch = true; toast('ロスカット回避券を使いました（維持率20%まで猶予）'); post('🛡 ロスカット回避券を使った！'); }
        else { n.pos.slice().forEach(q => close(n, q.id, true)); n.guardOn = false; ch = true; toast('証拠金維持率が下限を下回ったため強制ロスカット'); post('強制ロスカットされました'); }
      }
    }
    if (ch) commit(n);
  }, [candles]);
  // ランキング
  useEffect(() => {
    if (tab !== 'rank' || !user) return;
    const go = async () => { const { data } = await supabase.from('profiles').select('id,name,equity,code,title,icon').order('equity', { ascending: false }); setBoard(data || []); };
    go(); const i = setInterval(go, 20000); return () => clearInterval(i);
  }, [tab, user]);
  // ランキングに載る自分の総資産は価格更新に合わせて保存
  useEffect(() => { if (S && user && mid) commit(S); }, [mid]);

  function close(n, id, auto) {
    const i = n.pos.findIndex(p => p.id === id); if (i < 0) return;
    const p = n.pos[i], ex = p.side === 'buy' ? bid : ask;
    const pl = p.side === 'buy' ? (ex - p.entry) * p.units : (p.entry - ex) * p.units;
    n.bal += pl; n.hist.unshift({ et: p.t, t: Date.now(), side: p.side, units: p.units, entry: p.entry, exit: ex, pnl: pl, auto: !!auto });
    n.hist = n.hist.slice(0, 200); n.pos.splice(i, 1);
  }
  function place(side) {
    if (!mid) return toast('価格を取得中です');
    if (qty < 1000 || qty % 1000) return toast('数量は1,000通貨単位で入力してください');
    const n = structuredClone(S);
    if (otype === 'market') {
      const px = side === 'buy' ? ask : bid;
      if (qty * px / LEV > C.free) return toast('使用可能資金が足りません');
      n.pos.push({ id: n.id++, side, units: qty, entry: px, t: Date.now() }); toast((side === 'buy' ? '買い' : '売り') + '約定 @' + px.toFixed(3)); post((side === 'buy' ? '買い ' : '売り ') + qty.toLocaleString() + '通貨 @' + px.toFixed(3));
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

  // ---- ヘルパー ----
  const lcPx = st => { let net = 0, cst = 0, mg = 0; st.pos.forEach(q => { mg += q.units * q.entry / LEV; if (q.side === 'buy') { net += q.units; cst += (-SP / 2 - q.entry) * q.units; } else { net -= q.units; cst += (q.entry - SP / 2) * q.units; } }); return net ? ((st.guardOn ? 0.2 : 0.5) * mg - st.bal - cst) / net : null; };
  const loadGroups = async () => { const { data } = await supabase.rpc('my_groups'); const l = data || []; setGroups(l); setGsel(cur => (l.find(x => x.id === cur) ? cur : (l[0]?.id ?? null))); };
  const loadGBoard = async () => { if (!gsel) { setGboard([]); return; } const { data } = await supabase.rpc('group_board', { gid: gsel }); setGboard(data || []); };
  const createGroup = async () => { const v = gn.trim(); if (!v) return toast('グループ名を入力してください'); const { error } = await supabase.rpc('create_group', { gname: v }); if (error) return toast('作成に失敗しました'); setGn(''); toast('グループを作りました'); loadGroups(); };
  const joinGroup = async c => { const { data, error } = await supabase.rpc('join_group', { c }); toast(error ? '失敗しました' : data === 'ok' ? 'グループに参加しました。メンバー全員とフレンドになりました' : data === 'already' ? 'すでに参加しています' : data === 'full' ? 'メンバーの上限（30人）です' : 'コードが見つかりません'); setGc(''); loadGroups(); };
  const leaveGroup = async id => { if (!confirm('このグループを抜けますか？（フレンド関係は残ります）')) return; await supabase.rpc('leave_group', { gid: id }); loadGroups(); };
  const removeFriend = async r => { if (!confirm(r.name + ' さんをフレンドから削除しますか？')) return; await supabase.rpc('remove_friend', { fid: r.id }); setBoard(board.filter(x => x.id !== r.id)); toast('フレンドを削除しました'); };
  useEffect(() => { if (tab !== 'rank' || rtab !== 'group' || !user) return; loadGroups(); }, [tab, rtab, user]);
  useEffect(() => { if (tab !== 'rank' || rtab !== 'group' || !gsel) return; loadGBoard(); const i = setInterval(loadGBoard, 20000); return () => clearInterval(i); }, [tab, rtab, gsel]);
  const claimTransfers = async () => {
    if (!Sref.current) return;
    const { data } = await supabase.rpc('claim_transfers');
    if (!data || !data.length) return;
    const sum = data.reduce((a, x) => a + Number(x.amount), 0);
    const n = structuredClone(Sref.current); n.bal += sum;
    Sref.current = n; setS(n);
    await supabase.from('game_state').upsert({ user_id: user.id, data: n, updated_at: new Date().toISOString() });
    toast((data[0].from || 'フレンド') + ' さんから ' + yen(sum) + ' 受け取りました' + (data.length > 1 ? '（他' + (data.length - 1) + '件）' : ''));
  };
  const loadTransfers = async () => { const { data } = await supabase.from('transfers').select('id,amount,note,created_at,from_user,to_user,fp:profiles!transfers_from_user_fkey(name),tp:profiles!transfers_to_user_fkey(name)').order('created_at', { ascending: false }).limit(10); setTlist(data || []); };
  const sendMoney = async () => {
    if (!sendTo) return;
    const a = Math.floor(Number(amt));
    if (!(a >= 1000)) return toast('金額は1,000円以上で入力してください');
    if (a > 1000000) return toast('1回の送金は100万円までです');
    if (C.free < a) return toast('使用可能資金が足りません');
    const { data, error } = await supabase.rpc('send_transfer', { to_id: sendTo.id, amt: a, note: snote });
    if (error || data !== 'ok') return toast(data === 'notfriend' ? 'フレンドではありません' : '送金に失敗しました');
    const n = structuredClone(S); n.bal -= a; commit(n);
    post('🎁 ' + sendTo.name + ' さんに ' + yen(a) + ' を送金');
    toast(sendTo.name + ' さんに ' + yen(a) + ' を送りました（相手が開くと届きます）');
    setSendTo(null); setAmt(''); setSnote(''); loadTransfers();
  };
  useEffect(() => { if (!user || !S) return; claimTransfers(); const i = setInterval(claimTransfers, 20000); return () => clearInterval(i); }, [user, !!S]);
  useEffect(() => { if (tab === 'rank' && rtab === 'friend' && user) loadTransfers(); }, [tab, rtab, user]);
  const buy = (key, price) => {
    if (C.free < price) return toast('使用可能資金が足りません');
    const n = structuredClone(S);
    if (key === 'guard') { if (n.items.guard >= GUARD_MAX) return toast('持てるのは最大' + GUARD_MAX + '枚です'); n.items.guard++; } else n.items.own.push(key);
    n.bal -= price; commit(n); toast('購入しました');
  };
  const equip = async (field, val) => { await supabase.from('profiles').update({ [field]: val }).eq('id', user.id); const np = { ...profile, [field]: val }; setProfile(np); profRef.current = np; };
  const ppl = q => (q.side === 'buy' ? (bid - q.entry) : (q.entry - ask)) * q.units;
  const loadFeed = async () => { const { data } = await supabase.from('feed').select('id,user_id,text,pnl,created_at,profiles(name,title,icon),reactions(emoji,user_id)').order('created_at', { ascending: false }).limit(40); setFeed(data || []); };
  const react = async (f, emoji) => {
    const mine = f.reactions.some(r => r.user_id === user.id && r.emoji === emoji);
    if (mine) await supabase.from('reactions').delete().match({ feed_id: f.id, user_id: user.id, emoji });
    else await supabase.from('reactions').upsert({ feed_id: f.id, user_id: user.id, emoji });
    loadFeed();
  };
  const openPeer = async id => {
    if (peer[id]) { const n = { ...peer }; delete n[id]; setPeer(n); return; }
    const { data } = await supabase.from('public_positions').select('pos').eq('user_id', id).maybeSingle();
    setPeer({ ...peer, [id]: data?.pos || [] });
  };
  useEffect(() => { if (tab !== 'rank' || rtab !== 'feed' || !user) return; loadFeed(); const i = setInterval(loadFeed, 15000); return () => clearInterval(i); }, [tab, rtab, user]);
  // QR読み取り
  useEffect(() => {
    if (!scan) return;
    let stream, raf, done = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const v = vid.current; v.srcObject = stream; await v.play();
        const c = document.createElement('canvas');
        const loop = async () => {
          if (done) return;
          if (v.videoWidth) {
            c.width = v.videoWidth; c.height = v.videoHeight; const x = c.getContext('2d'); x.drawImage(v, 0, 0);
            const im = x.getImageData(0, 0, c.width, c.height); const r = jsQR(im.data, c.width, c.height);
            if (r) { done = true; setScan(false); let f = r.data; try { f = new URL(r.data).searchParams.get('f') || f; } catch {}
              const { data } = await supabase.rpc('add_friend', { c: f }); toast(data === 'ok' ? 'フレンドになりました' : data === 'self' ? '自分のIDです' : 'IDが見つかりません'); return; }
          }
          raf = requestAnimationFrame(loop);
        };
        loop();
      } catch { toast('カメラを使えません'); setScan(false); }
    })();
    return () => { done = true; cancelAnimationFrame(raf); stream && stream.getTracks().forEach(t => t.stop()); };
  }, [scan]);
  // チャート描画（ロスカットライン・取引マーカー付き）
  useEffect(() => {
    const el = cv.current; if (!el || tab !== 'market' || !candles.length) return;
    const r = window.devicePixelRatio || 1, w = el.clientWidth, h = el.clientHeight; el.width = w * r; el.height = h * r;
    const g = el.getContext('2d'); g.scale(r, r);
    const css = getComputedStyle(document.documentElement), up = css.getPropertyValue('--up'), dn = css.getPropertyValue('--dn'), ln = css.getPropertyValue('--line'), sb = css.getPropertyValue('--sub');
    const b = tf * 60000, m = new Map();
    candles.forEach(c => { const k = Math.floor(c.t / b); const x = m.get(k); if (!x) m.set(k, { ...c, t: k * b }); else { x.h = Math.max(x.h, c.h); x.l = Math.min(x.l, c.l); x.c = c.c; } });
    const d = [...m.values()].slice(-42);
    let hi = Math.max(...d.map(c => c.h)), lo = Math.min(...d.map(c => c.l));
    const lc = S ? lcPx(S) : null;
    if (lc && Math.abs(lc - mid) < mid * 0.01) { hi = Math.max(hi, lc); lo = Math.min(lo, lc); }
    const pad = (hi - lo) * .08 || .01; hi += pad; lo -= pad;
    const pw = 44, cw = (w - pw) / d.length, y = v => 6 + (hi - v) / (hi - lo) * (h - 12);
    g.font = '10px sans-serif'; g.lineWidth = 1;
    for (let i = 0; i < 4; i++) { const v = lo + (hi - lo) * i / 3, yy = y(v); g.strokeStyle = ln; g.beginPath(); g.moveTo(0, yy); g.lineTo(w - pw, yy); g.stroke(); g.fillStyle = sb; g.fillText(v.toFixed(3), w - pw + 4, yy + 3); }
    d.forEach((c, i) => { const x = i * cw + cw / 2, col = c.c >= c.o ? up : dn; g.strokeStyle = col; g.fillStyle = col; g.beginPath(); g.moveTo(x, y(c.h)); g.lineTo(x, y(c.l)); g.stroke(); g.fillRect(x - cw * .35, y(Math.max(c.o, c.c)), cw * .7, Math.max(1, Math.abs(y(c.o) - y(c.c)))); });
    // 取引マーカー（▲買い ▼売り）
    const idxOf = t => { let k = -1; d.forEach((c, i) => { if (c.t <= t) k = i; }); return k; };
    if (S) {
      const items = S.pos.map(q => ({ t: q.t, price: q.entry, side: q.side })).concat(S.hist.slice(0, 20).filter(x => x.et).map(x => ({ t: x.et, price: x.entry, side: x.side })));
      items.forEach(it => { const i = idxOf(it.t); if (i < 0 || it.price > hi || it.price < lo) return; const x = i * cw + cw / 2, yy = y(it.price), buy = it.side === 'buy';
        g.fillStyle = buy ? up : dn; g.strokeStyle = css.getPropertyValue('--ink'); g.lineWidth = 1.2; g.beginPath();
        if (buy) { g.moveTo(x, yy - 2); g.lineTo(x - 6, yy + 9); g.lineTo(x + 6, yy + 9); } else { g.moveTo(x, yy + 2); g.lineTo(x - 6, yy - 9); g.lineTo(x + 6, yy - 9); }
        g.closePath(); g.fill(); g.stroke(); });
      // 建値ライン
      g.setLineDash([3, 3]); g.strokeStyle = sb; g.lineWidth = 1;
      S.pos.forEach(q => { if (q.entry > lo && q.entry < hi) { g.beginPath(); g.moveTo(0, y(q.entry)); g.lineTo(w - pw, y(q.entry)); g.stroke(); } });
    }
    // ロスカットライン
    if (lc && lc > lo && lc < hi) { g.setLineDash([6, 4]); g.strokeStyle = dn; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, y(lc)); g.lineTo(w - pw, y(lc)); g.stroke(); g.setLineDash([]); g.fillStyle = dn; g.fillText('ロスカット ' + lc.toFixed(3), 4, y(lc) - 4); }
    g.setLineDash([]);
  }, [candles, tf, tab, S]);

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
        <div className="card"><h2>ショップ</h2><div className="sm" style={{ marginBottom: 8 }}>称号・アイコン・ロスカット回避券（所持 {S.items.guard}枚）</div><button className="btn" onClick={() => setTab('shop')}>ショップを見る</button></div>
        <div className="card"><h2>遊び方</h2><button className="btn g" onClick={() => setTut(0)}>チュートリアルを見る</button></div>
      </>}
      {tab === 'market' && <>
        <div className="card"><div className="sm">USD/JPY　米ドル／日本円</div>
          <div className="big num">{mid ? mid.toFixed(3) : '—'}</div>
          <div className="sm num">Bid {bid.toFixed(3)} / Ask {ask.toFixed(3)}　スプレッド{SP.toFixed(2)}円</div>
          <div className="seg">{[1, 5, 15].map(k => <button key={k} className={tf === k ? 'on' : ''} onClick={() => setTf(k)}>{k}分</button>)}</div>
          <canvas ref={cv} />
          <div className="sm">▲買い ▼売り（取引した位置）　赤い点線＝強制ロスカット価格の目安</div>
          {S.pos.length > 0 && lcPx(S) && <div className="sm warn num">強制ロスカット目安 {lcPx(S).toFixed(3)}（現在値との差 {Math.abs(mid - lcPx(S)).toFixed(2)}円）</div>}</div>
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
          <div className="row"><span>証拠金維持率</span><b className={'num ' + (C.lvl !== null && C.lvl < 100 ? 'warn' : '')}>{C.lvl === null ? '―' : C.lvl.toFixed(0) + '%'}</b></div>
          <div className="row"><span>ロスカット価格（目安）</span><b className="num warn">{lcPx(S) ? lcPx(S).toFixed(3) : '―'}</b></div></div>
        <h2>保有ポジション</h2>
        {S.pos.length ? S.pos.map(p => { const pl = p.side === 'buy' ? (bid - p.entry) * p.units : (p.entry - ask) * p.units;
          return <div className="card" key={p.id}><div className="row"><b>{p.side === 'buy' ? '買い' : '売り'} {p.units.toLocaleString()}通貨</b><b className={'num ' + cl(pl)}>{sgn(pl)}</b></div><div className="sm num">建値 {p.entry.toFixed(3)}</div>
            <button className="btn g" style={{ marginTop: 8 }} onClick={() => { const n = structuredClone(S); const b0 = n.bal; close(n, p.id); commit(n); post('決済 ' + (p.side === 'buy' ? '買い ' : '売り ') + p.units.toLocaleString() + '通貨', n.bal - b0); }}>決済する</button></div>; }) : <div className="card sm">ポジションはありません</div>}
        <h2>注文一覧</h2>
        {S.ord.length ? S.ord.map(o => <div className="card" key={o.id}><div className="row"><span>{o.side === 'buy' ? '買い' : '売り'}指値 {o.units.toLocaleString()}通貨</span><b className="num">{o.price.toFixed(3)}</b></div>
          <button className="btn g" onClick={() => { const n = structuredClone(S); n.ord = n.ord.filter(x => x.id !== o.id); commit(n); }}>取消</button></div>) : <div className="card sm">待機中の注文はありません</div>}
        <h2>取引履歴</h2>
        <div className="card">{S.hist.length ? S.hist.slice(0, 30).map((x, i) => <div className="row" key={i}><span className="sm">{new Date(x.t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}<br />{x.side === 'buy' ? '買い' : '売り'} {x.units.toLocaleString()}{x.auto ? '（ロスカット）' : ''}<br />{x.entry.toFixed(3)} → {x.exit.toFixed(3)}</span><b className={'num ' + cl(x.pnl)}>{sgn(x.pnl)}</b></div>) : <span className="sm">まだありません</span>}</div>
      </>}
      {tab === 'rank' && <>
        <div className="seg">{[['rank', 'ランキング'], ['feed', 'フィード'], ['group', 'グループ'], ['friend', 'フレンド']].map(([k, l]) => <button key={k} className={rtab === k ? 'on' : ''} onClick={() => setRtab(k)}>{l}</button>)}</div>
        {rtab === 'rank' && <div className="card"><h2>フレンドランキング（総資産）</h2>
          {board.map((r, i) => <div key={r.id}><div className={'row' + (r.id === user.id ? ' me' : '')} style={{ cursor: 'pointer' }} onClick={() => r.id !== user.id && openPeer(r.id)}><span>{i + 1}位　{r.icon} {r.id === user.id ? 'あなた' : r.name} {r.title && <span className="sm">【{r.title}】</span>}</span><b className="num">{yen(r.id === user.id ? C.eq : r.equity)}</b></div>
            {peer[r.id] && <div className="sm" style={{ padding: '0 0 6px 10px' }}>{peer[r.id].length ? peer[r.id].map((q, j) => <div key={j} className="num">{q.side === 'buy' ? '買い' : '売り'} {q.units.toLocaleString()}通貨 @{q.entry.toFixed(3)}　<span className={cl(ppl(q))}>{sgn(ppl(q))}</span></div>) : '非公開、またはポジションなし'}</div>}</div>)}
          <div className="sm" style={{ marginTop: 6 }}>{board.length <= 1 ? 'フレンドを追加すると順位が表示されます。' : 'フレンドの名前をタップすると保有ポジションが見られます。'}</div></div>}
        {rtab === 'feed' && (feed.length ? feed.map(f => <div className="card" key={f.id}>
          <div className="row" style={{ border: 0 }}><span><b>{f.profiles?.icon} {f.user_id === user.id ? 'あなた' : (f.profiles?.name || '')}</b> {f.profiles?.title && <span className="sm">【{f.profiles.title}】</span>}</span><span className="sm">{new Date(f.created_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
          <div>{f.text}{f.pnl != null && <b className={'num ' + cl(f.pnl)}>　{sgn(f.pnl)}</b>}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>{['👍', '🔥', '😱', '😂'].map(e => { const n = f.reactions.filter(x => x.emoji === e).length, mine = f.reactions.some(x => x.emoji === e && x.user_id === user.id);
            return <button key={e} className="btn g" style={{ padding: '4px 10px', outline: mine ? '2px solid var(--acc)' : 'none' }} onClick={() => react(f, e)}>{e}{n > 0 ? ' ' + n : ''}</button>; })}</div></div>)
          : <div className="card sm">まだ投稿がありません。取引するとここに流れます。</div>)}
        {rtab === 'group' && <>
          {groups.length > 0 && <div className="card"><h2>グループランキング（総資産）</h2>
            <div className="seg" style={{ flexWrap: 'wrap' }}>{groups.map(x => <button key={x.id} className={gsel === x.id ? 'on' : ''} onClick={() => setGsel(x.id)}>{x.name}（{x.members}人）</button>)}</div>
            {(() => { const x = groups.find(y => y.id === gsel); return x && <div className="sm" style={{ marginBottom: 8 }}>グループコード：<b>{x.code}</b></div>; })()}
            {gboard.map((r, i) => <div className={'row' + (r.id === user.id ? ' me' : '')} key={r.id}><span>{i + 1}位　{r.icon} {r.id === user.id ? 'あなた' : r.name} {r.title && <span className="sm">【{r.title}】</span>}</span><b className="num">{yen(r.id === user.id ? C.eq : r.equity)}</b></div>)}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button className="btn g" onClick={async () => { const x = groups.find(y => y.id === gsel); if (!x) return; const l = location.origin + '/?g=' + x.code; try { await navigator.clipboard.writeText(l); toast('グループ招待リンクをコピーしました'); } catch { toast(l); } }}>招待リンクをコピー</button>
              <button className="btn g" onClick={() => leaveGroup(gsel)}>このグループを抜ける</button></div></div>}
          <div className="card"><h2>グループを作る</h2><div className="sm" style={{ marginBottom: 6 }}>参加した人は、メンバー全員とフレンドになります（ポジション公開などフレンドに見える情報が、全員に見えます）。</div>
            <input value={gn} onChange={e => setGn(e.target.value)} placeholder="グループ名" maxLength={20} /><button className="btn" style={{ marginTop: 8 }} onClick={createGroup}>作成する</button></div>
          <div className="card"><h2>コードで参加</h2><input value={gc} onChange={e => setGc(e.target.value)} placeholder="グループコード" /><button className="btn" style={{ marginTop: 8 }} onClick={() => joinGroup(gc)}>参加する</button></div>
        </>}
        {rtab === 'friend' && <div className="card"><h2>フレンドを追加</h2>
          <div className="sm" style={{ marginBottom: 6 }}>あなたのフレンドID：<b>{profile?.code}</b></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <button className="btn g" onClick={async () => { try { await navigator.clipboard.writeText(profile.code); toast('IDをコピーしました'); } catch { toast(profile.code); } }}>IDをコピー</button>
            <button className="btn g" onClick={copy}>招待リンクをコピー</button>
            <button className="btn g" onClick={async () => setQrUrl(qrUrl ? '' : await QRCode.toDataURL(invite, { width: 240, margin: 1 }))}>QRを表示</button>
            <button className="btn g" onClick={() => setScan(!scan)}>QRを読み取る</button></div>
          {qrUrl && <div style={{ textAlign: 'center', marginBottom: 10 }}><img src={qrUrl} width={240} height={240} alt="招待QRコード" /><div className="sm">相手のカメラで読み取ってもらうか、この画面を見せてください</div></div>}
          {scan && <div style={{ marginBottom: 10 }}><video ref={vid} playsInline muted style={{ width: '100%', borderRadius: 10 }} /><div className="sm">相手のQRコードを枠に映してください</div></div>}
          <div className="sm" style={{ marginBottom: 6 }}>リンクを送ると、相手は開くだけ（ゲストでOK）でフレンドになります。IDを直接入力して追加もできます。</div>
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="相手のフレンドID" /><button className="btn" style={{ marginTop: 8 }} onClick={addFriend}>追加する</button>
          <h2 style={{ marginTop: 18 }}>フレンド一覧</h2>
          {board.filter(r => r.id !== user.id).length ? board.filter(r => r.id !== user.id).map(r => <div key={r.id}><div className="row"><span>{r.icon} {r.name}</span><span style={{ display: 'flex', gap: 6 }}>
              <button className="btn g" style={{ padding: '4px 10px' }} onClick={() => setSendTo(sendTo?.id === r.id ? null : r)}>送金</button>
              <button className="btn g" style={{ padding: '4px 10px' }} onClick={() => removeFriend(r)}>削除</button></span></div>
              {sendTo?.id === r.id && <div style={{ padding: '4px 0 10px' }}>
                <div className="sm" style={{ marginBottom: 4 }}>{r.name} さんに送る金額（1,000円〜100万円・使用可能 {yen(C.free)}）</div>
                <input type="number" inputMode="numeric" value={amt} onChange={e => setAmt(e.target.value)} placeholder="金額（円）" />
                <input style={{ marginTop: 6 }} value={snote} onChange={e => setSnote(e.target.value)} placeholder="ひとこと（任意）" maxLength={30} />
                <button className="btn" style={{ marginTop: 8 }} onClick={sendMoney}>送金する</button></div>}</div>) : <div className="sm">まだフレンドがいません</div>}
          <h2 style={{ marginTop: 18 }}>送金履歴（直近10件）</h2>
          {tlist.length ? tlist.map(t => { const mine = t.from_user === user.id; return <div className="row" key={t.id}><span className="sm">{new Date(t.created_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}　{mine ? '→ ' + (t.tp?.name || '（相手）') : '← ' + (t.fp?.name || '（相手）')}{t.note ? '「' + t.note + '」' : ''}</span><b className={'num ' + (mine ? 'dn' : 'up')}>{mine ? '-' : '+'}{yen(t.amount)}</b></div>; }) : <div className="sm">まだ送金はありません</div>}</div>}
      </>}
      {tab === 'shop' && <>
        <button className="btn g" style={{ marginBottom: 12 }} onClick={() => setTab('home')}>← ホームに戻る</button>
        <div className="card"><div className="sm">使えるお金（使用可能資金）</div><div className="big num">{yen(C.free)}</div><div className="sm">買い物をすると総資産が減り、ランキングの順位も下がります。</div></div>
        <div className="card"><h2>🛡 ロスカット回避券　{yen(GUARD_PRICE)}</h2>
          <div className="sm" style={{ marginBottom: 8 }}>強制ロスカットになりそうなとき、自動で1枚使われます。維持率が20%を下回るまで猶予が生まれ、50%まで回復すれば通常に戻ります。持てるのは最大{GUARD_MAX}枚。</div>
          <div className="row" style={{ border: 0 }}><span>所持：<b>{S.items.guard}枚</b>{S.guardOn && '（発動中）'}</span><button className="btn" onClick={() => buy('guard', GUARD_PRICE)}>購入</button></div></div>
        <div className="card"><h2>称号</h2>{TITLES.map(([t, pr]) => { const key = 't:' + t, own = S.items.own.includes(key);
          return <div className="row" key={t}><span>【{t}】</span>{own ? <button className="btn g" onClick={() => equip('title', profile?.title === t ? null : t)}>{profile?.title === t ? '外す' : '装備'}</button> : <button className="btn" onClick={() => buy(key, pr)}>{yen(pr)}</button>}</div>; })}</div>
        <div className="card"><h2>アイコン</h2>{ICONS.map(([ic, pr]) => { const key = 'i:' + ic, own = S.items.own.includes(key);
          return <div className="row" key={ic}><span style={{ fontSize: 22 }}>{ic}</span>{own ? <button className="btn g" onClick={() => equip('icon', profile?.icon === ic ? null : ic)}>{profile?.icon === ic ? '外す' : '装備'}</button> : <button className="btn" onClick={() => buy(key, pr)}>{yen(pr)}</button>}</div>; })}</div>
      </>}
      {tab === 'set' && <>
        <div className="card"><h2>プロフィール</h2><input value={nm} onChange={e => setNm(e.target.value)} maxLength={12} /><button className="btn g" style={{ marginTop: 8 }} onClick={saveName}>名前を変更</button></div>
        <div className="card"><h2>アカウント</h2>
          {user.is_anonymous ? <><p className="sm warn">ゲストでプレイ中です。ブラウザのデータを消したり端末を変えるとデータを失います。</p><button className="btn" onClick={link}>Googleと連携する</button><p className="sm">連携すると、PCなど他の端末からもGoogleログインで続きから遊べます。</p></>
            : <><div className="sm" style={{ marginBottom: 8 }}>{user.email}（Google連携済み）</div><button className="btn g" onClick={() => supabase.auth.signOut()}>ログアウト</button></>}
          {user.is_anonymous && <button className="btn g" style={{ marginTop: 8 }} onClick={() => { if (confirm('ゲストのままログアウトするとこのデータには戻れません。よろしいですか？')) supabase.auth.signOut(); }}>ログアウト</button>}</div>
        <div className="card"><h2>プライバシー</h2><div className="sm" style={{ marginBottom: 8 }}>フレンドに保有ポジションを見せる：<b>{profile?.share_pos === false ? 'オフ' : 'オン'}</b></div>
          <button className="btn g" onClick={async () => { const v = profile?.share_pos === false; await supabase.from('profiles').update({ share_pos: v }).eq('id', user.id); const np = { ...profile, share_pos: v }; setProfile(np); profRef.current = np; commit(S); toast(v ? 'ポジションを公開します' : 'ポジションを非公開にしました'); }}>切り替える</button></div>
        <div className="card"><button className="btn g" onClick={() => setTut(0)}>遊び方（チュートリアル）</button></div>
        <div className="card"><button className="btn g" onClick={() => { if (confirm('最初からやり直しますか？')) commit(fresh()); }}>データをリセット</button></div>
      </>}
    </main>
    {tut >= 0 && (() => {
      const T = [
        ['FXってなに？', 'USD/JPYは「1ドルが何円か」の価格です。ドルが値上がり（円安）しそうなら「買い」、値下がり（円高）しそうなら「売り」で利益を狙います。ここでは仮想のお金（初期100万円）で、本物のドル円の価格を使って練習できます。'],
        ['買い（ロング）', '今のAsk（買値）でドルを買います。価格が上がると利益、下がると損失になります。'],
        ['売り（ショート）', '今のBid（売値）でドルを先に売ります。価格が下がると利益、上がると損失になります。FXでは持っていないドルでも売れるのが特徴です。'],
        ['数量と決済', '数量は通貨単位です。10,000通貨は1万ドル分で、約155万円分の取引になります。レバレッジ25倍なので、必要な証拠金は約6.2万円です。「保有資産」の決済ボタンを押すと、利益や損失が確定します。'],
        ['成行と指値', '成行は「今の価格ですぐ」。指値は「この価格になったら」と予約する注文で、買いはAskより下、売りはBidより上に置きます。'],
        ['ロスカット', '含み損が増えて証拠金維持率が50%を下回ると、強制的に決済されます。市場画面のチャートの赤い点線が、その目安の価格です。近づいたら決済や数量の見直しを。'],
        ['用語', 'Bid：売る価格／Ask：買う価格／スプレッド：その差（実質コスト）／含み損益：決済前の損益／確定損益：決済後の損益／証拠金：取引に預けるお金。']
      ];
      const [t, d] = T[tut], last = tut === T.length - 1;
      const done = () => { try { localStorage.setItem('vm_tut', '1'); } catch {} setTut(-1); };
      return <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 20 }}>
        <div className="card" style={{ maxWidth: 420, width: '100%', marginBottom: 0 }}>
          <div className="sm">{tut + 1} / {T.length}</div><h2 style={{ fontSize: 18 }}>{t}</h2><p>{d}</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
            <button className="btn g" onClick={done}>閉じる</button>
            <span style={{ display: 'flex', gap: 8 }}>{tut > 0 && <button className="btn g" onClick={() => setTut(tut - 1)}>戻る</button>}
              <button className="btn" onClick={() => last ? done() : setTut(tut + 1)}>{last ? 'はじめる' : '次へ'}</button></span></div></div></div>;
    })()}
    {msg && <div className="toast" role="status">{msg}</div>}
    <nav>{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
  </>);
}
