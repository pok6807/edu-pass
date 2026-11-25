let db = Edu.emptyData();
const PAGE_SIZE = 8;
const STALE_MS = 60 * 1000;

const state = {
  user: null,
  booting: false,
  syncing: false,
  lastSync: 0,
  gisFailed: false,
  page: "form",
  navOpen: false,
  printing: false,
  form: blankForm(),
  formError: "",
  saving: false,
  filters: blankFilters(null),
  dashPage: 1,
  modal: null,
  loginError: "",
  adminTab: "teachers",
  importLevel: "",
  adminQ: "",
  adminLevel: "",
  adminTeacher: "",
  revealedStudentId: "",
  evidenceFile: null,
  evidencePreview: "",
  evidenceToken: 0,
  evidenceStatus: "",
  formTeacherQ: "",
};

function blankForm(teacherId) {
  return { teacherId: teacherId || "", levelId: "", studentId: "", statusId: "", note: "" };
}

function blankFilters(user) {
  return {
    teacherId: user && user.role === "teacher" ? user.teacher_id : "",
    levelId: "",
    statusId: "",
    dateFrom: "",
    dateTo: "",
    q: "",
  };
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || "-";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function todayIso() {
  return Edu.nowIso().slice(0, 10);
}

function shiftDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return Edu.nowIso(date).slice(0, 10);
}

function teacherName(id) {
  const teacher = db.teachers.find((t) => t.id === id);
  return teacher ? teacher.name : "-";
}

function teacherMatchesQuery(name, q) {
  const needle = String(q || "").trim().toLocaleLowerCase("th");
  if (!needle) return true;
  return String(name || "").toLocaleLowerCase("th").includes(needle);
}

function levelName(id) {
  const level = db.levels.find((l) => l.id === id);
  return level ? level.name : "-";
}

function studentById(id) {
  return db.students.find((s) => s.id === id) || null;
}

function userName(id) {
  const user = db.users.find((u) => u.id === id);
  return user ? user.name : "-";
}

function pagesFor(role) {
  if (role === "executive") return ["dashboard"];
  if (role === "admin") return ["form", "dashboard", "admin"];
  return ["form", "dashboard"];
}

function canEditReport(report) {
  if (!state.user || !report) return false;
  if (state.user.role === "admin" || state.user.role === "officer") return true;
  return state.user.role === "teacher" && report.teacher_id === state.user.teacher_id;
}

function pageMeta(page) {
  if (page === "dashboard") {
    return { title: "Dashboard", subtitle: "ภาพรวมการติดตั้งแอปและปัญหาที่ยังค้างอยู่" };
  }
  if (page === "admin") {
    return { title: "จัดการข้อมูลหลัก", subtitle: "บัญชีผู้ใช้ รายชื่อครู ระดับการศึกษา และนักศึกษา" };
  }
  return { title: "บันทึกข้อมูล", subtitle: "เลือกครู ระดับการศึกษา นักศึกษา และสถานะ แล้วบันทึก" };
}

function filterOpts() {
  return { user: state.user, ...state.filters };
}

function scopeOpts() {
  return { ...filterOpts(), statusId: "", q: "" };
}

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2800);
}

function logoImg(className) {
  return '<img class="' + className + '" src="img/educationid-icon.png" alt="EducationID">';
}

function statusBadge(id) {
  const status = Edu.statusById(id);
  if (!status) return '<span class="badge badge-off">ไม่ระบุ</span>';
  return '<span class="badge badge-' + status.tone + '">' + esc(status.name) + "</span>";
}

function render() {
  if (!state.user) {
    render.keepScroll = false;
    document.getElementById("app").innerHTML = renderLogin();
    document.body.classList.remove("modal-open");
    document.title = "เข้าสู่ระบบ · EDU APP TRACKER";
    mountLogin();
    return;
  }
  const keepScroll = render.keepScroll;
  render.keepScroll = false;
  const scroller = document.querySelector(".content");
  const scrollTop = keepScroll && scroller ? scroller.scrollTop : 0;
  const active = document.activeElement;
  const focusId = keepScroll && active && active.id ? active.id : "";
  document.getElementById("app").innerHTML = renderShell();
  document.body.classList.toggle("modal-open", !!state.modal);
  const shell = document.querySelector(".shell");
  if (shell) shell.classList.toggle("nav-open", state.navOpen);
  const nextScroll = document.querySelector(".content");
  if (keepScroll && nextScroll) nextScroll.scrollTop = scrollTop;
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
      el.focus();
      try {
        const pos = el.value.length;
        el.setSelectionRange(pos, pos);
      } catch (err) {
        /* some inputs do not support selection */
      }
    }
  }
  const evidenceInput = document.getElementById("form-evidence");
  if (evidenceInput && state.evidenceFile) {
    const transfer = new DataTransfer();
    transfer.items.add(state.evidenceFile);
    evidenceInput.files = transfer.files;
  }
  const reveal = document.querySelector(".status-reveal.is-pop");
  if (reveal) reveal.scrollIntoView({ behavior: "smooth", block: "nearest" });
  document.title = pageMeta(state.page).title + " · EDU APP TRACKER";
}

function renderLogin() {
  let action = "";
  if (state.booting) action = '<p class="hint" role="status">กำลังตรวจสอบบัญชีและโหลดข้อมูล...</p>';
  else if (!Api.configured()) action = '<p class="error">ยังไม่ได้ตั้งค่า API_URL และ GOOGLE_CLIENT_ID ในไฟล์ js/config.js</p>';
  else if (state.gisFailed) action = '<button type="button" class="btn" data-action="retry-gis">ลองโหลดปุ่มเข้าสู่ระบบอีกครั้ง</button>';
  else action = '<div id="gsi-button" class="gsi-slot"></div>';
  const retry =
    !state.booting && Api.hasToken() && state.loginError
      ? '<button type="button" class="btn secondary" data-action="retry-load">ลองโหลดข้อมูลอีกครั้ง</button>'
      : "";
  return (
    '<div class="login-screen"><section class="login-hero"><div class="brand-mark">' +
    logoImg("logo") +
    "<span><strong>EDU APP TRACKER</strong><small>EducationID</small></span></div>" +
    "<h1>ระบบติดตามการติดตั้งแอปของนักศึกษา</h1>" +
    '<p class="lead">ศูนย์ส่งเสริมการเรียนรู้ระดับอำเภอวังสามหมอ</p>' +
    '<ul class="hero-list"><li>ครูบันทึกสถานะของนักศึกษาในความรับผิดชอบ</li><li>ผู้บริหารดูภาพรวมได้จากข้อมูลชุดเดียวกัน</li><li>เข้าได้เฉพาะบัญชี Google ที่ผู้ดูแลระบบเพิ่มไว้</li></ul></section>' +
    '<section class="login-panel"><div class="login-card"><h2>เข้าสู่ระบบ</h2>' +
    '<p class="sub">ใช้บัญชี Google ที่ผู้ดูแลระบบเพิ่มไว้ให้</p>' +
    action +
    (state.loginError ? '<p class="error" role="alert">' + esc(state.loginError) + "</p>" : "") +
    retry +
    "</div></section></div>"
  );
}

function mountLogin() {
  const el = document.getElementById("gsi-button");
  if (!el) return;
  Api.mountButton(el, signedIn).catch((err) => {
    state.gisFailed = true;
    state.loginError = err && err.message ? err.message : "โหลดปุ่มเข้าสู่ระบบไม่ได้";
    render();
  });
}

function normalizeDb(data) {
  const empty = Edu.emptyData();
  const src = data || {};
  return {
    version: 1,
    teachers: Array.isArray(src.teachers) ? src.teachers : [],
    levels: Array.isArray(src.levels) && src.levels.length ? src.levels : empty.levels,
    students: Array.isArray(src.students) ? src.students : [],
    reports: Array.isArray(src.reports) ? src.reports : [],
    users: Array.isArray(src.users) ? src.users : [],
  };
}

function applyBootstrap(result, first) {
  const previousRole = state.user ? state.user.role : "";
  const previousId = state.user ? state.user.id : "";
  db = normalizeDb(result.data);
  state.user = result.user;
  state.booting = false;
  state.loginError = "";
  state.lastSync = Date.now();
  if (first || previousRole !== state.user.role || previousId !== state.user.id) {
    state.form = blankForm(state.user.role === "teacher" ? state.user.teacher_id : "");
    state.filters = blankFilters(state.user);
    state.modal = null;
    clearEvidence();
    const hash = location.hash.replace("#", "");
    const allowed = pagesFor(state.user.role);
    state.page = allowed.includes(hash) ? hash : allowed[0];
  }
  render();
}

async function loadData() {
  try {
    applyBootstrap(await Api.call("bootstrap"), !state.user);
  } catch (err) {
    state.booting = false;
    state.user = null;
    if (err.status === 401 || err.status === 403) Api.signOut();
    state.loginError = err && err.message ? err.message : "โหลดข้อมูลไม่สำเร็จ";
    render();
  }
}

function signedIn() {
  state.booting = true;
  state.loginError = "";
  render();
  return loadData();
}

async function remote(action, data) {
  try {
    return await Api.call(action, data);
  } catch (err) {
    if (err.status === 401) {
      state.user = null;
      state.modal = null;
      state.saving = false;
      state.syncing = false;
      state.loginError = err.message;
      render();
    }
    throw err;
  }
}

async function refreshData(silent) {
  if (state.syncing || !state.user) return;
  state.syncing = true;
  if (!silent) {
    render.keepScroll = true;
    render();
  }
  try {
    const result = await remote("bootstrap");
    state.syncing = false;
    render.keepScroll = true;
    applyBootstrap(result, false);
    if (!silent) toast("อัปเดตข้อมูลล่าสุดแล้ว");
  } catch (err) {
    state.syncing = false;
    if (!state.user) return;
    render.keepScroll = true;
    render();
    if (!silent) toast(err.message || "โหลดข้อมูลไม่สำเร็จ");
  }
}

function maybeRefresh() {
  if (state.page === "dashboard" && !state.modal && Date.now() - state.lastSync > STALE_MS) refreshData(true);
}

function upsertLocal(list, item) {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index >= 0) list[index] = item;
  else list.push(item);
}

