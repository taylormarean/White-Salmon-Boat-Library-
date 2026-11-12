// Which application (if any) is an incoming email about? Pure; unit tested.
import { emailDomain, isFreeMail, normalize } from './text';

export interface MatchableApp {
  id: number;
  company: string;
  contact_email: string | null;
  gmail_thread_id: string | null;
  updated_at: string;
}

export interface MatchableMail {
  threadId: string;
  from: string;
  subject: string;
  body: string;
}

// Applicant tracking systems send mail on employers' behalf — the company name is the only clue.
const ATS_DOMAINS = /(greenhouse\.io|lever\.co|myworkday|workday\.com|icims\.com|smartrecruiters|jobvite|workable|ashbyhq|bamboohr|paycom|paylocity|indeed|ziprecruiter|applytojob|recruitee|breezy\.hr|jazzhr|ultipro|ukg|taleo|successfactors|adp\.com|dayforce)/i;

export function senderAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

export function matchApplication(mail: MatchableMail, apps: MatchableApp[]): MatchableApp | null {
  if (!apps.length) return null;
  const byThread = apps.find((a) => a.gmail_thread_id && a.gmail_thread_id === mail.threadId);
  if (byThread) return byThread;

  const fromDomain = emailDomain(senderAddress(mail.from));
  if (fromDomain && !isFreeMail(fromDomain) && !ATS_DOMAINS.test(fromDomain)) {
    const byDomain = apps.filter((a) => {
      const d = emailDomain(a.contact_email);
      return d && !isFreeMail(d) && (d === fromDomain || fromDomain.endsWith(`.${d}`) || d.endsWith(`.${fromDomain}`));
    });
    if (byDomain.length) return newest(byDomain);
  }

  const hay = ` ${normalize(`${mail.from} ${mail.subject} ${mail.body.slice(0, 2000)}`)} `;
  const byName = apps.filter((a) => {
    const n = normalize(a.company);
    return n.length >= 4 && hay.includes(` ${n} `);
  });
  if (byName.length) return newest(byName);
  return null;
}

function newest(apps: MatchableApp[]): MatchableApp {
  return [...apps].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
}
