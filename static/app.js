'use strict';
/* ==========================================================
   SkillUp — frontend logic (vanilla JS)
   1 Config · 2 Sample data · 3 State · 4 Helpers · 5 Roadmap API
   6 Rendering · 7 Navigation · 8 Forms · 9 Auth stub · 10 Events
   ========================================================== */

/* 1 ── Config (no secrets belong here; Gemini keys stay on the server) */
const CONFIG = {
  API_URL: '/api/roadmap',          // Flask endpoint (Gemini runs server-side)
  STORAGE_KEY: 'skillup_demo_v1',   // localStorage: demo only, replace with Firestore later
  REMINDER_KEY: 'skillup_reminders_v1',
};

/* 2 ── Sample data (demo only) */
const res = (label, url) => ({ label, url });
const mod = (title, duration, topics, practice, project, resources, defaultMins = 30) =>
  ({ title, duration, topics: topics.map(t => ({
    t: typeof t === 'string' ? t : t.t,
    done: typeof t === 'object' ? !!t.done : false,
    targetMinutes: (typeof t === 'object' && t.targetMinutes) || defaultMins
  })), practice, project, resources });

const SAMPLE_ROADMAPS = [
  { id: 'rm-web', source: 'sample', title: 'Full-Stack Web Development',
    desc: 'From semantic HTML to a deployed Flask app with a database.',
    modules: [
      mod('HTML & CSS foundations', '1 week', ['Semantic HTML', 'Flexbox and Grid', 'Responsive design'], ['Rebuild a landing page from a screenshot'], 'Personal portfolio page', [res('MDN Learn Web Development', 'https://developer.mozilla.org/en-US/docs/Learn')]),
      mod('JavaScript essentials', '2 weeks', ['Variables and functions', 'DOM events', 'Fetch and async/await'], ['Build a to-do list with localStorage'], 'Weather lookup widget', [res('JavaScript.info', 'https://javascript.info/')]),
      mod('Backend with Flask', '2 weeks', ['Routes and templates', 'REST APIs', 'Working with a database'], ['Create a notes API with CRUD routes'], 'Bookmark manager', [res('Flask documentation', 'https://flask.palletsprojects.com/')]),
      mod('Ship it', '1 week', ['Git and GitHub', 'Deployment basics', 'Testing a web app'], ['Deploy a small app'], 'Capstone: full-stack app of your choice', [res('freeCodeCamp', 'https://www.freecodecamp.org/')]),
    ] },
  { id: 'rm-py', source: 'sample', title: 'Python Programming',
    desc: 'Write clean Python and automate real tasks.',
    modules: [
      mod('Python basics', '1 week', ['Types and control flow', 'Functions', 'Lists and dictionaries'], ['Solve 10 small exercises'], 'Number guessing game', [res('Python tutorial', 'https://docs.python.org/3/tutorial/')]),
      mod('Working with files & data', '2 weeks', ['Reading and writing files', 'Modules and packages', 'Error handling'], ['Parse a CSV and summarise it'], 'Expense tracker CLI', [res('Kaggle: Python', 'https://www.kaggle.com/learn/python')]),
      mod('Object-oriented Python', '2 weeks', ['Classes and objects', 'Inheritance', 'Writing tests'], ['Model a library system'], 'Inventory manager', [res('Real-world practice: Exercism', 'https://exercism.org/tracks/python')]),
    ] },
  { id: 'rm-ml', source: 'sample', title: 'AI and Machine Learning',
    desc: 'Understand core ML ideas and train your first models.',
    modules: [
      mod('Maths & data intuition', '2 weeks', ['Vectors and matrices', 'Probability basics', 'Data cleaning with pandas'], ['Explore a public dataset'], 'Data exploration notebook', [res('Kaggle: Pandas', 'https://www.kaggle.com/learn/pandas')]),
      mod('Classical ML', '3 weeks', ['Regression', 'Classification', 'Model evaluation'], ['Train and compare two models'], 'Predict house prices', [res('scikit-learn user guide', 'https://scikit-learn.org/stable/user_guide.html')]),
      mod('Neural networks', '3 weeks', ['Perceptrons and layers', 'Training and overfitting', 'Using a pretrained model'], ['Classify handwritten digits'], 'Image classifier demo', [res('Kaggle: Intro to Deep Learning', 'https://www.kaggle.com/learn/intro-to-deep-learning')]),
    ] },
];
// Mark some sample progress so the dashboard looks lived-in.
SAMPLE_ROADMAPS[0].modules[0].topics.forEach(t => (t.done = true));
SAMPLE_ROADMAPS[0].modules[1].topics[0].done = true;
SAMPLE_ROADMAPS[1].modules[0].topics.forEach(t => (t.done = true));
SAMPLE_ROADMAPS[1].modules[1].topics[0].done = true;
SAMPLE_ROADMAPS[1].modules[1].topics[1].done = true;
SAMPLE_ROADMAPS[2].modules[0].topics[0].done = true;

const SKILLS = [
  { name: 'JavaScript Fundamentals', level: 'Beginner', weeks: 4, desc: 'Core language, DOM and async code for the web.' },
  { name: 'SQL & Databases', level: 'Beginner', weeks: 3, desc: 'Query, design and normalise relational data.' },
  { name: 'Data Structures & Algorithms', level: 'Intermediate', weeks: 8, desc: 'Arrays, trees, graphs and problem-solving patterns.' },
  { name: 'UI/UX Design Basics', level: 'Beginner', weeks: 4, desc: 'Layout, typography and usability for student projects.' },
  { name: 'REST API Design with Flask', level: 'Intermediate', weeks: 5, desc: 'Build, document and secure JSON APIs.' },
  { name: 'Prompt Engineering', level: 'Intermediate', weeks: 3, desc: 'Write reliable prompts and evaluate model output.' },
  { name: 'Cloud & DevOps Essentials', level: 'Advanced', weeks: 6, desc: 'Containers, CI/CD and monitoring in practice.' },
  { name: 'Machine Learning Systems', level: 'Advanced', weeks: 8, desc: 'Take a model from notebook to a deployed service.' },
];

/* 3 ── State */
const state = {
  roadmaps: [], draft: null, user: null, view: 'dashboard', query: '', level: 'All', open: new Set(), lastFocus: null,
  timer: {
    active: false, paused: false, rmId: null, mIndex: null, tIndex: null,
    topicTitle: '', moduleTitle: '', targetMinutes: 30, totalSec: 1800, remainingSec: 1800,
    intervalId: null, expired: false, notified: false, startedAt: null
  },
  reminders: [],
  soundEnabled: true,
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY));
    if (saved && Array.isArray(saved.roadmaps)) { state.roadmaps = saved.roadmaps; return; }
  } catch (e) { /* storage blocked or corrupt: fall back to samples */ }
  state.roadmaps = JSON.parse(JSON.stringify(SAMPLE_ROADMAPS));
}
function persist() {
  if (state.user) return; // signed-in data lives in the server database
  try { localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify({ roadmaps: state.roadmaps })); } catch (e) { /* ignore */ }
}