function submitBtn(label) {
  const saving = !!(state.modal && state.modal.saving);
  return '<button class="btn" type="submit"' + (saving ? " disabled" : "") + ">" + (saving ? "กำลังบันทึก..." : label) + "</button>";
}

async function submitModal(action, data, draft, apply, message) {
  if (!state.modal || state.modal.saving) return;
  const modal = state.modal;
  modal.saving = true;
  modal.error = "";
  if (draft) modal.draft = draft;
  render.keepScroll = true;
  render();
  try {
    const result = await remote(action, data);
    apply(result);
    if (state.modal === modal) state.modal = null;
    render.keepScroll = true;
    render();
    toast(message);
  } catch (err) {
    if (!state.user) return;
    modal.saving = false;
    if (state.modal !== modal) return toast(err.message || "บันทึกไม่สำเร็จ");
    modalError(err.message || "บันทึกไม่สำเร็จ", draft);
  }
}

function renderShell() {
  const meta = pageMeta(state.page);
  const allowed = pagesFor(state.user.role);
  const nav = [
    ["form", "บันทึกข้อมูล"],
    ["dashboard", "Dashboard"],
    ["admin", "จัดการข้อมูล"],
  ]
    .filter(([id]) => allowed.includes(id))
    .map(
      ([id, label]) =>
        '<button type="button" data-action="nav" data-page="' +
        id +
        '"' +
        (state.page === id ? ' aria-current="page"' : "") +
        ">" +
        label +
        "</button>"
    )
    .join("");

  let body = "";
  if (state.page === "dashboard") body = renderDashboard();
  else if (state.page === "admin") body = renderAdmin();
  else body = renderForm();

  return (
    '<div class="shell">' +
    '<button type="button" class="nav-backdrop" data-action="close-nav" aria-label="ปิดเมนู"></button>' +
    '<aside class="sidebar">' +
    '<div class="brand-mark">' +
    logoImg("logo") +
    '<span><strong>EDU APP TRACKER</strong><small>EducationID</small></span></div>' +
    '<nav class="nav" aria-label="เมนูหลัก">' +
    nav +
    "</nav>" +
    '<div class="sidebar-user"><div><b>' +
    esc(state.user.name) +
    "</b><span>" +
    esc(Edu.ROLES[state.user.role] || state.user.role) +
    '</span><span class="user-email">' +
    esc(state.user.email) +
    '</span></div><div class="btn-row"><button type="button" class="btn ghost small" data-action="refresh"' +
    (state.syncing ? " disabled" : "") +
    ">" +
    (state.syncing ? "กำลังโหลด..." : "รีเฟรชข้อมูล") +
    '</button><button type="button" class="btn ghost small" data-action="logout">ออกจากระบบ</button></div></div></aside>' +
    '<div class="main"><header class="topbar"><p class="org-name"><span>ศูนย์ส่งเสริมการเรียนรู้</span><span>ระดับอำเภอวังสามหมอ</span></p><div class="topbar-row"><button type="button" class="icon-btn no-print" data-action="toggle-nav" aria-label="เปิดเมนู">☰</button>' +
    logoImg("top-logo no-print") +
    '<div class="topbar-title"><h1>' +
    esc(meta.title) +
    "</h1><p>" +
    esc(meta.subtitle) +
    '</p></div></div></header><div class="content" id="content">' +
    body +
    "</div></div></div>" +
    renderModal()
  );
}

function stepClass(done, current) {
  return done ? "done" : current ? "current" : "";
}

function evidenceField(form, parentPop) {
  const pop = state.evidenceStatus !== "1" && !parentPop;
  state.evidenceStatus = "1";
  const preview = state.evidencePreview
    ? '<img class="evidence-preview" src="' + esc(state.evidencePreview) + '" alt="ตัวอย่างหลักฐาน">'
    : "";
  return (
    '<div class="evidence-box' +
    (pop ? " is-pop" : "") +
    '"><label class="field">แนบหลักฐาน<input id="form-evidence" type="file" accept="image/*">' +
    (state.evidenceFile ? '<span class="hint">ไฟล์ที่เลือก: ' + esc(state.evidenceFile.name) + "</span>" : "") +
    '<span class="hint">รูปจะถูกเก็บในโฟลเดอร์ Google Drive ของหน่วยงานเมื่อกดบันทึก</span></label>' +
    preview +
    "</div>"
  );
}

async function readEvidence(file) {
  let blob = file;
  if (file.size > 1.5 * 1024 * 1024 && /^image\/(jpeg|png|webp)$/.test(file.type) && globalThis.createImageBitmap) {
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const smaller = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      if (smaller && smaller.size < file.size) blob = smaller;
    } catch (err) {
      /* the browser could not decode it here; send the original file */
    }
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("อ่านไฟล์รูปไม่ได้"));
    reader.readAsDataURL(blob);
  });
  return { mimeType: blob.type || file.type, data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
}

function clearEvidence() {
  state.evidenceFile = null;
  state.evidencePreview = "";
  state.evidenceToken += 1;
}

function evidenceAnchor(row) {
  if (!row || !row.evidence_url) return "";
  return ' <a href="' + esc(row.evidence_url) + '" target="_blank" rel="noopener">หลักฐาน</a>';
}

function renderForm() {
  const form = state.form;
  const teacherLocked = state.user.role === "teacher";
  const teachers = teacherLocked
    ? db.teachers.filter((t) => t.id === state.user.teacher_id)
    : db.teachers.filter((t) => t.is_active).sort((a, b) => a.name.localeCompare(b.name, "th"));
  const teacherQ = state.formTeacherQ;
  let teacherOptions = teachers.filter((t) => teacherMatchesQuery(t.name, teacherQ));
  if (form.teacherId && !teacherOptions.some((t) => t.id === form.teacherId)) {
    const picked = teachers.find((t) => t.id === form.teacherId);
    if (picked) teacherOptions = [picked, ...teacherOptions];
  }
  const teacherSearchHint =
    !teacherLocked && teacherQ.trim() && teachers.length
      ? '<p class="hint">แสดง ' + teacherOptions.length + " จาก " + teachers.length + " ครู</p>"
      : "";
  const levels = form.teacherId ? Edu.levelsForTeacher(db, form.teacherId) : [];
  const students = form.teacherId && form.levelId ? Edu.studentsFor(db, form.teacherId, form.levelId) : [];
  const missing = [];
  if (!form.teacherId) missing.push("ครู");
  if (!form.levelId) missing.push("ระดับ");
  if (!form.studentId) missing.push("นักศึกษา");
  if (!form.statusId) missing.push("สถานะ");
  if (String(form.statusId) === "1" && !state.evidenceFile) missing.push("หลักฐาน");
  const ready = Edu.canSave(form) && !state.saving && !missing.includes("หลักฐาน");

  const steps =
    "<ol class=\"steps\">" +
    '<li class="' + stepClass(!!form.teacherId, !form.teacherId) + '">1. ครู</li>' +
    '<li class="' + stepClass(!!form.levelId, !!form.teacherId && !form.levelId) + '">2. ระดับ</li>' +
    '<li class="' + stepClass(!!form.studentId, !!form.levelId && !form.studentId) + '">3. นักศึกษา</li>' +
    '<li class="' + stepClass(!!form.statusId, !!form.studentId && !form.statusId) + '">4. สถานะ</li></ol>';

  let studentHint = "";
  if (form.studentId) {
    const history = db.reports.filter((r) => r.student_id === form.studentId);
    const latest = Edu.latestByStudent(history).get(form.studentId);
    studentHint = latest
      ? '<p class="ok-hint">สถานะล่าสุด: ' + esc(Edu.statusById(latest.status_id).name) + " · " + esc(formatDate(latest.created_at)) + " · มี " + history.length + " รายการ</p>"
      : '<p class="hint">นักศึกษานี้ยังไม่มีรายการในระบบ</p>';
  }

  const recent = Edu.filterReports(db, { user: state.user, teacherId: "", levelId: "", statusId: "", dateFrom: "", dateTo: "", q: "" }).slice(0, 6);
  const identityReady = !!(form.teacherId && form.levelId && form.studentId);
  const popStatus = identityReady && state.revealedStudentId !== form.studentId;
  state.revealedStudentId = identityReady ? form.studentId : "";
  if (!identityReady || String(form.statusId) !== "1") state.evidenceStatus = "";
  const evidenceHtml = identityReady && String(form.statusId) === "1" ? evidenceField(form, popStatus) : "";
  const statusSection = identityReady
    ? '<div class="status-reveal' +
      (popStatus ? " is-pop" : "") +
      '">' +
      studentHint +
      '<div class="field"><span>สถานะ / รายการปัญหา</span><div class="status-grid">' +
      Edu.STATUSES.map((status) => {
        return (
          '<label class="status-card' +
          (String(form.statusId) === String(status.id) ? " is-selected" : "") +
          '" style="--c:' +
          status.color +
          '"><input type="radio" name="status" id="status-' +
          status.id +
          '" value="' +
          status.id +
          '"' +
          (String(form.statusId) === String(status.id) ? " checked" : "") +
          '><span class="status-dot"></span><span><strong>' +
          esc(status.name) +
          "</strong><small>" +
          esc(status.hint) +
          "</small></span></label>"
        );
      }).join("") +
      "</div></div>" +
      evidenceHtml +
      '<label class="field">หมายเหตุ (ไม่บังคับ)<textarea id="form-note" name="note" maxlength="500" placeholder="รายละเอียดเพิ่มเติม ถ้ามี">' +
      esc(form.note) +
      "</textarea></label>" +
      (state.formError ? '<p class="error">' + esc(state.formError) + "</p>" : "") +
      (missing.length && !state.formError ? '<p class="hint">ยังต้องเลือก: ' + esc(missing.join(", ")) + "</p>" : "") +
      '<div class="btn-row"><button class="btn" type="submit"' +
      (ready ? "" : " disabled") +
      ">" +
      (state.saving ? (String(form.statusId) === "1" ? "กำลังส่งรูป..." : "กำลังบันทึก...") : "บันทึกข้อมูล") +
      '</button><button class="btn secondary" type="button" data-action="clear-entry">ล้างนักศึกษาและสถานะ</button></div>' +
      '<p class="hint">หลังบันทึก ระบบล้างชื่อนักศึกษาและหมายเหตุ แต่คงครู ระดับ และสถานะไว้ เพื่อบันทึกคนถัดไป</p></div>'
    : "";

  return (
    '<div class="form-layout"><section class="panel"><div class="panel-head"><div><h2>แบบฟอร์มบันทึก</h2>' +
    '<p>เลือกได้หนึ่งสถานะต่อการบันทึก ถ้ามีหลายปัญหาให้บันทึกเพิ่มอีกครั้ง</p></div></div>' +
    steps +
    '<form id="record-form"><fieldset class="plain"' +
    (state.saving ? " disabled" : "") +
    '><div class="stack">' +
    '<div class="field teacher-field"><span>ชื่อครูผู้รับผิดชอบ</span>' +
    (teacherLocked
      ? ""
      : '<input id="form-teacher-q" type="search" value="' +
        esc(teacherQ) +
        '" placeholder="พิมพ์เพื่อค้นหาชื่อครู" autocomplete="off">') +
    '<select id="form-teacher" name="teacher"' +
    (teacherLocked ? " disabled" : "") +
    ">" +
    (teacherLocked ? "" : '<option value="">— เลือกครู —</option>') +
    (teacherQ.trim() && !teacherOptions.length ? '<option value="" disabled>ไม่พบชื่อที่ค้นหา</option>' : "") +
    teacherOptions
      .map((t) => '<option value="' + esc(t.id) + '"' + (t.id === form.teacherId ? " selected" : "") + ">" + esc(t.name) + "</option>")
      .join("") +
    "</select>" +
    teacherSearchHint +
    "</div>" +
    '<label class="field">ระดับการศึกษา<select id="form-level" name="level"' +
    (form.teacherId ? "" : " disabled") +
    ">" +
    '<option value="">' +
    (form.teacherId ? "— เลือกระดับ —" : "เลือกครูก่อน") +
    "</option>" +
    levels
      .map((l) => '<option value="' + esc(l.id) + '"' + (l.id === form.levelId ? " selected" : "") + ">" + esc(l.name) + "</option>")
      .join("") +
    "</select></label>" +
    '<label class="field">ชื่อนักศึกษา<select id="form-student" name="student"' +
    (form.levelId ? "" : " disabled") +
    ">" +
    '<option value="">' +
    (form.levelId ? "— เลือกนักศึกษา —" : "เลือกระดับก่อน") +
    "</option>" +
    students
      .map(
        (s) =>
          '<option value="' +
          esc(s.id) +
          '"' +
          (s.id === form.studentId ? " selected" : "") +
          ">" +
          esc(s.student_code + " · " + s.student_name) +
          "</option>"
      )
      .join("") +
    "</select></label>" +
    statusSection +
    "</div></fieldset></form></section>" +
    '<section class="panel"><div class="panel-head"><div><h2>รายการล่าสุด</h2><p>ในขอบเขตที่บัญชีนี้เห็นได้</p></div>' +
    '<button type="button" class="btn secondary small" data-action="nav" data-page="dashboard">ดูใน Dashboard</button></div>' +
    (recent.length ? recentTable(recent, true) : '<p class="empty">ยังไม่มีรายการ</p>') +
    "</section></div>"
  );
}

