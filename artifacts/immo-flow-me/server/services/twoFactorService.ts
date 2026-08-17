import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import crypto from "crypto";

export async function generateSecret(userId: string, email: string): Promise<{
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}> {
  const totp = new OTPAuth.TOTP({
    issuer: "ImmoFlowMe",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: new OTPAuth.Secret({ size: 20 }),
  });

  const secret = totp.secret.base32;
  const otpauthUrl = totp.toString();
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

  return { secret, otpauthUrl, qrCodeDataUrl };
}

export function verifyToken(secret: string, token: string): boolean {
  const totp = new OTPAuth.TOTP({
    issuer: "ImmoFlowMe",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

  const delta = totp.validate({ token, window: 1 });
  return delta !== null;
}

export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < 8; i++) {
    codes.push(crypto.randomBytes(4).toString("hex").toUpperCase());
  }
  return codes;
}

export function hashBackupCode(code: string): string {
  return crypto.createHash("sha256").update(code.toUpperCase().trim()).digest("hex");
}

export function verifyBackupCode(
  storedHashes: string[],
  code: string
): { valid: boolean; remainingCodes: string[] } {
  const inputHash = hashBackupCode(code);
  const index = storedHashes.findIndex((h) => h === inputHash);

  if (index === -1) {
    return { valid: false, remainingCodes: storedHashes };
  }

  const remainingCodes = [...storedHashes];
  remainingCodes.splice(index, 1);
  return { valid: true, remainingCodes };
}
