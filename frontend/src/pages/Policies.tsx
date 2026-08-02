// Library policies & SOP — WSBL's posted rules, plus the self-serve procedures.

import { C, S } from '../theme';

const SECTIONS: { title: string; items: string[] }[] = [
  {
    title: 'Membership',
    items: [
      'Membership is free and open to everyone. Sign up online — the waiver is part of signup and stays on file.',
      'New Member Orientations happen weekly (see the note on your welcome email). New paddlers are strongly encouraged to attend before their first checkout.',
      'The shed is open 24/7 for members via the access code you receive at checkout.',
      'Failure to follow library policies can result in suspension or termination of membership.',
    ],
  },
  {
    title: 'Checking gear out (self-serve)',
    items: [
      'Sign in and complete the digital checkout — it replaces the paper board. Every item you take must be on your checkout.',
      'You\'ll get the shed access code on screen and by email after you check out.',
      'Loans run up to 7 days and 6 items. Need longer? Ask a librarian for an extension.',
      'Close the shed and scramble the lock when you leave. Don\'t share the code.',
      'You can\'t check out more gear while you have anything overdue.',
    ],
  },
  {
    title: 'On the water — safety rules',
    items: [
      'Zero tolerance for drugs and alcohol while using library gear on the river.',
      'A properly fitted PFD must be worn whenever you are on the water. Helmets whenever appropriate.',
      'If you have never kayaked or are new to the sport, you must go with an experienced partner who can help you choose safe river sections and use the gear properly.',
      'Know the flows. Check river levels before you launch, and choose sections within your ability.',
      'The library lends gear — it does not provide guiding or instruction. Your decisions on the water are your own.',
    ],
  },
  {
    title: 'Returning gear',
    items: [
      'Return gear clean, drained, and dry enough to store.',
      'Mark your return in the app and give an honest condition report for every item — damage reports are how we keep gear safe for the next person. You will never be penalized for honestly reporting normal wear or damage.',
      'Damaged gear goes straight to the repair queue so nobody unknowingly takes out unsafe equipment.',
      'Lost or unreturned gear may lead to suspension — it\'s donated equipment the whole community shares.',
    ],
  },
  {
    title: 'Community standards',
    items: [
      'Zero tolerance for any sexual, physical, emotional, or verbal harassment.',
      'Treat the shed, the gear, and each other with care. This library exists because people donated their time and equipment.',
      'See something broken, unsafe, or off? Tell a librarian or report it with your return.',
    ],
  },
];

export default function Policies() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 20px' }}>
      <h1 style={S.h1}>Library policies</h1>
      <p style={{ color: C.textSecondary, marginBottom: 24 }}>
        The White Salmon Boat Library is a free, donation-based community gear library at The Missing Corner in BZ Corner, WA.
        These rules keep it running — and keep everyone safe on the river.
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