function recentTable(rows, manage) {
  return (
    '<div class="table-wrap"><table><thead><tr><th>วันที่บันทึก</th><th>นักศึกษา</th><th>สถานะ</th>' +
    (manage ? "<th>การจัดการ</th>" : "") +
    "</tr></thead><tbody>" +
    rows
      .map((row) => {
        const student = studentById(row.student_id);
        return (
          "<tr><td>" +
          esc(formatDate(row.created_at)) +
          "</td><td>" +
          esc(student ? student.student_name : "-") +
          '<span class="code">' +
          esc(teacherName(row.teacher_id) + " · " + levelName(row.level_id)) +
          "</span></td><td>" +
          statusBadge(row.status_id) +
          evidenceAnchor(row) +
          "</td>" +
          (manage ? "<td>" + rowActions(row) + "</td>" : "") +
          "</tr>"
        );
      })
      .join("") +
    "</tbody></table></div>"
  );
}

function rowActions(row) {
  let html =
    '<div class="row-actions"><button type="button" class="btn secondary small" data-action="view-report" data-id="' +
    esc(row.id) +
    '">ดู</button>';
  if (canEditReport(row)) {
    html +=
      '<button type="button" class="btn secondary small" data-action="edit-report" data-id="' +
      esc(row.id) +
      '">แก้ไข</button><button type="button" class="btn secondary small" data-action="delete-report" data-id="' +
      esc(row.id) +
      '">ลบ</button>';
  }
  return html + "</div>";
}

function renderDashboard() {
  const stats = Edu.kpi(db, filterOpts());
  const rateBase = Edu.kpi(db, scopeOpts());
  const percent = rateBase.denom ? Math.round((rateBase.success / rateBase.denom) * 100) : 0;
  const tone = percent >= 80 ? "ok" : percent >= 50 ? "phone" : "thaiid";
  const teachers = state.user.role === "teacher"
    ? db.teachers.filter((t) => t.id === state.user.teacher_id)
    : db.teachers.filter((t) => t.is_active).sort((a, b) => a.name.localeCompare(b.name, "th"));
  const levelOptions = state.filters.teacherId ? Edu.levelsForTeacher(db, state.filters.teacherId) : db.levels;
  const rows = stats.viewReports;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(state.dashPage, pages);
  const start = (page - 1) * PAGE_SIZE;
  const slice = rows.slice(start, start + PAGE_SIZE);

  const teacherSummary = sortGroups(Edu.groupOverview(db, scopeOpts(), "teacher_id"), "teacher");
  const levelSummary = sortGroups(Edu.groupOverview(db, scopeOpts(), "level_id"), "level");

  return (
    renderFilters(teachers, levelOptions, stats.invalidRange) +
    '<section class="cards">' +
    statCard("นักศึกษาที่บันทึกแล้ว", stats.recordedStudents, "คน ไม่ซ้ำ ตามตัวกรอง", "brand") +
    statCard("ลงทะเบียนเรียบร้อย", stats.readyStudents, "คน จากสถานะล่าสุด", "ok") +
    statCard("ยังพบปัญหา", stats.problemStudents, "คน จากสถานะล่าสุด", "thaiid") +
    statCard("รายการปัญหาทั้งหมด", stats.problemRecords, "รายการ ไม่นับซ้ำคน", "phone") +
    "</section>" +
    '<section class="overview"><div class="panel"><div class="panel-head"><div><h2>กราฟสรุปสถานะ</h2><p>นับตามจำนวนรายการบันทึก ' +
    stats.totalRecords +
    " รายการ</p></div></div>" +
    chartBlock(stats) +
    '</div><div class="panel rate-panel tone-' +
    tone +
    '"><h2>ร้อยละความสำเร็จ</h2><div class="rate-num">' +
    percent +
    '%</div><div class="bar"><span style="width:' +
    percent +
    '%"></span></div><p>ลงทะเบียนเรียบร้อย ' +
    rateBase.success +
    " จาก " +
    rateBase.denom +
    " คนในขอบเขต</p><p class=\"section-note\">" +
    (rateBase.hasDate
      ? "ช่วงวันที่นี้ใช้เฉพาะนักศึกษาที่มีรายการในช่วงนั้น"
      : "ยังไม่บันทึก " + rateBase.unrecorded + " คน และไม่ได้นำไปนับเป็นสำเร็จ") +
    " คิดจากสถานะล่าสุดของแต่ละคน ไม่ขึ้นกับตัวกรองสถานะหรือคำค้น</p></div></section>" +
    '<section class="summary-grid"><div class="panel"><div class="panel-head"><div><h2>สรุปตามครู</h2><p>นับนักศึกษาไม่ซ้ำจากสถานะล่าสุด</p></div></div>' +
    summaryTable(teacherSummary, "ครู") +
    '</div><div class="panel"><div class="panel-head"><div><h2>สรุปตามระดับ</h2><p>ใช้ตัวกรองครู ระดับ และวันที่</p></div></div>' +
    summaryTable(levelSummary, "ระดับ") +
    "</div></section>" +
    '<section class="panel"><div class="panel-head"><div><h2>ตารางรายละเอียด</h2><p>แสดง ' +
    (rows.length ? start + 1 : 0) +
    "–" +
    Math.min(start + PAGE_SIZE, rows.length) +
    " จาก " +
    rows.length +
    ' รายการ ตามตัวกรองทั้งหมด</p></div><div class="btn-row no-print">' +
    '<button type="button" class="btn secondary small" data-action="export-xlsx"' +
    (rows.length ? "" : " disabled") +
    '>ดาวน์โหลด Excel</button>' +
    '<button type="button" class="btn secondary small" data-action="export-csv"' +
    (rows.length ? "" : " disabled") +
    '>ดาวน์โหลด CSV</button>' +
    '<button type="button" class="btn secondary small" data-action="print">พิมพ์รายงาน</button></div></div>' +
    (rows.length ? '<div class="no-print">' + detailTable(slice, start) + "</div>" : '<p class="empty">ไม่พบรายการตามตัวกรอง</p>') +
    (rows.length
      ? '<div class="pager no-print"><button type="button" class="btn secondary" data-action="page" data-page="' +
        (page - 1) +
        '"' +
        (page <= 1 ? " disabled" : "") +
        '>ก่อนหน้า</button><p>หน้า ' +
        page +
        " / " +
        pages +
        '</p><button type="button" class="btn secondary" data-action="page" data-page="' +
        (page + 1) +
        '"' +
        (page >= pages ? " disabled" : "") +
        ">ถัดไป</button></div>"
      : "") +
    '<div class="print-only"><h2>รายการทั้งหมดตามตัวกรอง</h2>' +
    (rows.length ? detailTable(rows, 0) : "<p>ไม่มีรายการ</p>") +
    "</div></section>"
  );
}

function statCard(label, value, note, tone) {
  return '<article class="stat tone-' + tone + '"><em>' + esc(label) + "</em><b>" + value + "</b><span>" + esc(note) + "</span></article>";
}