/* 4 ── Helpers */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = () => { if (window.lucide) window.lucide.createIcons(); };
const ico = n => `<i data-lucide="${n}"></i>`;
const topicsOf = rm => rm.modules.flatMap(m => m.topics);
const pctOf = rm => { const t = topicsOf(rm); return t.length ? Math.round(t.filter(x => x.done).length / t.length * 100) : 0; };
const modDone = m => m.topics.length > 0 && m.topics.every(t => t.done);
const findRoadmap = id => state.roadmaps.find(r => r.id === id) || (state.draft && state.draft.id === id ? state.draft : null);
const nextTopic = rm => {
  for (let i = 0; i < rm.modules.length; i++) {
    const m = rm.modules[i];
    const ti = m.topics.findIndex(x => !x.done);
    if (ti !== -1) return { m, t: m.topics[ti], mIndex: i, tIndex: ti };
  }
  return null;
};
const matches = (...parts) => !state.query || parts.join(' ').toLowerCase().includes(state.query.toLowerCase());

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`; el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4800);
}

/* Server API + converters (server stores topics as strings and progress as keys like "0:1") */
async function api(path, method = 'GET', body) {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  let d = {}; try { d = await r.json(); } catch (e) { /* not JSON */ }
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
  return d;
}
const fromServer = r => ({
  id: String(r.id), source: r.source === 'gemini' ? 'api' : 'demo', title: r.title, desc: r.description || '',
  created_at: r.created_at || null, total_hours: r.total_hours || 0, inputs: r.inputs || null, timers: r.timers || {},
  modules: r.modules.map((m, i) => ({
    title: m.title, duration: m.duration, practice: m.practice || [], project: m.project || '', resources: m.resources || [],
    topics: m.topics.map((t, ti) => ({
      t, done: (r.completed || []).includes(`${i}:${ti}`),
      targetMinutes: (r.timers && r.timers[`${i}:${ti}`]?.targetMinutes) || Math.round((r.total_hours || 10) * 60 / Math.max(1, r.modules.reduce((a, x) => a + (x.topics || []).length, 0))) || 30
    }))
  }))
});
const progressKeys = rm => rm.modules.flatMap((m, i) => m.topics.flatMap((t, ti) => (t.done ? [`${i}:${ti}`] : [])));
const timerPayload = rm => {
  const map = { ...(rm.timers || {}) };
  rm.modules.forEach((m, i) => {
    m.topics.forEach((t, ti) => {
      if (t.targetMinutes) map[`${i}:${ti}`] = { ...(map[`${i}:${ti}`] || {}), targetMinutes: t.targetMinutes };
    });
  });
  return map;
};
const toPayload = rm => ({
  title: rm.title, explanation: rm.desc, source: rm.source === 'api' ? 'gemini' : 'demo',
  total_hours: rm.total_hours, inputs: rm.inputs, timers: timerPayload(rm),
  modules: rm.modules.map(m => ({ title: m.title, duration: m.duration, topics: m.topics.map(t => t.t), practice: m.practice, project: m.project, resources: m.resources }))
});
async function syncProgress(rm) {
  rm.timers = timerPayload(rm);
  if (!state.user || !state.roadmaps.includes(rm)) { persist(); return; }
  try { await api(`/api/roadmaps/${rm.id}/progress`, 'PATCH', { completed: progressKeys(rm), timers: rm.timers }); }
  catch (ex) { toast('Progress was not saved: ' + ex.message, 'error'); }
}

/* 5 ── Roadmap generation: real API first, clearly-labelled demo fallback */
const bandWeeks = (w, n) => Math.max(1, Math.round(w / n));

// DEMO FALLBACK ONLY. Not AI-generated. Replace by the real API response once Flask + Gemini are wired.
function buildDemoRoadmap(p) {
  const n = 4, per = bandWeeks(p.weeks, n), g = p.goal;
  const hands = p.pref === 'Hands-on Projects' || p.pref === 'Mixed';
  const names = ['Foundations', 'Core concepts', 'Build with it', 'Capstone and review'];
  const mins = p.daily || 30;
  return {
    id: 'draft-' + Date.now(), source: 'demo', title: g,
    desc: `A ${p.weeks}-week ${p.level.toLowerCase()} plan at ${p.daily} min/day, tuned for ${p.pref.toLowerCase()}.`,
    inputs: p, total_hours: Math.round((p.daily || 30) * 7 * (p.weeks || 4) / 60), timers: {},
    modules: names.map((nm, i) => mod(
      `${nm}: ${g}`, `${per} week${per > 1 ? 's' : ''}`,
      [`Key terms and ideas in ${g}`, `${i < 2 ? 'Essential' : 'Applied'} techniques (part ${i + 1})`, i === 0 && p.known ? `Connect ${p.known.split(',')[0].trim()} to ${g}` : `Self-check quiz ${i + 1}`],
      [`${p.daily >= 60 ? 'Two' : 'One'} focused exercise${p.daily >= 60 ? 's' : ''} per session`, hands ? 'Pair each lesson with a small build' : 'Summarise each lesson in your own words'],
      i === 3 ? `Capstone project in ${g}` : `Mini-project ${i + 1}: apply ${nm.toLowerCase()}`,
      [res(`Search: ${g} tutorials`, 'https://www.google.com/search?q=' + encodeURIComponent(g + ' tutorial')), res('freeCodeCamp', 'https://www.freecodecamp.org/')],
      mins
    )),
  };
}

// Map backend JSON into the shape the UI uses. Keep in sync with the Flask response contract.
function normalizeApi(data, p) {
  if (!data || !Array.isArray(data.modules) || !data.modules.length) throw new Error('The server returned an unexpected roadmap format.');
  const totalTopics = data.modules.reduce((a, m) => a + (m.topics || []).length, 0);
  const perTopic = totalTopics ? Math.round((data.total_hours || (p.daily * p.weeks * 7 / 60)) * 60 / totalTopics) : (p.daily || 30);
  return {
    id: 'draft-' + Date.now(), source: 'api', title: data.title || p.goal, desc: data.description || '',
    total_hours: data.total_hours, inputs: p, timers: {},
    modules: data.modules.map(m => mod(
      String(m.title || 'Untitled module'), String(m.duration || ''),
      (m.topics || []).map(String), (m.practice || []).map(String), String(m.project || ''),
      (m.resources || []).filter(r => /^https?:\/\//.test(r.url || '')).map(r => res(String(r.label || r.url), r.url)),
      perTopic
    )),
  };
}

async function requestRoadmap(p) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 30000);
  let r;
  try {
    r = await fetch(CONFIG.API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p), signal: ctrl.signal });
  } catch (e) {
    // Network failure or timeout: server unreachable
    return { roadmap: buildDemoRoadmap(p), fallback: e.name === 'AbortError' ? 'The server took too long to respond.' : 'The server could not be reached.' };
  } finally { clearTimeout(timer); }
  if ([404, 405, 501].includes(r.status)) return { roadmap: buildDemoRoadmap(p), fallback: 'The roadmap API is not set up yet.' };
  if (!r.ok) {
    let detail = ''; try { detail = (await r.json()).error || ''; } catch (e) { /* not JSON */ }
    throw new Error(detail || `The server returned an error (${r.status}). Try again in a moment.`);
  }
  let data; try { data = await r.json(); } catch (e) { throw new Error('The server sent a response that is not valid JSON.'); }
  return { roadmap: normalizeApi(data, p), fallback: null };
}

/* 6 ── Rendering */
function renderStats() {
  const all = state.roadmaps, topics = all.flatMap(topicsOf), done = topics.filter(t => t.done).length;
  const data = [
    ['route', all.length, 'Active learning paths'], ['check-circle-2', done, 'Topics completed'],
    state.user ? ['flame', '—', 'Streak (tracking coming soon)'] : ['flame', '7 days', 'Learning streak (sample)'],
    state.user ? ['clock', '—', 'Study time (tracking coming soon)'] : ['clock', (12 + done * 0.75).toFixed(1) + ' h', 'Study hours (sample)'],
  ];
  const html = data.map(([i, v, l]) => `<div class="stat"><div class="ico">${ico(i)}</div><b>${v}</b><span>${l}</span></div>`).join('');
  $('#stats').innerHTML = html; $('#stats2').innerHTML = html;
}

function roadmapCard(rm) {
  const p = pctOf(rm), nx = nextTopic(rm);
  return `<article class="card"><h3>${esc(rm.title)}</h3><p>${esc(rm.desc)}</p>
    <div><div class="pct"><span>Progress</span><span>${p}%</span></div><div class="bar" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(rm.title)} progress"><i style="width:${p}%"></i></div></div>
    <p class="next">Next topic: <b>${nx ? esc(nx.t.t) : 'All done. Nice work!'}</b></p>
    <button class="btn primary compact" data-action="open-roadmap" data-id="${rm.id}">Continue Learning</button></article>`;
}
function renderRoadmapList(el, list, emptyMsg) {
  el.innerHTML = list.length ? list.map(roadmapCard).join('') :
    `<div class="empty"><h3>${state.query ? 'No matching roadmaps' : 'No roadmaps yet'}</h3><p>${emptyMsg}</p><button class="btn primary compact" data-action="open-create">${ico('plus')}Create a roadmap</button></div>`;
}
function skillCard(s, i) {
  return `<article class="card"><div class="meta"><span class="tag ${s.level}">${s.level}</span><span class="tag">${s.weeks} weeks</span></div>
    <h3>${esc(s.name)}</h3><p>${esc(s.desc)}</p><button class="btn ghost compact" data-action="start-skill" data-i="${i}">Start Learning</button></article>`;
}
function renderSkillList(el, limit, level = 'All') {
  const list = SKILLS.map((s, i) => ({ s, i })).filter(({ s }) => (level === 'All' || s.level === level) && matches(s.name, s.desc, s.level)).slice(0, limit || 99);
  el.innerHTML = list.length ? list.map(({ s, i }) => skillCard(s, i)).join('') :
    `<div class="empty"><h3>No matching skills</h3><p>Try a different search term or difficulty.</p></div>`;
}

function renderProjects() {
  const items = state.roadmaps.flatMap(rm => rm.modules.map(m => ({ rm, m }))).filter(({ rm, m }) => matches(rm.title, m.project));
  $('#projectList').innerHTML = items.length ? items.map(({ rm, m }) =>
    `<article class="card"><span class="tag">${esc(rm.title)}</span><h3>${esc(m.project)}</h3><p>${modDone(m) ? 'Module complete: ready to showcase.' : 'Unlocks as you progress through ' + esc(m.title) + '.'}</p>
     <button class="btn ghost compact" data-action="open-roadmap" data-id="${rm.id}">Open roadmap</button></article>`).join('')
    : `<div class="empty"><h3>No projects yet</h3><p>Projects appear here when you create a roadmap.</p></div>`;
}
function renderProgress() {
  $('#progressList').innerHTML = state.roadmaps.length ? state.roadmaps.map(rm => {
    const p = pctOf(rm);
    return `<div class="prog-row"><strong>${esc(rm.title)}</strong><div><div class="pct"><span>${rm.modules.filter(modDone).length} of ${rm.modules.length} modules</span><span>${p}%</span></div><div class="bar"><i style="width:${p}%"></i></div></div></div>`;
  }).join('') : `<div class="empty"><h3>Nothing to track yet</h3><p>Create a roadmap to start tracking progress.</p></div>`;
  renderCertificateArea();
}

/* ── Certificates ── */
function completedRoadmaps() {
  return state.roadmaps.filter(rm => pctOf(rm) === 100);
}

function certHtml(rm, recipientName, dateStr) {
  const logoUrl = '/static/skillup-logo.png';
  const date = dateStr || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const name = recipientName || (state.user && state.user.name) || 'Learner';
  return `
    <div class="cert" id="certDoc">
      <div class="cert-corner-tr"></div>
      <div class="cert-corner-bl"></div>
      <img class="cert-logo" src="${logoUrl}" alt="SkillUp logo">
      <div class="cert-diamond"></div>
      <div class="cert-title">Certificate of Completion</div>
      <div class="cert-subtitle">This certificate is proudly presented to</div>
      <div class="cert-name">${esc(name)}</div>
      <div class="cert-completing">for successfully completing</div>
      <div class="cert-course">${esc(rm.title)}</div>
      <div class="cert-awarded">Awarded on ${esc(date)}</div>
      <div class="cert-footer">
        <div class="cert-sig-col">
          <span class="cert-sig-text">skillup Team</span>
          <div class="cert-sig-line"></div>
          <span class="cert-sig-label">Authorized Signature</span>
        </div>
        <div class="cert-divider"></div>
        <div class="cert-date-col">
          <div class="cert-date-label">Awarded on</div>
          <div class="cert-date-value">${esc(date)}</div>
        </div>
      </div>
    </div>
  `;
}

function renderCertificateArea() {
  const area = $('#certificateArea');
  if (!area) return;
  const done = completedRoadmaps();
  if (!done.length) { area.innerHTML = ''; return; }
  area.innerHTML = `
    <div class="cert-unlock-card">
      <h2>${ico('award')} 🎉 Roadmap Complete!</h2>
      <p>You've completed <strong>${done.length === 1 ? esc(done[0].title) : done.length + ' roadmaps'}</strong>. Download your certificate${done.length > 1 ? 's' : ''}.</p>
      <div class="row" style="justify-content:center;gap:10px;flex-wrap:wrap;">
        ${done.map(rm => `<button class="btn primary compact" data-action="open-cert" data-id="${rm.id}">${ico('award')} Get Certificate — ${esc(rm.title)}</button>`).join('')}
      </div>
    </div>`;
  icons();
}

function openCertificate(rmId) {
  const rm = findRoadmap(rmId);
  if (!rm || pctOf(rm) !== 100) {
    toast('Complete all topics in this roadmap first to earn your certificate.', 'warn');
    return;
  }
  const name = (state.user && state.user.name) || 'Learner';
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const preview = $('#certPreview');
  if (preview) preview.innerHTML = certHtml(rm, name, date);
  // store for print
  $('#certDialog').dataset.rmId = rmId;
  $('#certDialog').dataset.name = name;
  $('#certDialog').dataset.date = date;
  openDialog($('#certDialog'));
  icons();
}

function printCert() {
  const dlg = $('#certDialog');
  const rm = findRoadmap(dlg.dataset.rmId);
  if (!rm) return;
  const certContent = certHtml(rm, dlg.dataset.name, dlg.dataset.date);
  const printArea = document.createElement('div');
  printArea.id = 'certPrintArea';
  printArea.innerHTML = certContent;
  document.body.appendChild(printArea);
  window.print();
  setTimeout(() => printArea.remove(), 500);
}

/* ── Reminders, Task Timers & Schedule Tracking ── */
function playReminderChime() {
  if (!state.soundEnabled) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator(), gain1 = ctx.createGain();
    osc1.type = 'sine'; osc1.frequency.setValueAtTime(523.25, now);
    osc1.frequency.exponentialRampToValueAtTime(659.25, now + 0.15);
    gain1.gain.setValueAtTime(0.18, now); gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc1.connect(gain1); gain1.connect(ctx.destination);
    osc1.start(now); osc1.stop(now + 0.5);

    const osc2 = ctx.createOscillator(), gain2 = ctx.createGain();
    osc2.type = 'sine'; osc2.frequency.setValueAtTime(783.99, now + 0.2);
    gain2.gain.setValueAtTime(0.22, now + 0.2); gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    osc2.connect(gain2); gain2.connect(ctx.destination);
    osc2.start(now + 0.2); osc2.stop(now + 0.8);
  } catch (e) { /* ignore */ }
}

function sendDesktopNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon: '/static/skillup-mark.svg', tag: 'skillup-task-reminder' });
    } catch (e) { /* ignore */ }
  }
}

function formatTime(sec) {
  const m = Math.floor(Math.max(0, sec) / 60);
  const s = Math.max(0, sec) % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function saveReminders() {
  try { localStorage.setItem(CONFIG.REMINDER_KEY, JSON.stringify(state.reminders)); } catch (e) {}
}

function loadReminders() {
  try {
    const d = JSON.parse(localStorage.getItem(CONFIG.REMINDER_KEY));
    if (Array.isArray(d)) { state.reminders = d; return; }
  } catch (e) {}
  const sampleRm = state.roadmaps[0];
  if (sampleRm) {
    state.reminders = [{
      id: 'rem-sample',
      rmId: sampleRm.id,
      mIndex: 1,
      tIndex: 1,
      topicTitle: 'DOM events',
      moduleTitle: 'JavaScript essentials',
      reason: 'Scheduled study session (30 minutes) was not completed.',
      type: 'timer_expired',
      timestamp: Date.now() - 3600000
    }];
  }
}

function updateReminderUI() {
  const count = state.reminders.length;
  const countEl = $('#reminderCount');
  if (countEl) {
    countEl.hidden = count === 0;
    countEl.textContent = count > 9 ? '9+' : String(count);
  }
  const banner = $('#reminderBanner');
  if (banner) {
    if (count > 0) {
      const top = state.reminders[0];
      banner.hidden = false;
      banner.innerHTML = `
        <div class="reminder-banner-content">
          <div class="reminder-banner-icon">${ico('alarm-clock')}</div>
          <div>
            <strong>Incomplete Task Reminder: ${esc(top.topicTitle)}</strong>
            <p>${esc(top.reason)} &middot; <span class="muted">${esc(top.moduleTitle)}</span></p>
          </div>
        </div>
        <div class="row">
          <button class="btn primary compact" data-action="reminder-go-task" data-rm="${top.rmId}" data-m="${top.mIndex}" data-t="${top.tIndex}">Continue Task</button>
          <button class="btn ghost compact" data-action="open-reminders">View All (${count})</button>
        </div>`;
    } else {
      banner.hidden = true;
    }
  }
  icons();
}

function startTaskTimer(rmId, mIndex, tIndex, targetMinutes) {
  const rm = findRoadmap(rmId);
  if (!rm) return;
  const m = rm.modules[mIndex], t = m.topics[tIndex];
  if (state.timer.intervalId) clearInterval(state.timer.intervalId);

  const mins = targetMinutes || t.targetMinutes || 30;
  state.timer = {
    active: true,
    paused: false,
    rmId,
    mIndex,
    tIndex,
    topicTitle: t.t,
    moduleTitle: m.title,
    targetMinutes: mins,
    totalSec: mins * 60,
    remainingSec: mins * 60,
    expired: false,
    notified: false,
    startedAt: Date.now(),
    intervalId: setInterval(onTimerTick, 1000)
  };

  toast(`Timer started for "${t.t}" (${mins} min target).`, 'info');
  if (state.view === 'roadmap') renderDetail(rm.id);
  updateReminderUI();
}

function onTimerTick() {
  if (!state.timer.active || state.timer.paused) return;
  state.timer.remainingSec--;

  const clock = $('#timerClock');
  const bar = $('#timerBar');
  if (clock) clock.textContent = formatTime(state.timer.remainingSec);
  if (bar) {
    const pct = Math.max(0, Math.min(100, Math.round(state.timer.remainingSec / state.timer.totalSec * 100)));
    bar.style.width = pct + '%';
  }

  if (state.timer.remainingSec <= 0) {
    state.timer.remainingSec = 0;
    const rm = findRoadmap(state.timer.rmId);
    const isDone = rm && rm.modules[state.timer.mIndex]?.topics[state.timer.tIndex]?.done;

    if (!isDone) {
      state.timer.expired = true;
      if (!state.timer.notified) {
        state.timer.notified = true;
        playReminderChime();
        toast(`⏰ Time's up! You haven't completed "${state.timer.topicTitle}" in the set time of ${state.timer.targetMinutes} minutes.`, 'warn');
        sendDesktopNotification('SkillUp Task Reminder', `Time is up! You haven't completed "${state.timer.topicTitle}" in your set time.`);

        if (!state.reminders.some(r => r.rmId === state.timer.rmId && r.mIndex === state.timer.mIndex && r.tIndex === state.timer.tIndex)) {
          state.reminders.unshift({
            id: 'rem-' + Date.now(),
            rmId: state.timer.rmId,
            mIndex: state.timer.mIndex,
            tIndex: state.timer.tIndex,
            topicTitle: state.timer.topicTitle,
            moduleTitle: state.timer.moduleTitle,
            reason: `Set study time of ${state.timer.targetMinutes} minutes ended without completion.`,
            type: 'timer_expired',
            timestamp: Date.now()
          });
          saveReminders();
        }
      }
    }
    if (state.view === 'roadmap') renderDetail(state.timer.rmId);
    updateReminderUI();
  }
}

