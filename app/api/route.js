// 公開中のバージョン（デプロイ）を返す。端末側が「新しいバージョンがあります」と知らせるために使う
export const dynamic = 'force-dynamic';
export function GET() {
  const v = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || 'dev';
  return Response.json({ v }, { headers: { 'Cache-Control': 'no-store' } });
}
