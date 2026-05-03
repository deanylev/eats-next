import type { Metadata } from 'next';
import { resolveRequestTenant } from '@/lib/request-context';
import { DEFAULT_PRIMARY_COLOR } from '@/lib/theme';
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

const resolveThemeColor = async (): Promise<string> => {
  try {
    const tenant = await resolveRequestTenant();
    return tenant.primaryColor;
  } catch {
    return DEFAULT_PRIMARY_COLOR;
  }
};

type RootLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

export default async function RootLayout({ children }: RootLayoutProps) {
  const themeColor = await resolveThemeColor();

  return (
    <html lang="en" style={{ backgroundColor: themeColor }}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content={themeColor} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;700&display=swap" rel="stylesheet" />
      </head>
      <body style={{ backgroundColor: themeColor }}>{children}</body>
    </html>
  );
}
