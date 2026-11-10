import './globals.css';
export const metadata = { title: 'VIRTUAL MARKET', manifest: '/manifest.json', appleWebApp: { capable: true, title: 'VMarket' } };
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0F766E' };
export default function RootLayout({ children }) { return (<html lang="ja"><body>{children}</body></html>); }
