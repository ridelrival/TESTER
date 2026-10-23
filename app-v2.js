import {
  EXAM_LENGTH, EXAM_MINUTES, PASS_PERCENT, SECTION_LABELS, filterQuestions, initialState, normalizeState, orderedChoices,
  progressStats, recordStudyAnswer, scoreExam, selectExamQuestions, shuffled, validateQuestions,
} from "./core-v2.js";
import { loadState, resetState, saveState } from "./storage-v2.js";
import { createFuriganaRenderer, validateFurigana } from "./furigana-v2.js";

const root = document.querySelector("#app");
const dialog = document.querySelector("#image-dialog");
const imagePreview = document.querySelector("#large-image");
let questions = [], byId = new Map(), state, view = "home", notice = "", loadFailed = false;
let holdQuestion = null, retryId = null, reviewIndex = 0, latestResult = null, autoNextTimer = null;
let furigana = null, imageReadings = {};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function rich(value) { return (furigana ? furigana.markup(value) : esc(value)).replace(/\*\*(.+?)\*\*/gs, "<strong>$1</strong>"); }
function imageUrl(question) { return question.image ? new URL(question.image, document.baseURI).href : ""; }
function progress(question) { return state.progress[question.id] || null; }
function statusClass(question) {
  const result = progress(question)?.lastResult;
  return result === "correct" ? "correct" : result === "wrong" ? "wrong" : "";
}
function setTheme() {
  const theme = state.settings.theme;
  document.documentElement.dataset.theme = theme;
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]').content = dark ? "#090909" : "#f7f7f7";
}
async function persist() {
  try { await saveState(state); }
  catch (error) { notice = "Gagal menyimpan progres. Periksa ruang penyimpanan dan pengaturan browser."; console.error(error); }
}
async function persistRender() { await persist(); render(); }
function setNotice(message) { notice = message; render(); }
function button(action, label, classes = "", attrs = "") {
  return '<button type="button" class="button ' + classes + '" data-action="' + action + '" ' + attrs + '>' + label + '</button>';
}
function imageInfo(question) { return question.image ? imageReadings[question.image.split("/").at(-1)] : null; }
function imageMarks(info) {
  if (!info) return "";
  return info.labels.map(([x, y, reading, small]) => '<span class="image-ruby' + (small ? ' small-sign' : '')
    + '" style="left:' + (x * 100).toFixed(4) + '%;top:' + (y * 100).toFixed(4)
    + '%" aria-hidden="true">' + esc(reading) + '</span>').join("");
}
function imageBlock(question) {
  if (!question.image) return "";
  const info = imageInfo(question);
  const img = '<img class="question-image" src="' + esc(imageUrl(question)) + '" alt="Diagram soal ' + question.id + '" loading="eager">';
  const content = info ? '<span class="image-canvas" style="width:min(100%,' + Math.min(info.width, info.width / info.height * 500).toFixed(2)
    + 'px)">' + img + imageMarks(info) + '</span>' : img;
  return '<button type="button" class="image-open" data-action="image" data-id="' + question.id + '" aria-label="Perbesar diagram">'
    + content + '</button><p class="image-caption">Ketuk diagram untuk memperbesar</p>';
}
function choicesBlock(question, selected, feedback, locked, exam = false) {
  const choices = orderedChoices(question, state.settings.shuffleChoices, exam ? state.activeExam.seed : state.settings.choiceSeed);
  return '<div class="choices" role="radiogroup" aria-label="Pilihan soal ' + question.id + '">'
    + choices.map(choice => {
      const chosen = selected === choice.originalIndex;
      let cls = "";
      if (feedback) {
        if (choice.originalIndex === question.correctIndex) cls = "is-correct";
        else if (chosen) cls = "is-wrong";
      }
      return '<button type="button" class="choice ' + cls + '" role="radio" aria-checked="' + chosen + '" '
        + 'data-action="' + (exam ? "exam-answer" : "answer") + '" data-id="' + question.id + '" data-choice="' + choice.originalIndex + '" '
        + (locked ? "disabled" : "") + '><span class="radio" aria-hidden="true"></span><span class="choice-text">' + rich(choice.text) + '</span></button>';
    }).join("") + '</div>';
}
function filterItems() {
  return [["all", "Semua"], ["wrong", "Pernah salah"], ["unanswered", "Belum dijawab"],
    ["bookmarked", "Ditandai"], ["random", "Acak"]];
}
function sectionItems() {
  return [["all", "Semua bab"], ...SECTION_LABELS.map(name => [name, name])];
}
function rubySelect(kind, value, items) {
  const label = items.find(item => item[0] === value)?.[1] || items[0][1];
  return '<div class="ruby-select"><button type="button" class="ruby-select-trigger" data-action="toggle-select" aria-controls="' + kind + '-options" aria-expanded="false" aria-haspopup="listbox">'
    + rich(label) + '<span aria-hidden="true">⌄</span></button><div id="' + kind + '-options" class="ruby-select-options" role="listbox" hidden>'
    + items.map(([key, text]) => '<button type="button" role="option" aria-selected="' + (key === value)
      + '" data-action="select-' + kind + '" data-value="' + esc(key) + '">' + rich(text) + '</button>').join("")
    + '</div></div>';
}
function renderHome() {
  const stats = progressStats(state, questions);
  const cards = [
    ["all", "Mulai belajar", questions.length + " soal berurutan"],
    ["wrong", "Pernah salah", stats.everWrong + " soal untuk diulang"],
    ["unanswered", "Belum dijawab", stats.unanswered + " soal"],
    ["bookmarked", "Ditandai", stats.bookmarked + " soal"],
  ];
  return '<p class="eyebrow">SSW TG2 · 機械金属加工区分</p><h1 class="page-title">Manufaktur: Mesin dan Logam<br>' + questions.length + ' soal latihan</h1>'
    + '<p class="lede">Soal prediksi buatan AI dengan 4 pilihan, disusun mengikuti panduan belajar. Progres tersimpan otomatis dan dapat digunakan offline.</p>'
    + '<div class="panel"><div class="progress-track" role="progressbar" aria-valuenow="' + stats.answered + '" aria-valuemin="0" aria-valuemax="' + questions.length + '"><div class="progress-fill" style="width:' + (stats.answered / questions.length * 100) + '%"></div></div>'
    + '<div class="progress-caption"><span>Progres belajar</span><strong>' + stats.answered + ' / ' + questions.length + '</strong></div></div>'
    + '<div class="grid dashboard">'
    + [['Dijawab',stats.answered],['Belum dijawab',stats.unanswered],['Benar',stats.correct],['Salah',stats.wrong],
       ['Akurasi',stats.accuracy + '%'],['Ditandai',stats.bookmarked],['Pernah salah',stats.everWrong],['Berdiagram',questions.filter(q => q.image).length]]
      .map(([label,value]) => '<div class="metric"><strong>' + value + '</strong><span>' + label + '</span></div>').join("") + '</div>'
    + '<div class="grid home-actions">' + cards.map(([filter,title,desc]) =>
      '<button type="button" class="action-card" data-action="open-filter" data-filter="' + filter + '"><strong>' + title + '</strong><span>' + desc + '</span></button>').join("")
    + '<button type="button" class="action-card" data-action="open-exam"><strong>Simulasi ujian</strong><span>' + EXAM_LENGTH + ' soal · ' + EXAM_MINUTES + ' menit</span></button>'
    + '<button type="button" class="action-card" data-action="continue"><strong>Lanjut belajar</strong><span>Dari soal ' + state.currentQuestionId + '</span></button></div>'
    + renderHistory();
}
function renderHistory() {
  if (!state.examHistory.length) return "";
  return '<section class="panel history"><h2>Riwayat simulasi</h2>'
    + [...state.examHistory].reverse().slice(0, 5).map((exam, i) =>
      '<div class="history-item"><span>' + esc(new Date(exam.finishedAt).toLocaleDateString("id-ID")) + ' · Simulasi #' + (state.examHistory.length - i) + '</span><strong>' + exam.score.correct + ' / ' + EXAM_LENGTH + ' (' + exam.score.accuracy + '%)</strong></div>').join("")
    + '</section>';
}
function studyList() {
  const list = filterQuestions(questions, state);
  if (holdQuestion && !list.some(q => q.id === holdQuestion)) {
    const held = byId.get(holdQuestion);
    if (held) return [held, ...list];
  }
  return list;
}
function renderNavigator() {
  return '<aside class="panel navigator" aria-label="Daftar soal"><details class="navigator-details"' + (window.matchMedia("(min-width:801px)").matches ? " open" : "") + '><summary>Navigasi · ' + questions.length + ' soal</summary><p>Hijau: benar · merah: salah · ★: ditandai</p>'
    + '<div class="number-grid">' + questions.map(q =>
      '<button type="button" data-action="jump" data-id="' + q.id + '" class="' + statusClass(q) + (progress(q)?.bookmarked ? " bookmarked" : "") + (q.id === state.currentQuestionId ? " current" : "") + '" aria-label="Soal ' + q.id + '">' + q.id + '</button>'
    ).join("") + '</div></details></aside>';
}
function renderStudy() {
  const list = studyList();
  if (!list.length) return '<div class="panel empty"><h1>Belum ada soal</h1><p>Ubah filter untuk menampilkan soal lain.</p>' + button("clear-filter", "Tampilkan semua", "primary") + '</div>';
  let question = byId.get(state.currentQuestionId);
  if (!list.some(q => q.id === question?.id)) question = list[0];
  state.currentQuestionId = question.id;
  const index = list.findIndex(q => q.id === question.id);
  const p = progress(question), feedback = p?.lastResult && retryId !== question.id;
  const selected = retryId === question.id ? null : p?.lastAnswer;
  const locked = Boolean(feedback);
  return '<div class="study-layout"><div class="study-main">'
    + '<div class="study-toolbar"><div class="field"><span>Tampilkan</span>' + rubySelect('filter', state.filter, filterItems()) + '</div>'
    + '<div class="field"><span>Bab</span>' + rubySelect('section', state.sectionFilter, sectionItems()) + '</div>'
    + button("reshuffle", "Acak ulang", "small", state.filter === "random" || state.settings.shuffleQuestions ? "" : "hidden")
    + '</div><article class="panel">'
    + '<div class="question-meta"><span>' + esc(question.section) + ' · ' + esc(question.subcategory) + '</span>'
    + '<button type="button" class="button bookmark-button" data-action="bookmark" data-id="' + question.id + '" aria-label="Tandai soal" aria-pressed="' + Boolean(p?.bookmarked) + '">' + (p?.bookmarked ? "★" : "☆") + '</button></div>'
    + imageBlock(question)
    + '<h1 class="question-title">Soal ' + question.id + '<br>' + rich(question.question) + '</h1>'
    + choicesBlock(question, selected, feedback, locked)
    + (feedback ? '<div class="feedback ' + p.lastResult + '" role="status">' + (p.lastResult === "correct" ? "Benar" : "Salah") + '</div>'
      + '<p class="explanation">Jawaban: ' + rich(question.choices[question.correctIndex]) + '</p>'
      + '<p class="explanation">Penjelasan: ' + esc(question.explanationId) + '</p>'
      + '<p class="explanation" lang="ja">日本語: ' + rich(question.explanation) + '</p>' : "")
    + (state.filter === "wrong" && p?.wrongCount > 0 && locked ? button("retry", "Jawab lagi", "soft", 'data-id="' + question.id + '"') : "")
    + '<p class="source">Prediksi buatan AI · Panduan JAIM hlm. ' + esc(question.sourcePages.join('–')) + ' · ' + esc(question.knowledgeUnit) + '</p>'
    + '<div class="question-footer">' + button("previous", "← Sebelumnya", "", index <= 0 ? "disabled" : "")
    + '<strong>' + (index + 1) + ' / ' + list.length + '</strong>'
    + button("next", "Berikutnya →", "primary", index >= list.length - 1 ? "disabled" : "") + '</div></article></div>'
    + renderNavigator() + '</div>';
}
function renderExamLanding() {
  return '<p class="eyebrow">SIMULASI UJIAN</p><h1 class="page-title">Simulasi ujian</h1>'
    + '<div class="panel"><p>' + EXAM_LENGTH + ' soal dipilih dari ' + questions.length + ' soal prediksi. Waktu ' + EXAM_MINUTES + ' menit; ambang kelulusan ' + PASS_PERCENT + '%.</p>'
    + '<p>Distribusi soal per bab dirancang untuk meninjau materi secara luas; bukan bobot resmi ujian.</p>'
    + '<p>Hasil dan pembahasan akan ditampilkan setelah simulasi dikirim.</p>'
    + button("start-exam", "Mulai simulasi", "primary") + '</div>' + renderHistory();
}
function renderExam() {
  const exam = state.activeExam;
  if (!exam) return renderExamLanding();
  const index = Math.max(0, Math.min(EXAM_LENGTH - 1, exam.index || 0)), q = byId.get(exam.questionIds[index]);
  const selected = Number.isInteger(exam.answers[q.id]) ? exam.answers[q.id] : null;
  return '<div class="exam-header"><div><p class="eyebrow">SIMULASI UJIAN</p><h1 class="page-title">Soal ' + (index + 1) + ' / ' + EXAM_LENGTH + '</h1></div><div><span class="timer" id="exam-timer" aria-live="off">' + formatTime(exam.deadline - Date.now()) + '</span><br><small>Sisa waktu</small></div></div>'
    + '<article class="panel">' + imageBlock(q) + '<p class="question-meta">' + esc(q.section) + ' · Prediksi ' + q.id + '</p>'
    + '<h2 class="question-title">' + rich(q.question) + '</h2>' + choicesBlock(q, selected, false, false, true)
    + '<div class="question-footer">' + button("exam-previous", "← Sebelumnya", "", index === 0 ? "disabled" : "")
    + '<span>' + Object.keys(exam.answers).length + ' / ' + EXAM_LENGTH + ' dijawab</span>'
    + button("exam-next", "Berikutnya →", "primary", index === EXAM_LENGTH - 1 ? "disabled" : "") + '</div></article>'
    + '<div class="exam-nav" aria-label="Daftar soal simulasi">' + exam.questionIds.map((id, i) =>
      '<button type="button" data-action="exam-jump" data-index="' + i + '" class="' + (Number.isInteger(exam.answers[id]) ? "answered " : "") + (i === index ? "current" : "") + '" aria-label="Soal simulasi ' + (i + 1) + '">' + (i + 1) + '</button>').join("") + '</div>'
    + '<div class="button-row">' + button("submit-exam", "Kirim jawaban", "primary") + '</div>';
}
function renderResult() {
  const result = latestResult || state.examHistory.at(-1);
  if (!result) return renderExamLanding();
  const score = result.score, item = score.review[reviewIndex] || score.review[0], q = byId.get(item.id);
  return '<p class="eyebrow">HASIL SIMULASI</p><h1 class="page-title">Hasil simulasi</h1>'
    + '<div class="grid dashboard"><div class="metric"><strong>' + score.correct + ' / ' + EXAM_LENGTH + '</strong><span>Benar</span></div>'
    + '<div class="metric"><strong>' + score.wrong + '</strong><span>Salah / kosong</span></div>'
    + '<div class="metric"><strong>' + score.accuracy + '%</strong><span>Akurasi</span></div>'
    + '<div class="metric"><strong>' + EXAM_MINUTES + ' menit</strong><span>Waktu ujian</span></div></div>'
    + '<div class="feedback ' + (score.passed ? 'correct' : 'wrong') + '">' + (score.passed ? 'Mencapai ambang' : 'Belum mencapai ambang') + ' · ' + PASS_PERCENT + '%</div>'
    + '<div class="button-row" style="margin-bottom:1rem">' + button("open-exam", "Simulasi baru", "soft") + button("home", "Ke beranda") + '</div>'
    + '<article class="panel">' + imageBlock(q) + '<p class="question-meta">Ulasan ' + (reviewIndex + 1) + ' / ' + EXAM_LENGTH + ' · Prediksi ' + q.id + '</p>'
    + '<h2 class="question-title">' + rich(q.question) + '</h2>'
    + choicesBlock(q, item.answer, true, true)
    + '<div class="feedback ' + (item.correct ? "correct" : "wrong") + '">' + (item.correct ? "Benar" : item.answer === null ? "Kosong" : "Salah") + '</div>'
    + '<p class="explanation">Jawaban Anda: ' + (item.answer === null ? "Kosong" : rich(q.choices[item.answer])) + '</p>'
    + '<p class="explanation">Jawaban benar: ' + rich(q.choices[q.correctIndex]) + '</p>'
    + '<p class="explanation">Penjelasan: ' + esc(q.explanationId) + '</p>'
    + '<p class="explanation" lang="ja">日本語: ' + rich(q.explanation) + '</p>'
    + '<p class="source">Prediksi buatan AI · Panduan JAIM hlm. ' + esc(q.sourcePages.join('–')) + ' · ' + esc(q.knowledgeUnit) + '</p>'
    + '<div class="question-footer">' + button("review-previous", "← Sebelumnya", "", reviewIndex === 0 ? "disabled" : "")
    + button("review-next", "Berikutnya →", "primary", reviewIndex === EXAM_LENGTH - 1 ? "disabled" : "") + '</div></article>';
}
function renderSettings() {
  const s = state.settings;
  return '<p class="eyebrow">PREFERENSI</p><h1 class="page-title">Pengaturan</h1><div class="panel">'
    + '<label class="setting-row"><span><strong>Tema</strong><small>Warna tampilan</small></span><select id="theme-select">'
    + [["system","Sistem"],["light","Terang"],["dark","Gelap"]].map(([v,l]) => '<option value="' + v + '"' + (s.theme === v ? " selected" : "") + '>' + l + '</option>').join("") + '</select></label>'
    + [["showFurigana","Tampilkan furigana","Bantuan baca untuk kanji"],["shuffleQuestions","Acak soal","Nomor soal tetap"],["shuffleChoices","Acak pilihan","Kunci jawaban tetap benar"],["autoNext","Lanjut otomatis setelah benar","Awalnya nonaktif"]]
      .map(([key,label,desc]) => '<label class="setting-row"><span><strong>' + label + '</strong><small>' + desc + '</small></span><input type="checkbox" data-setting="' + key + '"' + (key === "showFurigana" ? ' class="setting-toggle" role="switch"' : '') + (s[key] ? " checked" : "") + '></label>').join("")
    + '</div><div class="panel" style="margin-top:1rem"><h2>Data belajar</h2><p>Cadangkan progres sebagai JSON. Impor akan mengganti progres yang ada.</p>'
    + '<div class="button-row">' + button("export", "Ekspor progres") + button("import", "Impor progres") + button("reset", "Atur ulang progres", "danger") + '</div>'
    + '<input type="file" id="import-file" accept="application/json,.json" hidden></div>';
}
function formatTime(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0");
}
function render() {
  if (!state) return;
  setTheme();
  document.documentElement.dataset.furigana = state.settings.showFurigana ? "on" : "off";
  root.innerHTML = (notice ? '<div class="notice" role="status">' + esc(notice) + '</div>' : "")
    + (view === "home" ? renderHome() : view === "study" ? renderStudy() : view === "exam" ? renderExam() : view === "result" ? renderResult() : renderSettings());
  furigana?.decorate(document.body);
}
function openStudy(filter = "all") {
  state.filter = filter; state.sectionFilter = "all"; holdQuestion = null; retryId = null;
  if (filter === "random" || state.settings.shuffleQuestions) state.randomOrder = shuffled(questions.map(q => q.id));
  view = "study"; render(); persist();
}
function alignCurrentQuestion() {
  const list = filterQuestions(questions, state);
  if (list.length && !list.some(q => q.id === state.currentQuestionId)) state.currentQuestionId = list[0].id;
}
async function navigateStudy(delta, preservePosition = false) {
  const list = studyList();
  const index = list.findIndex(q => q.id === state.currentQuestionId);
  const target = list[index + delta];
  if (!target) return;
  const action = delta > 0 ? "next" : "previous";
  const keepButtonInView = preservePosition && matchMedia("(max-width: 570px)").matches;
  const previousTop = keepButtonInView ? document.querySelector('[data-action="' + action + '"]')?.getBoundingClientRect().top : null;
  holdQuestion = null; retryId = null; state.currentQuestionId = target.id;
  await persistRender();
  if (previousTop == null) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  const image = document.querySelector(".question-image");
  if (image?.decode) await image.decode().catch(() => {});
  await new Promise(requestAnimationFrame);
  const button = document.querySelector('[data-action="' + action + '"]');
  if (button) window.scrollBy(0, button.getBoundingClientRect().top - previousTop);
}
function startExam() {
  state.activeExam = {
    id: Date.now(), questionIds: selectExamQuestions(questions, Math.random, state.examHistory), answers: {}, index: 0,
    startedAt: new Date().toISOString(), deadline: Date.now() + EXAM_MINUTES * 60000,
    seed: Math.floor(Math.random() * 2147483647),
  };
  view = "exam"; persistRender();
}
async function submitExam(force = false) {
  const exam = state.activeExam;
  if (!exam) return;
  const answered = Object.keys(exam.answers).length;
  if (!force && !confirm("Kirim jawaban? Terjawab: " + answered + " / " + EXAM_LENGTH)) return;
  const score = scoreExam(exam, byId);
  latestResult = { ...exam, finishedAt: new Date().toISOString(), score };
  state.examHistory.push(latestResult);
  state.examHistory = state.examHistory.slice(-100);
  state.activeExam = null; reviewIndex = 0; view = "result";
  await persistRender();
}
function exportProgress() {
  const payload = { appId: "ssw-tg2-manufacturing-m60-j11j", version: 1, questionDataVersion: 1, exportedAt: new Date().toISOString(), state };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = "ssw-tg2-manufacturing-progress.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function importProgress(file) {
  try {
    const payload = JSON.parse(await file.text());
    if (payload.appId !== "ssw-tg2-manufacturing-m60-j11j" || payload.version !== 1 || payload.questionDataVersion !== 1 || !payload.state || typeof payload.state !== "object") throw new Error("Unsupported backup format");
    if (!confirm("Ganti progres saat ini dengan data cadangan?")) return;
    state = normalizeState(payload.state); holdQuestion = null; retryId = null; latestResult = null;
    await persist(); notice = "Progres berhasil diimpor."; view = "home"; render();
  } catch (error) { setNotice("Impor gagal. Periksa format JSON dan versi bank soal."); console.error(error); }
}