function snoozeTimer(extraMins = 15) {
  if (!state.timer.active) return;
  state.timer.totalSec += extraMins * 60;
  state.timer.remainingSec += extraMins * 60;
  state.timer.expired = false;
  state.timer.notified = false;
  state.timer.paused = false;
  toast(`Added ${extraMins} minutes to "${state.timer.topicTitle}".`, 'info');
  if (state.view === 'roadmap') renderDetail(state.timer.rmId);
  updateReminderUI();
}

function resetTimer() {
  if (!state.timer.active) return;
  state.timer.remainingSec = state.timer.totalSec;
  state.timer.expired = false;
  state.timer.notified = false;
  state.timer.paused = true;
  if (state.view === 'roadmap') renderDetail(state.timer.rmId);
}

function completeActiveTask(rmId, mIndex, tIndex) {
  const rm = findRoadmap(rmId);
  if (!rm) return;
  rm.modules[mIndex].topics[tIndex].done = true;
  if (state.timer.rmId === rmId && state.timer.mIndex === mIndex && state.timer.tIndex === tIndex) {
    if (state.timer.intervalId) clearInterval(state.timer.intervalId);
    state.timer.active = false;
    state.timer.expired = false;
  }
  state.reminders = state.reminders.filter(r => !(r.rmId === rmId && r.mIndex === mIndex && r.tIndex === tIndex));
  saveReminders();
  renderDetail(rm.id);
  renderStats();
  syncProgress(rm);
  updateReminderUI();
  toast(`✓ Task completed! Great progress.`, 'success');
}

