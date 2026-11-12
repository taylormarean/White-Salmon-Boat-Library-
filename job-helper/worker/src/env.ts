export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;               // the built web app (served from this same Worker)
  ALLOWED_EMAILS?: string;        // secret: "mom@gmail.com, you@gmail.com" — first one is the job seeker
  FRONTEND_URL?: string;          // only for local dev, when the web app runs on a different port
  AI_MODEL?: string;
  TIMEZONE?: string;
  JWT_SECRET?: string;
  TOKEN_ENC_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  ADZUNA_APP_ID?: string;
  ADZUNA_APP_KEY?: string;
  USAJOBS_API_KEY?: string;
  USAJOBS_EMAIL?: string;
  MOCK_AI?: string;               // dev only: "1" = canned AI answers
  DEV_LOGIN?: string;             // dev only: "1" = sign in by email without Google
}
