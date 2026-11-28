// Rule-based tone check for co-parenting messages, loosely based on the
// BIFF approach (Brief, Informative, Friendly, Firm). It never blocks a message;
// it shows the sender what may read as hostile before they send it.
// Deliberately conservative: a short list of clear patterns, not sentiment guessing.

const CHECKS = [
  { id: 'insult', label: 'Name-calling', tip: 'Describe the specific behavior or problem instead of labeling the person.',
    re: /\b(idiot|stupid|moron|loser|pathetic|worthless|useless|liar|psycho|crazy|insane|deadbeat|selfish|lazy|incompetent|joke|narcissist)\b/gi },
  { id: 'profanity', label: 'Profanity', tip: 'Remove profanity; a judge may read this message one day.',
    re: /\b(f+u+c+k\w*|sh[i1]t\w*|bitch\w*|bastard|asshole|damn|crap|wtf|stfu)\b/gi },
  { id: 'absolute', label: 'Always/never statements', tip: 'Absolutes invite argument. Refer to the specific date or event.',
    re: /\byou\s+(always|never|constantly|keep)\b/gi },
  { id: 'blame', label: 'Blame framing', tip: 'Try "I need..." or "Can we..." rather than "you made/you caused".',
    re: /\b(your fault|you made me|because of you|you ruined|you caused|thanks to you)\b/gi },
  { id: 'threat', label: 'May read as a threat', tip: 'If you intend legal action, say so calmly or leave it to your attorney.',
    re: /\b(or else|you('| wi)ll regret|you('| wi)ll be sorry|watch yourself|see you in court|i('| wi)ll make sure you|you('| a)re going to pay)\b/gi },
  { id: 'kids', label: 'Using the children as leverage', tip: 'Keep the children out of adult disagreements.',
    re: /\b(the kids (hate|don'?t want|are scared of) you|i('| wi)ll tell the kids|you('| wi)ll never see)\b/gi },
  { id: 'sarcasm', label: 'Possible sarcasm', tip: 'Sarcasm reads worse in writing than you intend.',
    re: /\b(oh great|nice job|thanks a lot|real mature|good for you|whatever)\b/gi },
];

export function checkTone(text) {
  const t = String(text || '');
  const issues = [];
  for (const c of CHECKS) {
    const matches = [...new Set((t.match(c.re) || []).map(s => s.toLowerCase()))];
    if (matches.length) issues.push({ id: c.id, label: c.label, tip: c.tip, matches });
  }
  const words = t.match(/\b[A-Za-z]{3,}\b/g) || [];
  const caps = words.filter(w => w === w.toUpperCase());
  if (words.length >= 4 && caps.length / words.length > 0.4) {
    issues.push({ id: 'caps', label: 'All caps', tip: 'All caps reads as shouting.', matches: caps.slice(0, 5) });
  }
  if (/[!?]{3,}/.test(t)) issues.push({ id: 'punct', label: 'Stacked punctuation', tip: 'Use a single "?" or "!".', matches: t.match(/[!?]{3,}/g) });
  const wordCount = (t.match(/\S+/g) || []).length;
  if (wordCount > 250) issues.push({ id: 'long', label: 'Long message', tip: 'Brief messages get better responses. Consider splitting topics into separate threads.', matches: [`${wordCount} words`] });
  return { ok: issues.length === 0, issues, wordCount };
}
