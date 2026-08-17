/**
 * Utility functions for masking sensitive data in the UI
 */

/**
 * Masks an email address, showing only first and last character of local part
 * Example: max.muster@gmail.com -> m*********r@g***l.com
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  
  const [local, domain] = email.split('@');
  if (!domain) return email;
  
  const maskedLocal = local.length > 2 
    ? local[0] + '*'.repeat(Math.min(local.length - 2, 8)) + local.slice(-1)
    : local[0] + '*';
    
  const domainParts = domain.split('.');
  if (domainParts.length < 2) return `${maskedLocal}@${domain}`;
  
  const domainName = domainParts[0];
  const tld = domainParts.slice(1).join('.');
  
  const maskedDomain = domainName.length > 2
    ? domainName[0] + '*'.repeat(Math.min(domainName.length - 2, 3)) + domainName.slice(-1)
    : domainName[0] + '*';
    
  return `${maskedLocal}@${maskedDomain}.${tld}`;
}

/**
 * Masks an IBAN, showing only first 4 and last 4 characters
 * Example: AT123456789012345678 -> AT12 **** **** 5678
 */
export function maskIban(iban: string | null | undefined): string {
  if (!iban) return '';
  
  // Remove spaces for processing
  const cleanIban = iban.replace(/\s/g, '');
  
  if (cleanIban.length < 8) return '****';
  
  return `${cleanIban.slice(0, 4)} **** **** ${cleanIban.slice(-4)}`;
}

/**
 * Masks a BIC, showing only first 2 characters
 * Example: BKAUATWW -> BK******
 */
export function maskBic(bic: string | null | undefined): string {
  if (!bic) return '';
  
  if (bic.length < 4) return '****';
  
  return `${bic.slice(0, 2)}${'*'.repeat(bic.length - 2)}`;
}

/**
 * Masks a phone number, showing only last 4 digits
 * Example: +43 660 1234567 -> +43 *** ***4567
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  
  // Remove spaces for processing
  const cleanPhone = phone.replace(/\s/g, '');
  
  if (cleanPhone.length < 6) return '****';
  
  // Keep country code if present (starts with +)
  if (cleanPhone.startsWith('+')) {
    const countryCode = cleanPhone.slice(0, 3);
    const rest = cleanPhone.slice(3);
    return `${countryCode} *** ***${rest.slice(-4)}`;
  }
  
  return `*** ***${cleanPhone.slice(-4)}`;
}

/**
 * Checks if a value is already masked (contains asterisks)
 */
export function isMasked(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.includes('****') || value.includes('***');
}