document.addEventListener("click", async event => {
  const target = event.target.closest("[data-action]");
  if (target?.dataset.action === "retry-load") { init(); return; }
  if (!target || !state) return;
  const action = target.dataset.action, id = Number(target.dataset.id);
  if (autoNextTimer) { clearTimeout(autoNextTimer); autoNextTimer = null; }
  if (action === "home") { view = "home"; render(); }
  else if (action === "settings") { view = "settings"; render(); }
  else if (action === "toggle-select") {
    const menu = target.nextElementSibling;
    const open = menu.hidden;
    document.querySelectorAll('.ruby-select-options').forEach(other => { other.hidden = true; other.previousElementSibling.setAttribute('aria-expanded', 'false'); });
    menu.hidden = !open;
    target.setAttribute('aria-expanded', String(open));
  }
  else if (action === "select-filter") {
    state.filter = target.dataset.value; holdQuestion = null; retryId = null;
    if (state.filter === "random") state.randomOrder = shuffled(questions.map(q => q.id));
    alignCurrentQuestion(); await persistRender();
  }
  else if (action === "select-section") {
    state.sectionFilter = target.dataset.value; holdQuestion = null; retryId = null;
    alignCurrentQuestion(); await persistRender();
  }
  else if (action === "open-study") openStudy("all");
  else if (action === "open-filter") openStudy(target.dataset.filter);
  else if (action === "continue") { state.filter = "all"; state.sectionFilter = "all"; holdQuestion = null; view = "study"; render(); }
  else if (action === "clear-filter") openStudy("all");
  else if (action === "open-exam") { view = "exam"; render(); }
  else if (action === "start-exam") startExam();
  else if (action === "image") {
    const q = byId.get(id), info = imageInfo(q), canvas = document.querySelector('#large-image-canvas');
    imagePreview.src = imageUrl(q); imagePreview.alt = "Diagram soal " + id;
    canvas.style.width = info ? info.width + 'px' : 'min(100%,1100px)';
    canvas.querySelectorAll('.image-ruby').forEach(node => node.remove());
    if (info) canvas.insertAdjacentHTML('beforeend', imageMarks(info));
    dialog.showModal();
  }
  else if (action === "bookmark") {
    const p = progress(byId.get(id)) || { attemptCount: 0, correctCount: 0, wrongCount: 0, lastAnswer: null, lastResult: null, bookmarked: false };
    p.bookmarked = !p.bookmarked; state.progress[id] = p; await persistRender();
  }
  else if (action === "answer") {
    const q = byId.get(id), choice = Number(target.dataset.choice);
    if (recordStudyAnswer(state, q, choice, retryId === id)) {
      holdQuestion = id; retryId = null; await persistRender();
      if (state.settings.autoNext && choice === q.correctIndex) autoNextTimer = setTimeout(() => navigateStudy(1), 1800);
    }
  }
  else if (action === "retry") { retryId = id; render(); }
  else if (action === "previous") await navigateStudy(-1, true);
  else if (action === "next") await navigateStudy(1, true);
  else if (action === "jump") {
    state.filter = "all"; state.sectionFilter = "all"; holdQuestion = null; retryId = null;
    state.currentQuestionId = id; view = "study"; await persistRender(); window.scrollTo(0, 0);
  }
  else if (action === "reshuffle") { state.randomOrder = shuffled(questions.map(q => q.id)); await persistRender(); }
  else if (action === "exam-answer") {
    if (!state.activeExam) return;
    state.activeExam.answers[id] = Number(target.dataset.choice); await persistRender();
  }
  else if (action === "exam-previous" || action === "exam-next") {
    state.activeExam.index = Math.max(0, Math.min(EXAM_LENGTH - 1, state.activeExam.index + (action === "exam-next" ? 1 : -1))); await persistRender();
  }
  else if (action === "exam-jump") { state.activeExam.index = Number(target.dataset.index); await persistRender(); }
  else if (action === "submit-exam") await submitExam();
  else if (action === "review-previous" || action === "review-next") { reviewIndex += action === "review-next" ? 1 : -1; reviewIndex = Math.max(0, Math.min(EXAM_LENGTH - 1, reviewIndex)); render(); }
  else if (action === "export") exportProgress();
  else if (action === "import") document.querySelector("#import-file").click();
  else if (action === "reset") {
    if (!confirm("Hapus seluruh data belajar di perangkat ini?")) return;
    await resetState(); state = initialState(); latestResult = null; view = "home"; notice = "Data belajar dihapus."; render();
  }
});
document.addEventListener("change", async event => {
  if (!state) return;
  const target = event.target;
  if (target.id === "theme-select") {
    state.settings.theme = target.value; await persistRender();
  } else if (target.dataset.setting) {
    state.settings[target.dataset.setting] = target.checked;
    if (target.dataset.setting === "shuffleQuestions" && target.checked) state.randomOrder = shuffled(questions.map(q => q.id));
    await persistRender();
  } else if (target.id === "import-file" && target.files?.[0]) await importProgress(target.files[0]);
});
document.addEventListener('click', event => {
  if (event.target.closest('.ruby-select')) return;
  document.querySelectorAll('.ruby-select-options:not([hidden])').forEach(menu => {
    menu.hidden = true;
    menu.previousElementSibling.setAttribute('aria-expanded', 'false');
  });
});
document.addEventListener('keydown', event => {
  const trigger = event.target.closest('.ruby-select-trigger');
  const option = event.target.closest('.ruby-select-options button');
  const menu = trigger?.nextElementSibling || option?.parentElement;
  if (!menu) return;
  if (event.key === 'Escape' && !menu.hidden) {
    event.preventDefault(); menu.hidden = true;
    menu.previousElementSibling.setAttribute('aria-expanded', 'false');
    menu.previousElementSibling.focus();
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); menu.hidden = false;
    menu.previousElementSibling.setAttribute('aria-expanded', 'true');
    const options = [...menu.querySelectorAll('button')];
    const index = option ? options.indexOf(option) : options.findIndex(el => el.getAttribute('aria-selected') === 'true');
    options[(index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length].focus();
  }
});
document.querySelector("#close-image").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
document.addEventListener("keydown", event => {
  if (view !== "study" && view !== "exam") return;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  if (event.key === "ArrowRight") { event.preventDefault(); if (view === "study") navigateStudy(1); else if (state.activeExam) { state.activeExam.index = Math.min(EXAM_LENGTH - 1, state.activeExam.index + 1); persistRender(); } }
  if (event.key === "ArrowLeft") { event.preventDefault(); if (view === "study") navigateStudy(-1); else if (state.activeExam) { state.activeExam.index = Math.max(0, state.activeExam.index - 1); persistRender(); } }
});
setInterval(() => {
  if (!state?.activeExam) return;
  if (Date.now() >= state.activeExam.deadline) { submitExam(true); return; }
  const timer = document.querySelector("#exam-timer");
  if (timer) timer.textContent = formatTime(state.activeExam.deadline - Date.now());
}, 1000);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (loadFailed) location.reload(); });
  navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" })
    .then(registration => registration.update()).catch(console.error);
}
window.addEventListener("online", () => { if (loadFailed) init(); });

