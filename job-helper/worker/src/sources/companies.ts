// Software companies whose public career pages regularly list U.S. sales and customer-success roles.
// Searched for anyone focused on tech sales. Each one was checked on 2026-11-12 to have a live board
// with U.S. go-to-market openings; a board that later disappears is skipped and reported, not fatal.

export interface CompanyBoard {
  ats: 'greenhouse' | 'lever' | 'ashby';
  slug: string;
  name: string;
}

const gh = (slug: string, name: string): CompanyBoard => ({ ats: 'greenhouse', slug, name });
const ashby = (slug: string, name: string): CompanyBoard => ({ ats: 'ashby', slug, name });
const lever = (slug: string, name: string): CompanyBoard => ({ ats: 'lever', slug, name });

export const TECH_SALES_COMPANIES: CompanyBoard[] = [
  gh('samsara', 'Samsara'), gh('datadog', 'Datadog'), gh('stripe', 'Stripe'), gh('braze', 'Braze'),
  gh('gitlab', 'GitLab'), gh('brex', 'Brex'), gh('databricks', 'Databricks'), gh('elastic', 'Elastic'),
  gh('toast', 'Toast'), gh('anthropic', 'Anthropic'), gh('twilio', 'Twilio'), gh('qualtrics', 'Qualtrics'),
  gh('mongodb', 'MongoDB'), gh('abnormalsecurity', 'Abnormal Security'), gh('klaviyo', 'Klaviyo'),
  gh('grafanalabs', 'Grafana Labs'), gh('fivetran', 'Fivetran'), gh('zoominfo', 'ZoomInfo'), gh('netskope', 'Netskope'),
  gh('okta', 'Okta'), gh('gongio', 'Gong'), gh('rubrik', 'Rubrik'), gh('figma', 'Figma'), gh('justworks', 'Justworks'),
  gh('intercom', 'Intercom'), gh('gusto', 'Gusto'), gh('pagerduty', 'PagerDuty'), gh('vercel', 'Vercel'),
  gh('asana', 'Asana'), gh('carta', 'Carta'), gh('sproutsocial', 'Sprout Social'), gh('dialpad', 'Dialpad'),
  gh('affirm', 'Affirm'), gh('smartsheet', 'Smartsheet'), gh('launchdarkly', 'LaunchDarkly'), gh('6sense', '6sense'),
  gh('wrike', 'Wrike'), gh('salesloft', 'Salesloft'), gh('airtable', 'Airtable'), gh('mercury', 'Mercury'),
  gh('checkr', 'Checkr'), gh('dropbox', 'Dropbox'), gh('huntress', 'Huntress'), gh('greenhouse', 'Greenhouse'),
  ashby('snowflake', 'Snowflake'), ashby('vanta', 'Vanta'), ashby('notion', 'Notion'), ashby('1password', '1Password'),
  ashby('plaid', 'Plaid'), ashby('amplitude', 'Amplitude'), ashby('openai', 'OpenAI'), ashby('clickhouse', 'ClickHouse'),
  ashby('temporal', 'Temporal'), ashby('ashby', 'Ashby'), ashby('apollo', 'Apollo.io'), ashby('clickup', 'ClickUp'),
  ashby('webflow', 'Webflow'), ashby('miro', 'Miro'), ashby('linear', 'Linear'), ashby('fullstory', 'Fullstory'),
  ashby('drata', 'Drata'), ashby('zapier', 'Zapier'), ashby('sentry', 'Sentry'),
  lever('contentsquare', 'Contentsquare'), lever('outreach', 'Outreach'), lever('coalfire', 'Coalfire'),
];

/** Go-to-market titles worth keeping from a company's whole board (the rest of the board is skipped). */
export const GTM_TITLE = /(sales|account (executive|manager|director|development)|business development|\bsdr\b|\bbdr\b|\bae\b|customer success|client success|success manager|partner|channel|renewal|revenue|solutions? (consultant|engineer|architect)|pre-?sales|inside sales|territory|relationship manager)/i;
