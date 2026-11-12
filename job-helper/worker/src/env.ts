export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;               // the built web app (served from this same Worker)

  /** Set per request / per cron pass: whose workspace this code is acting in. */
  uid?: number;

  // ---- who's who (secrets, comma-separated emails)
  ADMIN_EMAILS?: string;          // the business owner(s): admin dashboard, payouts
  FREE_EMAILS?: string;           // comped accounts (e.g. the founder's mom) — AI cost is on the house
  ALLOWED_EMAILS?: string;        // legacy (v1): first address = job seeker; treated as FREE_EMAILS
  OPEN_SIGNUP?: string;           // "0" = invite-only (only listed emails); default open
  MAX_USERS?: string;             // beta cap (Google allows 100 users before app verification) — default 100

  // ---- pricing (vars)
  PRICE_MULTIPLIER?: string;      // customers pay this × the AI cost — default 2
  REFERRAL_SHARE?: string;        // share of profit paid to whoever referred the customer — default 0.5
  SIGNUP_CREDIT_USD?: string;     // free starter credit for new paid accounts — default 0
  PAYOUT_MIN_USD?: string;        // minimum referral balance before a cash payout — default 25
  PAYOUT_HOLD_DAYS?: string;      // earnings wait this long before payout (refund window) — default 30

  APP_URL?: string;               // canonical public address, e.g. https://nextchapterjobhunter.com
  FRONTEND_URL?: string;          // only for local development, when the web app runs on a different port
  AI_MODEL?: string;
  TIMEZONE?: string;
  JWT_SECRET?: string;
  TOKEN_ENC_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  RESEND_API_KEY?: string;        // system email (alerts, weekly summaries) independent of anyone's Gmail
  ALERT_FROM_EMAIL?: string;      // verified Resend sender, e.g. alerts@yourdomain.com
  TWILIO_ACCOUNT_SID?: string;    // optional text messages
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM?: string;
  ADZUNA_APP_ID?: string;
  ADZUNA_APP_KEY?: string;
  USAJOBS_API_KEY?: string;
  USAJOBS_EMAIL?: string;
  MOCK_AI?: string;               // dev only: "1" = canned AI answers
  DEV_LOGIN?: string;             // dev only: "1" = sign in by email without Google
}
