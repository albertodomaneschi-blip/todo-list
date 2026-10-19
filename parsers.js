// Parser per l'importazione dell'orario: ics, csv (anche da xlsx) e testo (PDF).
// Funzioni pure, senza accesso al DOM: restituiscono "bozze" di lezione da confermare.
(function (root) {
  'use strict';

  const TYPES = ['lezione', 'esercitazione', 'laboratorio', 'esame', 'ricevimento', 'altro'];
  const DAY_NAMES = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
  const DAY_KEYS = { lun: 0, mon: 0, mar: 1, tue: 1, mer: 2, wed: 2, gio: 3, thu: 3, ven: 4, fri: 4, sab: 5, sat: 5, dom: 6, sun: 6 };

  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const mkDate = s => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 12);
  const addDays = (s, n) => { const d = mkDate(s); d.setDate(d.getDate() + n); return ymd(d); };
  const weekdayOf = s => (mkDate(s).getDay() + 6) % 7;
  const strip = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  function classify(text) {
    const s = strip(text);
    if (/\b(esame|appello|prova (scritta|orale|intermedia)|verifica|compito|exam)\b/.test(s)) return { type: 'esame', sure: true };
    if (/esercitazion|\besercizi\b|tutorato/.test(s)) return { type: 'esercitazione', sure: true };
    if (/laborator|\blab\b/.test(s)) return { type: 'laboratorio', sure: true };
    if (/ricevimento|colloquio|office hours/.test(s)) return { type: 'ricevimento', sure: true };
    if (/\blezione\b|\blez\b|\bteoria\b|lecture/.test(s)) return { type: 'lezione', sure: true };
    return { type: 'lezione', sure: false };
  }

  function dayIndex(s) {
    const k = strip(s).slice(0, 3);
    return Object.prototype.hasOwnProperty.call(DAY_KEYS, k) ? DAY_KEYS[k] : undefined;
  }

  function parseTime(s) {
    const m = /(\d{1,2})\s*[:.hH]\s*(\d{2})/.exec(s || '');
    if (!m || +m[1] > 23 || +m[2] > 59) return null;
    return `${pad(+m[1])}:${m[2]}`;
  }

  const TIME = '\\d{1,2}\\s*[:.hH]\\s*\\d{2}';
  const RANGE = new RegExp(`(${TIME})\\s*(?:-|–|—|a|alle|to)\\s*(${TIME})`, 'i');
  function parseRange(s) {
    const m = RANGE.exec(s || '');
    if (!m) return null;
    const a = parseTime(m[1]), b = parseTime(m[2]);
    return a && b ? { start: a, end: b, index: m.index, length: m[0].length } : null;
  }

  function parseDateStr(s) {
    s = String(s || '').trim();
    let m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
    if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
    m = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
    if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
    return null;
  }

  function draft(o) {
    const c = classify(o.typeHint ? o.typeHint + ' ' + o.subject : o.subject + ' ' + (o.extra || ''));
    return {
      subject: (o.subject || '').trim() || '(senza nome)',
      teacher: (o.teacher || '').trim(), room: (o.room || '').trim(),
      type: c.type, sure: c.sure,
      start: o.start, end: o.end,
      repeat: !!o.repeat, weekday: o.weekday, date: o.date || '',
      from: o.from || '', to: o.to || '', ex: o.ex || []
    };
  }

  /* ---------- ICS ---------- */
  const unesc = s => String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

  function icsDate(val, params) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(val).trim());
    if (!m) return null;
    if (m[4] === undefined) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: null };
    let d;
    if (m[7]) d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
    else d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    return { date: ymd(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
  }

  function fromICS(text) {
    const lines = String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    const events = [];
    let cur = null;
    for (const line of lines) {
      if (/^BEGIN:VEVENT/i.test(line)) { cur = { EXDATE: [] }; continue; }
      if (/^END:VEVENT/i.test(line)) { if (cur) events.push(cur); cur = null; continue; }
      if (!cur) continue;
      const i = line.indexOf(':');
      if (i < 0) continue;
      const [name, ...params] = line.slice(0, i).split(';');
      const key = name.toUpperCase();
      const entry = { val: line.slice(i + 1), params };
      if (key === 'EXDATE') cur.EXDATE.push(entry); else cur[key] = entry;
    }
    const out = [];
    const rd = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
    for (const ev of events) {
      if (!ev.DTSTART) continue;
      const s = icsDate(ev.DTSTART.val, ev.DTSTART.params);
      if (!s) continue;
      const e = ev.DTEND ? icsDate(ev.DTEND.val, ev.DTEND.params) : null;
      const start = s.time || '00:00';
      let end = e && e.time ? e.time : (s.time ? `${pad(Math.min(23, +start.slice(0, 2) + 1))}:${start.slice(3)}` : '23:59');
      if (e && e.date !== s.date && (!e.time || e.time <= start)) end = '23:59';
      const desc = unesc(ev.DESCRIPTION && ev.DESCRIPTION.val);
      let teacher = '';
      const tm = /(?:docente|prof(?:essore|essoressa)?\.?|teacher|lecturer)\s*[:\-]?\s*([^\n]+)/i.exec(desc);
      if (tm) teacher = tm[1].trim();
      else if (ev.ORGANIZER) { const cn = ev.ORGANIZER.params.find(p => /^CN=/i.test(p)); if (cn) teacher = cn.slice(3).replace(/^"|"$/g, ''); }
      const base = {
        subject: unesc(ev.SUMMARY && ev.SUMMARY.val), teacher, room: unesc(ev.LOCATION && ev.LOCATION.val),
        extra: desc, start, end
      };
      const ex = ev.EXDATE.flatMap(x => x.val.split(',').map(v => (icsDate(v, x.params) || {}).date)).filter(Boolean);
      const rule = {};
      if (ev.RRULE) ev.RRULE.val.split(';').forEach(p => { const [k, v] = p.split('='); rule[k.toUpperCase()] = v; });
      const interval = +(rule.INTERVAL || 1);
      let until = null;
      if (rule.UNTIL) { const u = icsDate(rule.UNTIL); until = u && u.date; }
      if (!ev.RRULE) {
        out.push(draft({ ...base, date: s.date }));
      } else if (rule.FREQ === 'WEEKLY' && interval === 1) {
        const days = rule.BYDAY ? rule.BYDAY.split(',').map(d => rd.indexOf(d.replace(/[^A-Z]/g, ''))).filter(d => d >= 0) : [weekdayOf(s.date)];
        let to = until || '';
        if (!to && rule.COUNT) to = addDays(s.date, Math.ceil(+rule.COUNT / days.length) * 7 - 1);
        for (const wd of days) out.push(draft({ ...base, repeat: true, weekday: wd, from: s.date, to, ex }));
      } else {
        // altre ricorrenze: espansione in date singole (massimo 60)
        let d = mkDate(s.date), n = 0;
        const max = rule.COUNT ? +rule.COUNT : 60;
        while (n < Math.min(max, 60) && (!until || ymd(d) <= until)) {
          if (!ex.includes(ymd(d))) out.push(draft({ ...base, date: ymd(d) }));
          n++;
          if (rule.FREQ === 'DAILY') d.setDate(d.getDate() + interval);
          else if (rule.FREQ === 'WEEKLY') d.setDate(d.getDate() + 7 * interval);
          else if (rule.FREQ === 'MONTHLY') d.setMonth(d.getMonth() + interval);
          else if (rule.FREQ === 'YEARLY') d.setFullYear(d.getFullYear() + interval);
          else break;
        }
      }
    }
    return out;
  }

  /* ---------- CSV (usato anche per xlsx) ---------- */
  function csvRows(text) {
    text = String(text).replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const delim = [';', '\t', ','].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(x => x.trim())) rows.push(row);
        row = [];
      } else cell += c;
    }
    row.push(cell);
    if (row.some(x => x.trim())) rows.push(row);
    return rows;
  }

  function fromCSV(text) {
    const rows = csvRows(text);
    if (rows.length < 2) throw new Error('Il file è vuoto o senza righe di dati.');
    const head = rows[0].map(strip);
    const find = re => head.findIndex(h => re.test(h));
    const col = {
      subject: find(/materia|corso|insegnamento|subject|course|titolo|attivita|nome/),
      teacher: find(/docente|prof|teacher|lecturer/),
      room: find(/aula|luogo|room|location|link|sede/),
      day: find(/^(giorno|day)/),
      from: find(/^(dal|valido dal|from|data inizio|inizio periodo)$/),
      to: find(/^(al|valido al|until|data fine|fine periodo)$/),
      date: find(/^(data|date)/),
      range: find(/^(orario|ora|time|fascia)$/),
      start: find(/ora.*inizio|inizio.*ora|^inizio$|^start|^dalle|^da$/),
      end: find(/ora.*fine|fine.*ora|^fine$|^end|^alle|^a$/),
      type: find(/tipo|type/)
    };
    if (col.subject < 0) throw new Error('Colonne non riconosciute: serve almeno una colonna "Materia".');
    const out = [];
    for (const r of rows.slice(1)) {
      const g = k => (col[k] >= 0 ? (r[col[k]] || '').trim() : '');
      const rng = parseRange(g('range')) || { start: parseTime(g('start')), end: parseTime(g('end')) };
      if (!rng.start || !rng.end) continue;
      const wd = col.day >= 0 ? dayIndex(g('day')) : undefined;
      const date = parseDateStr(g('date'));
      if (wd === undefined && !date) continue;
      const repeat = wd !== undefined && !date;
      out.push(draft({
        subject: g('subject'), teacher: g('teacher'), room: g('room'),
        typeHint: g('type'), start: rng.start, end: rng.end,
        repeat, weekday: repeat ? wd : undefined, date: repeat ? '' : date,
        from: repeat ? parseDateStr(g('from')) : '', to: repeat ? parseDateStr(g('to')) : ''
      }));
    }
    return out;
  }

  /* ---------- Testo libero (PDF) ---------- */
  const DAY_RE = /^(lun(?:ed[ìi])?|mar(?:ted[ìi])?|mer(?:coled[ìi])?|gio(?:ved[ìi])?|ven(?:erd[ìi])?|sab(?:ato)?|dom(?:enica)?)(?![A-Za-zÀ-ÿ])\.?\s*(.*)$/i;

  function fromText(text) {
    const out = [];
    let day;
    for (const raw of String(text).split(/\r?\n/)) {
      let line = raw.replace(/\s+/g, ' ').trim();
      if (!line) continue;
      const dm = DAY_RE.exec(line);
      if (dm) { day = dayIndex(dm[1]); line = dm[2]; }
      const r = parseRange(line);
      if (!r || day === undefined) continue;
      let rest = (line.slice(0, r.index) + ' ' + line.slice(r.index + r.length)).trim();
      let room = '', teacher = '';
      let m = /https?:\/\/\S+/.exec(rest) || /\b(?:aula|room|lab(?:oratorio)?\.?)\s*[A-Za-z]?\d+[A-Za-z]?\b/i.exec(rest) || /\baula\s+\w+/i.exec(rest);
      if (m) { room = m[0]; rest = rest.replace(m[0], ' '); }
      m = /\b(?:[Pp]rof(?:\.|essor[ea]?)?|[Dd]ott(?:\.|ore|oressa)?|[Dd]ocente:?)\s+([A-ZÀ-Ý][\wÀ-ÿ'’.]+(?:\s+[A-ZÀ-Ý][\wÀ-ÿ'’.]+)?)/.exec(rest);
      if (m) { teacher = m[1]; rest = rest.replace(m[0], ' '); }
      rest = rest.replace(/^[\s|\-–,;:]+|[\s|\-–,;:]+$/g, '').replace(/\s+/g, ' ');
      out.push(draft({ subject: rest, teacher, room, start: r.start, end: r.end, repeat: true, weekday: day }));
    }
    return out;
  }

  const api = { TYPES, DAY_NAMES, classify, dayIndex, parseTime, parseRange, parseDateStr, fromICS, fromCSV, fromText, csvRows };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Parsers = api;
})(typeof window !== 'undefined' ? window : globalThis);
