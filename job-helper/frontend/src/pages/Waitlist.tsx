import './landing.css';

// Shown after Google sign-in when the beta is full (the worker redirects to #/waitlist).

export default function Waitlist() {
  return (
    <div className="lp">
      <main className="lp-main lp-waitlist">
        <div className="card lp-waitlist-card">
          <img src="/icons/icon.svg" alt="" width="56" height="56" />
          <h1>You’re on the list 🌱</h1>
          <p>
            Thank you for signing up for Next Chapter! We’re in a small, limited beta right now, with room for up to
            100 people while Google reviews the app.
          </p>
          <p>
            Your spot is saved. We’ll send you an email as soon as there’s room for you, and you won’t need to sign up again.
            Just come back and sign in with the same Google account.
          </p>
          <p className="small muted">
            Questions? Write to us at <a href="mailto:support@nextchapterjobhunter.com">support@nextchapterjobhunter.com</a>.
          </p>
          <a className="btn primary" href="/">Back to the home page</a>
        </div>
      </main>
    </div>
  );
}