function renderFilters(teachers, levels, invalid) {
  const f = state.filters;
  const locked = state.user.role === "teacher";
  return (
    '<section class="panel no-print"><div class="filters">' +
    '<label class="field">ครูผู้รับผิดชอบ<select id="filter-teacher"' +
    (locked ? " disabled" : "") +
    ">" +
    (locked ? "" : '<option value="">ทั้งหมด</option>') +
    teachers
      .map((t) => '<option value="' + esc(t.id) + '"' + (t.id === f.teacherId ? " selected" : "") + ">" + esc(t.name) + "</option>")
      .join("") +
    "</select></label>" +
    '<label class="field">ระดับการศึกษา<select id="filter-level"><option value="">ทั้งหมด</option>' +
    levels
      .map((l) => '<option value="' + esc(l.id) + '"' + (l.id === f.levelId ? " selected" : "") + ">" + esc(l.name) + "</option>")
      .join("") +
    "</select></label>" +
    '<label class="field">สถานะ<select id="filter-status"><option value="">ทั้งหมด</option>' +
    Edu.STATUSES.map(
      (s) => '<option value="' + s.id + '"' + (String(f.statusId) === String(s.id) ? " selected" : "") + ">" + esc(s.name) + "</option>"
    ).join("") +
    "</select></label>" +
    '<label class="field">ตั้งแต่วันที่<input id="filter-from" type="date" value="' +
    esc(f.dateFrom) +
    '"></label>' +
    '<label class="field">ถึงวันที่<input id="filter-to" type="date" value="' +
    esc(f.dateTo) +
    '"></label>' +
    '<label class="field filter-q">ค้นหาชื่อหรือรหัสนักศึกษา<input id="filter-q" value="' +
    esc(f.q) +
    '" placeholder="เช่น ณัฐพล หรือ 6901"></label></div>' +
    (invalid ? '<p class="error">วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด</p>' : "") +
    '<div class="btn-row" style="margin-top:12px"><button type="button" class="btn secondary small" data-action="range" data-range="week">7 วันล่าสุด</button>' +
    '<button type="button" class="btn secondary small" data-action="range" data-range="month">เดือนนี้</button>' +
    '<button type="button" class="btn secondary small" data-action="clear-filters">ล้างตัวกรอง</button></div></section>'
  );
}

function chartBlock(stats) {
  const total = stats.byStatus.reduce((sum, item) => sum + item.records, 0);
  const radius = 54;
  const circ = 2 * Math.PI * radius;
  let offset = 0;
  const circles = total
    ? stats.byStatus
        .map((item) => {
          const len = (item.records / total) * circ;
          const circle =
            '<circle cx="70" cy="70" r="' +
            radius +
            '" fill="none" stroke="' +
            item.color +
            '" stroke-width="16" stroke-dasharray="' +
            len +
            " " +
            (circ - len) +
            '" stroke-dashoffset="' +
            -offset +
            '" transform="rotate(-90 70 70)"/>';
          offset += len;
          return circle;
        })
        .join("")
    : '<circle cx="70" cy="70" r="54" fill="none" stroke="#e7e2f2" stroke-width="16"/>';

  const legend = stats.byStatus
    .map((item) => {
      const width = total ? Math.round((item.records / total) * 100) : 0;
      return (
        '<li><i class="swatch" style="--c:' +
        item.color +
        '"></i><div><strong>' +
        esc(item.name) +
        '</strong><div class="bar"><span style="width:' +
        width +
        "%;--c:" +
        item.color +
        '"></span></div><small>' +
        item.records +
        " รายการ · " +
        item.students +
        " คนจากสถานะล่าสุด</small></div><b>" +
        width +
        "%</b></li>"
      );
    })
    .join("");

  return (
    '<div class="chart-wrap"><svg class="donut" viewBox="0 0 140 140" role="img" aria-label="สัดส่วนสถานะ">' +
    circles +
    '<text x="70" y="66" text-anchor="middle" font-size="22" font-weight="700" fill="#241b45">' +
    total +
    '</text><text x="70" y="86" text-anchor="middle" font-size="11" fill="#655d7a">รายการ</text></svg><ul class="legend">' +
    legend +
    "</ul></div>"
  );
}

function sortGroups(groups, kind) {
  return [...groups].sort((a, b) => {
    if (kind === "level") {
      const ia = db.levels.findIndex((l) => l.id === a.id);
      const ib = db.levels.findIndex((l) => l.id === b.id);
      return ia - ib;
    }
    return teacherName(a.id).localeCompare(teacherName(b.id), "th");
  });
}

function summaryTable(groups, label) {
  if (!groups.length) return '<p class="empty">ไม่มีข้อมูลในขอบเขตนี้</p>';
  return (
    '<div class="table-wrap"><table><thead><tr><th>' +
    label +
    '</th><th class="num">นักศึกษา</th><th class="num">เรียบร้อย</th><th class="num">พบปัญหา</th><th class="num">ยังไม่บันทึก</th><th class="num">ร้อยละ</th></tr></thead><tbody>' +
    groups
      .map((g) => {
        const name = label === "ครู" ? teacherName(g.id) : levelName(g.id);
        return (
          "<tr><td>" +
          esc(name) +
          '</td><td class="num">' +
          g.denom +
          '</td><td class="num">' +
          g.ready +
          '</td><td class="num">' +
          g.problem +
          '</td><td class="num">' +
          g.unrecorded +
          '</td><td class="num">' +
          g.percent +
          "%</td></tr>"
        );
      })
      .join("") +
    "</tbody></table></div>"
  );
}

function detailTable(rows, offset) {
  return (
    '<div class="table-wrap"><table><thead><tr><th>ลำดับ</th><th>วันที่บันทึก</th><th>ชื่อครู</th><th>ระดับการศึกษา</th><th>ชื่อนักศึกษา</th><th>สถานะ</th><th class="no-print">การจัดการ</th></tr></thead><tbody>' +
    rows
      .map((row, index) => {
        const student = studentById(row.student_id);
        return (
          "<tr><td>" +
          (offset + index + 1) +
          "</td><td>" +
          esc(formatDate(row.created_at)) +
          "</td><td>" +
          esc(teacherName(row.teacher_id)) +
          "</td><td>" +
          esc(levelName(row.level_id)) +
          "</td><td>" +
          esc(student ? student.student_name : "-") +
          '<span class="code">' +
          esc(student ? student.student_code : "") +
          "</span></td><td>" +
          statusBadge(row.status_id) +
          evidenceAnchor(row) +
          '</td><td class="no-print">' +
          rowActions(row) +
          "</td></tr>"
        );
      })
      .join("") +
    "</tbody></table></div>"
  );
}

function exportRows() {
  const rows = Edu.kpi(db, filterOpts()).viewReports;
  const header = ["ลำดับ", "วันที่บันทึก", "ชื่อครู", "ระดับการศึกษา", "รหัสนักศึกษา", "ชื่อนักศึกษา", "สถานะ", "หมายเหตุ", "หลักฐาน", "ผู้บันทึก", "แก้ไขล่าสุด"];
  const body = rows.map((row, index) => {
    const student = studentById(row.student_id);
    const status = Edu.statusById(row.status_id);
    return [
      index + 1,
      formatDate(row.created_at),
      teacherName(row.teacher_id),
      levelName(row.level_id),
      student ? student.student_code : "",
      student ? student.student_name : "",
      status ? status.name : "",
      row.note || "",
      row.evidence_url || "",
      userName(row.created_by),
      formatDate(row.updated_at),
    ];
  });
  return [header, ...body];
}

function renderImportPanel() {
  return (
    '<section class="panel"><div class="panel-head"><div><h2>นำเข้าจากไฟล์ Excel</h2>' +
    "<p>ใช้ไฟล์ที่มีคอลัมน์ชื่อครูและชื่อผู้เรียน ถ้ามีระดับการศึกษาหรือรหัสนักศึกษา ระบบจะใช้ค่านั้นด้วย</p></div>" +
    '<button type="button" class="btn secondary small" data-action="download-roster-template">ดาวน์โหลดแบบฟอร์ม</button></div>' +
    '<div class="filters"><label class="field">ระดับเริ่มต้น ถ้าไฟล์ไม่ได้ระบุ<select id="import-level"><option value="">— เลือกเมื่อจำเป็น —</option>' +
    db.levels
      .map((level) => '<option value="' + esc(level.id) + '"' + (level.id === state.importLevel ? " selected" : "") + ">" + esc(level.name) + "</option>")
      .join("") +
    '</select></label><label class="field">ไฟล์ .xlsx, .xls หรือ .csv<input id="import-file" type="file" accept=".xlsx,.xls,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"></label></div>' +
    '<p class="hint">แถวแรกควรเป็นหัวตาราง เช่น ชื่อครู, ชื่อผู้เรียน, ระดับการศึกษา, รหัสนักศึกษา ระดับใส่ 1, 2 หรือ 3 ก็ได้ คำว่าครูที่นำหน้าชื่อจะถูกจับคู่กับครูที่มีอยู่แล้ว</p></section>'
  );
}

function renderAdmin() {
  const tabs = [
    ["teachers", "ครู"],
    ["levels", "ระดับการศึกษา"],
    ["students", "นักศึกษา"],
    ["users", "บัญชีผู้ใช้"],
  ]
    .map(
      ([id, label]) =>
        '<button type="button" class="btn secondary small" data-action="admin-tab" data-tab="' +
        id +
        '" aria-selected="' +
        (state.adminTab === id ? "true" : "false") +
        '">' +
        label +
        "</button>"
    )
    .join("");
  let panel = "";
  if (state.adminTab === "levels") panel = renderLevels();
  else if (state.adminTab === "students") panel = renderStudentsAdmin();
  else if (state.adminTab === "users") panel = renderUsers();
  else panel = renderTeachers();
  return (
    renderImportPanel() +
    '<section class="panel"><div class="tabs" role="tablist">' +
    tabs +
    '</div><div style="margin-top:14px">' +
    panel +
    "</div></section>"
  );
}

