import { Playfair_Display, Manrope, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const display = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['500', '700', '800'],
});

const body = Manrope({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '600', '700'],
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500'],
});

export const metadata = {
  title: 'Issue Analysis Agent',
  description: 'Analyze GitHub issues and generate implementation-ready reports',
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body className={`${display.variable} ${body.variable} ${mono.variable}`}>
        {children}
      </body>
    </html>
  );
}