function renderRemindersModal() {
  const box = $('#remindersList');
  if (!box) return;
  if (!state.reminders.length) {
    box.innerHTML = `<div class="empty"><h3>${ico('check-circle-2')} All caught up!</h3><p>You have no overdue tasks or expired timers right now. Great job keeping pace!</p></div>`;
    icons();
    return;
  }

  box.innerHTML = state.reminders.map((rem, i) => `
    <div class="reminder-item warning">
      <div class="reminder-item-main">
        <strong>${esc(rem.topicTitle)}</strong>
        <small>${esc(rem.reason)} &middot; <span class="muted">${esc(rem.moduleTitle)}</span></small>
      </div>
      <div class="reminder-actions">
        <button class="btn primary compact" data-action="reminder-go-task" data-rm="${rem.rmId}" data-m="${rem.mIndex}" data-t="${rem.tIndex}" title="Continue learning this task">Go to task</button>
        <button class="btn ghost compact" data-action="reminder-complete" data-rm="${rem.rmId}" data-m="${rem.mIndex}" data-t="${rem.tIndex}" title="Mark completed">${ico('check')}</button>
        <button class="btn ghost compact" data-action="reminder-dismiss" data-i="${i}" title="Dismiss reminder">${ico('x')}</button>
      </div>
    </div>
  `).join('');
  icons();
}

