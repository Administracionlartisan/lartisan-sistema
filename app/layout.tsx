import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: "L'Artisan | Sistema interno", description: 'Prototipo de ventas, caja y stock.' };

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
