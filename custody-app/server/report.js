// Printable records report (open in a browser, then Print > Save as PDF).
import { verifyFamily } from './db.js';
import { timeShare } from './schedule.js';
import { addDays, utcToLocalDate, utcToLocalStamp } from './time.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const money = (c) => `$${(c / 100).toFixed(2)}`;
const ENTERED_LATE_MIN = 10;
const STATUS_TEXT = { active: 'Approved', unconfirmed: 'Not yet confirmed by other parent', pending: 'Awaiting approval', rejected: 'Rejected', withdrawn: 'Withdrawn', retired: 'Ended' };

export function renderReport(db, api, c, from, to) {
  const h = api.helpers;
  const tz = c.tz;
  const t = (ms) => utcToLocalStamp(ms, tz).replace('T', ' ');
  const iso = (s) => (s ? t(Date.parse(s)) : '');
  const { timeline } = h.timelineFor(c, from, to);
  const share = h.shareWithNames(c, timeShare(timeline, tz, from, to));
  const rules = h.loadRules(c.family.id);
  const q = (sql, ...a) => db.prepare(sql).all(...a);
  const inRange = (s) => s >= `${from}` && s < `${to}T99`;
  const fid = c.family.id;

  const exchanges = q('SELECT * FROM exchanges WHERE family_id = ? ORDER BY at_ms', fid).filter(x => inRange(utcToLocalStamp(x.at_ms, tz)));
  const expenses = q('SELECT * FROM expenses WHERE family_id = ? AND date >= ? AND date < ? ORDER BY date', fid, from, to);
  const payments = q('SELECT * FROM payments WHERE family_id = ? AND date >= ? AND date < ? ORDER BY date', fid, from, to);
  const calls = q('SELECT * FROM calls WHERE family_id = ? AND started_local >= ? AND started_local < ? ORDER BY started_local', fid, `${from}T00:00`, `${to}T00:00`);
  const threads = q('SELECT * FROM threads WHERE family_id = ? ORDER BY id', fid);
  const messages = q('SELECT * FROM messages WHERE family_id = ? ORDER BY id', fid).filter(m => inRange(utcToLocalStamp(Date.parse(m.created_at), tz)));
  const reads = q('SELECT r.* FROM message_reads r JOIN messages m ON m.id = r.message_id WHERE m.family_id = ?', fid);
  const notes = q('SELECT * FROM notes WHERE family_id = ? ORDER BY id', fid).filter(n => inRange(utcToLocalStamp(Date.parse(n.created_at), tz)));
  const comp = h.compliance(c, from, to);
  const verify = verifyFamily(db, fid);
  const who = (id) => esc(h.nameOf(c, id));
  // Server receipt times, shown next to the times people entered when they differ.
  const savedLine = (label, createdIso) => `<div class="muted">${esc(label)} ${esc(iso(createdIso))} (server time)</div>`;
  const dateDiffers = (date, createdIso) => Number.isFinite(Date.parse(createdIso)) && utcToLocalDate(Date.parse(createdIso), tz) !== date;
  const gps = (x) => (x.lat != null && x.lng != null && Number.isFinite(x.lat) && Number.isFinite(x.lng)
    ? `<div class="muted">GPS ${x.lat.toFixed(5)}, ${x.lng.toFixed(5)}${x.accuracy != null && Number.isFinite(x.accuracy) ? ` (&plusmn;${Math.round(x.accuracy)} m)` : ''}</div>` : '');

  const section = (title, body) => `<section><h2>${esc(title)}</h2>${body}</section>`;
  const table = (cols, rows) => rows.length
    ? `<table><thead><tr>${cols.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(x => `<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : '<p class="muted">None in this period.</p>';

  const notesFor = (type, id) => notes.filter(n => n.target_type === type && n.target_id === String(id)).map(n => `<div class="note">Note by ${who(n.author)}, ${iso(n.created_at)}: ${esc(n.body)}</div>`).join('');

  const body = [
    section('Summary', `<p>Family: <b>${esc(c.family.name)}</b> &middot; Time zone: ${esc(tz)} &middot; Period: <b>${esc(from)}</b> to <b>${esc(addDays(to, -1))}</b></p>
      <p>Generated ${esc(t(Date.now()))} by ${esc(c.user.name)}. Times are local to the family time zone. The server records when each entry was saved, and that time cannot be changed.
      Times people enter themselves (for exchanges, calls, expenses and payments) are shown alongside the server time where they differ; an exchange saved more than
      ${ENTERED_LATE_MIN} minutes after the time entered is marked <b>entered later</b>.</p>`),
    section('Parenting time share (scheduled)', table(['Parent', 'Hours', '% of time', 'Overnights', '% of overnights'],
      share.byParent.map(p => [esc(p.name), p.hours.toFixed(1), `${p.pct}%`, p.overnights, `${p.nightPct}%`])) +
      '<p class="muted">Computed from the approved schedule rules below. "Overnight" = the parent with the children at 2:00 AM.</p>'),
    section('Schedule rules and change requests', table(['#', 'Type', 'Name', 'Requested', 'Status', 'Decision'],
      rules.map(r => [r.id, esc(r.type), esc(r.name) + (r.reason ? `<div class="muted">Reason: ${esc(r.reason)}</div>` : '') + notesFor('rule', r.id),
        `${who(r.requested_by)}<br>${iso(r.requested_at)}`, esc(STATUS_TEXT[r.status] || r.status) + (r.status === 'retired' && r.ended_at != null ? `<div class="muted">Applied until ${esc(t(r.ended_at))}</div>` : ''),
        r.decided_by ? `${who(r.decided_by)}<br>${iso(r.decided_at)}${r.decision_note ? `<div class="muted">"${esc(r.decision_note)}"</div>` : ''}` : ''])
    )),
    section('Exchanges (hand-off check-ins)', table(['When', 'Type', 'Logged by', 'Scheduled', 'Late (min)', 'Location', 'Details'],
      exchanges.map(x => {
        const late = h.enteredLate(x.at_ms, x.created_at);
        const when = t(x.at_ms) + (late != null ? `<div class="muted"><b>${late > 0 ? 'Entered later' : 'Time entered is after it was saved'}</b>: saved ${esc(iso(x.created_at))} (server time)</div>` : '');
        return [when, esc(x.kind), who(x.logged_by), x.scheduled_ms ? t(x.scheduled_ms) : '', x.scheduled_ms ? Math.round((x.at_ms - x.scheduled_ms) / 60000) : '',
          esc(x.location) + gps(x), esc(x.details) + notesFor('exchange', x.id)];
      }))),
    section('Phone / video contact', comp.map(r => `<h3>${esc(r.rule.name)} &mdash; for ${esc(r.rule.entitled)}</h3>
      <p>Allowed ${r.totals.allowed}, completed ${r.totals.completed}, missed (not facilitated) ${r.totals.missed_not_facilitated}, missed (not called) ${r.totals.missed_not_called}, short ${r.totals.short}, disputed ${r.totals.disputed}, outside window ${r.totals.outside_window}</p>`).join('') +
      table(['When', 'Status', 'Minutes', 'Method', 'Logged by', 'Other parent', 'Details'],
        calls.map(x => [esc(x.started_local.replace('T', ' ')) + savedLine('Logged', x.created_at), esc(x.status.replace(/_/g, ' ')), x.duration_min, esc(x.method), who(x.logged_by),
          x.confirm_result ? `${esc(x.confirm_result)} (${iso(x.confirmed_at)})` : 'No response', esc(x.details) + notesFor('call', x.id)]))),
    section('Expenses', table(['Date', 'Description', 'Paid by', 'Amount', 'Other parent share', 'Status', 'Receipt'],
      expenses.map(e => [esc(e.date) + (dateDiffers(e.date, e.created_at) ? savedLine('Entered', e.created_at) : ''), esc(e.description) + `<div class="muted">${esc(e.category)}</div>` + (e.decision_note ? `<div class="muted">Response: "${esc(e.decision_note)}"</div>` : '') + notesFor('expense', e.id),
        who(e.paid_by), money(e.amount_cents), `${e.other_share_pct}% = ${money(Math.round(e.amount_cents * e.other_share_pct / 100))}`, esc(e.status), e.receipt_hash ? `SHA-256 ${e.receipt_hash.slice(0, 16)}&hellip;` : 'None'])) +
      '<h3>Reimbursement payments</h3>' + table(['Date', 'From', 'To', 'Amount', 'Method', 'Status'],
        payments.map(p => [esc(p.date) + (dateDiffers(p.date, p.created_at) ? savedLine('Entered', p.created_at) : ''), who(p.from_user), who(p.to_user), money(p.amount_cents), esc(p.method), esc(p.status) + (p.confirmed_at ? ` ${iso(p.confirmed_at)}` : '')]))),
    section('Messages', threads.map(th => {
      const ms = messages.filter(m => m.thread_id === th.id);
      if (!ms.length) return '';
      return `<h3>${esc(th.subject)}</h3>` + ms.map(m => {
        const rd = reads.filter(r => r.message_id === m.id).map(r => `read by ${who(r.user_id)} ${iso(r.read_at)}`).join('; ');
        return `<div class="msg"><div class="meta">${who(m.author)} &middot; ${iso(m.created_at)} &middot; ${rd || 'unread'} &middot; #${m.id}</div><div class="body">${esc(m.body)}</div></div>`;
      }).join('');
    }).join('') || '<p class="muted">None in this period.</p>'),
    section('Journal and day notes', table(['When', 'By', 'About', 'Note'],
      notes.filter(n => ['day', 'general', 'event', 'payment', 'call_rule'].includes(n.target_type)).map(n => [iso(n.created_at), who(n.author), esc(n.target_type === 'day' ? `Day ${n.target_id}` : `${n.target_type} ${n.target_id}`), esc(n.body)]))),
    section('Record integrity', `<p>Audit log entries: <b>${verify.entries}</b>. Chain check: <b>${verify.ok ? 'PASSED' : 'FAILED'}</b>.</p>
      ${verify.problems.length ? `<ul>${verify.problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
      <p>Chain head hash: <code>${esc(verify.head)}</code></p>
      ${verify.records_not_content_checked ? `<p class="muted">${verify.records_not_content_checked} exchange or call entries were logged before content fingerprints were recorded and are covered by the chain only.</p>` : ''}
      <p class="muted">Every create, approval and change is appended to a SHA-256 hash chain. Messages, notes and exchange check-ins are append-only, call logs can only
      receive the other parent's answer, and the content of each is fingerprinted when saved and cross-checked here; changing any stored record breaks the chain. This shows records were not altered after the fact relative to the head hash above; it does not by itself
      make a record admissible. Admissibility is decided by the court under local rules of evidence. Consult your attorney.</p>`),
  ].join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Co-parenting record ${esc(from)} to ${esc(to)}</title>
<style>body{font:13px/1.45 Georgia,serif;color:#111;max-width:960px;margin:24px auto;padding:0 16px}h1{font-size:22px}h2{font-size:16px;border-bottom:1px solid #999;margin-top:28px}
h3{font-size:14px;margin:14px 0 4px}table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #bbb;padding:4px 6px;vertical-align:top;text-align:left}th{background:#eee}
.muted{color:#555;font-size:12px}.msg{border-left:3px solid #999;padding:4px 10px;margin:6px 0}.meta{color:#555;font-size:12px}.body{white-space:pre-wrap}.note{font-size:12px;color:#333;margin-top:4px;padding-left:6px;border-left:2px solid #ccc}
code{font-size:11px;word-break:break-all}@media print{body{margin:0}section{break-inside:auto}}</style></head>
<body><h1>Co-parenting record</h1>${body}</body></html>`;
}

