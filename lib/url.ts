export const googleMapsHostnames = ['google.com', 'www.google.com', 'maps.google.com', 'maps.app.goo.gl'];

export const isGoogleMapsUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const isGoogleHost = googleMapsHostnames.some(
      (candidate) => host === candidate || host.endsWith(`.${candidate}`)
    );
    if (!isGoogleHost) {
      return false;
    }

    return host === 'maps.app.goo.gl' || path === '/maps' || path.startsWith('/maps/');
  } catch {
    return false;
  }
};

export const isGoogleMapsSearchUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (!isGoogleMapsUrl(url)) {
      return false;
    }

    return (
      path === '/maps/search' ||
      path.startsWith('/maps/search/') ||
      (path === '/maps' && (parsed.searchParams.has('q') || parsed.searchParams.has('query')))
    );
  } catch {
    return false;
  }
};

export const normalizeLookupUrl = (url: string): string => {
  const parsed = new URL(url);
  if (isGoogleMapsUrl(parsed.toString())) {
    return parsed.toString();
  }

  return `${parsed.origin}/`;
};
