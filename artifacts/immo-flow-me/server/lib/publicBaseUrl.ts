/**
 * Die eine öffentliche Basis-URL für Links, die unsere Server in E-Mails
 * versenden. Produktionsmails dürfen niemals aus einem Request-Host oder einer
 * Replit-Preview-Domain abgeleitet werden.
 */
export const PUBLIC_PRODUCTION_BASE_URL = 'https://www.immoflowme.at';

function withoutTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Liefert die vertrauenswürdige öffentliche URL der Anwendung.
 *
 * In Produktion ist die eigene Domain absichtlich fest verdrahtet. APP_BASE_URL
 * kann lokale oder Staging-Setups adressieren, aber keinen Produktions-Mail-Link
 * auf eine versehentlich konfigurierte Fremd- oder Preview-Domain umleiten.
 */
export function getPublicBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NODE_ENV === 'production') {
    return PUBLIC_PRODUCTION_BASE_URL;
  }

  const configuredUrl = env.APP_BASE_URL?.trim();
  if (configuredUrl) {
    try {
      const parsed = new URL(configuredUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return withoutTrailingSlash(parsed.toString());
      }
    } catch {
      // Eine fehlerhafte lokale Konfiguration darf keine kaputten Mail-Links
      // erzeugen; die sichere Entwicklungs-Alternative folgt unten.
    }
  }

  const replitDevDomain = env.REPLIT_DEV_DOMAIN?.trim();
  if (replitDevDomain) {
    return `https://${replitDevDomain}`;
  }

  return 'http://localhost:5000';
}