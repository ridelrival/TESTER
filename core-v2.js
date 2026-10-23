export const QUESTION_DATA_VERSION = 1;
export const STORAGE_VERSION = 1;
export const EXAM_LENGTH = 30;
export const EXAM_MINUTES = 80;
export const PASS_PERCENT = 60;
export const SECTION_LABELS = [
  "第2章 安全衛生", "第3章 品質管理", "第4章 検査", "第5章 測定",
  "第6章 製図", "第7章 機械の操作・管理", "第8章 金属材料、金属加工",
  "第9章 電気機器・成形・塗装・包装・アルミニウム加工",
];

const validId = id => Number.isInteger(id) && id >= 2000 && id < 10000 && Math.floor(id / 1000) >= 2 && Math.floor(id / 1000) <= 9;

export function validateQuestions(questions) {
  if (!Array.isArray(questions) || !questions.length) throw new Error("Question bank is empty");
  const ids = new Set();
  for (const q of questions) {
    if (!validId(q.id) || ids.has(q.id)) throw new Error(`Invalid or duplicate question ID: ${q.id}`);
    ids.add(q.id);
    if (!SECTION_LABELS.includes(q.section) || !q.subcategory || !q.knowledgeUnit) throw new Error(`Invalid section on question ${q.id}`);
    if (q.examCategory !== "M60-J11J" || q.sourceClass !== "AI-generated 予想問題") throw new Error(`Invalid provenance on question ${q.id}`);
    if (typeof q.question !== "string" || !q.question.trim() || /�/u.test(q.question)) throw new Error(`Invalid question ${q.id}`);
    if (!Array.isArray(q.choices) || q.choices.length !== 4 || q.choices.some(c => typeof c !== "string" || !c.trim() || /�/u.test(c)) || new Set(q.choices).size !== 4) throw new Error(`Invalid choices on question ${q.id}`);
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3) throw new Error(`Invalid answer on question ${q.id}`);
    if (q.image !== null && (typeof q.image !== "string" || !/^[a-z0-9-]+\.svg$/.test(q.image))) throw new Error(`Invalid image on question ${q.id}`);
    if (typeof q.explanation !== "string" || !q.explanation.trim() || typeof q.explanationId !== "string" || !q.explanationId.trim() || !Array.isArray(q.sourcePages) || q.sourcePages.length !== 2) throw new Error(`Missing explanation/source on question ${q.id}`);
  }
  if (SECTION_LABELS.some(section => !questions.some(q => q.section === section))) throw new Error("A chapter is empty");
  return { total: ids.size, imageQuestions: questions.filter(q => q.image).length, uniqueImages: new Set(questions.map(q => q.image).filter(Boolean)).size };
}

export function initialState() {
  return {
    storageVersion: STORAGE_VERSION, questionDataVersion: QUESTION_DATA_VERSION,
    progress: {},
    settings: { theme: "light", showFurigana: true, shuffleQuestions: false, shuffleChoices: false, autoNext: false, choiceSeed: Math.floor(Math.random() * 2147483647) },
    currentQuestionId: 2001, filter: "all", sectionFilter: "all", randomOrder: [], examHistory: [], activeExam: null,
  };
}

const nonnegative = value => Number.isInteger(value) && value >= 0 ? value : 0;
export function normalizeState(input) {
  const base = initialState();
  if (!input || typeof input !== "object") return base;
  const progress = {};
  for (const [key, value] of Object.entries(input.progress || {})) {
    const id = Number(key);
    if (!validId(id) || !value || typeof value !== "object") continue;
    const correctCount = nonnegative(value.correctCount), wrongCount = nonnegative(value.wrongCount);
    progress[id] = {
      attemptCount: Math.max(nonnegative(value.attemptCount), correctCount + wrongCount),
      correctCount, wrongCount,
      lastAnswer: Number.isInteger(value.lastAnswer) && value.lastAnswer >= 0 && value.lastAnswer <= 3 ? value.lastAnswer : null,
      lastResult: ["correct", "wrong"].includes(value.lastResult) ? value.lastResult : null,
      bookmarked: Boolean(value.bookmarked),
    };
  }
  const s = input.settings || {};
  return {
    ...base, progress,
    settings: {
      theme: ["light", "dark", "system"].includes(s.theme) ? s.theme : "light",
      showFurigana: typeof s.showFurigana === "boolean" ? s.showFurigana : true,
      shuffleQuestions: Boolean(s.shuffleQuestions), shuffleChoices: Boolean(s.shuffleChoices),
      autoNext: Boolean(s.autoNext),
      choiceSeed: Number.isInteger(s.choiceSeed) ? s.choiceSeed : base.settings.choiceSeed,
    },
    currentQuestionId: validId(input.currentQuestionId) ? input.currentQuestionId : 2001,
    filter: ["all", "wrong", "unanswered", "bookmarked", "random"].includes(input.filter) ? input.filter : "all",
    sectionFilter: SECTION_LABELS.includes(input.sectionFilter) ? input.sectionFilter : "all",
    randomOrder: Array.isArray(input.randomOrder) ? [...new Set(input.randomOrder.filter(validId))] : [],
    examHistory: Array.isArray(input.examHistory) ? input.examHistory.filter(validExamRecord).slice(-100) : [],
    activeExam: validActiveExam(input.activeExam) ? input.activeExam : null,
  };
}
function validActiveExam(exam) {
  return exam && Array.isArray(exam.questionIds) && exam.questionIds.length === EXAM_LENGTH &&
    new Set(exam.questionIds).size === EXAM_LENGTH && exam.questionIds.every(validId) &&
    Number.isFinite(exam.deadline) && Number.isInteger(exam.index) && exam.index >= 0 && exam.index < EXAM_LENGTH &&
    exam.answers && typeof exam.answers === "object" &&
    Object.entries(exam.answers).every(([id, answer]) => exam.questionIds.includes(Number(id)) && Number.isInteger(answer) && answer >= 0 && answer < 4);
}
function validExamRecord(exam) {
  return exam && Array.isArray(exam.questionIds) && exam.questionIds.length === EXAM_LENGTH &&
    new Set(exam.questionIds).size === EXAM_LENGTH && exam.questionIds.every(validId) &&
    exam.score && Number.isInteger(exam.score.correct) && exam.score.correct >= 0 && exam.score.correct <= EXAM_LENGTH &&
    Number.isFinite(exam.score.accuracy) && Array.isArray(exam.score.review) && exam.score.review.length === EXAM_LENGTH;
}

