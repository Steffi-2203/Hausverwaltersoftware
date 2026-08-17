import test from "node:test";
import assert from "node:assert/strict";
import { isSecretPath } from "./backup-denylist.mjs";

test("blocks secret-bearing files", () => {
  for (const p of [
    ".env", ".env.production", "artifacts/immo-flow-me/.env", "a/b/.env.local",
    ".npmrc", "home/.netrc", ".pgpass", ".git-credentials",
    "certs/server.key", "certs/server.pem", "app.p12", "keystore.jks", "putty.ppk",
    ".ssh/config", ".aws/config", "x/.gnupg/ring", ".kube/config", "config/secrets/prod.yml",
    "id_rsa", "keys/id_ed25519", "gcp-service-account.json", "serviceAccount.json",
    "credentials.json", "secrets.json", "token.txt", "api_keys.json", ".token",
  ]) {
    assert.equal(isSecretPath(p), true, `should block: ${p}`);
  }
});

test("allows normal project files", () => {
  for (const p of [
    ".env.example", "artifacts/immo-flow-me/.env.example", ".env.sample",
    "package.json", "src/index.ts", "docs/environment.md", "keyboard.ts",
    "public/monkey.png", "server/tokenService.ts", "tests/env-config.test.ts",
    "ssh-howto.md", "id_rsa.pub", "envelope.tsx", "src/secretsService.ts",
  ]) {
    assert.equal(isSecretPath(p), false, `should allow: ${p}`);
  }
});