function renderTeachers() {
  const rows = [...db.teachers].sort((a, b) => a.name.localeCompare(b.name, "th"));
  return (
    '<div class="panel-head"><div><h2>รายชื่อครู</h2><p>' +
    rows.length +
    ' คน</p></div><button type="button" class="btn small" data-action="edit-teacher">เพิ่มครู</button></div>' +
    '<div class="table-wrap"><table><thead><tr><th>ชื่อครู</th><th>ระดับที่รับผิดชอบ</th><th>สถานะ</th><th>การจัดการ</th></tr></thead><tbody>' +
    rows
      .map((t) => {
        const levels = (t.level_ids || []).map(levelName).join(", ") || "-";
        return (
          "<tr><td>" +
          esc(t.name) +
          "</td><td>" +
          esc(levels) +
          "</td><td>" +
          (t.is_active ? '<span class="badge badge-ok">ใช้งาน</span>' : '<span class="badge badge-off">ปิดใช้งาน</span>') +
          '</td><td><div class="row-actions"><button type="button" class="btn secondary small" data-action="edit-teacher" data-id="' +
          esc(t.id) +
          '">แก้ไข</button><button type="button" class="btn secondary small" data-action="delete-master" data-target="teacher" data-id="' +
          esc(t.id) +
          '">ลบ</button></div></td></tr>'
        );
      })
      .join("") +
    "</tbody></table></div>"
  );
}

function renderLevels() {
  return (
    '<div class="panel-head"><div><h2>ระดับการศึกษา</h2><p>มี 3 ระดับ คงที่ทั้งระบบ</p></div></div>' +
    '<div class="table-wrap"><table><thead><tr><th>ชื่อระดับ</th><th class="num">นักศึกษา</th></tr></thead><tbody>' +
    db.levels
      .map((level) => {
        const count = db.students.filter((s) => s.level_id === level.id).length;
        return "<tr><td>" + esc(level.name) + '</td><td class="num">' + count + "</td></tr>";
      })
      .join("") +
    "</tbody></table></div>"
  );
}

function renderStudentsAdmin() {
  const q = state.adminQ.trim().toLowerCase();
  const rows = db.students
    .filter((s) => {
      if (state.adminLevel && s.level_id !== state.adminLevel) return false;
      if (state.adminTeacher && s.teacher_id !== state.adminTeacher) return false;
      if (!q) return true;
      return (s.student_name + " " + s.student_code).toLowerCase().includes(q);
    })
    .sort((a, b) => a.student_code.localeCompare(b.student_code, "th"));
  return (
    '<div class="panel-head"><div><h2>รายชื่อนักศึกษา</h2><p>' +
    rows.length +
    ' คน</p></div><button type="button" class="btn small" data-action="edit-student">เพิ่มนักศึกษา</button></div>' +
    '<div class="filters" style="margin-bottom:12px"><label class="field">ระดับ<select id="admin-level"><option value="">ทั้งหมด</option>' +
    db.levels
      .map((l) => '<option value="' + esc(l.id) + '"' + (l.id === state.adminLevel ? " selected" : "") + ">" + esc(l.name) + "</option>")
      .join("") +
    '</select></label><label class="field">ครู<select id="admin-teacher"><option value="">ทั้งหมด</option>' +
    db.teachers
      .map((t) => '<option value="' + esc(t.id) + '"' + (t.id === state.adminTeacher ? " selected" : "") + ">" + esc(t.name) + "</option>")
      .join("") +
    '</select></label><label class="field filter-q">ค้นหา<input id="admin-q" value="' +
    esc(state.adminQ) +
    '" placeholder="ชื่อหรือรหัส"></label></div>' +
    '<div class="table-wrap"><table><thead><tr><th>รหัส</th><th>ชื่อนักศึกษา</th><th>ระดับ</th><th>ครู</th><th>สถานะ</th><th>การจัดการ</th></tr></thead><tbody>' +
    (rows.length
      ? rows
          .map(
            (s) =>
              "<tr><td>" +
              esc(s.student_code) +
              "</td><td>" +
              esc(s.student_name) +
              "</td><td>" +
              esc(levelName(s.level_id)) +
              "</td><td>" +
              esc(teacherName(s.teacher_id)) +
              "</td><td>" +
              (s.is_active ? '<span class="badge badge-ok">ใช้งาน</span>' : '<span class="badge badge-off">ปิดใช้งาน</span>') +
              '</td><td><div class="row-actions"><button type="button" class="btn secondary small" data-action="edit-student" data-id="' +
              esc(s.id) +
              '">แก้ไข</button><button type="button" class="btn secondary small" data-action="delete-master" data-target="student" data-id="' +
              esc(s.id) +
              '">ลบ</button></div></td></tr>'
          )
          .join("")
      : '<tr><td colspan="6" class="empty">ไม่พบนักศึกษา</td></tr>') +
    "</tbody></table></div>"
  );
}

function renderUsers() {
  return (
    '<div class="panel-head"><div><h2>บัญชีผู้ใช้</h2><p>เข้าระบบได้เฉพาะบัญชี Google ที่อีเมลตรงกับรายการนี้ บทบาทกำหนดว่าเห็นข้อมูลอะไรได้บ้าง</p></div><button type="button" class="btn small" data-action="edit-user">เพิ่มบัญชี</button></div>' +
    '<div class="table-wrap"><table><thead><tr><th>อีเมล Google</th><th>ชื่อที่แสดง</th><th>บทบาท</th><th>ครูที่เชื่อม</th><th>การจัดการ</th></tr></thead><tbody>' +
    db.users
      .map(
        (user) =>
          "<tr><td>" +
          esc(user.email) +
          "</td><td>" +
          esc(user.name) +
          "</td><td>" +
          esc(Edu.ROLES[user.role] || user.role) +
          "</td><td>" +
          esc(user.teacher_id ? teacherName(user.teacher_id) : "-") +
          '</td><td><div class="row-actions"><button type="button" class="btn secondary small" data-action="edit-user" data-id="' +
          esc(user.id) +
          '">แก้ไข</button>' +
          (user.id === state.user.id
            ? ""
            : '<button type="button" class="btn secondary small" data-action="delete-master" data-target="user" data-id="' +
              esc(user.id) +
              '">ลบ</button>') +
          "</div></td></tr>"
      )
      .join("") +
    "</tbody></table></div>"
  );
}

function renderModal() {
  const modal = state.modal;
  if (!modal) return "";
  let inner = "";
  if (modal.type === "report-view") inner = reportView(modal.id);
  else if (modal.type === "report-edit") inner = reportEdit(modal.id);
  else if (modal.type === "confirm") inner = confirmBox(modal);
  else if (modal.type === "alert") inner = alertBox(modal.message);
  else if (modal.type === "teacher") inner = teacherForm(modal);
  else if (modal.type === "level") inner = levelForm(modal);
  else if (modal.type === "student") inner = studentForm(modal);
  else if (modal.type === "user") inner = userForm(modal);
  else if (modal.type === "import") inner = importModal(modal);
  if (!inner) return "";
  const wide = modal.type === "import" ? " wide" : "";
  return '<div class="modal-back" data-action="close-modal"><div class="modal' + wide + '" role="dialog" aria-modal="true" data-action="stop">' + inner + "</div></div>";
}

function importResultBadge(result) {
  const labels = {
    "add-student": ["เพิ่มผู้เรียน", "ok"],
    "add-teacher": ["เพิ่มครู", "mail"],
    update: ["อัปเดต", "phone"],
    exists: ["มีอยู่แล้ว", "off"],
    duplicate: ["ซ้ำในไฟล์", "off"],
    error: ["ผิดพลาด", "thaiid"],
  };
  const item = labels[result] || ["-", "off"];
  return '<span class="badge badge-' + item[1] + '">' + item[0] + "</span>";
}

function importModal(modal) {
  const plan = modal.plan;
  const counts = plan.counts;
  const shown = plan.preview.slice(0, 12);
  const more = plan.preview.length - shown.length;
  return (
    "<h2>ตรวจสอบไฟล์ก่อนนำเข้า</h2><p>" +
    esc(modal.fileName) +
    '</p><div class="import-stats"><span>ครูใหม่ ' +
    counts.teachers +
    "</span><span>ผู้เรียนใหม่ " +
    counts.students +
    "</span><span>อัปเดต " +
    counts.updated +
    "</span><span>ระดับใหม่ " +
    counts.levels +
    "</span><span>ข้าม " +
    counts.unchanged +
    "</span><span>ผิดพลาด " +
    counts.errors +
    "</span></div>" +
    (plan.preview.length
      ? '<div class="table-wrap"><table><thead><tr><th>แถว</th><th>ชื่อครู</th><th>ชื่อผู้เรียน</th><th>ระดับ</th><th>รหัส</th><th>ผล</th></tr></thead><tbody>' +
        shown
          .map(
            (row) =>
              "<tr><td>" +
              row.line +
              "</td><td>" +
              esc(row.teacher || "-") +
              "</td><td>" +
              esc(row.student || "-") +
              "</td><td>" +
              esc(row.level || "-") +
              "</td><td>" +
              esc(row.code || "-") +
              "</td><td>" +
              importResultBadge(row.result) +
              '<span class="code">' +
              esc(row.detail) +
              "</span></td></tr>"
          )
          .join("") +
        "</tbody></table></div>" +
        (more > 0 ? '<p class="hint">และอีก ' + more + " แถว</p>" : "")
      : '<p class="empty">ไม่พบชื่อครูหรือชื่อผู้เรียนในไฟล์</p>') +
    (modal.error ? '<p class="error">' + esc(modal.error) + "</p>" : "") +
    '<div class="btn-row"><button type="button" class="btn" data-action="apply-import"' +
    (plan.actionable && !modal.saving ? "" : " disabled") +
    ">" +
    (modal.saving ? "กำลังนำเข้า..." : "นำเข้าข้อมูล") +
    '</button><button type="button" class="btn secondary" data-action="close-modal">ยกเลิก</button></div>'
  );
}

function reportView(id) {
  const row = db.reports.find((r) => r.id === id);
  if (!row) return "";
  const student = studentById(row.student_id);
  const items = [
    ["วันที่บันทึก", formatDate(row.created_at)],
    ["แก้ไขล่าสุด", formatDate(row.updated_at)],
    ["ครู", teacherName(row.teacher_id)],
    ["ระดับ", levelName(row.level_id)],
    ["นักศึกษา", student ? student.student_code + " · " + student.student_name : "-"],
    ["ผู้บันทึก", userName(row.created_by)],
    ["หมายเหตุ", row.note || "-"],
  ];
  return (
    "<h2>รายละเอียดรายการ</h2><dl class=\"detail-list\">" +
    items.map(([k, v]) => "<dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd>").join("") +
    "<dt>สถานะ</dt><dd>" +
    statusBadge(row.status_id) +
    "</dd>" +
    (row.evidence_url
      ? '<dt>หลักฐาน</dt><dd><a href="' + esc(row.evidence_url) + '" target="_blank" rel="noopener">เปิดรูปใน Google Drive</a></dd>'
      : "") +
    "</dl>" +
    '<div class="btn-row">' +
    (canEditReport(row)
      ? '<button type="button" class="btn" data-action="edit-report" data-id="' + esc(row.id) + '">แก้ไข</button>'
      : "") +
    '<button type="button" class="btn secondary" data-action="close-modal">ปิด</button></div>'
  );
}

