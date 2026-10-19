(() => {
  'use strict';
  const P = window.Parsers;
  const TYPES = P.TYPES;
  const DAY_NAMES = P.DAY_NAMES;
  const DAY_SHORT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  const PALETTE = ['#4f46e5', '#d93a40', '#15803d', '#b45309', '#0e7490', '#a21caf', '#4d7c0f', '#c2410c', '#0f766e', '#6d28d9'];
  const KEYS = { todos: 'todo-list-v1', sched: 'orario-v1', settings: 'impostazioni-v1', seed: 'todo-seed-1' };

  /* ---------- Utilità ---------- */
  const $ = (s, el = document) => el.querySelector(s);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = s => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 12);
  const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const wdOf = s => (parseYmd(s).getDay() + 6) % 7;
  const mondayOf = s => addDays(s, -wdOf(s));
  const today = () => ymd(new Date());
  const minutes = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
  const fmtDay = s => parseYmd(s).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtShort = s => parseYmd(s).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    let value;
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'value') value = v;
      else if (k === 'checked' || k === 'hidden' || k === 'disabled' || k === 'selected') el[k] = !!v;
      else if (k.startsWith('on')) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    const add = k => {
      if (Array.isArray(k)) k.forEach(add);
      else if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    };
    kids.forEach(add);
    if (value !== undefined) el.value = value;
    return el;
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  /* ---------- Dati ---------- */
  const load = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch (e) { return def; } };
  const persist = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  let todos = load(KEYS.todos, []);
  let sched = load(KEYS.sched, { lessons: [], subjects: {} });
  let settings = Object.assign({ remind: false, lead: 15 }, load(KEYS.settings, {}));
  const saveTodos = () => persist(KEYS.todos, todos);
  const saveSched = () => persist(KEYS.sched, sched);
  const saveSettings = () => persist(KEYS.settings, settings);

  // Impegni iniziali: aggiunti una sola volta per browser
  const SEED = [
    'inserire app diritto (elettorato passivo)', 'come funziona code',
    'esercizi lezione 4 (fx, operazioni di fx, curve di livello)', 'stampare appunti',
    'comprare spf tret azelaic, guardare video e chiedere ad AI', 'tessera studente',
    'mate: stampa esercitazione 1-2', 'sistemare app stampati', 'informarsi per i libri', 'cfp zanardelli pcto'
  ];
  try {
    if (!localStorage.getItem(KEYS.seed)) {
      todos = SEED.map((text, i) => ({ id: Date.now() + i, text, done: false })).concat(todos);
      localStorage.setItem(KEYS.seed, '1');
      saveTodos();
    }
  } catch (e) {}

  function colorOf(name) {
    if (!sched.subjects[name]) {
      sched.subjects[name] = PALETTE[Object.keys(sched.subjects).length % PALETTE.length];
      saveSched();
    }
    return sched.subjects[name];
  }

  const onDate = (l, ds) => (l.ex || []).indexOf(ds) < 0 && (l.repeat
    ? wdOf(ds) === l.weekday && (!l.from || ds >= l.from) && (!l.to || ds <= l.to)
    : l.date === ds);
  const fascia = t => (t < '13:00' ? 'mattina' : 'pomeriggio');
  const ui = { tab: 'tasks', mode: 'day', cursor: today(), filter: 'all', types: new Set(), fascia: '' };
  const passes = l => (!ui.types.size || ui.types.has(l.type)) && (!ui.fascia || ui.fascia === fascia(l.start));
  const lessonsOn = (ds, filtered = true) => sched.lessons
    .filter(l => onDate(l, ds) && (!filtered || passes(l)))
    .sort((a, b) => a.start.localeCompare(b.start));
  const tasksOn = ds => todos.filter(t => t.due === ds);

  function nextDate(l) {
    if (!l.repeat) return l.date;
    const t = today();
    for (let i = 0; i < 400; i++) { const d = addDays(t, i); if (onDate(l, d)) return d; }
    return l.to || t;
  }

  /* ---------- Finestra (bottom sheet) ---------- */
  const sheet = $('#sheet');
  const openSheet = (...kids) => { sheet.replaceChildren(...kids.flat(Infinity).filter(Boolean)); if (!sheet.open) sheet.showModal(); };
  const closeSheet = () => { if (sheet.open) sheet.close(); };
  sheet.addEventListener('click', e => {
    const r = sheet.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeSheet();
  });
  const subjectList = h('datalist', { id: 'subjects' });
  document.body.append(subjectList);

  /* ---------- Componenti ---------- */
  function subjectSelect(value) {
    return h('select', { value: value || '' },
      h('option', { value: '' }, '— nessuna materia —'),
      Object.keys(sched.subjects).sort().map(s => h('option', { value: s }, s)));
  }

  function todoItem(t) {
    const meta = [];
    if (t.due) meta.push(fmtShort(t.due) + (t.time ? ' ' + t.time : ''));
    return h('li', { class: 'todo' + (t.done ? ' done' : '') },
      h('input', { type: 'checkbox', checked: t.done, 'aria-label': 'Completa', onchange: e => { t.done = e.target.checked; saveTodos(); render(); } }),
      h('button', { class: 'body', onclick: () => editTask(t) },
        h('div', { class: 'txt' }, t.text),
        (meta.length || t.subject) ? h('div', { class: 'meta' },
          t.subject ? [h('span', { class: 'dot', style: `background:${colorOf(t.subject)}` }), t.subject + (meta.length ? ' · ' : '')] : null,
          meta.join(' · ')) : null),
      h('button', { class: 'icon-btn', 'aria-label': 'Elimina', onclick: () => { todos = todos.filter(x => x !== t); saveTodos(); render(); } }, '×'));
  }

  function lessonCard(l, ds) {
    return h('button', { class: 'lesson', onclick: () => openLesson(l, ds) },
      h('span', { class: 'bar', style: `background:${colorOf(l.subject)}` }),
      h('span', { class: 'grow' },
        h('div', { class: 't' }, l.subject),
        h('div', { class: 'time' }, `${l.start}–${l.end}` + (l.room ? ' · ' + l.room : '')),
        h('div', null, h('span', { class: 'tag' }, cap(l.type)), l.note ? h('span', { class: 'tag warn' }, l.note) : null, l.teacher ? h('span', { class: 'muted' }, l.teacher) : null)));
  }

  function filterChips() {
    const chip = (label, on, fn) => h('button', { class: 'chip', 'aria-pressed': on ? 'true' : 'false', onclick: fn }, label);
    return h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtri' },
      chip('Tutti i tipi', !ui.types.size, () => { ui.types.clear(); render(); }),
      TYPES.map(t => chip(cap(t), ui.types.has(t), () => { ui.types.has(t) ? ui.types.delete(t) : ui.types.add(t); render(); })),
      chip('Mattina', ui.fascia === 'mattina', () => { ui.fascia = ui.fascia === 'mattina' ? '' : 'mattina'; render(); }),
      chip('Pomeriggio', ui.fascia === 'pomeriggio', () => { ui.fascia = ui.fascia === 'pomeriggio' ? '' : 'pomeriggio'; render(); }));
  }

  /* ---------- Attività ---------- */
  function viewTasks() {
    const t0 = today();
    const todayLessons = lessonsOn(t0, false), todayTasks = tasksOn(t0);
    const oggi = h('div', { class: 'card' },
      h('strong', null, 'Oggi'),
      (todayLessons.length || todayTasks.length) ? h('ul', { class: 'list', style: 'margin-top:8px' },
        todayLessons.map(l => h('li', null, lessonCard(l, t0))),
        todayTasks.map(todoItem))
        : h('div', { class: 'muted', style: 'margin-top:4px' }, 'Niente in programma oggi.'));

    const input = h('input', { type: 'text', placeholder: 'Nuova attività…', maxlength: 200, autocomplete: 'off', 'aria-label': 'Nuova attività' });
    const due = h('input', { type: 'date', 'aria-label': 'Data' });
    const time = h('input', { type: 'time', 'aria-label': 'Ora' });
    const subj = subjectSelect('');
    subj.setAttribute('aria-label', 'Materia');
    const extras = h('div', { class: 'extras stack', hidden: true }, h('div', { class: 'grid2' }, due, time), subj);
    const form = h('form', {
      onsubmit: e => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        const t = { id: Date.now() + Math.random(), text, done: false };
        if (due.value) t.due = due.value;
        if (time.value) t.time = time.value;
        if (subj.value) t.subject = subj.value;
        todos.unshift(t); saveTodos(); render();
      }
    },
      h('div', { class: 'addbar' }, input, h('button', { class: 'btn', type: 'submit' }, 'Aggiungi')),
      h('button', { class: 'chip', type: 'button', style: 'margin-top:8px', onclick: () => { extras.hidden = !extras.hidden; } }, '+ data, ora, materia'),
      extras);

    const shown = todos.filter(t => ui.filter === 'all' || (ui.filter === 'done') === t.done);
    const left = todos.filter(t => !t.done).length;
    return [
      h('h1', null, 'Le mie attività'),
      h('p', { class: 'sub' }, fmtDay(t0)),
      oggi, h('div', { style: 'height:14px' }), form,
      h('div', { class: 'chips', style: 'margin-top:12px' },
        [['all', 'Tutte'], ['active', 'Da fare'], ['done', 'Completate']].map(([k, label]) =>
          h('button', { class: 'chip', 'aria-pressed': ui.filter === k ? 'true' : 'false', onclick: () => { ui.filter = k; render(); } }, label))),
      shown.length ? h('ul', { class: 'list' }, shown.map(todoItem))
        : h('div', { class: 'empty' }, todos.length ? 'Nessuna attività in questa vista.' : 'Nessuna attività. Aggiungine una!'),
      h('div', { class: 'row', style: 'align-items:center;margin-top:12px' },
        h('span', { class: 'muted' }, left === 1 ? '1 da fare' : left + ' da fare'),
        todos.some(t => t.done) ? h('button', { class: 'btn sec small', style: 'flex:none', onclick: () => { todos = todos.filter(t => !t.done); saveTodos(); render(); } }, 'Elimina completate') : null)
    ];
  }

  function editTask(t) {
    const text = h('input', { type: 'text', value: t.text, maxlength: 200 });
    const due = h('input', { type: 'date', value: t.due || '' });
    const time = h('input', { type: 'time', value: t.time || '' });
    const subj = subjectSelect(t.subject);
    openSheet(
      h('h3', { id: 'sheetTitle' }, 'Modifica attività'),
      h('label', null, 'Testo'), text,
      h('div', { class: 'grid2' }, h('div', null, h('label', null, 'Data'), due), h('div', null, h('label', null, 'Ora'), time)),
      h('label', null, 'Materia'), subj,
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => {
          if (!text.value.trim()) return;
          t.text = text.value.trim();
          if (due.value) t.due = due.value; else delete t.due;
          if (time.value) t.time = time.value; else delete t.time;
          if (subj.value) t.subject = subj.value; else delete t.subject;
          saveTodos(); closeSheet(); render();
        } }, 'Salva'),
        h('button', { class: 'btn sec', onclick: closeSheet }, 'Annulla')));
  }

  /* ---------- Dettaglio lezione ---------- */
  function openLesson(l, ds) {
    const typeSel = h('select', { value: l.type, 'aria-label': 'Tipo' }, TYPES.map(t => h('option', { value: t }, cap(t))));
    typeSel.onchange = () => { l.type = typeSel.value; saveSched(); render(); };
    const color = h('input', { type: 'color', value: colorOf(l.subject), 'aria-label': 'Colore materia' });
    color.oninput = () => { sched.subjects[l.subject] = color.value; saveSched(); render(); };
    const linked = todos.filter(t => t.lessonId === l.id);
    const newTask = h('input', { type: 'text', placeholder: 'Nuova attività collegata…', maxlength: 200 });
    const period = l.repeat
      ? `Ogni ${DAY_NAMES[l.weekday].toLowerCase()}` + (l.from || l.to ? ` · dal ${l.from ? fmtShort(l.from) : '…'} al ${l.to ? fmtShort(l.to) : '…'}` : '')
      : 'Evento singolo';
    const isUrl = /^https?:\/\//i.test(l.room);
    openSheet(
      h('h3', { id: 'sheetTitle' }, h('span', { class: 'dot', style: `background:${colorOf(l.subject)}` }), l.subject),
      h('p', { class: 'muted', style: 'margin:0 0 4px' }, `${cap(fmtDay(ds))} · ${l.start}–${l.end} · ${cap(fascia(l.start))}`),
      h('p', { class: 'muted', style: 'margin:0 0 4px' }, period),
      l.teacher ? h('p', { style: 'margin:0 0 4px' }, 'Docente: ' + l.teacher) : null,
      l.room ? h('p', { style: 'margin:0 0 4px' }, 'Aula: ', isUrl ? h('a', { href: l.room, target: '_blank', rel: 'noopener' }, l.room) : l.room) : null,
      h('div', { class: 'grid2' }, h('div', null, h('label', null, 'Tipo'), typeSel), h('div', null, h('label', null, 'Colore'), color)),
      h('h2', null, 'Attività collegate'),
      linked.length ? h('ul', { class: 'list' }, linked.map(todoItem)) : h('div', { class: 'muted' }, 'Nessuna.'),
      h('div', { class: 'addbar', style: 'margin-top:8px' }, newTask,
        h('button', { class: 'btn', onclick: () => {
          const text = newTask.value.trim();
          if (!text) return;
          todos.unshift({ id: Date.now() + Math.random(), text, done: false, due: ds, subject: l.subject, lessonId: l.id });
          saveTodos(); render(); openLesson(l, ds);
        } }, 'Aggiungi')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn sec', onclick: () => lessonForm(l) }, 'Modifica'),
        l.repeat ? h('button', { class: 'btn danger', onclick: () => {
          (l.ex = l.ex || []).push(ds); saveSched(); closeSheet(); render(); toast('Rimossa solo la lezione del giorno.');
        } }, 'Elimina questo giorno') : null,
        h('button', { class: 'btn danger', onclick: () => {
          if (!confirm(l.repeat ? 'Eliminare tutta la serie di lezioni?' : 'Eliminare questa lezione?')) return;
          sched.lessons = sched.lessons.filter(x => x !== l); saveSched(); closeSheet(); render();
        } }, l.repeat ? 'Elimina serie' : 'Elimina'),
        h('button', { class: 'btn sec', onclick: closeSheet }, 'Chiudi')));
  }

  /* ---------- Editor lezione (manuale e anteprima) ---------- */
  function lessonEditor(d, full) {
    const f = {
      subject: h('input', { type: 'text', value: d.subject || '', list: 'subjects', placeholder: 'Materia', 'aria-label': 'Materia', maxlength: 80 }),
      teacher: h('input', { type: 'text', value: d.teacher || '', placeholder: 'Docente', 'aria-label': 'Docente' }),
      room: h('input', { type: 'text', value: d.room || '', placeholder: 'Aula o link', 'aria-label': 'Aula o link' }),
      type: h('select', { value: d.type || 'lezione', 'aria-label': 'Tipo' }, TYPES.map(t => h('option', { value: t }, cap(t)))),
      repeat: h('input', { type: 'checkbox', checked: d.repeat !== false && (d.repeat || !d.date) }),
      weekday: h('select', { value: String(d.weekday ?? 0), 'aria-label': 'Giorno' }, DAY_NAMES.map((n, i) => h('option', { value: String(i) }, n))),
      date: h('input', { type: 'date', value: d.date || '', 'aria-label': 'Data' }),
      start: h('input', { type: 'time', value: d.start || '09:00', 'aria-label': 'Inizio' }),
      end: h('input', { type: 'time', value: d.end || '11:00', 'aria-label': 'Fine' }),
      from: h('input', { type: 'date', value: d.from || '', 'aria-label': 'Valido dal' }),
      to: h('input', { type: 'date', value: d.to || '', 'aria-label': 'Valido al' })
    };
    const warn = h('span', { class: 'tag warn', hidden: d.sure !== false || d.confirmed }, 'Tipo da confermare');
    f.type.onchange = () => { warn.hidden = true; };
    const rep = h('div', null, h('label', null, 'Giorno'), f.weekday);
    const one = h('div', null, h('label', null, 'Data'), f.date);
    const period = h('div', { class: 'grid2' }, h('div', null, h('label', null, 'Valido dal'), f.from), h('div', null, h('label', null, 'Valido al'), f.to));
    const sync = () => { rep.hidden = !f.repeat.checked; one.hidden = f.repeat.checked; period.hidden = !full || !f.repeat.checked; };
    f.repeat.onchange = sync; sync();
    const el = h('div', null,
      f.subject, h('div', { style: 'margin-top:8px' }, f.type, h('div', { style: 'margin-top:6px' }, warn)),
      h('label', { class: 'inline' }, f.repeat, 'Ripeti ogni settimana'),
      rep, one,
      h('div', { class: 'grid2' }, h('div', null, h('label', null, 'Inizio'), f.start), h('div', null, h('label', null, 'Fine'), f.end)),
      f.room, full ? [h('div', { style: 'height:8px' }), f.teacher] : null, full ? period : null);
    return {
      el,
      get() {
        return Object.assign({}, d, {
          subject: f.subject.value.trim(), teacher: f.teacher.value.trim(), room: f.room.value.trim(),
          type: f.type.value, repeat: f.repeat.checked, weekday: +f.weekday.value,
          date: f.repeat.checked ? '' : f.date.value, start: f.start.value, end: f.end.value,
          from: f.repeat.checked ? f.from.value : '', to: f.repeat.checked ? f.to.value : ''
        });
      },
      validate() {
        const v = this.get();
        if (!v.subject) return 'Inserisci la materia.';
        if (!v.start || !v.end || v.start >= v.end) return 'L\u2019ora di fine deve essere dopo l\u2019inizio.';
        if (!v.repeat && !v.date) return 'Scegli la data.';
        return '';
      }
    };
  }

  const cleanLesson = (v, id) => ({
    id: id || uid(), subject: v.subject, teacher: v.teacher || '', room: v.room || '', type: TYPES.includes(v.type) ? v.type : 'lezione',
    start: v.start, end: v.end, repeat: !!v.repeat, weekday: v.repeat ? +v.weekday : undefined, date: v.repeat ? '' : v.date,
    from: v.from || '', to: v.to || '', ex: v.ex || [], note: v.note || ''
  });

  function lessonForm(l) {
    const ed = lessonEditor(l || { repeat: true, weekday: wdOf(ui.cursor), date: ui.cursor }, true);
    const err = h('p', { class: 'err' });
    openSheet(
      h('h3', { id: 'sheetTitle' }, l ? 'Modifica lezione' : 'Nuova lezione'), ed.el, err,
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => {
          const m = ed.validate();
          if (m) { err.textContent = m; return; }
          const v = ed.get();
          if (l) Object.assign(l, cleanLesson(v, l.id)); else sched.lessons.push(cleanLesson(v));
          colorOf(v.subject); saveSched(); closeSheet(); render();
        } }, 'Salva'),
        h('button', { class: 'btn sec', onclick: closeSheet }, 'Annulla')));
  }

  /* ---------- Importazione ---------- */
  const loaded = {};
  function loadScript(src) {
    return loaded[src] || (loaded[src] = new Promise((res, rej) => {
      const s = h('script', { src });
      s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error('Impossibile caricare ' + src)); };
      document.head.append(s);
    }));
  }

  async function pdfText(file) {
    await loadScript('vendor/pdf.min.js');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const items = (await (await pdf.getPage(p)).getTextContent()).items.filter(i => i.str.trim());
      const lines = new Map();
      for (const i of items) {
        const y = Math.round(i.transform[5] / 3);
        if (!lines.has(y)) lines.set(y, []);
        lines.get(y).push(i);
      }
      [...lines.entries()].sort((a, b) => b[0] - a[0]).forEach(([, row]) => {
        text += row.sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join(' ') + '\n';
      });
    }
    return text;
  }

  async function handleFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    try {
      let drafts;
      if (ext === 'ics') drafts = P.fromICS(await file.text());
      else if (ext === 'csv' || ext === 'txt') drafts = ext === 'txt' ? P.fromText(await file.text()) : P.fromCSV(await file.text());
      else if (ext === 'xlsx' || ext === 'xls') {
        await loadScript('vendor/xlsx.mini.min.js');
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
        drafts = P.fromCSV(XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { FS: ';', dateNF: 'yyyy-mm-dd' }));
      } else if (ext === 'pdf') drafts = P.fromText(await pdfText(file));
      else if (file.type.startsWith('image/')) { toast('Le immagini non sono ancora supportate: usa PDF, .ics, .csv o l\u2019inserimento manuale.'); return; }
      else { toast('Formato non supportato: usa .ics, .csv, .xlsx o PDF.'); return; }
      if (!drafts.length) { toast('Nessuna lezione riconosciuta nel file.'); return; }
      importPreview(drafts, file.name);
    } catch (e) { toast('Errore: ' + e.message); }
  }

  function importPreview(drafts, name) {
    const rows = drafts.map(d => {
      const ed = lessonEditor(d, false);
      const on = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Importa questa lezione' });
      const wrap = h('div', { class: 'preview-row' }, h('label', { class: 'inline', style: 'margin:0' }, on, 'Importa'), ed.el);
      on.onchange = () => wrap.classList.toggle('off', !on.checked);
      return { on, ed, wrap };
    });
    const replace = h('input', { type: 'checkbox' });
    const from = h('input', { type: 'date' }), to = h('input', { type: 'date' });
    const err = h('p', { class: 'err' });
    const btn = h('button', { class: 'btn' }, '');
    const count = () => rows.filter(r => r.on.checked).length;
    const upd = () => { btn.textContent = `Importa ${count()} lezioni`; };
    rows.forEach(r => r.on.addEventListener('change', upd)); upd();
    btn.onclick = () => {
      const chosen = rows.filter(r => r.on.checked);
      for (const r of chosen) { const m = r.ed.validate(); if (m) { err.textContent = m + ' (controlla le righe)'; return; } }
      if (replace.checked) sched.lessons = [];
      for (const r of chosen) {
        const v = r.ed.get();
        if (v.repeat) { if (!v.from && from.value) v.from = from.value; if (!v.to && to.value) v.to = to.value; }
        colorOf(v.subject);
        sched.lessons.push(cleanLesson(v));
      }
      saveSched(); closeSheet(); ui.tab = 'orario'; render(); toast(`Importate ${chosen.length} lezioni.`);
    };
    openSheet(
      h('h3', { id: 'sheetTitle' }, 'Controlla le lezioni'),
      h('p', { class: 'muted', style: 'margin:0' }, `${name}: trovate ${drafts.length} lezioni. Correggi i dati e conferma i tipi segnalati.`),
      h('div', { class: 'grid2' }, h('div', null, h('label', null, 'Periodo dal (opzionale)'), from), h('div', null, h('label', null, 'al'), to)),
      h('label', { class: 'inline' }, replace, 'Sostituisci l\u2019orario attuale'),
      rows.map(r => r.wrap), err,
      h('div', { class: 'actions' }, btn, h('button', { class: 'btn sec', onclick: closeSheet }, 'Annulla')));
  }

  function filePicker(accept, onfile, label, cls) {
    const input = h('input', { type: 'file', accept, hidden: true, onchange: () => { const f = input.files[0]; input.value = ''; if (f) onfile(f); } });
    return [input, h('button', { class: cls || 'btn', onclick: () => input.click() }, label)];
  }

  /* ---------- Orario ---------- */
  function viewOrario() {
    const list = sched.lessons.filter(passes);
    const groups = DAY_NAMES.map((n, i) => ({ title: n, items: list.filter(l => l.repeat && l.weekday === i).sort((a, b) => a.start.localeCompare(b.start)) }));
    const single = list.filter(l => !l.repeat).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    return [
      h('h1', null, 'Orario'),
      h('p', { class: 'sub' }, sched.lessons.length === 1 ? '1 lezione' : sched.lessons.length + ' lezioni'),
      h('div', { class: 'row' },
        filePicker('.ics,.csv,.txt,.xlsx,.xls,.pdf,image/*', handleFile, 'Importa file'),
        h('button', { class: 'btn sec', onclick: () => lessonForm(null) }, '+ Lezione')),
      h('div', { style: 'height:12px' }),
      filterChips(),
      !sched.lessons.length ? h('div', { class: 'empty' }, 'Nessuna lezione. Importa un file .ics, .csv, .xlsx o PDF, oppure aggiungine una a mano.') : null,
      groups.filter(g => g.items.length).map(g => [h('div', { class: 'fascia' }, g.title), h('ul', { class: 'list' }, g.items.map(l => h('li', null, lessonCard(l, nextDate(l)))))]),
      single.length ? [h('div', { class: 'fascia' }, 'Date singole'), h('ul', { class: 'list' }, single.map(l => h('li', null,
        h('div', { class: 'muted', style: 'margin:0 0 2px 2px' }, cap(fmtDay(l.date))), lessonCard(l, l.date))))] : null
    ];
  }

  /* ---------- Calendario ---------- */
  function step(dir) {
    if (ui.mode === 'month') {
      const d = parseYmd(ui.cursor), day = d.getDate();
      const n = new Date(d.getFullYear(), d.getMonth() + dir, 1, 12);
      n.setDate(Math.min(day, new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate()));
      ui.cursor = ymd(n);
    } else ui.cursor = addDays(ui.cursor, dir * (ui.mode === 'week' ? 7 : 1));
    render();
  }

  function calTitle() {
    if (ui.mode === 'day') return fmtDay(ui.cursor);
    if (ui.mode === 'week') { const m = mondayOf(ui.cursor); return `${fmtShort(m)} – ${fmtShort(addDays(m, 6))}`; }
    return parseYmd(ui.cursor).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  }

  function dayBody() {
    const ds = ui.cursor;
    const untimed = tasksOn(ds).filter(t => !t.time);
    const entries = [
      ...lessonsOn(ds).map(l => ({ time: l.start, el: h('li', null, lessonCard(l, ds)) })),
      ...tasksOn(ds).filter(t => t.time && (!ui.fascia || fascia(t.time) === ui.fascia)).map(t => ({ time: t.time, el: todoItem(t) }))
    ].sort((a, b) => a.time.localeCompare(b.time));
    const sec = (title, f) => {
      const items = entries.filter(e => fascia(e.time) === f);
      return items.length ? [h('div', { class: 'fascia' }, title), h('ul', { class: 'list' }, items.map(e => e.el))] : null;
    };
    const nothing = !untimed.length && !entries.length;
    return [
      untimed.length ? [h('div', { class: 'fascia' }, 'Scadenze del giorno'), h('ul', { class: 'list' }, untimed.map(todoItem))] : null,
      sec('Mattina', 'mattina'), sec('Pomeriggio', 'pomeriggio'),
      nothing ? h('div', { class: 'empty' }, 'Nessuna lezione o attività.') : null
    ];
  }

  function weekBody() {
    const mon = mondayOf(ui.cursor), days = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(mon, i));
    let h0 = 8, h1 = 18;
    days.forEach(d => lessonsOn(d).forEach(l => { h0 = Math.min(h0, +l.start.slice(0, 2)); h1 = Math.max(h1, Math.ceil(minutes(l.end) / 60)); }));
    const RH = 46, H = (h1 - h0) * RH, t0 = today();
    const grid = h('div', { class: 'week' }, h('div'));
    days.forEach((d, i) => {
      const n = tasksOn(d).filter(t => !t.done).length;
      grid.append(h('button', { class: 'hd' + (d === t0 ? ' today' : ''), 'aria-label': fmtDay(d), onclick: () => { ui.cursor = d; ui.mode = 'day'; render(); } },
        DAY_SHORT[i], h('small', null, d.slice(8)), n ? h('small', null, '✓' + n) : null));
    });
    const hours = h('div', { class: 'hours', style: `height:${H}px` });
    for (let x = h0; x <= h1; x++) hours.append(h('span', { style: `top:${(x - h0) * RH}px` }, String(x)));
    grid.append(hours);
    days.forEach(d => {
      const col = h('div', { class: 'col', style: `height:${H}px;background-image:repeating-linear-gradient(to bottom,var(--border) 0,var(--border) 1px,transparent 1px,transparent ${RH}px)` });
      lessonsOn(d).forEach(l => {
        const top = (minutes(l.start) - h0 * 60) / 60 * RH, ht = Math.max(18, (minutes(l.end) - minutes(l.start)) / 60 * RH - 1);
        col.append(h('button', { class: 'blk' + (l.note ? ' mod' : ''), style: `top:${top}px;height:${ht}px;background:${colorOf(l.subject)}`, 'aria-label': `${l.subject} ${l.start}`, onclick: () => openLesson(l, d) }, l.subject));
      });
      grid.append(col);
    });
    return grid;
  }

  function monthBody() {
    const c = parseYmd(ui.cursor), first = new Date(c.getFullYear(), c.getMonth(), 1, 12);
    const total = new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate();
    const weeks = Math.ceil(((first.getDay() + 6) % 7 + total) / 7), start = mondayOf(ymd(first)), t0 = today();
    const grid = h('div', { class: 'month' }, DAY_SHORT.map(n => h('div', { class: 'wd' }, n[0])));
    for (let i = 0; i < weeks * 7; i++) {
      const d = addDays(start, i), ls = lessonsOn(d), ts = tasksOn(d).filter(t => !t.done);
      const subs = [...new Set(ls.map(l => l.subject))].slice(0, 5);
      grid.append(h('button', {
        class: 'cell' + (d.slice(0, 7) !== ymd(first).slice(0, 7) ? ' out' : '') + (d === t0 ? ' today' : ''),
        'aria-label': fmtDay(d), onclick: () => { ui.cursor = d; ui.mode = 'day'; render(); }
      }, String(+d.slice(8)), h('span', { class: 'dots' }, subs.map(s => h('i', { style: `background:${colorOf(s)}` })), ts.length ? h('i', { class: 'task' }) : null)));
    }
    return grid;
  }

  function viewCal() {
    const body = h('div', { class: 'calbody' }, ui.mode === 'day' ? dayBody() : ui.mode === 'week' ? weekBody() : monthBody());
    let sx = 0, sy = 0;
    body.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    body.addEventListener('touchend', e => {
      const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dy) < 45) step(dx < 0 ? 1 : -1);
    });
    return [
      h('h1', null, 'Calendario'),
      h('div', { class: 'calbar', style: 'margin-top:8px' },
        h('button', { class: 'btn sec small', 'aria-label': 'Precedente', onclick: () => step(-1) }, '‹'),
        h('div', { class: 'title', role: 'heading', 'aria-level': '2' }, calTitle()),
        h('button', { class: 'btn sec small', 'aria-label': 'Successivo', onclick: () => step(1) }, '›'),
        h('button', { class: 'btn small', onclick: () => { ui.cursor = today(); render(); } }, 'Oggi')),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Vista' },
        [['day', 'Giorno'], ['week', 'Settimana'], ['month', 'Mese']].map(([k, label]) =>
          h('button', { 'aria-pressed': ui.mode === k ? 'true' : 'false', onclick: () => { ui.mode = k; render(); } }, label))),
      filterChips(), body
    ];
  }

  /* ---------- Backup e sincronizzazione ---------- */
  const bundle = () => ({ app: 'todo-list', version: 2, todos, sched, exported: new Date().toISOString() });

  function mergeBundle(data) {
    if (!data || data.app !== 'todo-list') throw new Error('Il testo o il file non è un backup valido.');
    let nt = 0, nl = 0;
    const tm = new Map(todos.map(t => [t.id, t]));
    for (const t of data.todos || []) {
      if (!t || typeof t.text !== 'string' || t.id == null) continue;
      if (!tm.has(t.id)) nt++;
      const c = { id: t.id, text: t.text.slice(0, 200), done: !!t.done };
      ['due', 'time', 'subject', 'lessonId'].forEach(k => { if (t[k]) c[k] = t[k]; });
      tm.set(t.id, c);
    }
    todos = [...tm.values()].sort((a, b) => b.id - a.id);
    if (data.sched && Array.isArray(data.sched.lessons)) {
      const lm = new Map(sched.lessons.map(l => [l.id, l]));
      for (const l of data.sched.lessons) {
        if (!l || !l.subject || !/^\d\d:\d\d$/.test(l.start) || !/^\d\d:\d\d$/.test(l.end) || !l.id) continue;
        if (!lm.has(l.id)) nl++;
        lm.set(l.id, cleanLesson(l, String(l.id)));
      }
      sched.lessons = [...lm.values()];
      sched.subjects = Object.assign({}, data.sched.subjects || {}, sched.subjects);
    }
    saveTodos(); saveSched();
    return { nt, nl };
  }

  function download() {
    const blob = new Blob([JSON.stringify(bundle(), null, 1)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `backup-todo-${today()}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  async function importBackup(file) {
    try { const r = mergeBundle(JSON.parse(await file.text())); render(); toast(`Importate ${r.nt} attività e ${r.nl} lezioni nuove.`); }
    catch (e) { toast(e.message.startsWith('Il ') ? e.message : 'File non valido.'); }
  }

  function syncText() {
    const box = h('textarea', { placeholder: 'Il testo copiato compare qui. Per importare, incollalo qui.', 'aria-label': 'Dati della lista' });
    const msg = h('div', { class: 'muted', role: 'status', style: 'min-height:1.4em;margin-top:8px' });
    openSheet(
      h('h3', { id: 'sheetTitle' }, 'Sincronizza con testo'),
      h('p', { class: 'muted', style: 'margin:0 0 8px' }, 'Su un dispositivo tocca Copia, sull\u2019altro incolla il testo qui e tocca Importa. I dati si uniscono a quelli presenti.'),
      box, msg,
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: async () => {
          box.value = JSON.stringify(bundle());
          try { await navigator.clipboard.writeText(box.value); msg.textContent = 'Copiato. Incollalo sull\u2019altro dispositivo.'; }
          catch (e) { box.select(); msg.textContent = 'Seleziona il testo e copialo a mano.'; }
        } }, 'Copia'),
        h('button', { class: 'btn', onclick: async () => {
          let text = box.value.trim();
          if (!text) { try { text = (await navigator.clipboard.readText()).trim(); box.value = text; } catch (e) {} }
          if (!text) { msg.textContent = 'Incolla prima il testo copiato.'; return; }
          try { const r = mergeBundle(JSON.parse(text)); render(); msg.textContent = `Importate ${r.nt} attività e ${r.nl} lezioni nuove.`; }
          catch (e) { msg.textContent = 'Testo non valido: copialo dall\u2019altro dispositivo.'; }
        } }, 'Importa'),
        h('button', { class: 'btn sec', onclick: closeSheet }, 'Chiudi')));
  }

  /* ---------- Impostazioni e promemoria ---------- */
  function viewSettings() {
    const names = Object.keys(sched.subjects).sort();
    const notif = 'Notification' in window;
    const status = !notif ? 'non supportati da questo browser' : Notification.permission === 'granted' && settings.remind ? 'attivi' : Notification.permission === 'denied' ? 'bloccati nelle impostazioni del browser' : 'spenti';
    return [
      h('h1', null, 'Impostazioni'),
      h('h2', null, 'Backup'),
      h('div', { class: 'stack' },
        h('button', { class: 'btn block', onclick: download }, 'Esporta backup (file)'),
        filePicker('.json,application/json', importBackup, 'Importa backup (file)', 'btn sec block'),
        h('button', { class: 'btn sec block', onclick: syncText }, 'Sincronizza con testo (copia/incolla)'),
        h('p', { class: 'muted', style: 'margin:0' }, 'L\u2019importazione unisce i dati a quelli presenti e non cancella nulla.')),
      h('h2', null, 'Colori delle materie'),
      names.length ? h('ul', { class: 'list' }, names.map(n => h('li', { class: 'card row', style: 'align-items:center' },
        h('span', { style: 'flex:1' }, n),
        h('input', { type: 'color', value: sched.subjects[n], 'aria-label': 'Colore ' + n, style: 'flex:none', onchange: e => { sched.subjects[n] = e.target.value; saveSched(); } }))))
        : h('div', { class: 'muted' }, 'Compariranno quando aggiungi lezioni.'),
      h('h2', null, 'Promemoria'),
      h('p', { class: 'muted', style: 'margin:0 0 8px' }, `Stato: ${status}. Funzionano solo mentre l\u2019app è aperta o in background: senza un server push, iPhone non permette avvisi ad app chiusa.`),
      h('div', { class: 'row' },
        h('button', { class: 'btn ' + (settings.remind ? 'sec' : ''), disabled: !notif, onclick: async () => {
          if (settings.remind) { settings.remind = false; saveSettings(); render(); return; }
          const p = await Notification.requestPermission();
          settings.remind = p === 'granted'; saveSettings(); render();
          if (p !== 'granted') toast('Permesso notifiche negato.');
        } }, settings.remind ? 'Disattiva promemoria' : 'Attiva promemoria'),
        h('select', { 'aria-label': 'Anticipo', value: String(settings.lead), onchange: e => { settings.lead = +e.target.value; saveSettings(); } },
          [5, 10, 15, 30, 60].map(m => h('option', { value: String(m) }, `${m} min prima`)))),
      h('p', { class: 'muted', style: 'margin-top:24px' }, 'I dati sono salvati solo in questo browser.')
    ];
  }

  const fired = new Set();
  function checkReminders() {
    if (!settings.remind || !('Notification' in window) || Notification.permission !== 'granted') return;
    const now = new Date(), ds = ymd(now), nm = now.getHours() * 60 + now.getMinutes();
    const items = [
      ...lessonsOn(ds, false).map(l => ({ k: 'l' + l.id + ds, title: l.subject, time: l.start, body: `${cap(l.type)} alle ${l.start}${l.room ? ' · ' + l.room : ''}` })),
      ...todos.filter(t => !t.done && t.due === ds && t.time).map(t => ({ k: 't' + t.id, title: t.text, time: t.time, body: 'Scadenza alle ' + t.time }))
    ];
    for (const it of items) {
      const diff = minutes(it.time) - nm;
      if (diff >= 0 && diff <= settings.lead && !fired.has(it.k)) {
        fired.add(it.k);
        const opts = { body: it.body, icon: 'icon-192.png' };
        (navigator.serviceWorker ? navigator.serviceWorker.ready.then(r => r.showNotification(it.title, opts)) : Promise.reject())
          .catch(() => { try { new Notification(it.title, opts); } catch (e) {} });
      }
    }
  }
  setInterval(checkReminders, 30000);

  /* ---------- Render e avvio ---------- */
  const views = { tasks: viewTasks, cal: viewCal, orario: viewOrario, settings: viewSettings };
  function render() {
    subjectList.replaceChildren(...Object.keys(sched.subjects).sort().map(s => h('option', { value: s })));
    $('#main').replaceChildren(...[views[ui.tab]()].flat(Infinity).filter(Boolean));
    document.querySelectorAll('#nav button').forEach(b => {
      if (b.dataset.tab === ui.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }
  $('#nav').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) { ui.tab = b.dataset.tab; window.scrollTo(0, 0); render(); }
  });
  render();
  checkReminders();

  // Orario iniziale (Economia e analisi dei dati): caricato una sola volta per browser
  const SEED_ORARIO = 'orario-seed-1';
  try {
    if (!localStorage.getItem(SEED_ORARIO)) {
      fetch('orario-iniziale.json', { cache: 'no-cache' }).then(r => r.json()).then(lessons => {
        mergeBundle({ app: 'todo-list', sched: { lessons } });
        localStorage.setItem(SEED_ORARIO, '1');
        render();
        toast(`Orario caricato: ${lessons.length} lezioni.`);
      }).catch(() => {});
    }
  } catch (e) {}

  // Aggiornamento automatico: il service worker scarica sempre l'ultima versione.
  if ('serviceWorker' in navigator) {
    let had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) location.reload(); had = true; });
    navigator.serviceWorker.register('sw.js').then(reg => {
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update(); });
    }).catch(() => {});
  }
})();