function timerWidgetHtml(rm, nx) {
  if (!nx) return '';
  const isTimerForThisTask = state.timer.active && state.timer.rmId === rm.id && state.timer.mIndex === nx.mIndex && state.timer.tIndex === nx.tIndex;
  const targetMins = isTimerForThisTask ? state.timer.targetMinutes : (nx.t.targetMinutes || 30);
  const remainingSec = isTimerForThisTask ? state.timer.remainingSec : targetMins * 60;
  const totalSec = isTimerForThisTask ? state.timer.totalSec : targetMins * 60;
  const pct = Math.max(0, Math.min(100, Math.round(remainingSec / totalSec * 100)));
  const isExpired = isTimerForThisTask && state.timer.expired;
  const isRunning = isTimerForThisTask && !state.timer.paused;

  return `
    <div class="timer-widget ${isExpired ? 'expired' : isRunning ? 'running' : ''}" id="timerWidget">
      <div class="timer-header">
        <span>${ico('clock')} Task Target Timer</span>
        <span class="timer-target-tag">${targetMins} min goal</span>
      </div>
      <div class="timer-display">
        <div class="timer-clock" id="timerClock">${formatTime(remainingSec)}</div>
        <div class="timer-presets">
          <button type="button" class="preset-btn ${targetMins === 15 ? 'active' : ''}" data-action="timer-preset" data-min="15">15m</button>
          <button type="button" class="preset-btn ${targetMins === 30 ? 'active' : ''}" data-action="timer-preset" data-min="30">30m</button>
          <button type="button" class="preset-btn ${targetMins === 45 ? 'active' : ''}" data-action="timer-preset" data-min="45">45m</button>
          <button type="button" class="preset-btn ${targetMins === 60 ? 'active' : ''}" data-action="timer-preset" data-min="60">60m</button>
        </div>
      </div>
      <div class="timer-progress-bar"><i id="timerBar" style="width:${pct}%"></i></div>
      ${isExpired ? `
        <div class="timer-alert-box">
          <strong>⚠️ Set time expired!</strong>
          <span>You haven't completed this task in your set time of ${targetMins} minutes.</span>
          <div class="row">
            <button type="button" class="btn primary compact" data-action="timer-snooze" data-min="15">${ico('plus')} +15 Min</button>
            <button type="button" class="btn ghost compact" data-action="timer-complete-task" data-rm="${rm.id}" data-m="${nx.mIndex}" data-t="${nx.tIndex}">${ico('check')} Mark Complete</button>
          </div>
        </div>
      ` : ''}
      <div class="timer-actions">
        ${!isTimerForThisTask ? `
          <button type="button" class="btn primary compact block" data-action="timer-start" data-rm="${rm.id}" data-m="${nx.mIndex}" data-t="${nx.tIndex}" data-min="${targetMins}">${ico('play')} Start Task Timer</button>
        ` : `
          <button type="button" class="btn ghost compact" data-action="timer-toggle-pause">${state.timer.paused ? ico('play') + ' Resume' : ico('pause') + ' Pause'}</button>
          <button type="button" class="btn ghost compact" data-action="timer-reset">${ico('rotate-ccw')} Reset</button>
          <button type="button" class="btn primary compact" data-action="timer-complete-task" data-rm="${rm.id}" data-m="${nx.mIndex}" data-t="${nx.tIndex}">${ico('check')} Complete</button>
        `}
      </div>
    </div>
  `;
}

function renderDetail(id) {
  const rm = findRoadmap(id), box = $('#roadmapDetail');
  if (!rm) { box.innerHTML = `<div class="empty"><h3>Roadmap not found</h3><button class="btn primary compact" data-action="nav" data-view="roadmaps">Back to roadmaps</button></div>`; return; }
  const p = pctOf(rm), dm = rm.modules.filter(modDone).length, nx = nextTopic(rm), saved = state.roadmaps.includes(rm);
  const badge = rm.source === 'api' ? `<span class="badge-demo badge-ai">${ico('sparkles')} Generated by the server</span>`
    : rm.source === 'demo' ? `<span class="badge-demo">${ico('flask-conical')} Demo roadmap: not generated by AI</span>`
    : `<span class="badge-demo">${ico('flask-conical')} Sample roadmap</span>`;
  box.dataset.id = id;
  box.innerHTML = `
    <button class="link back" data-action="nav" data-view="${saved ? 'roadmaps' : 'dashboard'}">&larr; Back</button>
    <div class="rm-head"><div class="row"><div>${badge}</div>
      ${saved ? `<span class="tag">${state.user ? 'Saved to your account' : 'Saved in this browser'}</span><button class="btn ghost compact" data-action="delete-roadmap" data-id="${rm.id}">${ico('trash-2')}Delete</button>` : `<button class="btn ghost compact" data-action="save-roadmap" data-id="${rm.id}">${ico('bookmark')}Save roadmap</button>`}</div>
      <h1 id="h-rd" tabindex="-1">${esc(rm.title)}</h1><p class="muted">${esc(rm.desc)}</p></div>
    <div class="rm-layout"><div class="modules">${rm.modules.map((m, i) => moduleHtml(rm, m, i)).join('')}</div>
      <aside class="side-card" aria-label="Roadmap summary">
        <div><div class="big">${p}%</div><span class="muted">${dm} of ${rm.modules.length} modules completed</span></div>
        <div class="bar" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100" aria-label="Overall progress"><i style="width:${p}%"></i></div>
        <div class="next-step">
          <span class="muted">Recommended next step</span>
          <b>${nx ? esc(nx.t.t) : 'Roadmap complete. Pick a new skill to explore.'}</b>
          ${nx ? `<span class="muted">in ${esc(nx.m.title)}</span>` : ''}
        </div>
        ${nx ? timerWidgetHtml(rm, nx) : '<button class="btn primary compact" data-action="nav" data-view="explore">Explore Skills</button>'}
      </aside>
    </div>`;
  icons();
}

