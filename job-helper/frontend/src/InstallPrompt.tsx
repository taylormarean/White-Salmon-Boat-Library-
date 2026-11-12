import { useEffect, useState } from 'react';

/**
 * A friendly card that offers to put Next Chapter on the phone's home screen.
 *  - Android / Chrome / Edge: shows an "Add to home screen" button (uses the browser's install prompt).
 *  - iPhone / iPad Safari: shows the two taps needed (Share → Add to Home Screen).
 * Hidden when already running as a home-screen app, and for 30 days after "Not now".
 */

// Chrome's install event isn't in TypeScript's DOM types yet.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

const DISMISS_KEY = 'nc-install-dismissed-at';
const DISMISS_FOR_MS = 30 * 24 * 60 * 60 * 1000;

// Capture the install event as soon as this module loads — it can fire before the card mounts.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own, friendlier card instead of the browser's mini-bar
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS reports itself as a Mac; touch support gives it away.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!iOS) return false;
  // Other iOS browsers and in-app browsers (Facebook, Instagram, Gmail…) don't offer "Add to Home Screen" the same way.
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA|FBAN|FBAV|Instagram|Line\//.test(ua);
}

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* private mode etc. — just hide for this visit */
  }
}

function ShareIcon() {
  // The iOS "Share" glyph: a box with an arrow pointing up.
  return (
    <svg
      width="18"
      height="22"
      viewBox="0 0 18 22"
      aria-hidden="true"
      style={{ verticalAlign: '-4px', margin: '0 .2rem' }}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 13V1.5M5 5l4-3.5L13 5" />
      <path d="M6 8.5H3a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 3 20.5h12a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 15 8.5h-3" />
    </svg>
  );
}

export default function InstallPrompt() {
  const [canPrompt, setCanPrompt] = useState<boolean>(() => deferredPrompt !== null);
  const [hidden, setHidden] = useState<boolean>(() => isStandalone() || recentlyDismissed());
  const [ios] = useState<boolean>(isIosSafari);

  useEffect(() => {
    const update = () => setCanPrompt(deferredPrompt !== null);
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);

  if (hidden || (!canPrompt && !ios)) return null;

  const dismiss = () => {
    rememberDismissal();
    setHidden(true);
  };

  const install = async () => {
    const evt = deferredPrompt;
    if (!evt) return;
    deferredPrompt = null; // the browser only lets us use it once
    try {
      await evt.prompt();
      const choice = await evt.userChoice;
      if (choice.outcome === 'dismissed') rememberDismissal();
    } catch {
      /* ignore — browser refused to show it */
    }
    setHidden(true);
    notify();
  };

  return (
    <div
      className="card no-print"
      role="region"
      aria-label="Add Next Chapter to your home screen"
      style={{ borderColor: 'var(--brand)', background: 'var(--brand-soft)' }}
    >
      <div className="row between" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <img
            src="/icons/icon-192.png"
            alt=""
            width={48}
            height={48}
            style={{ borderRadius: 12, flex: 'none' }}
          />
          <div>
            <h3 style={{ margin: 0 }}>Put Next Chapter on your home screen</h3>
            {canPrompt ? (
              <p className="muted small" style={{ margin: '.2rem 0 0' }}>
                Open it with one tap, just like any other app.
              </p>
            ) : (
              <>
                <p className="small" style={{ margin: '.2rem 0 0' }}>
                  Tap the Share button
                  <ShareIcon />, then ‘Add to Home Screen’.
                </p>
                <p className="muted small" style={{ margin: '.2rem 0 0' }}>
                  Don’t see Share? Tap the ••• button first.
                </p>
              </>
            )}
          </div>
        </div>
        <button type="button" className="ghost small" onClick={dismiss} aria-label="Hide this tip">
          Not now
        </button>
      </div>
      {canPrompt && (
        <div className="row" style={{ marginTop: '.75rem' }}>
          <button type="button" className="primary" onClick={install}>
            Add to home screen
          </button>
        </div>
      )}
    </div>
  );
}
