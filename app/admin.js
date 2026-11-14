'use client';
import { useEffect, useState } from 'react';

const fmt = t => (t ? new Date(t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '―');

// 管理者パネル（管理者アカウントにだけ表示される。実際の権限チェックはサーバー側で行う）
export default function AdminPanel({ supabase, toast, yen }) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [sel, setSel] = useState(null);
  const [view, setView] = useState(null);
  const [bks, setBks] = useState([]);
  const [text, setText] = useState('');

  const load = async () => {
    await supabase.rpc('admin_friend_all');
    const { data } = await supabase.rpc('admin_users');
    setUsers(data || []);
  };
  useEffect(() => { if (open) load(); }, [open]);

  const pick = async u => {
    setSel(u); setView(null); setBks([]);
    const { data: v } = await supabase.rpc('admin_view_user', { uid: u.id }); setView(v);
    const { data: b } = await supabase.rpc('admin_backups', { uid: u.id }); setBks(b || []);
  };
  const restore = async b => {
    if (!confirm((sel?.name || '') + ' さんのデータを ' + fmt(b.saved_at) + ' の状態に戻します。よろしいですか？')) return;
    const { data } = await supabase.rpc('admin_restore', { bid: b.id });
    toast(data === 'ok' ? '復元しました' : '失敗しました：' + data); pick(sel); load();
  };
  const wipe = async () => {
    if (!confirm((sel?.name || '') + ' さんのデータを初期化（資金100万円）します。よろしいですか？')) return;
    const { data } = await supabase.rpc('admin_wipe_data', { uid: sel.id });
    toast(data === 'ok' ? '初期化しました' : '失敗しました：' + data); pick(sel); load();
  };
  const del = async () => {
    if (!confirm((sel?.name || '') + ' さんのアカウントを完全に削除します。元に戻せません。よろしいですか？')) return;
    if (!confirm('本当に削除しますか？')) return;
    const { data } = await supabase.rpc('admin_delete_user', { uid: sel.id });
    toast(data === 'ok' ? '削除しました' : '失敗しました：' + data); setSel(null); setView(null); load();
  };
  const postUpdate = async () => {
    if (!text.trim()) return;
    const { data } = await supabase.rpc('admin_post_update', { msg: text.trim() });
    toast(data === 'ok' ? 'お知らせを投稿しました' : '失敗しました：' + data); if (data === 'ok') setText('');
  };
  const season = async full => {
    if (!confirm(full ? 'シーズンをリセットします（全員の資金を100万円に戻し、保存ログも全削除）。よろしいですか？' : '保存ログ（バックアップ・取引履歴・整合性ログ）を全削除します。よろしいですか？')) return;
    if (full && !confirm('本当に全員の資金を初期化しますか？')) return;
    const { data } = await supabase.rpc('season_reset', { reset_funds: full });
    toast(data === 'ok' ? '完了しました' : '失敗しました：' + data); load();
  };

  if (!open) return <div className="card"><h2>🛠 管理者パネル</h2><button className="btn" onClick={() => setOpen(true)}>開く</button></div>;
  const d = view && view.data;
  return (
    <div className="card">
      <div className="row" style={{ border: 0 }}><h2 style={{ margin: 0 }}>🛠 管理者パネル</h2><button className="btn g" style={{ padding: '4px 10px' }} onClick={() => setOpen(false)}>閉じる</button></div>

      <h2 style={{ marginTop: 12 }}>お知らせを書く（全員に表示）</h2>
      <input value={text} onChange={e => setText(e.target.value)} placeholder="アップデート内容など" maxLength={200} />
      <button className="btn" style={{ marginTop: 8 }} onClick={postUpdate}>投稿する</button>

      <h2 style={{ marginTop: 16 }}>ユーザー一覧（{users.length}人）</h2>
      {users.map(u => (
        <div className={'row' + (sel && sel.id === u.id ? ' me' : '')} key={u.id} style={{ cursor: 'pointer' }} onClick={() => pick(u)}>
          <span>{u.name} <span className="sm">#{u.code}{u.admin_flag ? '（管理者）' : ''}</span><br /><span className="sm">v{u.version ?? '―'}・{fmt(u.saved_at)}</span></span>
          <b className="num">{u.equity == null ? '―' : yen(u.equity)}</b>
        </div>
      ))}

      {sel && <div style={{ marginTop: 12 }}>
        <h2>{sel.name} さんのデータ</h2>
        {!view ? <div className="sm">読み込み中…</div> : <>
          <div className="row"><span>現金</span><b className="num">{d ? yen(d.bal) : '―'}</b></div>
          <div className="row"><span>バージョン・保存</span><b className="num">v{view.version ?? '―'}・{fmt(view.saved_at)}</b></div>
          <div className="sm" style={{ marginTop: 6 }}>保有ポジション</div>
          {d && d.pos && d.pos.length ? d.pos.map((q, i) => <div className="num sm" key={i}>{q.side === 'buy' ? '買い' : '売り'} {Number(q.units).toLocaleString()}通貨 @{Number(q.entry).toFixed(3)}</div>) : <div className="sm">なし</div>}
          <div className="sm" style={{ marginTop: 6 }}>借金：{d && d.loan ? yen(d.loan.principal) : 'なし'}　最近の決済</div>
          {d && d.hist && d.hist.slice(0, 5).map((h, i) => <div className="num sm" key={i}>{fmt(h.t)}　{h.side === 'buy' ? '買い' : '売り'} {Number(h.units).toLocaleString()}　{Math.round(h.pnl).toLocaleString()}円</div>)}
          {view.log && view.log.length > 0 && <>
            <div className="sm" style={{ marginTop: 6 }}>整合性ログ（古い端末の検知など）</div>
            {view.log.map((l, i) => <div className="num sm" key={i}>{fmt(l.at)}　{l.kind}</div>)}</>}
        </>}
        <h2 style={{ marginTop: 12 }}>バックアップ（直近24時間）</h2>
        {bks.length ? bks.map(b => (
          <div className="row" key={b.id}><span className="sm">{fmt(b.saved_at)}　v{b.version}　{b.event}<br />現金 {yen(b.cash)}・ポジション{b.pos_count}件</span><button className="btn g" style={{ padding: '4px 10px' }} onClick={() => restore(b)}>復元</button></div>
        )) : <div className="sm">バックアップはありません</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn g" onClick={wipe}>データを初期化</button>
          <button className="btn g" onClick={del} style={{ color: 'var(--dn)' }}>アカウントを削除</button>
        </div>
      </div>}

      <h2 style={{ marginTop: 16 }}>シーズン</h2>
      <div className="sm" style={{ marginBottom: 6 }}>操作はすべて、全体フィードに記録されます。</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn g" onClick={() => season(false)}>保存ログを全削除</button>
        <button className="btn g" onClick={() => season(true)}>シーズンリセット（資金も100万円に）</button>
      </div>
    </div>
  );
}
