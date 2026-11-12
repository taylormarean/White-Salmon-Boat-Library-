// Her search preferences and autopilot switches. Stored as one JSON blob in settings('prefs').

export interface Prefs {
  name: string;
  email: string;
  phone: string;
  home_location: string;       // "White Salmon, WA"
  radius_miles: number;
  target_roles: string[];      // job titles / keywords she wants
  exclude_keywords: string[];  // never show jobs mentioning these
  min_salary: number | null;   // yearly USD; hourly jobs are compared at 2080 h/yr
  want_remote: boolean;
  want_local: boolean;         // in-person or hybrid within radius
  wishes: string;              // free text: "part-time ok, no night shifts, love working with kids"
  industry_focus: string;      // what kind of work/industry to focus the search on
  exclude_companies: string[]; // employers she never wants to see again (a 👎 for "the company" adds here)
  min_fit_to_recommend: number; // jobs scoring below this are screened out instead of asking for her vote
  sources: {
    remotive: boolean;
    remoteok: boolean;
    himalayas: boolean;
    adzuna: boolean;
    usajobs: boolean;
    web_scout: boolean;        // Claude web search for local listings (small-town boards, employer sites)
    greenhouse_boards: string[]; // company board tokens, e.g. "providencehealth"
    lever_sites: string[];
    rss_feeds: string[];
  };
  autopilot: {
    daily_search: boolean;
    daily_hour: number;              // local hour to run the daily search
    max_scores_per_run: number;      // cost guard: AI fit checks per day
    auto_prepare_threshold: number;  // > 0: write the application automatically once she gives a job 👍 (0 = off)
    auto_send_applications: boolean; // send email applications without waiting for her OK
    auto_send_follow_ups: boolean;   // send follow-ups without waiting for her OK
    follow_up_days: number[];        // days to wait before each follow-up (from last contact)
    close_after_days: number;        // after the last follow-up, mark closed if still silent
    interview_check_in_days: number;
    daily_digest: boolean;           // morning email: what she needs to do + what the app did for her
  };
}

export const DEFAULT_PREFS: Prefs = {
  name: '',
  email: '',
  phone: '',
  home_location: '',
  radius_miles: 30,
  // Starting focus: tech sales. She can change any of this in Settings.
  target_roles: [
    'Sales Development Representative',
    'Business Development Representative',
    'Account Executive',
    'Account Manager',
    'Customer Success Manager',
    'Inside Sales Representative',
  ],
  exclude_keywords: ['commission only', '100% commission', 'door to door', 'door-to-door'],
  min_salary: null,
  want_remote: true,
  want_local: true,
  wishes: '',
  industry_focus: 'Tech sales — selling software, SaaS, or other technology products and services (B2B), remote or nearby',
  exclude_companies: [],
  min_fit_to_recommend: 60,
  sources: {
    remotive: true,
    remoteok: true,
    himalayas: true,
    adzuna: true,
    usajobs: true,
    web_scout: true,
    greenhouse_boards: [],
    lever_sites: [],
    rss_feeds: [],
  },
  autopilot: {
    daily_search: true,
    daily_hour: 7,
    max_scores_per_run: 25,
    auto_prepare_threshold: 80,
    auto_send_applications: false,
    auto_send_follow_ups: false,
    follow_up_days: [7, 10],
    close_after_days: 21,
    interview_check_in_days: 7,
    daily_digest: true,
  },
};

/** Deep-merge stored prefs over defaults so new fields always have a value. */
export function mergePrefs(stored: Partial<Prefs> | null | undefined): Prefs {
  const s = stored ?? {};
  return {
    ...DEFAULT_PREFS,
    ...s,
    sources: { ...DEFAULT_PREFS.sources, ...(s.sources ?? {}) },
    autopilot: { ...DEFAULT_PREFS.autopilot, ...(s.autopilot ?? {}) },
  };
}
