// Library policies — mirrors the policies posted on whitesalmonboatlibrary.org,
// with notes on how the app implements each one.

import { C, S } from '../theme';

const SECTIONS: { title: string; items: string[] }[] = [
  {
    title: 'Membership & the facility',
    items: [
      'Membership is free and requires a signed waiver and sign-up — both completed online. New Member Orientations are Tuesdays at 5:30pm at the library.',
      'The library is open 24/7 for members.',
      'Your access code must not be shared with anyone.',
      'All members must abide by the rules, regulations, and policies of the White Salmon Boat Library. Borrowing gear is a privilege — failure to adhere to these policies will result in termination of library membership. A request for re-admittance can be made in the following year.',
    ],
  },
  {
    title: 'Checking gear out',
    items: [
      'Every checkout must be thoroughly completed — your full name, each item\'s brand, model, color, and ID number, and your exact rental and return dates. The app records all of this for you.',
      'The rental period is 3 days. If you live locally and have the ability to return gear in three days or less, please do so.',
      'Rentals longer than 3 days must be noted at checkout. 9 days (three rental periods) is the maximum — this is reserved for members going on multi-day runs or out-of-town trips.',
      'Library gear is intended for local use. If gear is leaving a 100-mile radius of the library, you must tell the library where the gear is going.',
    ],
  },
  {
    title: 'Gear care',
    items: [
      'It is your duty to inspect all of your own gear for defects before use. If gear is torn, ripped, or broken, place it in the repair bin and find another piece of gear.',
      'If gear was damaged while in use, notify the library and place it in the damaged bin. In the app, the damage report at return does both — and nobody is charged for honestly reported damage.',
      'All returned gear must be put back in its correct location in the library.',
    ],
  },
  {
    title: 'On the water',
    items: [
      'All participants must wear a suitable PFD while on the water.',
      'Boat within your personal skill level — and never use library equipment on Class V whitewater.',
      'Zero tolerance for drug and alcohol use when on the river with library gear.',
      'If you have never been kayaking or are new to the sport, you must go with another person who can help you decide on safe river sections and instruct you on proper use of the gear.',
    ],
  },
  {
    title: 'Community standards',
    items: [
      'The White Salmon Boat Library does not discriminate on the basis of race, gender, sexual orientation, religion, gender identity, or economic status — and expects all members to do the same.',
      'Zero tolerance for any sexual, physical, emotional, or verbal harassment.',
    ],
  },
];

export default function Policies() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 20px' }}>
      <h1 style={S.h1}>Library policies</h1>
      <p style={{ color: C.textSecondary, marginBottom: 24 }}>
        The White Salmon Boat Library is a local, donation-based non-profit in the heart of the
        White Salmon kayaking community, located at The Missing Corner in BZ Corner, WA.
        These are the library's policies — the app enforces the ones it can, and trusts you with the rest.
      </p>
      {SECTIONS.map((s) => (
        <div key={s.title} style={{ ...S.card, marginBottom: 16 }}>
          <h2 style={S.h2}>{s.title}</h2>
          <ul style={{ paddingLeft: 20, fontSize: 14, lineHeight: 1.7, color: C.text }}>
            {s.items.map((i, idx) => <li key={idx}>{i}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}
