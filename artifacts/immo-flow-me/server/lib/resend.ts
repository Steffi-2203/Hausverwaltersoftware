import { Resend } from 'resend';

let connectionSettings: any;

async function getCredentials() {
  // First check for direct RESEND_API_KEY environment variable
  if (process.env.RESEND_API_KEY) {
    console.log('[Resend] Using RESEND_API_KEY from environment');
    return {
      apiKey: process.env.RESEND_API_KEY,
      // Use Resend's test domain for development, or verified domain
      fromEmail: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
    };
  }

  // Fallback to Replit connector
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=resend',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  if (!connectionSettings || (!connectionSettings.settings.api_key)) {
    throw new Error('Resend not connected');
  }
  return {
    apiKey: connectionSettings.settings.api_key,
    fromEmail: connectionSettings.settings.from_email
      || process.env.RESEND_FROM_EMAIL
      || 'onboarding@resend.dev'
  };
}

export async function getResendClient() {
  const { apiKey, fromEmail } = await getCredentials();
  return {
    client: new Resend(apiKey),
    fromEmail
  };
}

export async function sendEmail(options: {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  attachments?: Array<{ filename: string; content: string; content_type?: string }>;
  /** Stabiler Schlüssel: Resend dedupliziert wiederholte Sends mit demselben
   *  Key (24h-Fenster) — schützt vor Doppelversand bei Retry nach Crash. */
  idempotencyKey?: string;
}) {
  if (!options.html && !options.text) {
    throw new Error('[Resend] sendEmail benötigt html oder text.');
  }
  const { client, fromEmail } = await getResendClient();

  const result = await client.emails.send({
    from: fromEmail,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
    attachments: options.attachments,
  } as any, options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined);

  // Resend SDK returns { data, error } — a resolved promise does NOT mean success.
  // Throw so callers can rely on try/catch instead of inspecting the return value.
  if (result.error) {
    throw new Error(result.error.message || `Resend API error (name=${result.error.name})`);
  }

  return result;
}

export async function sendInviteEmail(options: {
  to: string;
  inviterName: string;
  organizationName: string;
  role: string;
  inviteUrl: string;
}) {
  const roleLabels: Record<string, string> = {
    admin: 'Administrator',
    property_manager: 'Verwalter',
    finance: 'Buchhalter',
    viewer: 'Betrachter',
    tester: 'Tester'
  };

  const roleLabel = roleLabels[options.role] || options.role;

  return sendEmail({
    to: options.to,
    subject: `Einladung zu ${options.organizationName} - ImmoFlowMe`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1a365d;">Einladung zu ImmoFlowMe</h1>
        <p>Hallo,</p>
        <p><strong>${options.inviterName}</strong> hat Sie eingeladen, der Organisation <strong>${options.organizationName}</strong> als <strong>${roleLabel}</strong> beizutreten.</p>
        <p style="margin: 30px 0;">
          <a href="${options.inviteUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Einladung annehmen
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">
          Dieser Link ist 7 Tage gültig. Falls Sie diese E-Mail nicht erwartet haben, können Sie sie ignorieren.
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="color: #999; font-size: 12px;">
          ImmoFlowMe - Professionelle Hausverwaltung
        </p>
      </div>
    `,
    text: `
${options.inviterName} hat Sie eingeladen, der Organisation ${options.organizationName} als ${roleLabel} beizutreten.

Klicken Sie auf diesen Link, um die Einladung anzunehmen:
${options.inviteUrl}

Dieser Link ist 7 Tage gültig.
    `
  });
}