function moduleHtml(rm, m, i) {
  const key = rm.id + ':' + i, done = modDone(m);
  const list = arr => arr.length ? `<ul>${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  return `<details class="module ${done ? 'done' : ''}" data-key="${key}" ${state.open.has(key) ? 'open' : ''}>
    <summary><span class="mnum">${done ? '&#10003;' : i + 1}</span><span><strong>${esc(m.title)}</strong><small>${esc(m.duration)} &middot; ${m.topics.filter(t => t.done).length}/${m.topics.length} topics</small></span></summary>
    <div class="mbody">
      <div><h4>Topics to learn</h4><ul class="topics">${m.topics.map((t, ti) => {
        const isTimer = state.timer.active && state.timer.rmId === rm.id && state.timer.mIndex === i && state.timer.tIndex === ti;
        const isOverdue = state.reminders.some(r => r.rmId === rm.id && r.mIndex === i && r.tIndex === ti);
        return `<li>
          <div class="topic-row">
            <label class="check">
              <input type="checkbox" data-action="toggle-topic" data-rm="${rm.id}" data-m="${i}" data-t="${ti}" ${t.done ? 'checked' : ''}>
              <span>${esc(t.t)}</span>
            </label>
            <div class="topic-meta">
              ${t.done ? '<span class="topic-badge done">✓ Done</span>'
                : isTimer && state.timer.expired ? '<span class="topic-badge overdue">⚠️ Past set time</span>'
                : isTimer ? `<span class="topic-badge running">⏱️ ${formatTime(state.timer.remainingSec)}</span>`
                : isOverdue ? '<span class="topic-badge overdue">⚠️ Overdue</span>'
                : `<button type="button" class="topic-badge link" data-action="start-topic-timer" data-rm="${rm.id}" data-m="${i}" data-t="${ti}" title="Start timer for this task">⏱️ ${t.targetMinutes || 30}m</button>`}
            </div>
          </div>
        </li>`;
      }).join('')}</ul></div>
      ${m.practice.length ? `<div><h4>Practice exercises</h4>${list(m.practice)}</div>` : ''}
      ${m.project ? `<div><h4>Mini-project</h4><p>${esc(m.project)}</p></div>` : ''}
      ${m.resources.length ? `<div><h4>Resources</h4><ul>${m.resources.map(r => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.label)}</a></li>`).join('')}</ul></div>` : ''}
      <button class="btn ${done ? 'ghost' : 'primary'} compact" data-action="complete-module" data-rm="${rm.id}" data-m="${i}">${done ? 'Mark as incomplete' : 'Mark module as complete'}</button>
    </div></details>`;
}

function renderAll() {
  const q = state.query;
  renderStats();
  renderRoadmapList($('#continue'), state.roadmaps.filter(r => matches(r.title, r.desc)).slice(0, 3), q ? 'Try another search term.' : 'Create your first roadmap to get started.');
  renderRoadmapList($('#allRoadmaps'), state.roadmaps.filter(r => matches(r.title, r.desc)), q ? 'Try another search term.' : 'Create your first roadmap to get started.');
  renderSkillList($('#recommended'), 3); renderSkillList($('#allSkills'), 0, state.level);
  renderProjects(); renderProgress();
  updateReminderUI();
  if (state.view === 'roadmap') renderDetail($('#roadmapDetail').dataset.id);
  icons();
}

/* 7 ── Navigation */
function show(view, id) {
  state.view = view;
  $$('.view').forEach(v => (v.hidden = v.id !== 'view-' + view));
  const navView = view === 'roadmap' ? 'roadmaps' : view;
  $$('.nav-btn').forEach(b => { b.dataset.view === navView ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); });
  if (view === 'roadmap') renderDetail(id); else renderAll();
  closeMenu(); window.scrollTo({ top: 0 });
  const h = $(`#view-${view} h1`); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
}
function setMenu(open) {
  $('#sidebar').classList.toggle('open', open); $('#scrim').hidden = !open;
  $('#menuBtn').setAttribute('aria-expanded', String(open)); $('#menuBtn').setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
}
const closeMenu = () => setMenu(false);

/* 8 ── Create-roadmap form */
function openDialog(d) { state.lastFocus = document.activeElement; d.showModal(); }
function closeDialog(d) { d.close(); }

function validate(form) {
  const v = Object.fromEntries(new FormData(form).entries()); let ok = true;
  const rules = {
    goal: x => (x.trim().length >= 3 ? '' : 'Tell us what you want to learn (at least 3 characters).'),
    level: x => (x ? '' : 'Choose your current level.'),
    daily: x => (x ? '' : 'Choose a daily study time.'),
    weeks: x => (Number.isInteger(+x) && +x >= 1 && +x <= 52 ? '' : 'Enter a whole number from 1 to 52.'),
    pref: x => (x ? '' : 'Choose a learning preference.'),
  };
  for (const k in rules) {
    const msg = rules[k](v[k] || ''), input = form.elements[k];
    $('#' + k + '-err').textContent = msg; input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (msg && ok) { input.focus(); ok = false; }
  }
  return ok ? { goal: v.goal.trim(), level: v.level, known: (v.known || '').trim(), daily: +v.daily, weeks: +v.weeks, pref: v.pref } : null;
}

async function submitRoadmap(e) {
  e.preventDefault();
  const form = e.target, err = $('#formError'); err.hidden = true;
  const payload = validate(form); if (!payload) return;
  const btn = $('#genBtn'); btn.disabled = true; btn.classList.add('loading'); $('#genLabel').textContent = 'Generating…';
  try {
    const { roadmap, fallback } = await requestRoadmap(payload);
    state.draft = roadmap; state.open = new Set([roadmap.id + ':0']);
    closeDialog($('#createDialog')); form.reset(); show('roadmap', roadmap.id);
    if (fallback) toast(`${fallback} Showing a demo roadmap, not an AI-generated one.`, 'warn');
    else toast('Your roadmap is ready.', 'success');
  } catch (ex) {
    err.textContent = ex.message; err.hidden = false; toast('Could not generate your roadmap.', 'error');
  } finally { btn.disabled = false; btn.classList.remove('loading'); $('#genLabel').textContent = 'Generate My Roadmap'; }
}