function reportEdit(id) {
  const row = db.reports.find((r) => r.id === id);
  if (!row) return "";
  const student = studentById(row.student_id);
  return (
    "<h2>แก้ไขรายการ</h2><p>" +
    esc(student ? student.student_name : "") +
    " · " +
    esc(teacherName(row.teacher_id)) +
    '</p><form id="edit-form" class="stack"><div class="status-grid">' +
    Edu.STATUSES.map(
      (status) =>
        '<label class="status-card' +
        (row.status_id === status.id ? " is-selected" : "") +
        '" style="--c:' +
        status.color +
        '"><input type="radio" name="status" value="' +
        status.id +
        '"' +
        (row.status_id === status.id ? " checked" : "") +
        '><span class="status-dot"></span><span><strong>' +
        esc(status.name) +
        "</strong></span></label>"
    ).join("") +
    '</div><label class="field">หมายเหตุ<textarea name="note" maxlength="500">' +
    esc(row.note || "") +
    "</textarea></label>" +
    (state.modal.error ? '<p class="error">' + esc(state.modal.error) + "</p>" : "") +
    '<div class="btn-row">' + submitBtn("บันทึกการแก้ไข") + '<button class="btn secondary" type="button" data-action="close-modal">ยกเลิก</button></div></form>'
  );
}

function confirmBox(modal) {
  return (
    "<h2>" +
    esc(modal.title) +
    "</h2><p>" +
    esc(modal.message) +
    "</p>" +
    (modal.error ? '<p class="error">' + esc(modal.error) + "</p>" : "") +
    '<div class="btn-row"><button type="button" class="btn danger" data-action="confirm-delete"' +
    (modal.saving ? " disabled" : "") +
    ">" +
    (modal.saving ? "กำลังลบ..." : "ยืนยันการลบ") +
    '</button><button type="button" class="btn secondary" data-action="close-modal">ยกเลิก</button></div>'
  );
}

function alertBox(message) {
  return "<h2>ไม่สามารถทำรายการได้</h2><p>" + esc(message) + '</p><button type="button" class="btn" data-action="close-modal">ตกลง</button>';
}

function teacherForm(modal) {
  const draft = modal.draft;
  return (
    "<h2>" +
    (modal.id ? "แก้ไขครู" : "เพิ่มครู") +
    '</h2><form id="teacher-form" class="stack"><label class="field">ชื่อ-นามสกุล<input name="name" value="' +
    esc(draft.name) +
    '" required></label><div class="field"><span>ระดับที่รับผิดชอบ</span><div class="checks">' +
    db.levels
      .map(
        (level) =>
          '<label class="check"><input type="checkbox" name="level_ids" value="' +
          esc(level.id) +
          '"' +
          (draft.level_ids.includes(level.id) ? " checked" : "") +
          ">" +
          esc(level.name) +
          "</label>"
      )
      .join("") +
    '</div></div><label class="check"><input type="checkbox" name="is_active"' +
    (draft.is_active === "on" ? " checked" : "") +
    '>เปิดใช้งาน</label>' +
    (modal.error ? '<p class="error">' + esc(modal.error) + "</p>" : "") +
    '<div class="btn-row">' + submitBtn("บันทึก") + '<button class="btn secondary" type="button" data-action="close-modal">ยกเลิก</button></div></form>'
  );
}

function levelForm(modal) {
  return (
    "<h2>" +
    (modal.id ? "แก้ไขระดับ" : "เพิ่มระดับ") +
    '</h2><form id="level-form" class="stack"><label class="field">ชื่อระดับ<input name="name" value="' +
    esc(modal.draft.name) +
    '" required></label>' +
    (modal.error ? '<p class="error">' + esc(modal.error) + "</p>" : "") +
    '<div class="btn-row">' + submitBtn("บันทึก") + '<button class="btn secondary" type="button" data-action="close-modal">ยกเลิก</button></div></form>'
  );
}

function studentForm(modal) {
  const draft = modal.draft;
  const teachers = db.teachers.filter(
    (t) => (t.is_active && (t.level_ids || []).includes(draft.level_id)) || t.id === draft.teacher_id
  );
  return (
    "<h2>" +
    (modal.id ? "แก้ไขนักศึกษา" : "เพิ่มนักศึกษา") +
    '</h2><form id="student-form" class="stack"><label class="field">รหัสนักศึกษา<input name="student_code" value="' +
    esc(draft.student_code) +
    '" required></label><label class="field">ชื่อ-นามสกุล<input name="student_name" value="' +
    esc(draft.student_name) +
    '" required></label><label class="field">ระดับการศึกษา<select name="level_id"><option value="">— เลือก —</option>' +
    db.levels
      .map((l) => '<option value="' + esc(l.id) + '"' + (l.id === draft.level_id ? " selected" : "") + ">" + esc(l.name) + "</option>")
      .join("") +
    '</select></label><label class="field">ครูผู้รับผิดชอบ<select name="teacher_id"' +
    (draft.level_id ? "" : " disabled") +
    '><option value="">' +
    (draft.level_id ? "— เลือกครู —" : "เลือกระดับก่อน") +
    "</option>" +
    teachers
      .map((t) => '<option value="' + esc(t.id) + '"' + (t.id === draft.teacher_id ? " selected" : "") + ">" + esc(t.name) + "</option>")
      .join("") +
    '</select></label><label class="check"><input type="checkbox" name="is_active"' +
    (draft.is_active === "on" ? " checked" : "") +
    '>เปิดใช้งาน</label>' +
    (modal.error ? '<p class="error">' + esc(modal.error) + "</p>" : "") +
    '<div class="btn-row">' + submitBtn("บันทึก") + '<button class="btn secondary" type="button" data-action="close-modal">ยกเลิก</button></div></form>'
  );
}

function userForm(modal) {
  const draft = modal.draft;
  const showTeacher = draft.role === "teacher";
  return (
    "<h2>" +
    (modal.id ? "แก้ไขบัญชี" : "เพิ่มบัญชี") +
    '</h2><form id="user-form" class="stack"><label class="field">อีเมล Google<input name="email" type="email" value="' +
    esc(draft.email) +
    '" required autocomplete="off" placeholder="name@gmail.com"></label><label class="field">ชื่อที่แสดง<input name="name" value="' +
    esc(draft.name) +
    '" required></label><label class="field">บทบาท<select name="role"' +
    (modal.id === state.user.id ? " disabled" : "") +
    ">" +
    Object.entries(Edu.ROLES)
      .map(([id, label]) => '<option value="' + id + '"' + (draft.role === id ? " selected" : "") + ">" + esc(label) + "</option>")
      .join("") +
    "</select></label>" +
    (showTeacher
      ? '<label class="field">เชื่อมกับครู<select name="teacher_id"><option value="">— เลือกครู —</option>' +
        db.teachers
          .filter((t) => t.is_active || t.id === draft.teacher_id)
          .map((t) => '<option value="' + esc(t.id) + '"' + (t.id === draft.teacher_id ? " selected" : "") + ">" + esc(t.name) + "</option>")
          .join("") +
        "</select></label>"
      : "") +
    (modal.error ? '<p class="error">' + esc(modal.error) + "</p>" : "") +
    '<div class="btn-row">' + submitBtn("บันทึก") + '<button class="btn secondary" type="button" data-action="close-modal">ยกเลิก</button></div></form>'
  );
}

function openModal(modal) {
  state.modal = modal;
  render.keepScroll = true;
  render();
}

function closeModal() {
  state.modal = null;
  render.keepScroll = true;
  render();
}

function validatePayload(payload) {
  if (!payload.teacherId || !payload.levelId || !payload.studentId || !Edu.isValidStatus(payload.statusId)) {
    return "กรุณาเลือกครู ระดับ นักศึกษา และสถานะให้ครบ";
  }
  const student = studentById(payload.studentId);
  if (!student || !student.is_active || student.teacher_id !== payload.teacherId || student.level_id !== payload.levelId) {
    return "นักศึกษาไม่ได้อยู่ในระดับหรือครูที่เลือก";
  }
  return "";
}

async function doSave() {
  if (state.saving) return;
  const noteEl = document.getElementById("form-note");
  const payload = {
    teacherId: state.user.role === "teacher" ? state.user.teacher_id : state.form.teacherId,
    levelId: state.form.levelId,
    studentId: state.form.studentId,
    statusId: Number(state.form.statusId),
    note: (noteEl ? noteEl.value : state.form.note).trim(),
  };
  const error = validatePayload(payload);
  if (error) {
    state.formError = error;
    render.keepScroll = true;
    render();
    return;
  }
  if (payload.statusId === 1 && !state.evidenceFile) {
    state.formError = "กรุณาแนบรูปหลักฐาน";
    render.keepScroll = true;
    render();
    return;
  }
  const file = state.evidenceFile;
  state.saving = true;
  state.formError = "";
  render.keepScroll = true;
  render();
  try {
    const evidence = payload.statusId === 1 ? await readEvidence(file) : null;
    const result = await remote("saveReport", { ...payload, evidence });
    upsertLocal(db.reports, result.report);
    clearEvidence();
    state.form = Edu.reduceForm({ ...state.form, note: payload.note, statusId: String(payload.statusId) }, { type: "saved" });
    state.saving = false;
    render.keepScroll = true;
    render();
    toast(evidence ? "บันทึกและส่งรูปเข้า Google Drive แล้ว" : "บันทึกข้อมูลเรียบร้อยแล้ว");
  } catch (err) {
    state.saving = false;
    if (!state.user) return;
    state.evidenceFile = file;
    state.formError = err && err.message ? err.message : "บันทึกไม่สำเร็จ";
    render.keepScroll = true;
    render();
  }
}

function readDraft(form) {
  const data = new FormData(form);
  const draft = {};
  for (const [key, value] of data.entries()) {
    if (draft[key] === undefined) draft[key] = value;
  }
  form.querySelectorAll('input[type="checkbox"]').forEach((box) => {
    if (!box.name || data.getAll(box.name).length > 1) return;
    draft[box.name] = box.checked ? "on" : "";
  });
  return draft;
}

