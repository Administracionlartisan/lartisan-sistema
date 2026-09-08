import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: "L'Artisan | Sistema interno",
  description: "Ventas, caja, stock y administración de L'ARTISAN.",
  icons: { icon: "/icon.svg" },
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
