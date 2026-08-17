/**
 * Secret exclusion for the public GitHub backup.
 * Never push files matching these rules, even if git would track them.
 */
const SENSITIVE_DIRS = new Set([
  ".aws", ".ssh", ".gnupg", ".gcloud", ".azure", ".kube", ".docker",
  ".config", "secrets", "credentials", ".secrets", ".credentials",
]);

const SENSITIVE_BASENAMES = new Set([
  ".npmrc", ".netrc", ".pgpass", ".pypirc", ".git-credentials",
  "credentials", "credentials.json", "secrets.json", "secret.json",
  "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
]);

export function isSecretPath(path) {
  const segments = path.split("/");
  const base = segments[segments.length - 1];
  const baseLower = base.toLowerCase();

  // Directories that typically hold credentials
  if (segments.slice(0, -1).some((s) => SENSITIVE_DIRS.has(s.toLowerCase()))) return true;

  // .env and variants — but .env.example/.env.sample are safe templates
  if (/^\.env(\..+)?$/.test(base) && !/^\.env\.(example|sample|template)$/.test(base)) return true;

  // Key material / keystores / cert bundles with private keys
  if (/\.(pem|key|p12|pfx|keystore|jks|asc|ppk)$/i.test(base)) return true;

  // SSH private keys and known credential filenames
  if (SENSITIVE_BASENAMES.has(baseLower)) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)(\..*)?$/.test(baseLower) && !baseLower.endsWith(".pub")) return true;

  // Service-account / token-ish JSON and token files
  if (/(service[-_]?account|serviceaccount).*\.json$/i.test(base)) return true;
  if (/^\.?(token|tokens|apikey|api[-_]?keys?)(\.(txt|json|ya?ml))?$/i.test(baseLower)) return true;

  return false;
}
