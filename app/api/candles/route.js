// サーバーの現在時刻を返す（端末の時計がずれていても、更新タイミングを正しく合わせるため）
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json({ t: Date.now() }, { headers: { 'Cache-Control': 'no-store' } });
}
