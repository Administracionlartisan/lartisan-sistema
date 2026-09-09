import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: "L'Artisan | Sistema interno",
  description: "Ventas, caja, stock y administración de L'ARTISAN.",
  icons: {
    icon: [
      { url: "/icon.svg?brand=20260909", type: "image/svg+xml" },
      { url: "/icons/lartisan-32.png", type: "image/png", sizes: "32x32" },
      { url: "/icons/lartisan-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/lartisan-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-touch-icon.png?brand=20260909", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, statusBarStyle: "default" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