function modalError(message, draft) {
  state.modal.error = message;
  if (draft) state.modal.draft = draft;
  render.keepScroll = true;
  render();
}

function saveTeacher(form) {
  const data = new FormData(form);
  const draft = {
    name: String(data.get("name") || "").trim(),
    level_ids: data.getAll("level_ids").map(String),
    is_active: data.get("is_active") === "on" ? "on" : "",
  };
  if (!draft.name) return modalError("กรุณากรอกชื่อครู", draft);
  if (state.modal.id) {
    const stuck = db.students.filter(
      (s) => s.teacher_id === state.modal.id && s.is_active && !draft.level_ids.includes(s.level_id)
    );
    if (stuck.length) return modalError("ยังมีนักศึกษาในระดับที่นำออก กรุณาย้ายนักศึกษาก่อน", draft);
  }
  return submitModal(
    "saveTeacher",
    { id: state.modal.id || "", name: draft.name, level_ids: draft.level_ids, is_active: draft.is_active === "on" },
    draft,
    (result) => upsertLocal(db.teachers, result.teacher),
    "บันทึกข้อมูลครูแล้ว"
  );
}

function saveLevel() {
  state.modal = { type: "alert", message: "ระดับการศึกษามี 3 ระดับคงที่ จึงแก้ไขไม่ได้" };
  render();
}

function saveStudent(form) {
  const data = new FormData(form);
  const draft = {
    student_code: String(data.get("student_code") || "").trim(),
    student_name: String(data.get("student_name") || "").trim(),
    level_id: String(data.get("level_id") || ""),
    teacher_id: String(data.get("teacher_id") || ""),
    is_active: data.get("is_active") === "on" ? "on" : "",
  };
  if (!draft.student_code || !draft.student_name || !draft.level_id || !draft.teacher_id) {
    return modalError("กรุณากรอกข้อมูลให้ครบ", draft);
  }
  if (db.students.some((s) => s.student_code === draft.student_code && s.id !== state.modal.id)) {
    return modalError("รหัสนักศึกษานี้มีแล้ว", draft);
  }
  const teacher = db.teachers.find((t) => t.id === draft.teacher_id);
  if (!teacher || !(teacher.level_ids || []).includes(draft.level_id)) {
    return modalError("ครูคนนี้ไม่ได้รับผิดชอบระดับที่เลือก", draft);
  }
  const record = {
    student_code: draft.student_code,
    student_name: draft.student_name,
    level_id: draft.level_id,
    teacher_id: draft.teacher_id,
    is_active: draft.is_active === "on",
  };
  return submitModal(
    "saveStudent",
    { id: state.modal.id || "", ...record },
    draft,
    (result) => upsertLocal(db.students, result.student),
    "บันทึกนักศึกษาแล้ว"
  );
}

function saveUser(form) {
  const data = new FormData(form);
  const existing = state.modal.id ? db.users.find((u) => u.id === state.modal.id) : null;
  const draft = {
    email: String(data.get("email") || "").trim().toLowerCase(),
    name: String(data.get("name") || "").trim(),
    role: existing && existing.id === state.user.id ? existing.role : String(data.get("role") || "officer"),
    teacher_id: String(data.get("teacher_id") || ""),
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email)) return modalError("กรุณากรอกอีเมล Google ให้ถูกต้อง", draft);
  if (!draft.name) return modalError("กรุณากรอกชื่อที่แสดง", draft);
  if (db.users.some((u) => u.email === draft.email && u.id !== state.modal.id)) {
    return modalError("อีเมลนี้มีบัญชีอยู่แล้ว", draft);
  }
  if (draft.role === "teacher") {
    if (!draft.teacher_id) return modalError("เลือกครูที่บัญชีนี้รับผิดชอบ", draft);
    if (db.users.some((u) => u.role === "teacher" && u.teacher_id === draft.teacher_id && u.id !== state.modal.id)) {
      return modalError("ครูคนนี้มีบัญชีอยู่แล้ว", draft);
    }
  } else draft.teacher_id = "";
  return submitModal(
    "saveUser",
    { id: state.modal.id || "", ...draft },
    draft,
    (result) => {
      upsertLocal(db.users, result.user);
      if (result.me) state.user = result.me;
    },
    "บันทึกบัญชีแล้ว"
  );
}

function deleteMaster() {
  const { target, id } = state.modal;
  if (target === "report") {
    const row = db.reports.find((r) => r.id === id);
    if (!canEditReport(row)) return closeModal();
    return submitModal("deleteReport", { id }, null, () => {
      db.reports = db.reports.filter((r) => r.id !== id);
    }, "ลบรายการแล้ว");
  }
  if (target === "teacher") {
    if (db.students.some((s) => s.teacher_id === id) || db.reports.some((r) => r.teacher_id === id)) {
      state.modal = { type: "alert", message: "ครูคนนี้มีนักศึกษาหรือรายการบันทึกอยู่ ให้ปิดใช้งานแทนการลบ" };
      render();
      return;
    }
    if (db.users.some((u) => u.teacher_id === id)) {
      state.modal = { type: "alert", message: "ยังมีบัญชีผู้ใช้ที่เชื่อมกับครูคนนี้" };
      render();
      return;
    }
    return submitModal("deleteTeacher", { id }, null, () => {
      db.teachers = db.teachers.filter((t) => t.id !== id);
    }, "ลบข้อมูลแล้ว");
  } else if (target === "level") {
    state.modal = { type: "alert", message: "ระดับการศึกษามี 3 ระดับคงที่ จึงลบไม่ได้" };
    render();
    return;
  } else if (target === "student") {
    if (db.reports.some((r) => r.student_id === id)) {
      state.modal = { type: "alert", message: "นักศึกษานี้มีรายการบันทึกแล้ว ให้ปิดใช้งานแทนการลบ" };
      render();
      return;
    }
    return submitModal("deleteStudent", { id }, null, () => {
      db.students = db.students.filter((s) => s.id !== id);
    }, "ลบข้อมูลแล้ว");
  } else if (target === "user") {
    if (id === state.user.id) return closeModal();
    const admins = db.users.filter((u) => u.role === "admin" && u.id !== id);
    const targetUser = db.users.find((u) => u.id === id);
    if (targetUser && targetUser.role === "admin" && admins.length === 0) {
      state.modal = { type: "alert", message: "ต้องมีผู้ดูแลระบบอย่างน้อย 1 บัญชี" };
      render();
      return;
    }
    return submitModal("deleteUser", { id }, null, () => {
      db.users = db.users.filter((u) => u.id !== id);
    }, "ลบข้อมูลแล้ว");
  }
  closeModal();
}

