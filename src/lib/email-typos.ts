// Catches common typos in email domains ("gmial.com", "gmail.con") so the
// organisers can actually reach people. Only a suggestion: unusual but real
// domains are still accepted, except endings that can never be valid.

const KNOWN = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.in",
  "yahoo.in",
  "ymail.com",
  "rocketmail.com",
  "hotmail.com",
  "hotmail.co.in",
  "outlook.com",
  "outlook.in",
  "live.com",
  "live.in",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "rediffmail.com",
  "protonmail.com",
  "proton.me",
  "aol.com",
  "zoho.com",
  "zohomail.in",
  "mail.com",
  "email.com",
  "gmx.com",
]);

// Long enough that a near miss is almost certainly a typo of one of these.
const TARGETS = [
  "gmail.com",
  "yahoo.com",
  "yahoo.co.in",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "rediffmail.com",
  "protonmail.com",
  "googlemail.com",
];

// Domains people type that don't exist for personal email.
const ALIASES: Record<string, string> = {
  "gmail.co.in": "gmail.com",
  "gmail.in": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail": "gmail.com",
  "hotmail.co": "hotmail.com",
  "outlook.co": "outlook.com",
  "icloud.co": "icloud.com",
  "yahoo.co": "yahoo.com",
  "yahoo": "yahoo.com",
  "rediff.com": "rediffmail.com",
};

/** Endings that are never a real top-level domain: always a typo of .com. */
const BAD_TLD = /\.(con|cmo|ocm|comm|coom|cpm|vom|xom|c0m|cim|clm)$/;

/** Edit distance counting a swap of two neighbouring letters as one edit. */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

function splitEmail(email: string): [string, string] | null {
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  return [email.slice(0, at), email.slice(at + 1).toLowerCase()];
}

/** True when the domain ends in something like ".con" that can't be real. */
export function hasImpossibleDomain(email: string): boolean {
  const parts = splitEmail(email.trim());
  return !!parts && BAD_TLD.test(parts[1]);
}

/** The likely intended address, or null when the domain looks fine. */
export function suggestEmail(email: string): string | null {
  const parts = splitEmail(email.trim());
  if (!parts) return null;
  const [local, domain] = parts;
  if (KNOWN.has(domain)) return null;

  let fixed = domain.replace(BAD_TLD, ".com").replace(/\.{2,}/g, ".").replace(/\.$/, "");
  fixed = ALIASES[fixed] ?? fixed;
  if (!KNOWN.has(fixed)) {
    let best: string | null = null;
    let bestDist = Infinity;
    for (const t of TARGETS) {
      const dist = distance(fixed, t);
      if (dist < bestDist) [best, bestDist] = [t, dist];
    }
    const allowed = fixed.length >= 10 ? 2 : 1;
    if (best && bestDist <= allowed) fixed = best;
  }
  return fixed !== domain ? `${local}@${fixed}` : null;
}