export function recordStudyAnswer(state, question, originalIndex, retry = false) {
  if (!Number.isInteger(originalIndex) || originalIndex < 0 || originalIndex > 3) throw new Error("Invalid choice");
  const prior = state.progress[question.id] || { attemptCount: 0, correctCount: 0, wrongCount: 0, lastAnswer: null, lastResult: null, bookmarked: false };
  if (prior.lastResult && !retry) return false;
  const correct = originalIndex === question.correctIndex;
  state.progress[question.id] = {
    ...prior, attemptCount: prior.attemptCount + 1,
    correctCount: prior.correctCount + Number(correct), wrongCount: prior.wrongCount + Number(!correct),
    lastAnswer: originalIndex, lastResult: correct ? "correct" : "wrong",
  };
  return true;
}

export function progressStats(state, questions) {
  const validIds = new Set(questions.map(q => q.id));
  const values = Object.entries(state.progress).filter(([id]) => validIds.has(Number(id))).map(([, p]) => p);
  const answered = values.filter(p => p.attemptCount > 0).length;
  const correct = values.filter(p => p.lastResult === "correct").length;
  const wrong = values.filter(p => p.lastResult === "wrong").length;
  return { total: questions.length, answered, unanswered: questions.length - answered, correct, wrong,
    bookmarked: values.filter(p => p.bookmarked).length, everWrong: values.filter(p => p.wrongCount > 0).length,
    accuracy: answered ? Math.round(correct / answered * 1000) / 10 : 0 };
}

export function filterQuestions(questions, state) {
  let list = questions.filter(q => state.sectionFilter === "all" || q.section === state.sectionFilter);
  if (state.filter === "wrong") list = list.filter(q => state.progress[q.id]?.wrongCount > 0);
  if (state.filter === "unanswered") list = list.filter(q => !state.progress[q.id]?.attemptCount);
  if (state.filter === "bookmarked") list = list.filter(q => state.progress[q.id]?.bookmarked);
  if (state.filter === "random" || state.settings.shuffleQuestions) {
    const order = new Map(state.randomOrder.map((id, i) => [id, i]));
    list = [...list].sort((a, b) => (order.get(a.id) ?? 9999 + a.id) - (order.get(b.id) ?? 9999 + b.id));
  }
  return list;
}

export function shuffled(values, random = Math.random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function orderedChoices(question, shuffle, seed) {
  const result = question.choices.map((text, originalIndex) => ({ text, originalIndex }));
  if (!shuffle) return result;
  let x = (seed ^ Math.imul(question.id, 2654435761)) >>> 0;
  const random = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
  return shuffled(result, random);
}
export function selectExamQuestions(questions, random = Math.random, history = []) {
  if (questions.length < EXAM_LENGTH) throw new Error("Insufficient validated questions for exam");
  const frequency = new Map();
  for (const exam of history.slice(-5)) for (const id of exam.questionIds || []) frequency.set(id, (frequency.get(id) || 0) + 1);
  const rank = pool => shuffled(pool, random).sort((a, b) => (frequency.get(a.id) || 0) - (frequency.get(b.id) || 0));
  const chosen = [];
  // Analytical breadth rule, not an official topic weighting: at least three from each chapter.
  for (const section of SECTION_LABELS) {
    const pool = questions.filter(q => q.section === section);
    if (pool.length < 3) throw new Error("Insufficient questions in " + section);
    chosen.push(...rank(pool).slice(0, 3));
  }
  const used = new Set(chosen.map(q => q.id));
  chosen.push(...rank(questions.filter(q => !used.has(q.id))).slice(0, EXAM_LENGTH - chosen.length));
  const ids = shuffled(chosen.map(q => q.id), random);
  const signature = list => [...list].sort((a, b) => a - b).join(",");
  if (history.some(exam => signature(exam.questionIds) === signature(ids))) {
    const byId = new Map(questions.map(q => [q.id, q]));
    for (let i = ids.length - 1; i >= 0; i--) {
      const section = byId.get(ids[i]).section;
      const remaining = rank(questions.filter(q => q.section === section && !ids.includes(q.id)));
      if (remaining.length) { ids[i] = remaining[0].id; break; }
    }
  }
  return ids;
}
export function scoreExam(exam, questionsById) {
  const review = exam.questionIds.map(id => {
    const question = questionsById.get(id), raw = exam.answers[id];
    if (!question) throw new Error("Exam references missing question " + id);
    const answer = Number.isInteger(raw) && raw >= 0 && raw <= 3 ? raw : null;
    return { id, answer, correctIndex: question.correctIndex, correct: answer === question.correctIndex };
  });
  const correct = review.filter(item => item.correct).length;
  const accuracy = Math.round(correct / EXAM_LENGTH * 1000) / 10;
  return { correct, wrong: EXAM_LENGTH - correct, accuracy, passed: accuracy >= PASS_PERCENT, review };
}