function onClick(event) {
  const el = event.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  if (action === "stop") return;
  if (action === "nav") {
    const page = el.dataset.page;
    if (!pagesFor(state.user.role).includes(page)) return;
    state.navOpen = false;
    if (location.hash !== "#" + page) location.hash = page;
    else {
      state.page = page;
      render();
      maybeRefresh();
    }
    return;
  }
  if (action === "toggle-nav") {
    state.navOpen = !state.navOpen;
    render.keepScroll = true;
    render();
    return;
  }
  if (action === "close-nav" || action === "close-modal") {
    if (action === "close-nav") state.navOpen = false;
    if (action === "close-modal") state.modal = null;
    render.keepScroll = true;
    render();
    return;
  }
  if (action === "clear-entry") {
    state.form = { ...state.form, studentId: "", statusId: "", note: "" };
    state.formError = "";
    clearEvidence();
    render.keepScroll = true;
    render();
    return;
  }
  if (action === "logout") {
    Api.signOut();
    state.user = null;
    state.modal = null;
    state.loginError = "";
    db = Edu.emptyData();
    clearEvidence();
    render();
    return;
  }
  if (action === "refresh") {
    refreshData(false);
    return;
  }
  if (action === "retry-load") {
    signedIn();
    return;
  }
  if (action === "retry-gis") {
    state.gisFailed = false;
    state.loginError = "";
    render();
    return;
  }
  if (action === "clear-filters") {
    state.filters = blankFilters(state.user);
    state.dashPage = 1;
    render();
    return;
  }
  if (action === "range") {
    const today = todayIso();
    if (el.dataset.range === "week") {
      state.filters.dateFrom = shiftDays(-6);
      state.filters.dateTo = today;
    } else {
      state.filters.dateFrom = today.slice(0, 8) + "01";
      state.filters.dateTo = today;
    }
    state.dashPage = 1;
    render();
    return;
  }
  if (action === "page") {
    state.dashPage = Number(el.dataset.page);
    render.keepScroll = true;
    render();
    return;
  }
  if (action === "export-xlsx" || action === "export-csv") {
    const rows = exportRows();
    if (rows.length < 2) return;
    const stamp = todayIso();
    if (action === "export-xlsx") {
      downloadBlob(
        "EDU_APP_TRACKER_" + stamp + ".xlsx",
        new Blob([buildXlsx(rows)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
      );
    } else {
      downloadBlob("EDU_APP_TRACKER_" + stamp + ".csv", new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
    }
    return;
  }
  if (action === "print") {
    window.print();
    return;
  }
  if (action === "view-report") return openModal({ type: "report-view", id: el.dataset.id });
  if (action === "edit-report") return openModal({ type: "report-edit", id: el.dataset.id, error: "" });
  if (action === "delete-report") {
    const row = db.reports.find((r) => r.id === el.dataset.id);
    const student = row ? studentById(row.student_id) : null;
    return openModal({
      type: "confirm",
      target: "report",
      id: el.dataset.id,
      title: "ลบรายการบันทึก",
      message: "ต้องการลบรายการของ " + (student ? student.student_name : "นักศึกษานี้") + " ใช่หรือไม่",
    });
  }
  if (action === "confirm-delete") return deleteMaster();
  if (action === "admin-tab") {
    state.adminTab = el.dataset.tab;
    render();
    return;
  }
  if (action === "edit-teacher") {
    const teacher = db.teachers.find((t) => t.id === el.dataset.id);
    return openModal({
      type: "teacher",
      id: teacher ? teacher.id : null,
      error: "",
      draft: teacher
        ? { name: teacher.name, level_ids: [...(teacher.level_ids || [])], is_active: teacher.is_active ? "on" : "" }
        : { name: "", level_ids: [], is_active: "on" },
    });
  }
  if (action === "edit-level") {
    const level = db.levels.find((l) => l.id === el.dataset.id);
    return openModal({ type: "level", id: level ? level.id : null, error: "", draft: { name: level ? level.name : "" } });
  }
  if (action === "edit-student") {
    const student = db.students.find((s) => s.id === el.dataset.id);
    return openModal({
      type: "student",
      id: student ? student.id : null,
      error: "",
      draft: student
        ? { student_code: student.student_code, student_name: student.student_name, level_id: student.level_id, teacher_id: student.teacher_id, is_active: student.is_active ? "on" : "" }
        : { student_code: "", student_name: "", level_id: "", teacher_id: "", is_active: "on" },
    });
  }
  if (action === "edit-user") {
    const user = db.users.find((u) => u.id === el.dataset.id);
    return openModal({
      type: "user",
      id: user ? user.id : null,
      error: "",
      draft: user
        ? { email: user.email || "", name: user.name, role: user.role, teacher_id: user.teacher_id || "" }
        : { email: "", name: "", role: "officer", teacher_id: "" },
    });
  }
  if (action === "delete-master") {
    const target = el.dataset.target;
    const id = el.dataset.id;
    const labels = { teacher: teacherName(id), level: levelName(id), student: (studentById(id) || {}).student_name || "", user: userName(id) };
    return openModal({
      type: "confirm",
      target,
      id,
      title: "ยืนยันการลบ",
      message: "ต้องการลบ " + (labels[target] || "รายการนี้") + " ใช่หรือไม่",
    });
  }
  if (action === "download-roster-template") {
    const rows = [["ชื่อครู", "ชื่อผู้เรียน", "ระดับการศึกษา", "รหัสนักศึกษา"]];
    downloadBlob(
      "แบบฟอร์มรายชื่อครูและผู้เรียน.xlsx",
      new Blob([buildXlsx(rows)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
    );
    return;
  }
  if (action === "apply-import") {
    if (!state.modal || state.modal.type !== "import" || !state.modal.plan.actionable || state.modal.saving) return;
    const modal = state.modal;
    modal.saving = true;
    modal.error = "";
    render.keepScroll = true;
    render();
    remote("importRoster", { entries: modal.entries, defaultLevelId: state.importLevel })
      .then((response) => {
        const result = response.result;
        db = normalizeDb(response.data);
        state.lastSync = Date.now();
        if (state.modal === modal) state.modal = null;
        state.adminTab = "students";
        render();
        const parts = [];
        if (result.teachers) parts.push("ครูใหม่ " + result.teachers + " คน");
        if (result.students) parts.push("ผู้เรียนใหม่ " + result.students + " คน");
        if (result.updated) parts.push("อัปเดต " + result.updated + " คน");
        if (result.levels) parts.push("ระดับใหม่ " + result.levels + " ระดับ");
        toast(parts.length ? "นำเข้าแล้ว: " + parts.join(" · ") : "ไม่มีข้อมูลใหม่ให้นำเข้า");
      })
      .catch((err) => {
        if (!state.user) return;
        modal.saving = false;
        modal.error = err && err.message ? err.message : "นำเข้าไม่สำเร็จ";
        if (state.modal === modal) {
          render.keepScroll = true;
          render();
        } else toast(modal.error);
      });
    return;
  }
}

function onChange(event) {
  const target = event.target;
  if (target.id === "import-level") {
    state.importLevel = target.value;
    return;
  }
  if (target.id === "import-file") {
    const file = target.files && target.files[0];
    target.value = "";
    if (!file) return;
    file
      .arrayBuffer()
      .then((buffer) => readTable(buffer, file.name))
      .then((table) => {
        const entries = Edu.mapRosterTable(table);
        const plan = Edu.planRosterImport(db, entries, state.importLevel);
        state.modal = { type: "import", fileName: file.name, plan, entries, error: "" };
        render();
      })
      .catch((err) => {
        state.modal = { type: "alert", message: err && err.message ? err.message : "อ่านไฟล์ไม่สำเร็จ" };
        render();
      });
    return;
  }
  if (target.id === "form-evidence") {
    const file = target.files && target.files[0];
    if (file && file === state.evidenceFile) return;
    const token = ++state.evidenceToken;
    if (!file || !/^image\//.test(file.type) || file.size > 8 * 1024 * 1024) {
      state.evidenceFile = null;
      state.evidencePreview = "";
      state.formError = !file ? "" : !/^image\//.test(file.type || "") ? "แนบได้เฉพาะไฟล์รูปภาพ" : "รูปใหญ่เกิน 8 MB";
      render.keepScroll = true;
      render();
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (token !== state.evidenceToken || String(state.form.statusId) !== "1") return;
      state.evidenceFile = file;
      state.evidencePreview = String(reader.result || "");
      state.formError = "";
      render.keepScroll = true;
      render();
    };
    reader.readAsDataURL(file);
    return;
  }
  if (target.id === "form-teacher") {
    clearEvidence();
    state.form = Edu.reduceForm(state.form, { type: "teacher", value: target.value });
    state.formError = "";
    render.keepScroll = true;
    render();
    return;
  }
  if (target.id === "form-level") {
    clearEvidence();
    state.form = Edu.reduceForm(state.form, { type: "level", value: target.value });
    state.formError = "";
    render.keepScroll = true;
    render();
    return;
  }
  if (target.id === "form-student") {
    clearEvidence();
    state.form = Edu.reduceForm(state.form, { type: "student", value: target.value });
    state.formError = "";
    render.keepScroll = true;
    render();
    return;
  }
  if (target.name === "status" && target.form && target.form.id === "record-form") {
    if (String(target.value) !== "1") clearEvidence();
    state.form = Edu.reduceForm(state.form, { type: "status", value: target.value });
    state.formError = "";
    render.keepScroll = true;
    render();
    return;
  }
  if (target.id === "filter-teacher") {
    state.filters.teacherId = target.value;
    if (
      target.value &&
      state.filters.levelId &&
      !Edu.levelsForTeacher(db, target.value).some((l) => l.id === state.filters.levelId)
    ) {
      state.filters.levelId = "";
    }
    state.dashPage = 1;
    render.keepScroll = true;
    render();
    return;
  }
  if (target.id === "filter-level" || target.id === "filter-status") {
    const key = target.id === "filter-level" ? "levelId" : "statusId";
    state.filters[key] = target.value;
    state.dashPage = 1;
    render.keepScroll = true;
    render();
    return;
  }
  if (target.id === "filter-from" || target.id === "filter-to") {
    state.filters[target.id === "filter-from" ? "dateFrom" : "dateTo"] = target.value;
    state.dashPage = 1;
    render.keepScroll = true;
    render();
    return;
  }
  if (target.id === "admin-level" || target.id === "admin-teacher") {
    if (target.id === "admin-level") state.adminLevel = target.value;
    else state.adminTeacher = target.value;
    render.keepScroll = true;
    render();
    return;
  }
  if (target.form && target.form.id === "student-form" && target.name === "level_id") {
    const draft = readDraft(target.form);
    draft.level_id = target.value;
    draft.teacher_id = "";
    state.modal.draft = draft;
    state.modal.error = "";
    render.keepScroll = true;
    render();
    return;
  }
  if (target.form && target.form.id === "user-form" && target.name === "role") {
    const draft = readDraft(target.form);
    draft.role = target.value;
    if (draft.role !== "teacher") draft.teacher_id = "";
    state.modal.draft = draft;
    state.modal.error = "";
    render.keepScroll = true;
    render();
  }
}

function onInput(event) {
  const target = event.target;
  if (target.id === "form-note") {
    state.form.note = target.value;
    return;
  }
  if (target.id === "form-teacher-q") {
    state.formTeacherQ = target.value;
    if (event.isComposing) return;
    render.keepScroll = true;
    render();
    return;
  }
  if (target.id === "filter-q") {
    state.filters.q = target.value;
    if (event.isComposing) return;
    state.dashPage = 1;
    render.keepScroll = true;
    render();
    return;
  }
  if (target.id === "admin-q") {
    state.adminQ = target.value;
    if (event.isComposing) return;
    render.keepScroll = true;
    render();
  }
}

function onSubmit(event) {
  event.preventDefault();
  const id = event.target.id;
  if (id === "record-form") return doSave();
  if (id === "edit-form") {
    const row = db.reports.find((r) => r.id === state.modal.id);
    if (!canEditReport(row)) return closeModal();
    const fields = new FormData(event.target);
    const statusId = Number(fields.get("status"));
    if (!Edu.isValidStatus(statusId)) return modalError("กรุณาเลือกสถานะ");
    const note = String(fields.get("note") || "").trim();
    return submitModal(
      "updateReport",
      { id: row.id, statusId, note },
      null,
      (result) => upsertLocal(db.reports, result.report),
      "แก้ไขรายการแล้ว"
    );
  }
  if (id === "teacher-form") return saveTeacher(event.target);
  if (id === "level-form") return saveLevel(event.target);
  if (id === "student-form") return saveStudent(event.target);
  if (id === "user-form") return saveUser(event.target);
}

function onKey(event) {
  if (event.key !== "Escape") return;
  if (state.modal) return closeModal();
  if (state.navOpen) {
    state.navOpen = false;
    render.keepScroll = true;
    render();
  }
}

function onHash() {
  if (!state.user) return;
  const hash = location.hash.replace("#", "");
  const allowed = pagesFor(state.user.role);
  if (!allowed.includes(hash) || state.page === hash) return;
  state.page = hash;
  state.navOpen = false;
  render();
  maybeRefresh();
}

function boot() {
  const app = document.getElementById("app");
  app.addEventListener("click", onClick);
  app.addEventListener("change", onChange);
  app.addEventListener("input", onInput);
  app.addEventListener("submit", onSubmit);
  app.addEventListener("compositionend", (event) => {
    if (event.target.id === "form-teacher-q" || event.target.id === "filter-q" || event.target.id === "admin-q") onInput(event);
  });
  document.addEventListener("keydown", onKey);
  window.addEventListener("hashchange", onHash);
  if (Api.configured() && Api.restore()) {
    signedIn();
    return;
  }
  render();
}

boot();