/* 9 ── Accounts (Flask session login, SQLite on the server) */
let authMode = 'login';
function updateProfile() {
  const u = state.user, p = $('.profile'), top = $('.topbar .avatar'), act = u ? 'logout' : 'open-auth';
  p.dataset.action = act; top.dataset.action = act;
  p.querySelector('.avatar').textContent = top.textContent = u ? u.email[0].toUpperCase() : 'G';
  p.querySelector('strong').textContent = u ? u.email : 'Guest learner';
  p.querySelector('small').textContent = u ? 'Click to log out' : 'Demo mode · Sign in';
  $('.demo-note').hidden = !!u;
}
async function setUser(user) {
  state.user = user; state.draft = null;
  if (user) { const d = await api('/api/roadmaps'); state.roadmaps = d.roadmaps.map(fromServer); } else loadState();
  updateProfile(); if (state.view === 'roadmap') show('dashboard'); else renderAll();
}
async function submitAuth(e) {
  e.preventDefault();
  const name = $('#fullName'), email = $('#email'), pw = $('#password');
  const nameValue = name.value.trim();
  const nMsg = (authMode === 'register' && !nameValue) || nameValue.length > 100 ? 'Enter your full name (up to 100 characters).' : '';
  const eMsg = /^\S+@\S+\.\S+$/.test(email.value) ? '' : 'Enter a valid email address.';
  const pMsg = pw.value.length >= 8 ? '' : 'Use at least 8 characters.';
  $('#name-err').textContent = nMsg; $('#email-err').textContent = eMsg; $('#password-err').textContent = pMsg;
  name.setAttribute('aria-invalid', String(!!nMsg)); email.setAttribute('aria-invalid', String(!!eMsg)); pw.setAttribute('aria-invalid', String(!!pMsg));
  if (nMsg || eMsg || pMsg) { (nMsg ? name : eMsg ? email : pw).focus(); return; }
  const btn = $('#authSubmit'); btn.disabled = true;
  try {
    const d = await api('/api/auth/' + authMode, 'POST', { name: nameValue, email: email.value.trim(), password: pw.value });
    closeDialog($('#authDialog')); e.target.reset(); setPasswordVisibility(false); await setUser(d.user);
    toast(authMode === 'login' ? 'Signed in.' : 'Account created. You are signed in.', 'success');
  } catch (ex) { toast(ex.message, 'error'); } finally { btn.disabled = false; }
}
function setPasswordVisibility(visible) {
  const pw = $('#password'), toggle = $('.password-toggle');
  pw.type = visible ? 'text' : 'password';
  toggle.setAttribute('aria-pressed', String(visible));
  toggle.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  toggle.title = visible ? 'Hide password' : 'Show password';
  toggle.innerHTML = ico(visible ? 'eye-off' : 'eye');
  icons();
}