async function init() {
  loadFailed = false;
  root.textContent = "Memuat…";
  try {
    const response = await fetch("./questions.json");
    if (!response.ok) throw new Error("Question database unavailable");
    questions = await response.json();
    validateQuestions(questions);
    const [furiganaResponse, imageResponse] = await Promise.all([fetch('./furigana.json'), fetch('./image-furigana.json')]);
    if (!furiganaResponse.ok || !imageResponse.ok) throw new Error('Furigana data unavailable');
    const furiganaData = await furiganaResponse.json();
    imageReadings = await imageResponse.json();
    validateFurigana(questions, furiganaData);
    furigana = createFuriganaRenderer(furiganaData);
    byId = new Map(questions.map(q => [q.id, q]));
    try { state = await loadState(); }
    catch (error) {
      state = initialState();
      notice = "Progres tersimpan gagal dimuat. Periksa penyimpanan browser.";
      console.error(error);
    }
    if (state.activeExam && state.activeExam.questionIds.some(id => !byId.has(id))) {
      state.activeExam = null;
      notice = "Simulasi lama tidak cocok dengan bank soal saat ini dan telah dibatalkan. Progres belajar tetap tersimpan.";
      await persist();
    }
    if (state.activeExam && Date.now() >= state.activeExam.deadline) await submitExam(true);
    render();
  } catch (error) {
    loadFailed = true;
    root.innerHTML = '<div class="panel empty"><h1>Gagal memuat</h1><p>Periksa koneksi lalu coba lagi. Pembukaan pertama memerlukan koneksi internet.</p><button class="button primary" type="button" data-action="retry-load">Coba lagi</button></div>';
    console.error(error);
  }
}
init();
