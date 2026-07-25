import { z } from "zod";

/**
 * Validated environment. Imported by server code only (except NEXT_PUBLIC_*).
 * Missing Supabase config is ALLOWED and switches the app into demo mode —
 * every dashboard renders deterministic demo data with zero keys.
 */

const serverSchema = z.object({
  DATABASE_URL: z.string().url().optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  APP_ENCRYPTION_KEY: z.string().min(32).optional(),
  CRON_SECRET: z.string().min(16).optional(),
  /** One agency-wide long-lived Meta user token — sees every ad account the
   *  agency admin manages. Optional: per-client connections (OAuth or a
   *  pasted token) work without it; sync falls back to this only when a
   *  connection has no per-client credential of its own. */
  META_USER_TOKEN: z.string().min(20).optional(),
  META_APP_ID: z.string().min(1).optional(),
  META_APP_SECRET: z.string().min(1).optional(),
  /** HMAC secret Shopify signs webhook payloads with — set per the app's
   *  webhook config in the Shopify Partner dashboard (or a custom app's
   *  webhook settings). Read directly by the webhook route too; declared
   *  here as well so it's validated/discoverable alongside every other key. */
  SHOPIFY_WEBHOOK_SECRET: z.string().min(1).optional(),
  /** Google Ads OAuth client (Google Cloud Console → APIs & Services →
   *  Credentials → OAuth client ID, type "Web application"). Required for
   *  the /api/integrations/google_ads/start|callback OAuth flow. */
  GOOGLE_ADS_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_ADS_CLIENT_SECRET: z.string().min(1).optional(),
  /** Agency-wide developer token from a Google Ads Manager (MCC) account's
   *  API Center — gates every Google Ads API call regardless of which
   *  client's refresh token is used, same role META_USER_TOKEN plays for
   *  Meta's agency-wide path. */
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().min(1).optional(),
  /** The MCC manager account's customer id (digits only, no dashes) — sent
   *  as the login-customer-id header so the API knows which manager account
   *  is acting on behalf of a linked client account. */
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: z.string().min(1).optional(),
  /** One agency-wide OAuth refresh token, minted once (e.g. via Google's
   *  OAuth 2.0 Playground authorizing the adwords scope, or by running this
   *  app's own /api/integrations/google_ads/start flow once and copying the
   *  refresh_token it receives). Lets the agency list and connect every
   *  client account linked under GOOGLE_ADS_LOGIN_CUSTOMER_ID's MCC without
   *  a separate OAuth consent per client — same role META_USER_TOKEN plays
   *  for Meta's agency-wide path. */
  GOOGLE_ADS_REFRESH_TOKEN: z.string().min(1).optional(),
  /** TikTok for Business developer app, from the TikTok for Business
   *  Marketing API app registration. Required for the
   *  /api/integrations/tiktok/start|callback OAuth flow. */
  TIKTOK_APP_ID: z.string().min(1).optional(),
  TIKTOK_APP_SECRET: z.string().min(1).optional(),
});

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
});

export const env = {
  ...serverSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
    META_USER_TOKEN: process.env.META_USER_TOKEN,
    META_APP_ID: process.env.META_APP_ID,
    META_APP_SECRET: process.env.META_APP_SECRET,
    SHOPIFY_WEBHOOK_SECRET: process.env.SHOPIFY_WEBHOOK_SECRET,
    GOOGLE_ADS_CLIENT_ID: process.env.GOOGLE_ADS_CLIENT_ID,
    GOOGLE_ADS_CLIENT_SECRET: process.env.GOOGLE_ADS_CLIENT_SECRET,
    GOOGLE_ADS_DEVELOPER_TOKEN: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    GOOGLE_ADS_REFRESH_TOKEN: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    TIKTOK_APP_ID: process.env.TIKTOK_APP_ID,
    TIKTOK_APP_SECRET: process.env.TIKTOK_APP_SECRET,
  }),
  ...clientSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  }),
};

/** True when no Supabase project is configured — run on deterministic demo data. */
export const isDemoMode =
  !env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
