export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function getDomainFromUrl(url: string): string {
  const hostname = new URL(url).hostname;
  const parts = hostname.split(".");

  // If we have more than 2 parts (e.g., www.example.com)
  if (parts.length > 2) {
    // Take the last two parts at minimum (example.com)
    // If the second-to-last part is very short (like 'co' in .co.uk), take one more
    const secondToLast = parts[parts.length - 2];
    if (secondToLast.length <= 2 && parts.length > 3) {
      return parts.slice(-3).join(".");
    }
    return parts.slice(-2).join(".");
  }

  // If we only have two parts or less (example.com or localhost)
  return hostname;
}

export function normalizeUrl(baseUrl: string, relativeUrl: string): string {
  try {
    // Handle empty or invalid URLs
    if (
      !relativeUrl ||
      relativeUrl === "#" ||
      relativeUrl.startsWith("mailto:") ||
      relativeUrl.startsWith("tel:") ||
      relativeUrl.startsWith("javascript:")
    ) {
      return "";
    }

    // If it's already an absolute URL, validate and return it
    if (relativeUrl.match(/^https?:\/\//)) {
      const url = new URL(relativeUrl);
      return url.protocol === "https:" || url.protocol === "http:"
        ? url.toString()
        : "";
    }

    // Handle protocol-relative URLs (//example.com)
    if (relativeUrl.startsWith("//")) {
      const url = new URL(`https:${relativeUrl}`);
      return url.toString();
    }

    // Handle root-relative URLs (/path) and relative URLs (path or ../path)
    const url = new URL(relativeUrl, baseUrl);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : "";
  } catch (error) {
    return "";
  }
}

export function extractRelevantLinks(
  baseUrl: string,
  html: string
): { link: string }[] {
  try {
    // Validate base URL first
    const baseUrlObj = new URL(baseUrl);
    if (baseUrlObj.protocol !== "https:" && baseUrlObj.protocol !== "http:") {
      return [];
    }

    const baseDomain = getDomainFromUrl(baseUrl);

    return Array.from(html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>/g))
      .map((match) => ({
        link: normalizeUrl(baseUrl, match[1]),
      }))
      .filter(({ link }) => {
        if (!link) return false;
        try {
          const url = new URL(link);
          // Only keep valid HTTP(S) URLs from the same domain
          return (
            (url.protocol === "https:" || url.protocol === "http:") &&
            getDomainFromUrl(link) === baseDomain
          );
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}
