'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { isMarketOpen } from '../lib/market';

const LEV = 25, SP = 0.01;
const fresh = () => ({ bal: 1e6, pos: [], ord: [], hist: [], bonusDay: '', bonusTotal: 0, bonusCount: 0, start: Date.now(), id: 1, items: { own: [], guard: 0, ins: 0 }, guardOn: false, loan: null, insDay: '', vip: null, vipDay: '' });
const yen = n => (n < 0 ? '-' : '') + '¥' + Math.round(Math.abs(n)).toLocaleString('ja-JP');
const sgn = n => (n > 0 ? '+' : n < 0 ? '-' : '') + '¥' + Math.round(Math.abs(n)).toLocaleString('ja-JP');
const cl = n => (n > 0 ? 'up' : n < 0 ? 'dn' : '');
const today = () => new Date().toLocaleDateString('sv-SE');
const copyText = async t => {
  try { await navigator.clipboard.writeText(t); return true; } catch {}
  try { const a = document.createElement('textarea'); a.value = t; a.style.position = 'fixed'; a.style.opacity = '0'; document.body.appendChild(a); a.focus(); a.select(); const ok = document.execCommand('copy'); a.remove(); return ok; } catch { return false; }
};
// 借金：10日以内は元本の100%、以後10日ごとに元本の50%ずつ上乗せ（単利）
const debtDue = (s, now = Date.now()) => { if (!s.loan) return 0; const d = (now - s.loan.at) / 864e5; const k = d <= 10 ? 0 : Math.ceil((d - 10) / 10); return s.loan.principal * (1 + 0.5 * k); };
const loanNext = (s, now = Date.now()) => { const d = (now - s.loan.at) / 864e5; const k = d <= 10 ? 0 : Math.ceil((d - 10) / 10); return { days: 10 + 10 * k - d, next: s.loan.principal * (1 + 0.5 * (k + 1)) }; };
const TITLES = [['見習いトレーダー', 30000], ['相場の旅人', 100000], ['ドル円職人', 300000], ['円安の覇者', 1000000]];
const ICONS = [['🐣', 10000], ['🦊', 50000], ['🐺', 150000], ['🦁', 400000], ['🐉', 1000000]];
const GUARD_PRICE = 60000, GUARD_MAX = 3;
const STAMPS = [['smug', '😏', '煽り'], ['despair', '😱', '絶望'], ['happy', '😄', 'ご機嫌'], ['lol', '🤣', '爆笑'], ['fire', '🔥', '燃えてる'], ['cry', '😭', '号泣'], ['clap', '👏', '拍手'], ['gg', '🫡', 'お疲れ']];
const STAMP_EM = Object.fromEntries(STAMPS.map(x => [x[0], x[1]])), STAMP_LB = Object.fromEntries(STAMPS.map(x => [x[0], x[2]]));
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
  const [nextAt, setNextAt] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [lid, setLid] = useState('');
  const [lpw, setLpw] = useState('');
  const [rid, setRid] = useState('');
  const [rpw, setRpw] = useState('');
  const [npw, setNpw] = useState('');
  const [loanAmt, setLoanAmt] = useState('');
  const [repayAmt, setRepayAmt] = useState('');
  const [gtop, setGtop] = useState([]);
  const [gme, setGme] = useState(null);
  const [gev, setGev] = useState([]);
  const [gmode, setGmode] = useState('total');
  const [ann, setAnn] = useState(null);
  const [newVer, setNewVer] = useState(false);
  const [gview, setGview] = useState('rank');
  const [gfeed, setGfeed] = useState([]);
  const [gmsg, setGmsg] = useState('');
  const [meta, setMeta] = useState({ interval: 120, mode: 'normal', left: null, lastOk: 0, fails: 0, lastErr: '' });
  const Sref = useRef(null), midRef = useRef(0), timer = useRef(null), cv = useRef(null), profRef = useRef(null), vid = useRef(null), loaded = useRef(false), goRef = useRef(null), nextRef = useRef(null), offRef = useRef(0), annQ = useRef([]), annBusy = useRef(false);

  const mid = candles.length ? candles[candles.length - 1].c : 0;
  const bid = mid - SP / 2, ask = mid + SP / 2;
  midRef.current = mid;
  nextRef.current = nextAt;
  // 端末の時計がずれていても動くよう、サーバー時刻との差(offRef)を使う
  const sNow = () => Date.now() + offRef.current;
  const mOpen = () => isMarketOpen(new Date(sNow()));
  const jstDay = () => new Date(sNow() + 9 * 36e5).toISOString().slice(0, 10);
  const mktOpen = mOpen();
  // 価格が取得できない／15分以上更新されない場合は「取引を一時停止」
  const feedDown = mktOpen && (!!err || (candles.length > 0 && sNow() - candles[candles.length - 1].t > 15 * 60000));
  const blocked = !mktOpen || feedDown;
  const toast = m => { setMsg(m); setTimeout(() => setMsg(''), 2600); };
  const post = (text, pnl) => { if (user) supabase.from('feed').insert({ user_id: user.id, text, pnl: pnl ?? null }).then(() => {}); };
  // 画面上部の「お知らせ」バナー（短時間表示・順番に表示）
  const showNextAnn = () => { const t = annQ.current.shift(); if (!t) { annBusy.current = false; setAnn(null); return; } annBusy.current = true; setAnn(t); setTimeout(showNextAnn, 4000); };
  const pushAnn = t => { if (annQ.current.length < 5) annQ.current.push(String(t).slice(0, 70)); if (!annBusy.current) showNextAnn(); };
  // 価格データがない・古い・市場休止のときは、新規注文も決済もできない
  const guardTrade = () => {
    if (!mid) { toast('価格データがありません。取得できるまでお待ちください'); return true; }
    if (!mOpen()) { toast('市場が閉まっています（週末は取引できません）'); return true; }
    if (feedDown) { toast('価格データを取得できないため、取引を一時停止しています'); return true; }
    return false;
  };

  const calcOf = (s, m) => {
    let u = 0, mg = 0;
    s.pos.forEach(p => { u += p.side === 'buy' ? (m - SP / 2 - p.entry) * p.units : (p.entry - (m + SP / 2)) * p.units; mg += p.units * p.entry / LEV; });
    const eq = s.bal + u;
    const due = debtDue(s);
    return { u, mg, eq, due, nw: eq - due, free: eq - mg, lvl: mg > 0 ? eq / mg * 100 : null };
  };
  const C = S && mid ? calcOf(S, mid) : { u: 0, mg: 0, eq: S ? S.bal : 0, due: 0, nw: S ? S.bal : 0, free: S ? S.bal : 0, lvl: null };

  const commit = n => {
    Sref.current = n; setS({ ...n });
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const n = Sref.current;
      const eq = calcOf(n, midRef.current || 155).nw;
      await supabase.from('game_state').upsert({ user_id: user.id, data: n, updated_at: new Date().toISOString() });
      await supabase.from('profiles').update({ equity: eq, updated_at: new Date().toISOString() }).eq('id', user.id);
      await supabase.from('public_positions').upsert({ user_id: user.id, pos: profRef.current?.share_pos === false ? [] : n.pos.map(q => ({ side: q.side, units: q.units, entry: q.entry })), updated_at: new Date().toISOString() });
      await supabase.rpc('check_top3');
      const { data: gl } = await supabase.rpc('my_groups'); (gl || []).forEach(x => supabase.rpc('check_group_rank', { gid: x.id }).then(() => {}));
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
      const s = Object.assign(fresh(), g?.data || {}); s.items = { own: [], guard: 0, ins: 0, ...(s.items || {}) }; Sref.current = s; setS(s);
    })();
  }, [user]);
  // カウントダウン用の時計（1秒ごと）
  useEffect(() => { const i = setInterval(() => setNowMs(sNow()), 1000); return () => clearInterval(i); }, []);
  // 価格取得：サーバーの「更新の区切り」に合わせて全端末がほぼ同時に取りに行く。
  // 時刻はサーバー基準（端末の時計ずれに影響されない）。見張り番つきで止まりにくくしている
  useEffect(() => {
    let timer, dead = false, busy = false;
    const schedule = ms => { if (dead) return; clearTimeout(timer); timer = setTimeout(go, ms); };
    const go = async () => {
      if (busy) return; busy = true;
      try {
        if (loaded.current && !isMarketOpen(new Date(Date.now() + offRef.current))) { schedule(60000); return; }
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 15000);
        const t0 = Date.now();
        const [r, tr] = await Promise.all([fetch('/api/candles', { signal: ctl.signal }), fetch('/api/time', { cache: 'no-store', signal: ctl.signal }).catch(() => null)]);
        const t1 = Date.now(); clearTimeout(to);
        try { if (tr && tr.ok) { const tj = await tr.json(); if (tj.t) offRef.current = tj.t - (t0 + t1) / 2; } } catch {}
        const j = await r.json();
        if (j.candles) {
          setCandles(j.candles); setNextAt(j.nextAt || null); setErr(''); loaded.current = true;
          setMeta(m => ({ interval: j.intervalSec || m.interval, mode: j.mode || 'normal', left: j.left ?? null, lastOk: Date.now(), fails: 0, lastErr: '' }));
          schedule(j.nextAt ? Math.min(Math.max(3000, j.nextAt - (Date.now() + offRef.current) + 2000 + Math.random() * 3000), 6 * 60000) : (isMarketOpen(new Date(Date.now() + offRef.current)) ? 30000 : 600000));
        } else { const e = j.error || '価格取得エラー'; setErr(e); setMeta(m => ({ ...m, fails: m.fails + 1, lastErr: e })); schedule(15000); }
      } catch (e) { setErr('通信できません'); setMeta(m => ({ ...m, fails: m.fails + 1, lastErr: '通信できません' })); schedule(15000); }
      finally { busy = false; }
    };
    goRef.current = () => { busy = false; go(); };
    go();
    const wake = () => { if (!document.hidden) go(); };
    document.addEventListener('visibilitychange', wake); window.addEventListener('online', wake); window.addEventListener('focus', wake); window.addEventListener('pageshow', wake);
    // 見張り番：予定時刻を過ぎても更新されていなければ取り直す
    const dog = setInterval(() => { if (!busy && loaded.current && isMarketOpen(new Date(Date.now() + offRef.current)) && nextRef.current && Date.now() + offRef.current > nextRef.current + 20000) go(); }, 10000);
    return () => { dead = true; clearTimeout(timer); clearInterval(dog); document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', wake); window.removeEventListener('focus', wake); window.removeEventListener('pageshow', wake); };
  }, []);
  // 指値約定・ロスカット判定（価格更新ごと）
  useEffect(() => {
    const s = Sref.current; if (!s || !candles.length || feedDown) return;
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
    let pl = p.side === 'buy' ? (ex - p.entry) * p.units : (p.entry - ex) * p.units;
    // 高級保険：契約中は、1日1回だけ、損失が3万円を超える決済を1万円に軽減する
    let vipSaved = 0;
    if (n.vip && n.vip.paidUntil > sNow() && n.vipDay !== jstDay() && pl < -30000) {
      vipSaved = -pl - 10000; pl = -10000; n.vipDay = jstDay();
      post('🛡 高級保険が発動！ 損失 ' + yen(10000 + vipSaved) + ' → ' + yen(10000) + ' に軽減');
    }
    n.bal += pl; n.hist.unshift({ et: p.t, t: Date.now(), side: p.side, units: p.units, entry: p.entry, exit: ex, pnl: pl, auto: !!auto, vip: vipSaved });
    n.hist = n.hist.slice(0, 200); n.pos.splice(i, 1);
  }
  function place(side) {
    if (guardTrade()) return;
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
  const loadGBoard = async () => { if (!gsel) { setGboard([]); return; } const { data } = await supabase.rpc('group_board', { gid: gsel }); setGboard(data || []); supabase.rpc('check_group_rank', { gid: gsel }).then(() => {}); };
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
  const claimLevies = async () => {
    if (!Sref.current) return;
    const { data } = await supabase.rpc('claim_levies');
    if (!data || !data.length) return;
    const n = structuredClone(Sref.current); let paid = 0;
    data.forEach(x => { const a = Math.min(Number(x.amount), Math.max(0, n.bal)); n.bal -= a; paid += a; });
    Sref.current = n; setS(n);
    await supabase.from('game_state').upsert({ user_id: user.id, data: n, updated_at: new Date().toISOString() });
    toast('復興補助募金に ' + yen(paid) + ' を拠出しました');
    post('🤝 復興補助募金に ' + yen(paid) + ' を拠出（' + data.map(x => x.to).join('・') + ' さん）');
  };
  const claimAll = async () => { await claimTransfers(); await claimLevies(); };
  useEffect(() => { if (!user || !S) return; claimAll(); const i = setInterval(claimAll, 20000); return () => clearInterval(i); }, [user, !!S]);
  const borrow = () => {
    const a = Math.floor(Number(loanAmt));
    if (S.loan) return toast('すでに借金があります。先に返済してください');
    if (!(a >= 10000)) return toast('10,000円以上で入力してください');
    if (a > 1000000) return toast('借りられるのは100万円までです');
    const n = structuredClone(S); n.bal += a; n.loan = { principal: a, at: Date.now() }; commit(n);
    post('🏦 銀行から ' + yen(a) + ' を借りた'); toast(yen(a) + ' を借りました'); setLoanAmt('');
  };
  const repay = all => {
    if (!S.loan) return;
    const due = debtDue(S);
    const p = all ? due : Math.min(due, Math.floor(Number(repayAmt)));
    if (!(p >= 1)) return toast('返済額を入力してください');
    if (C.free < p) return toast('使用可能資金が足りません');
    const n = structuredClone(S); n.bal -= p;
    const full = p >= due - 0.5;
    if (full) { n.loan = null; post('🏦 借金を完済した'); } else n.loan = { ...n.loan, principal: n.loan.principal * (1 - p / due) };
    commit(n); toast(full ? '完済しました' : yen(p) + ' を返済しました'); setRepayAmt('');
  };
  const buyIns = () => {
    if (S.insDay === today()) return toast('保険券は1日1回しか買えません');
    if (S.items.ins >= 3) return toast('持てるのは最大3枚です');
    if (C.free < 1300) return toast('使用可能資金が足りません');
    const n = structuredClone(S); n.bal -= 1300; n.items.ins++; n.insDay = today(); commit(n); toast('FX保険券を買いました');
  };
  const useIns = () => {
    const h = S.hist[0];
    if (!S.items.ins) return toast('保険券がありません');
    if (!h || h.void) return toast('取り消せる決済がありません');
    if (!(h.pnl < 0 && h.pnl >= -1500)) return toast('損失が1,500円以内の決済だけ取り消せます');
    const n = structuredClone(S); n.items.ins--; n.bal -= h.pnl; n.hist[0] = { ...h, was: h.pnl, pnl: 0, void: true }; commit(n);
    post('🧾 FX保険券を使い、損失 ' + yen(-h.pnl) + ' を取り消した'); toast('損失を取り消しました');
  };
  const buyRelief = async () => {
    if (C.free < 3000) return toast('使用可能資金が足りません');
    const { data, error } = await supabase.rpc('buy_relief');
    if (error || !data) return toast('失敗しました');
    if (data.status === 'rich') return toast('総資産が80万円を超えているため購入できません');
    if (data.status === 'already') return toast('復興補助募金は1日1回までです');
    if (data.status === 'nodonor') return toast('総資産80万円以上のフレンドがいないため購入できません');
    if (data.status !== 'ok') return toast('失敗しました');
    const n = structuredClone(Sref.current); n.bal -= 3000; commit(n);
    post('🤝 復興補助募金を使用！ ' + data.names.slice(0, 5).join('・') + (data.count > 5 ? ' ほか' : '') + ' から1,000円ずつ受け取り');
    toast('復興補助募金を使いました（' + data.count + '人から ' + yen(data.count * 1000) + '）');
    await claimTransfers();
  };
  useEffect(() => { if (tab === 'rank' && rtab === 'friend' && user) loadTransfers(); }, [tab, rtab, user]);
  const contractVip = () => {
    if (S.vip && S.vip.on) return;
    if (C.free < 2000) return toast('使用可能資金が足りません');
    const n = structuredClone(S); n.bal -= 2000;
    const base = n.vip && n.vip.paidUntil > sNow() ? n.vip.paidUntil : sNow();
    n.vip = { on: true, paidUntil: base + 3600000 }; commit(n);
    post('💎 高級保険に加入'); toast('高級保険に加入しました');
  };
  const cancelVip = () => { const n = structuredClone(S); n.vip = { ...n.vip, on: false }; commit(n); toast('解約しました（支払い済みの時間の終わりまで有効です）'); };
  const billVip = () => {
    const s0 = Sref.current; if (!s0 || !s0.vip || !s0.vip.on) return;
    if (sNow() < s0.vip.paidUntil) return;
    const n = structuredClone(s0);
    if ((midRef.current ? calcOf(n, midRef.current).free : n.bal) < 2000) { n.vip.on = false; commit(n); toast('高級保険：資金不足のため自動解約されました'); return; }
    n.bal -= 2000;
    const base = sNow() - n.vip.paidUntil > 120000 ? sNow() : n.vip.paidUntil;
    n.vip.paidUntil = base + 3600000; commit(n);
  };
  useEffect(() => { if (!user || !S) return; billVip(); const i = setInterval(billVip, 30000); return () => clearInterval(i); }, [user, !!S]);
  // フィードの動きを、どの画面にいても上のお知らせで知らせる（30秒ごとに確認）
  useEffect(() => {
    if (!user) return;
    let alive = true; const last = { f: -1, g: -1, gr: {} };
    const go = async () => {
      try {
        const out = [];
        const { data: f } = await supabase.from('feed').select('id,user_id,text,profiles(name,icon)').order('id', { ascending: false }).limit(10);
        const mf = (f || []).reduce((m, x) => Math.max(m, x.id), 0);
        if (last.f >= 0) (f || []).filter(x => x.id > last.f && x.user_id !== user.id).reverse().forEach(x => out.push((x.profiles?.icon || '') + ' ' + (x.profiles?.name || '') + '：' + x.text));
        last.f = Math.max(last.f, mf);
        const { data: g } = await supabase.from('global_events').select('id,text').order('id', { ascending: false }).limit(5);
        const mg = (g || []).reduce((m, x) => Math.max(m, x.id), 0);
        if (last.g >= 0) (g || []).filter(x => x.id > last.g).reverse().forEach(x => out.push(x.text));
        last.g = Math.max(last.g, mg);
        const { data: gl } = await supabase.rpc('my_groups');
        for (const x of (gl || []).slice(0, 3)) {
          const { data: rows } = await supabase.rpc('group_feed_list', { gid: x.id });
          const mx = (rows || []).reduce((m, r) => Math.max(m, r.id), 0);
          if (last.gr[x.id] !== undefined) (rows || []).filter(r => r.id > last.gr[x.id] && r.user_id !== user.id).reverse().forEach(r => out.push('【' + x.name + '】 ' + (r.kind === 'rank' ? r.text : (STAMP_EM[r.stamp] || '') + ' ' + (r.name || '') + ' が' + (STAMP_LB[r.stamp] || '') + 'スタンプ')));
          last.gr[x.id] = Math.max(last.gr[x.id] || 0, mx);
        }
        if (alive) out.slice(-3).forEach(pushAnn);
      } catch {}
    };
    go(); const i = setInterval(go, 30000);
    return () => { alive = false; clearInterval(i); };
  }, [user]);
  // 新しいバージョン（デプロイ）の検知
  useEffect(() => {
    let v0 = null, shown = false;
    const go = async () => { try { const r = await fetch('/api/version', { cache: 'no-store' }); const j = await r.json(); if (v0 === null) v0 = j.v; else if (j.v !== v0 && !shown) { shown = true; setNewVer(true); pushAnn('🆕 新しいバージョンが公開されました。再読み込みしてください'); } } catch {} };
    go(); const i = setInterval(go, 120000); return () => clearInterval(i);
  }, []);
  const buy = (key, price) => {
    if (C.free < price) return toast('使用可能資金が足りません');
    const n = structuredClone(S);
    if (key === 'guard') { if (n.items.guard >= GUARD_MAX) return toast('持てるのは最大' + GUARD_MAX + '枚です'); n.items.guard++; } else n.items.own.push(key);
    n.bal -= price; commit(n); toast('購入しました');
  };
  const equip = async (field, val) => { await supabase.from('profiles').update({ [field]: val }).eq('id', user.id); const np = { ...profile, [field]: val }; setProfile(np); profRef.current = np; };
  const ppl = q => (q.side === 'buy' ? (bid - q.entry) : (q.entry - ask)) * q.units;
  const loadGFeed = async () => { if (!gsel) return; const { data } = await supabase.rpc('group_feed_list', { gid: gsel }); setGfeed(data || []); };
  const sendStamp = async k => {
    const { data, error } = await supabase.rpc('group_post', { gid: gsel, st: k, msg: gmsg });
    if (error || data !== 'ok') return toast(data === 'slow' ? '連打しすぎです。少し待ってね' : '送れませんでした');
    setGmsg(''); loadGFeed();
  };
  useEffect(() => { if (tab !== 'rank' || rtab !== 'group' || !gsel || gview !== 'feed') return; loadGFeed(); const i = setInterval(loadGFeed, 10000); return () => clearInterval(i); }, [tab, rtab, gsel, gview]);
  const loadGlobal = async () => {
    const { data } = await supabase.rpc(gmode === 'daily' ? 'global_daily' : 'global_board', { lim: 200 }); setGtop(data || []);
    const { data: me } = await supabase.rpc('global_me'); setGme(me || null);
    supabase.rpc('check_top3').then(() => {});
  };
  useEffect(() => { if (tab !== 'rank' || rtab !== 'global' || !user) return; loadGlobal(); const i = setInterval(loadGlobal, 30000); return () => clearInterval(i); }, [tab, rtab, user, gmode]);
  const loadFeed = async () => { const { data } = await supabase.from('feed').select('id,user_id,text,pnl,created_at,profiles(name,title,icon),reactions(emoji,user_id)').order('created_at', { ascending: false }).limit(40); setFeed(data || []); const { data: ge } = await supabase.from('global_events').select('id,text,created_at').order('created_at', { ascending: false }).limit(15); setGev(ge || []); };
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
      const items = S.pos.map(q => ({ t: q.t, price: q.entry, side: q.side }));
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
  const guest = async () => {
    const nmv = gname.trim(); if (!nmv) return alert('ニックネームを入力してください');
    const { data: free } = await supabase.rpc('name_available', { n: nmv });
    if (free === false) return alert('この名前はすでに使われています。別の名前にしてください');
    const { error } = await supabase.auth.signInAnonymously({ options: { data: { name: nmv } } });
    if (error) alert('ゲストログインに失敗: ' + error.message);
  };
  const idMail = v => v.trim().toLowerCase() + '@vmarket.example.com';
  const validId = v => /^[a-z0-9_]{3,20}$/.test(v.trim().toLowerCase());
  const loginId = async () => {
    if (!validId(lid)) return alert('IDは半角英数字とアンダースコアの3〜20文字です');
    const { error } = await supabase.auth.signInWithPassword({ email: idMail(lid), password: lpw });
    if (error) alert('ログインに失敗しました。IDまたはパスワードを確認してください');
  };
  const register = async () => {
    if (!validId(rid)) return toast('IDは半角英数字とアンダースコアの3〜20文字です');
    if (rpw.length < 6) return toast('パスワードは6文字以上にしてください');
    const { error } = await supabase.auth.updateUser({ email: idMail(rid), password: rpw });
    if (error) return toast(/already|registered|exists/i.test(error.message) ? 'このIDはすでに使われています' : '登録に失敗: ' + error.message);
    await supabase.auth.refreshSession(); setRid(''); setRpw(''); toast('登録しました。IDとパスワードで、どの端末からでも入れます');
  };
  const changePw = async () => {
    if (npw.length < 6) return toast('パスワードは6文字以上にしてください');
    const { error } = await supabase.auth.updateUser({ password: npw }); setNpw(''); toast(error ? '変更に失敗しました' : 'パスワードを変更しました');
  };
  const saveName = async () => { const n = nm.trim(); if (!n) return; const { data, error } = await supabase.rpc('set_name', { n }); if (error || data !== 'ok') return toast(data === 'taken' ? 'この名前はすでに使われています' : '変更できませんでした'); setProfile({ ...profile, name: n.slice(0, 12) }); toast('名前を変更しました'); };
  const invite = profile ? location.origin + '/?f=' + profile.code : '';
  const copy = async () => { toast((await copyText(invite)) ? '招待リンクをコピーしました' : 'コピーできません。下のリンクを長押ししてコピーしてください'); };
  if (!user) return (<main style={{ paddingTop: 50, textAlign: 'center' }}><h1>VIRTUAL MARKET</h1><p className="sm">本物のドル円の価格で遊べる仮想トレード</p>
    <div className="card"><input value={gname} onChange={e => setGname(e.target.value)} placeholder="ニックネーム" maxLength={12} /><button className="btn" style={{ marginTop: 8, width: '100%' }} onClick={guest}>ゲストで始める</button>
      <p className="sm">登録不要ですぐ遊べます。あとから設定でIDとパスワードを登録すれば、他の端末でも続けられます。</p></div>
    <div className="card"><h2>IDでログイン</h2><input value={lid} onChange={e => setLid(e.target.value)} placeholder="ユーザーID（半角英数字）" autoCapitalize="none" autoCorrect="off" />
      <input style={{ marginTop: 8 }} type="password" value={lpw} onChange={e => setLpw(e.target.value)} placeholder="パスワード" />
      <button className="btn g" style={{ marginTop: 8, width: '100%' }} onClick={loginId}>ログイン</button><p className="sm">登録済みのIDで、別の端末から続けるときはこちら。</p></div></main>);
  if (!S) return <main><p className="sm">データを読み込み中…</p></main>;

  const feedAll = [...feed, ...gev.map(e => ({ ...e, _g: true }))].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 50);
  const peerBox = id => peer[id] && <div className="sm" style={{ padding: '0 0 6px 10px' }}>{peer[id].length ? peer[id].map((q, j) => <div key={j} className="num">{q.side === 'buy' ? '買い' : '売り'} {q.units.toLocaleString()}通貨 @{q.entry.toFixed(3)}　<span className={cl(ppl(q))}>{sgn(ppl(q))}</span></div>) : '非公開、またはポジションなし'}</div>;
  const real = S.hist.reduce((a, h) => a + h.pnl, 0);
  const left = (() => { const e = new Date(S.start); e.setMonth(e.getMonth() + 6); return Math.max(0, Math.ceil((e - Date.now()) / 864e5)); })();
  const canBonus = S.bonusDay !== today();
  const at = candles.length ? new Date(candles[candles.length - 1].t + 60000) : null;
  const rem = nextAt ? Math.max(0, Math.ceil((nextAt - nowMs) / 1000)) : null;
  const cd = rem === null ? '' : rem > 0 ? Math.floor(rem / 60) + ':' + String(rem % 60).padStart(2, '0') : '更新中…';
  const hhmm = at ? String(at.getHours()).padStart(2, '0') + ':' + String(at.getMinutes()).padStart(2, '0') : '--:--';

  return (<>
    <header><b>VIRTUAL MARKET</b><button className="btn g" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => goRef.current && goRef.current()}>↻ 再取得</button></header>
    <div className="status">
      {mid > 0 && <span className="pxbig num">{mid.toFixed(3)}</span>}
      {newVer && <button className="btn" style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => location.reload()}>🆕 新しいバージョン：再読み込み</button>}
      {!mktOpen ? <span>市場休止中（最終価格 {hhmm}）</span> : <>
        {(err || feedDown) && <span className="warn">⚠ {err ? '価格を取得できません：' + err + '（失敗' + meta.fails + '回）' : '価格が更新されていません'}・取引を一時停止中</span>}
        <span>価格 {hhmm}</span><span>次の更新まで <b className="num">{cd || '--'}</b></span><span>更新間隔 {meta.interval / 60}分{meta.mode === 'slow' ? '（節約中）' : '（通常）'}</span></>}
    </div>
    <main>
      {tab === 'home' && <>
        <div className="card"><div className="sm">総資産</div><div className="big num">{yen(C.nw)}</div><div className={'sm num ' + cl(C.nw - 1e6)}>スタート比 {sgn(C.nw - 1e6)}</div></div>
        <div className="card">
          <div className="row"><span>現金残高</span><b className="num">{yen(S.bal)}</b></div>
          <div className="row"><span>含み損益</span><b className={'num ' + cl(C.u)}>{sgn(C.u)}</b></div>
          <div className="row"><span>確定損益</span><b className={'num ' + cl(real)}>{sgn(real)}</b></div>
          {S.loan && <div className="row"><span>借金（現在の返済額）</span><b className="num dn">{yen(C.due)}</b></div>}
          <div className="row"><span>シーズン残り</span><b>{left}日</b></div></div>
        <div className="card"><h2>ログインボーナス</h2><div className="sm" style={{ marginBottom: 8 }}>1日1回 ¥20,000（受取{S.bonusCount}回・累計{yen(S.bonusTotal)}）</div>
          <button className="btn" disabled={!canBonus} onClick={claim}>{canBonus ? '¥20,000を受け取る' : '本日は受取済み'}</button></div>
        <div className="card"><h2>ショップ</h2><div className="sm" style={{ marginBottom: 8 }}>称号・アイコン・ロスカット回避券（所持 {S.items.guard}枚）</div><button className="btn" onClick={() => setTab('shop')}>ショップを見る</button></div>
        <div className="card"><h2>遊び方</h2><button className="btn g" onClick={() => setTut(0)}>チュートリアルを見る</button></div>
      </>}
      {tab === 'market' && <div className="mk">
        <div className="card"><div className="sm">USD/JPY　米ドル／日本円</div>
          <div className="big num">{mid ? mid.toFixed(3) : '—'}</div>
          <div className="sm num">Bid {bid.toFixed(3)} / Ask {ask.toFixed(3)}　スプレッド{SP.toFixed(2)}円</div>
          {mktOpen && cd && <div className="sm">次の更新まで {cd}（全端末が同時に更新されます）</div>}
          {!mktOpen && <div className="sm warn">市場休止中です（週末）。日本時間の月曜早朝に再開します。</div>}
          {feedDown && <div className="sm warn">価格を取得できないため、取引を一時停止しています。復旧すると自動で再開します。</div>}
          <div className="seg">{[1, 5, 15].map(k => <button key={k} className={tf === k ? 'on' : ''} onClick={() => setTf(k)}>{k}分</button>)}</div>
          <canvas ref={cv} />
          <div className="sm">▲買い ▼売り（保有中の建値。決済すると消えます）　赤い点線＝強制ロスカット価格の目安</div>
          {S.pos.length > 0 && lcPx(S) && <div className="sm warn num">強制ロスカット目安 {lcPx(S).toFixed(3)}（現在値との差 {Math.abs(mid - lcPx(S)).toFixed(2)}円）</div>}</div>
        <div className="card">
          <div className="seg">{[['market', '成行'], ['limit', '指値']].map(([k, l]) => <button key={k} className={otype === k ? 'on' : ''} onClick={() => setOtype(k)}>{l}</button>)}</div>
          <div className="sm">数量（通貨・1,000単位）</div><input type="number" inputMode="numeric" step="1000" value={qty} onChange={e => setQty(parseInt(e.target.value) || 0)} />
          {otype === 'limit' && <><div className="sm" style={{ marginTop: 8 }}>指値価格（円）</div><input type="number" inputMode="decimal" step="0.001" value={lp} onChange={e => setLp(e.target.value)} placeholder="例 155.000" /></>}
          <div className="sm num" style={{ marginTop: 8 }}>必要証拠金 {yen(qty * (otype === 'limit' && parseFloat(lp) ? parseFloat(lp) : mid) / LEV)}　使用可能 {yen(C.free)}　手数料 ¥0</div>
          <div className="trade"><button className="s" style={blocked ? { opacity: .45 } : undefined} onClick={() => place('sell')}><small>売り（Bid）</small><br />{bid.toFixed(3)}</button><button className="b" style={blocked ? { opacity: .45 } : undefined} onClick={() => place('buy')}><small>買い（Ask）</small><br />{ask.toFixed(3)}</button></div>
          <details className="sm" style={{ marginTop: 8 }}><summary>用語の説明</summary><p>Bid/Ask：売る価格/買う価格。差がスプレッド（実質コスト）。レバレッジ：証拠金の{LEV}倍まで取引可。維持率が50%未満で強制ロスカット。</p></details></div>
      </div>}
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
            <button className="btn g" style={{ marginTop: 8 }} onClick={() => { if (guardTrade()) return; const n = structuredClone(S); const b0 = n.bal; close(n, p.id); commit(n); post('決済 ' + (p.side === 'buy' ? '買い ' : '売り ') + p.units.toLocaleString() + '通貨', n.bal - b0); }}>決済する</button></div>; }) : <div className="card sm">ポジションはありません</div>}
        <h2>注文一覧</h2>
        {S.ord.length ? S.ord.map(o => <div className="card" key={o.id}><div className="row"><span>{o.side === 'buy' ? '買い' : '売り'}指値 {o.units.toLocaleString()}通貨</span><b className="num">{o.price.toFixed(3)}</b></div>
          <button className="btn g" onClick={() => { const n = structuredClone(S); n.ord = n.ord.filter(x => x.id !== o.id); commit(n); }}>取消</button></div>) : <div className="card sm">待機中の注文はありません</div>}
        <h2>取引履歴</h2>
        <div className="card">{S.items.ins > 0 && S.hist[0] && !S.hist[0].void && S.hist[0].pnl < 0 && S.hist[0].pnl >= -1500 && <button className="btn" style={{ marginBottom: 10 }} onClick={useIns}>🧾 保険券を使う（直近の損失 {yen(-S.hist[0].pnl)} を取消）</button>}{S.hist.length ? S.hist.slice(0, 30).map((x, i) => <div className="row" key={i}><span className="sm">{new Date(x.t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}<br />{x.side === 'buy' ? '買い' : '売り'} {x.units.toLocaleString()}{x.auto ? '（ロスカット）' : ''}{x.void ? '（保険で取消）' : ''}{x.vip ? '（高級保険で軽減）' : ''}<br />{x.entry.toFixed(3)} → {x.exit.toFixed(3)}</span><b className={'num ' + cl(x.pnl)}>{sgn(x.pnl)}</b></div>) : <span className="sm">まだありません</span>}</div>
      </>}
      {tab === 'rank' && <>
        <div className="seg">{[['rank', 'フレンド順位'], ['global', '全体順位'], ['feed', 'フィード'], ['group', 'グループ'], ['friend', 'フレンド']].map(([k, l]) => <button key={k} className={rtab === k ? 'on' : ''} onClick={() => setRtab(k)}>{l}</button>)}</div>
        {rtab === 'rank' && <div className="card"><h2>フレンドランキング（総資産）</h2>
          {board.map((r, i) => <div key={r.id}><div className={'row' + (r.id === user.id ? ' me' : '')} style={{ cursor: 'pointer' }} onClick={() => r.id !== user.id && openPeer(r.id)}><span>{i + 1}位　{r.icon} {r.id === user.id ? 'あなた' : r.name} {r.title && <span className="sm">【{r.title}】</span>}</span><b className="num">{yen(r.id === user.id ? C.nw : r.equity)}</b></div>
            {peer[r.id] && <div className="sm" style={{ padding: '0 0 6px 10px' }}>{peer[r.id].length ? peer[r.id].map((q, j) => <div key={j} className="num">{q.side === 'buy' ? '買い' : '売り'} {q.units.toLocaleString()}通貨 @{q.entry.toFixed(3)}　<span className={cl(ppl(q))}>{sgn(ppl(q))}</span></div>) : '非公開、またはポジションなし'}</div>}</div>)}
          <div className="sm" style={{ marginTop: 6 }}>{board.length <= 1 ? 'フレンドを追加すると順位が表示されます。' : 'フレンドの名前をタップすると保有ポジションが見られます。'}</div></div>}
        {rtab === 'global' && <div className="card"><h2>全体ランキング（全員参加）</h2>
          <div className="seg">{[['total', '総資産'], ['daily', '本日の利益']].map(([k, l]) => <button key={k} className={gmode === k ? 'on' : ''} onClick={() => { setGmode(k); setGtop([]); }}>{l}</button>)}</div>
          <div className="sm" style={{ marginBottom: 8 }}>{gmode === 'daily' ? '日本時間0時からの総資産の増減です。送金や借金なども含みます。' : '総資産は各端末からの自己申告です。お遊び用の参考順位としてお楽しみください。'}</div>
          {gmode === 'total' && gme && <div className="row me"><span>あなたの順位</span><b className="num">{gme.rank}位 / {gme.total}人</b></div>}
          {gtop.map((r, i) => <div className={'row' + (r.id === user.id ? ' me' : '')} key={r.id}><span>{['🥇', '🥈', '🥉'][i] || (i + 1) + '位'}　{r.icon} {r.id === user.id ? 'あなた' : r.name} {r.title && <span className="sm">【{r.title}】</span>}</span>{gmode === 'daily' ? <b className={'num ' + cl(r.gain)}>{sgn(r.gain)}</b> : <b className="num">{yen(r.id === user.id ? C.nw : r.equity)}</b>}</div>)}
          {!gtop.length && <div className="sm">読み込み中…</div>}
          <div className="sm" style={{ marginTop: 8 }}>登録している全員を表示します（最大200人）。TOP3が入れ替わると、フィードとお知らせに出ます。</div></div>}
        {rtab === 'feed' && (feedAll.length ? feedAll.map(f => f._g ? <div className="card" key={'g' + f.id}><div className="row" style={{ border: 0 }}><b>🏆 全体のできごと</b><span className="sm">{new Date(f.created_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div><div>{f.text}</div></div> : <div className="card" key={f.id}>
          <div className="row" style={{ border: 0 }}><span><b>{f.profiles?.icon} {f.user_id === user.id ? 'あなた' : (f.profiles?.name || '')}</b> {f.profiles?.title && <span className="sm">【{f.profiles.title}】</span>}</span><span className="sm">{new Date(f.created_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
          <div>{f.text}{f.pnl != null && <b className={'num ' + cl(f.pnl)}>　{sgn(f.pnl)}</b>}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>{['👍', '🔥', '😱', '😂'].map(e => { const n = f.reactions.filter(x => x.emoji === e).length, mine = f.reactions.some(x => x.emoji === e && x.user_id === user.id);
            return <button key={e} className="btn g" style={{ padding: '4px 10px', outline: mine ? '2px solid var(--acc)' : 'none' }} onClick={() => react(f, e)}>{e}{n > 0 ? ' ' + n : ''}</button>; })}</div></div>)
          : <div className="card sm">まだ投稿がありません。取引するとここに流れます。</div>)}
        {rtab === 'group' && <>
          {groups.length > 0 && <div className="card"><h2>グループランキング（総資産）</h2>
            <div className="seg" style={{ flexWrap: 'wrap' }}>{groups.map(x => <button key={x.id} className={gsel === x.id ? 'on' : ''} onClick={() => setGsel(x.id)}>{x.name}（{x.members}人）</button>)}</div>
            {(() => { const x = groups.find(y => y.id === gsel); return x && <div className="sm" style={{ marginBottom: 8 }}>グループコード：<b>{x.code}</b></div>; })()}
            <div className="seg">{[['rank', '順位'], ['feed', 'フィード']].map(([k, l]) => <button key={k} className={gview === k ? 'on' : ''} onClick={() => setGview(k)}>{l}</button>)}</div>
            {gview === 'rank' && gboard.map((r, i) => <div key={r.id}><div className={'row' + (r.id === user.id ? ' me' : '')} style={{ cursor: 'pointer' }} onClick={() => r.id !== user.id && openPeer(r.id)}><span>{i + 1}位　{r.icon} {r.id === user.id ? 'あなた' : r.name} {r.title && <span className="sm">【{r.title}】</span>}</span><b className="num">{yen(r.id === user.id ? C.nw : r.equity)}</b></div>{peerBox(r.id)}</div>)}
            {gview === 'feed' && <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>{STAMPS.map(([k, em, lb]) => <button key={k} className="btn g" style={{ padding: '6px 10px' }} onClick={() => sendStamp(k)}>{em} {lb}</button>)}</div>
              <input value={gmsg} onChange={e => setGmsg(e.target.value)} placeholder="ひとこと（任意・スタンプと一緒に送ります）" maxLength={40} />
              {gfeed.length ? gfeed.map(f => <div className="row" key={f.id} style={{ alignItems: 'flex-start' }}><span>{f.kind === 'rank' ? '📊 ' + f.text : <><span style={{ fontSize: 22 }}>{STAMP_EM[f.stamp] || '💬'}</span> <b>{f.icon} {f.user_id === user.id ? 'あなた' : f.name}</b> {STAMP_LB[f.stamp]}{f.text ? '「' + f.text + '」' : ''}</>}</span><span className="sm">{new Date(f.created_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>) : <div className="sm" style={{ marginTop: 8 }}>まだ投稿がありません。スタンプを送ってみよう！</div>}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button className="btn g" onClick={async () => { const x = groups.find(y => y.id === gsel); if (!x) return; const l = location.origin + '/?g=' + x.code; toast((await copyText(l)) ? 'グループ招待リンクをコピーしました' : 'コピーできません：' + l); }}>招待リンクをコピー</button>
              <button className="btn g" onClick={() => leaveGroup(gsel)}>このグループを抜ける</button></div></div>}
          <div className="card"><h2>グループを作る</h2><div className="sm" style={{ marginBottom: 6 }}>参加した人は、メンバー全員とフレンドになります（ポジション公開などフレンドに見える情報が、全員に見えます）。</div>
            <input value={gn} onChange={e => setGn(e.target.value)} placeholder="グループ名" maxLength={20} /><button className="btn" style={{ marginTop: 8 }} onClick={createGroup}>作成する</button></div>
          <div className="card"><h2>コードで参加</h2><input value={gc} onChange={e => setGc(e.target.value)} placeholder="グループコード" /><button className="btn" style={{ marginTop: 8 }} onClick={() => joinGroup(gc)}>参加する</button></div>
        </>}
        {rtab === 'friend' && <div className="card"><h2>フレンドを追加</h2>
          <div className="sm" style={{ marginBottom: 6 }}>あなたのフレンドID：<b>{profile?.code}</b></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <button className="btn g" onClick={async () => { toast((await copyText(profile.code)) ? 'IDをコピーしました' : 'コピーできません。IDを長押ししてコピーしてください'); }}>IDをコピー</button>
            <button className="btn g" onClick={copy}>招待リンクをコピー</button>
            <button className="btn g" onClick={async () => setQrUrl(qrUrl ? '' : await QRCode.toDataURL(invite, { width: 240, margin: 1 }))}>QRを表示</button>
            <button className="btn g" onClick={() => setScan(!scan)}>QRを読み取る</button></div>
          <input readOnly value={invite} onFocus={e => e.target.select()} style={{ marginBottom: 10 }} aria-label="招待リンク" />
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
        <div className="card"><h2>🏦 銀行（借金）</h2>
          <div className="sm" style={{ marginBottom: 8 }}>最大100万円まで・同時に1件。借りてから10日以内に返せば元本のまま。以後10日ごとに元本の50%が上乗せされます（11〜20日は150%、21〜30日は200%…）。借金は総資産から引かれます。</div>
          {S.loan ? <>
            <div className="row"><span>元本</span><b className="num">{yen(S.loan.principal)}</b></div>
            <div className="row"><span>現在の返済額</span><b className="num dn">{yen(C.due)}</b></div>
            <div className="row"><span>次の上乗せ</span><b className="num">{Math.max(1, Math.ceil(loanNext(S, nowMs).days))}日後に {yen(loanNext(S, nowMs).next)}</b></div>
            <input style={{ marginTop: 8 }} type="number" inputMode="numeric" value={repayAmt} onChange={e => setRepayAmt(e.target.value)} placeholder="返済する金額（円）" />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}><button className="btn" onClick={() => repay(false)}>一部返済</button><button className="btn g" onClick={() => repay(true)}>全額返済</button></div>
          </> : <>
            <input type="number" inputMode="numeric" value={loanAmt} onChange={e => setLoanAmt(e.target.value)} placeholder="借りる金額（1万円〜100万円）" />
            <button className="btn" style={{ marginTop: 8 }} onClick={borrow}>借りる</button></>}</div>
        <div className="card"><h2>🤝 復興補助募金　{yen(3000)}</h2>
          <div className="sm" style={{ marginBottom: 8 }}>総資産が80万円以下の人が、1日1回だけ買えます。総資産80万円以上のフレンド全員から、1,000円ずつ受け取ります（相手の残高は、相手が次にアプリを開いたとき引かれます）。使った人と払った人は、フィードに残ります。</div>
          <div className="row" style={{ border: 0 }}><span>あなたの総資産：<b>{yen(C.nw)}</b></span><button className="btn" onClick={buyRelief}>購入</button></div></div>
        <div className="card"><h2>🧾 FX保険券　{yen(1300)}</h2>
          <div className="sm" style={{ marginBottom: 8 }}>1日1回だけ買えます（3枚まで所持可）。直近の決済が損失1,500円以内なら、その損失を返金して取り消せます（ポジションは戻りません）。使うのは「保有資産」の取引履歴からです。</div>
          <div className="row" style={{ border: 0 }}><span>所持：<b>{S.items.ins}枚</b></span><button className="btn" onClick={buyIns}>購入（1日1回）</button></div></div>
        <div className="card"><h2>💎 高級保険　{yen(2000)}／時間</h2>
          <div className="sm" style={{ marginBottom: 8 }}>契約中は、1日1回（日本時間0時に復活）だけ、損失が3万円を超える決済の損失を1万円に軽減します。1時間ごとに2,000円がかかり、自動更新です。いつでも解約できます（支払い済みの時間の終わりまでは有効）。</div>
          {(() => { const v = S.vip, act = v && v.paidUntil > nowMs, used = S.vipDay === jstDay(); return <>
            <div className="row"><span>状態</span><b>{act ? (v.on ? '契約中（自動更新）' : '解約済み（支払い済み分は有効）') : '未契約'}</b></div>
            {act && <div className="row"><span>{v.on ? '次の更新まで' : '有効期限まで'}</span><b className="num">{Math.max(0, Math.ceil((v.paidUntil - nowMs) / 60000))}分</b></div>}
            <div className="row"><span>本日の発動</span><b>{used ? '使用済み' : '未使用'}</b></div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>{v && v.on ? <button className="btn g" onClick={cancelVip}>解約する</button> : <button className="btn" onClick={contractVip}>契約する（初回 {yen(2000)}）</button>}</div></>; })()}</div>
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
          {user.is_anonymous ? <>
            <p className="sm warn">ゲストでプレイ中です。IDとパスワードを登録すると、他の端末でも続きから遊べます。</p>
            <input value={rid} onChange={e => setRid(e.target.value)} placeholder="ユーザーID（半角英数字・3〜20文字）" autoCapitalize="none" autoCorrect="off" />
            <input style={{ marginTop: 8 }} type="password" value={rpw} onChange={e => setRpw(e.target.value)} placeholder="パスワード（6文字以上）" />
            <button className="btn" style={{ marginTop: 8 }} onClick={register}>登録する</button>
            <p className="sm">パスワードを忘れると復旧できません。メモしておいてください。</p>
            <button className="btn g" style={{ marginTop: 8 }} onClick={() => { if (confirm('ゲストのままログアウトするとこのデータには戻れません。よろしいですか？')) supabase.auth.signOut(); }}>ログアウト</button></>
          : <><div className="sm" style={{ marginBottom: 8 }}>ユーザーID：<b>{(user.email || '').split('@')[0]}</b></div>
            <input type="password" value={npw} onChange={e => setNpw(e.target.value)} placeholder="新しいパスワード（6文字以上）" />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}><button className="btn g" onClick={changePw}>パスワードを変更</button><button className="btn g" onClick={() => supabase.auth.signOut()}>ログアウト</button></div></>}</div>
        <div className="card"><h2>接続情報（価格の更新）</h2>
          <div className="row"><span>最終取得</span><b className="num">{meta.lastOk ? Math.round((Date.now() - meta.lastOk) / 1000) + '秒前' : '―'}</b></div>
          <div className="row"><span>次の更新まで</span><b className="num">{cd || '―'}</b></div>
          <div className="row"><span>更新間隔</span><b>{meta.interval / 60}分{meta.mode === 'slow' ? '（節約中）' : '（通常）'}</b></div>
          <div className="row"><span>APIの残り（推定）</span><b className="num">{meta.left ?? '―'}</b></div>
          <div className="row"><span>連続失敗</span><b className="num">{meta.fails}回</b></div>
          <div className="row"><span>直近のエラー</span><b className="sm">{err || meta.lastErr || 'なし'}</b></div>
          <div className="row"><span>端末の時計のずれ</span><b className="num">{(offRef.current / 1000).toFixed(1)}秒</b></div>
          <button className="btn g" style={{ marginTop: 8 }} onClick={() => goRef.current && goRef.current()}>↻ 今すぐ再取得</button></div>
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
    {ann && <div className="ann" role="status">{ann}</div>}
    {msg && <div className="toast" role="status">{msg}</div>}
    <nav>{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
  </>);
}
