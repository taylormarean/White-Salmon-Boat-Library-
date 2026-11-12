export interface Env {
  DB: D1Database;
  FRONTEND_URL: string;
  API_URL: string;
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
  MOCK_AI?: string;
}
