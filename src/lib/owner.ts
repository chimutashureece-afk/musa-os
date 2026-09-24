// The people who run Musa OS. They approve new schools and can see every demo.
// Keep this list in step with isOwner() in firestore.rules.
export const OWNER_EMAILS = ['chimutashureece@gmail.com', 'chimutashutanatswa13@gmail.com'];
export const isOwnerEmail = (email?: string | null) => !!email && OWNER_EMAILS.includes(email.trim().toLowerCase());

/** How long a demo lasts. */
export const DEMO_MS = 24 * 60 * 60 * 1000;

export const timeLeft = (until?: number) => {
  if (!until) return '';
  const ms = until - Date.now();
  if (ms <= 0) return 'ended';
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return h ? `${h} h ${m} min left` : `${m} min left`;
};