/* 10 ── Events (delegated) */
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-action]'); if (!t) return;
  const a = t.dataset.action;
  switch (a) {
    case 'nav': show(t.dataset.view); break;
    case 'open-create': openDialog($('#createDialog')); $('#goal').focus(); break;
    case 'open-auth': openDialog($('#authDialog')); break;
    case 'toggle-password': setPasswordVisibility($('#password').type === 'password'); break;
    case 'close-dialog': closeDialog(t.closest('dialog')); break;
    case 'notify':
    case 'open-reminders':
      renderRemindersModal();
      openDialog($('#remindersDialog'));
      break;
    case 'request-notify':
      if ('Notification' in window) {
        try {
          const perm = await Notification.requestPermission();
          if (perm === 'granted') {
            toast('Desktop notifications enabled!', 'success');
            sendDesktopNotification('SkillUp Notifications Enabled', 'We will alert you if tasks exceed your set study time.');
          } else {
            toast('Notifications permission: ' + perm, 'info');
          }
        } catch (err) {
          toast('Unable to enable notifications.', 'error');
        }
      } else {
        toast('Desktop notifications are not supported in this browser.', 'info');
      }
      break;
    case 'timer-start': {
      const rmId = t.dataset.rm, mIdx = +t.dataset.m, tIdx = +t.dataset.t, mins = +(t.dataset.min || 30);
      startTaskTimer(rmId, mIdx, tIdx, mins);
      break;
    }
    case 'start-topic-timer': {
      const rmId = t.dataset.rm, mIdx = +t.dataset.m, tIdx = +t.dataset.t;
      const rm = findRoadmap(rmId);
      const mins = (rm && rm.modules[mIdx]?.topics[tIdx]?.targetMinutes) || 30;
      startTaskTimer(rmId, mIdx, tIdx, mins);
      break;
    }
    case 'timer-toggle-pause':
      if (state.timer.active) {
        state.timer.paused = !state.timer.paused;
        toast(state.timer.paused ? 'Timer paused' : 'Timer resumed', 'info');
        if (state.view === 'roadmap') renderDetail($('#roadmapDetail').dataset.id);
      }
      break;
    case 'timer-reset':
      resetTimer();
      break;
    case 'timer-preset': {
      const min = +t.dataset.min;
      const curRmId = state.timer.rmId || $('#roadmapDetail').dataset.id;
      const rm = findRoadmap(curRmId);
      if (state.timer.active) {
        state.timer.totalSec = min * 60;
        state.timer.remainingSec = min * 60;
        state.timer.targetMinutes = min;
        state.timer.startedAt = Date.now();
        state.timer.expired = false;
        state.timer.notified = false;
      }
      if (rm) {
        const nx = nextTopic(rm);
        const mIdx = state.timer.active ? state.timer.mIndex : (nx ? nx.mIndex : 0);
        const tIdx = state.timer.active ? state.timer.tIndex : (nx ? nx.tIndex : 0);
        if (rm.modules[mIdx]?.topics[tIdx]) {
          rm.modules[mIdx].topics[tIdx].targetMinutes = min;
          syncProgress(rm);
        }
      }
      toast(`Goal set to ${min} minutes`, 'info');
      if (state.view === 'roadmap') renderDetail(curRmId);
      break;
    }
    case 'timer-snooze':
      snoozeTimer(+(t.dataset.min || 15));
      break;
    case 'timer-complete-task':
      completeActiveTask(t.dataset.rm, +t.dataset.m, +t.dataset.t);
      break;
    case 'reminder-go-task': {
      const rmId = t.dataset.rm;
      closeDialog($('#remindersDialog'));
      state.open.add(rmId + ':' + t.dataset.m);
      show('roadmap', rmId);
      break;
    }
    case 'reminder-complete':
      completeActiveTask(t.dataset.rm, +t.dataset.m, +t.dataset.t);
      renderRemindersModal();
      break;
    case 'reminder-dismiss': {
      const i = +t.dataset.i;
      if (Number.isInteger(i) && state.reminders[i]) {
        state.reminders.splice(i, 1);
      } else {
        const rmId = t.dataset.rm, mIdx = +t.dataset.m, tIdx = +t.dataset.t;
        state.reminders = state.reminders.filter(r => !(r.rmId === rmId && r.mIndex === mIdx && r.tIndex === tIdx));
      }
      saveReminders();
      updateReminderUI();
      renderRemindersModal();
      if (state.view === 'roadmap') renderDetail($('#roadmapDetail').dataset.id);
      break;
    }
    case 'open-roadmap': state.open = state.open.size ? state.open : new Set([t.dataset.id + ':0']); show('roadmap', t.dataset.id); break;
    case 'start-skill': {
      const s = SKILLS[+t.dataset.i];
      const rm = buildDemoRoadmap({ goal: s.name, level: s.level, known: '', daily: 30, weeks: s.weeks, pref: 'Mixed' });
      state.draft = rm; state.open = new Set([rm.id + ':0']); show('roadmap', rm.id);
      toast('Demo roadmap created. It is not AI-generated.', 'warn'); break;
    }
    case 'save-roadmap': {
      const rm = findRoadmap(t.dataset.id); if (!rm) break;
      if (state.user) {   // real save: only report success after the server confirms
        try {
          const d = await api('/api/roadmaps', 'POST', { roadmap: toPayload(rm) }); rm.id = String(d.id);
          const k = progressKeys(rm); if (k.length) await api(`/api/roadmaps/${rm.id}/progress`, 'PATCH', { completed: k, timers: timerPayload(rm) });
          state.roadmaps.unshift(rm); state.draft = null; state.open = new Set([rm.id + ':0']); renderDetail(rm.id); toast('Saved to your account.', 'success');
        } catch (ex) { toast('Could not save: ' + ex.message, 'error'); }
        break;
      }
      rm.source = rm.source === 'api' ? 'api' : 'demo'; state.roadmaps.unshift(rm); state.draft = null; persist(); renderDetail(rm.id);
      toast('Saved in this browser only (demo mode). Sign in to save to your account.', 'success'); break;
    }
    case 'complete-module': {
      const rm = findRoadmap(t.dataset.rm), m = rm.modules[+t.dataset.m], next = !modDone(m);
      m.topics.forEach(x => (x.done = next)); renderDetail(rm.id); renderStats(); syncProgress(rm);
      if (next && pctOf(rm) === 100) {
        renderCertificateArea();
        toast('🎉 Roadmap complete! Your certificate is ready in the Progress tab.', 'success');
      } else {
        toast(next ? 'Module marked as complete.' : 'Module marked as incomplete.', next ? 'success' : 'info');
      }
      break;
    }
    case 'delete-roadmap': {
      const rm = findRoadmap(t.dataset.id); if (!rm || !confirm(`Delete "${rm.title}"? This cannot be undone.`)) break;
      try { if (state.user) await api(`/api/roadmaps/${rm.id}`, 'DELETE'); state.roadmaps = state.roadmaps.filter(r => r !== rm); persist(); show('roadmaps'); toast('Roadmap deleted.', 'success'); }
      catch (ex) { toast('Could not delete: ' + ex.message, 'error'); } break;
    }
    case 'logout':
      if (!confirm('Are you sure you want to log out?')) break;
      try { await api('/api/auth/logout', 'POST'); window.location.href = '/'; } catch (ex) { toast(ex.message, 'error'); } break;
    case 'reset-demo':
      if (state.user) { toast('Demo data is only used while signed out.'); break; }
      localStorage.removeItem(CONFIG.STORAGE_KEY); localStorage.removeItem(CONFIG.REMINDER_KEY); state.draft = null; loadState(); loadReminders(); renderAll(); toast('Demo data reset.', 'success'); break;
    case 'open-cert':
      openCertificate(t.dataset.id);
      break;
    case 'print-cert':
      printCert();
      break;
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'soundToggle' || t.dataset.action === 'toggle-sound') {
    state.soundEnabled = t.checked;
    localStorage.setItem('skillup_sound', String(state.soundEnabled));
    toast(state.soundEnabled ? 'Chime sound enabled' : 'Chime sound muted', 'info');
    return;
  }
  if (t.dataset.action !== 'toggle-topic') return;
  const rmId = t.dataset.rm, mIdx = +t.dataset.m, tIdx = +t.dataset.t;
  const rm = findRoadmap(rmId);
  if (!rm) return;
  rm.modules[mIdx].topics[tIdx].done = t.checked;
  if (t.checked) {
    if (state.timer.active && state.timer.rmId === rmId && state.timer.mIndex === mIdx && state.timer.tIndex === tIdx) {
      resetTimer();
    }
    state.reminders = state.reminders.filter(r => !(r.rmId === rmId && r.mIndex === mIdx && r.tIndex === tIdx));
    saveReminders();
  }
  renderDetail(rm.id); renderStats(); updateReminderUI(); syncProgress(rm);
  const el = $(`[data-m="${mIdx}"][data-t="${tIdx}"]`); if (el) el.focus();
});
// Remember which modules are expanded across re-renders (toast does not bubble, so capture).
document.addEventListener('toggle', e => {
  const k = e.target.dataset && e.target.dataset.key; if (!k) return;
  e.target.open ? state.open.add(k) : state.open.delete(k);
}, true);

$('#roadmapForm').addEventListener('submit', submitRoadmap);
$('#authForm').addEventListener('submit', submitAuth);
$('#menuBtn').addEventListener('click', () => setMenu(!$('#sidebar').classList.contains('open')));
$('#scrim').addEventListener('click', closeMenu);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
$('#search').addEventListener('input', e => { state.query = e.target.value.trim(); if (state.view === 'roadmap') return; renderAll(); });
$('#levelChips').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  state.level = b.dataset.level; $$('#levelChips .chip').forEach(c => c.setAttribute('aria-pressed', String(c === b))); renderAll();
});
$$('.tabs [data-mode]').forEach(b => b.addEventListener('click', () => {
  authMode = b.dataset.mode; $$('.tabs .chip').forEach(c => c.setAttribute('aria-pressed', String(c === b)));
  $('#authTitle').textContent = authMode === 'login' ? 'Sign in to SkillUp' : 'Create your SkillUp account';
  $('#authSubmit').textContent = authMode === 'login' ? 'Sign in' : 'Create account';
  $('#fullName').required = authMode === 'register';
  $('#name-err').textContent = '';
  $('#password').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
}));
// Return focus to the trigger and clear stale validation when a dialog closes. Backdrop click closes too.
$$('dialog').forEach(d => {
  d.addEventListener('close', () => { if (state.lastFocus && document.contains(state.lastFocus)) state.lastFocus.focus(); });
  d.addEventListener('click', e => { if (e.target === d) d.close(); });
});

/* Boot */
(async () => {
  const soundPref = localStorage.getItem('skillup_sound');
  if (soundPref !== null) state.soundEnabled = soundPref === 'true';
  const soundToggle = $('#soundToggle');
  if (soundToggle) soundToggle.checked = state.soundEnabled;
  try { const d = await api('/api/auth/me'); if (d.user) await setUser(d.user); else loadState(); } catch (e) { loadState(); }
  loadReminders();
  updateProfile(); updateReminderUI(); show('dashboard');
})();
