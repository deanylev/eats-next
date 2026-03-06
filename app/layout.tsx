import type { Metadata } from 'next';
import { resolveRequestTenant } from '@/lib/request-context';
import './globals.css';

const defaultDescription = "Dean Levinson's favourite places to eat around the world.";
const fallbackTitle = "Dean's Favourite Eats";

export const generateMetadata = async (): Promise<Metadata> => {
  try {
    const tenant = await resolveRequestTenant();
    return {
      title: `${tenant.displayName}'s Favourite Eats`,
      description: defaultDescription
    };
  } catch {
    return {
      title: fallbackTitle,
      description: defaultDescription
    };
  }
};

type RootLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
