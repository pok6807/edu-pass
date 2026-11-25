/* EDU APP TRACKER — data, rules, and dashboard calculations */
const Edu = (function () {

  const STATUSES = [
    {
      id: 1,
      name: "ติดตั้งและลงทะเบียนเรียบร้อยแล้ว",
      short: "เรียบร้อยแล้ว",
      tone: "ok",
      color: "#15803d",
      hint: "นักศึกษาติดตั้งแอปและลงทะเบียนสำเร็จ",
    },
    {
      id: 2,
      name: "เข้าระบบ ThaiID ไม่ได้",
      short: "ThaiID ไม่ได้",
      tone: "thaiid",
      color: "#dc2626",
      hint: "นักศึกษาพบปัญหาในการเข้าสู่ระบบ ThaiID",
    },
    {
      id: 3,
      name: "โทรศัพท์มีปัญหา หรือไม่มีโทรศัพท์",
      short: "โทรศัพท์มีปัญหา",
      tone: "phone",
      color: "#ea580c",
      hint: "อุปกรณ์ไม่พร้อมใช้งานหรือไม่มีโทรศัพท์",
    },
    {
      id: 4,
      name: "Mail มีปัญหา",
      short: "Mail มีปัญหา",
      tone: "mail",
      color: "#0284c7",
      hint: "พบปัญหาเกี่ยวกับอีเมลหรือการใช้งาน Mail",
    },
  ];

  const ROLES = {
    admin: "ผู้ดูแลระบบ",
    teacher: "ครู",
    executive: "ผู้บริหาร",
    officer: "ผู้รับผิดชอบข้อมูล",
  };

  function statusById(id) {
    return STATUSES.find((s) => String(s.id) === String(id)) || null;
  }

  function isValidStatus(id) {
    return !!statusById(id);
  }

  function nowIso(date) {
    const d = date || new Date();
    const z = (n) => String(n).padStart(2, "0");
    return (
      d.getFullYear() +
      "-" +
      z(d.getMonth() + 1) +
      "-" +
      z(d.getDate()) +
      "T" +
      z(d.getHours()) +
      ":" +
      z(d.getMinutes()) +
      ":" +
      z(d.getSeconds())
    );
  }

  function nextId(list, prefix) {
    let max = 0;
    list.forEach((item) => {
      const n = parseInt(String(item.id).slice(prefix.length), 10);
      if (!isNaN(n)) max = Math.max(max, n);
    });
    return prefix + String(max + 1).padStart(3, "0");
  }

  function reduceForm(form, event) {
    if (event.type === "teacher") {
      return { ...form, teacherId: event.value, levelId: "", studentId: "" };
    }
    if (event.type === "level") {
      return { ...form, levelId: event.value, studentId: "" };
    }
    if (event.type === "student") return { ...form, studentId: event.value };
    if (event.type === "status") return { ...form, statusId: String(event.value) };
    if (event.type === "note") return { ...form, note: event.value };
    if (event.type === "saved") return { ...form, studentId: "", note: "" };
    return form;
  }

  function canSave(form) {
    return !!(form.teacherId && form.levelId && form.studentId && isValidStatus(form.statusId));
  }

  function levelsForTeacher(db, teacherId) {
    const teacher = db.teachers.find((t) => t.id === teacherId);
    if (!teacher) return [];
    const ids = new Set(teacher.level_ids || []);
    db.students.forEach((s) => {
      if (s.teacher_id === teacherId && s.is_active) ids.add(s.level_id);
    });
    return db.levels.filter((l) => ids.has(l.id));
  }

  function studentsFor(db, teacherId, levelId) {
    return db.students
      .filter((s) => s.is_active && s.teacher_id === teacherId && s.level_id === levelId)
      .sort((a, b) => a.student_name.localeCompare(b.student_name, "th"));
  }

  function filterReports(db, opts) {
    const user = opts.user;
    const teacherId = opts.teacherId || "";
    const levelId = opts.levelId || "";
    const statusId = opts.statusId || "";
    const dateFrom = opts.dateFrom || "";
    const dateTo = opts.dateTo || "";
    const query = (opts.q || "").trim().toLowerCase();

    return db.reports
      .filter((r) => {
        if (user && user.role === "teacher" && r.teacher_id !== user.teacher_id) return false;
        if (teacherId && r.teacher_id !== teacherId) return false;
        if (levelId && r.level_id !== levelId) return false;
        if (statusId && String(r.status_id) !== String(statusId)) return false;
        const day = String(r.created_at).slice(0, 10);
        if (dateFrom && day < dateFrom) return false;
        if (dateTo && day > dateTo) return false;
        if (query) {
          const student = db.students.find((s) => s.id === r.student_id);
          const hay = ((student && student.student_name) || "") + " " + ((student && student.student_code) || "");
          if (!hay.toLowerCase().includes(query)) return false;
        }
        return true;
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  }

  function latestByStudent(reports) {
    const sorted = [...reports].sort(
      (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
    );
    const map = new Map();
    sorted.forEach((r) => map.set(r.student_id, r));
    return map;
  }

  function studentsInScope(db, opts) {
    const user = opts.user;
    const teacherId = opts.teacherId || "";
    const levelId = opts.levelId || "";
    return db.students.filter((s) => {
      if (!s.is_active) return false;
      if (user && user.role === "teacher" && s.teacher_id !== user.teacher_id) return false;
      if (teacherId && s.teacher_id !== teacherId) return false;
      if (levelId && s.level_id !== levelId) return false;
      return true;
    });
  }

  function emptyByStatus() {
    return STATUSES.map((s) => ({ ...s, records: 0, students: 0 }));
  }

  function kpi(db, opts) {
    if (opts.dateFrom && opts.dateTo && opts.dateFrom > opts.dateTo) {
      return {
        invalidRange: true,
        viewReports: [],
        denom: 0,
        success: 0,
        unrecorded: 0,
        hasDate: true,
        recordedStudents: 0,
        readyStudents: 0,
        problemStudents: 0,
        problemRecords: 0,
        totalRecords: 0,
        byStatus: emptyByStatus(),
      };
    }

    const hasDate = !!(opts.dateFrom || opts.dateTo);
    const baseReports = filterReports(db, { ...opts, statusId: "", q: "" });
    const viewReports = filterReports(db, opts);
    const population = studentsInScope(db, opts);
    const latestBase = latestByStudent(baseReports);
    const latestRows = [...latestBase.values()];

    let denom;
    let success;
    let unrecorded;
    if (hasDate) {
      denom = latestRows.length;
      success = latestRows.filter((r) => r.status_id === 1).length;
      unrecorded = 0;
    } else {
      denom = population.length;
      success = population.filter((s) => latestBase.get(s.id)?.status_id === 1).length;
      const recorded = population.filter((s) => latestBase.has(s.id)).length;
      unrecorded = denom - recorded;
    }

    const latestView = [...latestByStudent(viewReports).values()];
    return {
      invalidRange: false,
      viewReports,
      denom,
      success,
      unrecorded,
      hasDate,
      recordedStudents: latestView.length,
      readyStudents: latestView.filter((r) => r.status_id === 1).length,
      problemStudents: latestView.filter((r) => r.status_id !== 1).length,
      problemRecords: viewReports.filter((r) => r.status_id !== 1).length,
      totalRecords: viewReports.length,
      byStatus: STATUSES.map((s) => ({
        ...s,
        records: viewReports.filter((r) => r.status_id === s.id).length,
        students: latestView.filter((r) => r.status_id === s.id).length,
      })),
    };
  }

  function groupOverview(db, opts, key) {
    if (opts.dateFrom && opts.dateTo && opts.dateFrom > opts.dateTo) return [];
    const hasDate = !!(opts.dateFrom || opts.dateTo);
    const population = studentsInScope(db, opts);
    const reports = filterReports(db, { ...opts, statusId: "", q: "" });
    const latest = latestByStudent(reports);
    const ids = [...new Set(population.map((s) => s[key]))];
    return ids
      .map((id) => {
        const people = population.filter((s) => s[key] === id);
        const latestPeople = people.map((s) => latest.get(s.id)).filter(Boolean);
        const denom = hasDate ? latestPeople.length : people.length;
        const ready = latestPeople.filter((r) => r.status_id === 1).length;
        const problem = latestPeople.filter((r) => r.status_id !== 1).length;
        return {
          id,
          denom,
          ready,
          problem,
          unrecorded: hasDate ? 0 : denom - ready - problem,
          records: reports.filter((r) => r[key] === id).length,
          percent: denom ? Math.round((ready / denom) * 100) : 0,
        };
      })
      .filter((g) => g.denom > 0 || g.records > 0);
  }

  const FIXED_LEVELS = [
    { id: "l1", name: "1 ประถมศึกษา" },
    { id: "l2", name: "2 มัธยมศึกษาตอนต้น" },
    { id: "l3", name: "3 มัธยมศึกษาตอนปลาย" },
  ];

  function emptyData() {
    return { version: 1, teachers: [], levels: FIXED_LEVELS.map((level) => ({ ...level })), students: [], reports: [], users: [] };
  }

  function cleanText(value) {
    return String(value ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanTeacher(value) {
    return cleanText(value).replace(/^(ครู|อาจารย์)\s*/, "");
  }

  function cleanCode(value) {
    return cleanText(value).replace(/\.0$/, "");
  }

  function canonicalLevelName(value) {
    const key = cleanText(value)
      .replace(/\.0$/, "")
      .toLowerCase()
      .replace(/[\s.]+/g, "");
    const aliases = {
      "1": "1 ประถมศึกษา",
      "๑": "1 ประถมศึกษา",
      ประถม: "1 ประถมศึกษา",
      ประถมศึกษา: "1 ประถมศึกษา",
      "1ประถมศึกษา": "1 ประถมศึกษา",
      ระดับประถมศึกษา: "1 ประถมศึกษา",
      "2": "2 มัธยมศึกษาตอนต้น",
      "๒": "2 มัธยมศึกษาตอนต้น",
      มต้น: "2 มัธยมศึกษาตอนต้น",
      มัธยมต้น: "2 มัธยมศึกษาตอนต้น",
      มัธยมศึกษาตอนต้น: "2 มัธยมศึกษาตอนต้น",
      "2มัธยมศึกษาตอนต้น": "2 มัธยมศึกษาตอนต้น",
      "3": "3 มัธยมศึกษาตอนปลาย",
      "๓": "3 มัธยมศึกษาตอนปลาย",
      มปลาย: "3 มัธยมศึกษาตอนปลาย",
      มัธยมปลาย: "3 มัธยมศึกษาตอนปลาย",
      มัธยมศึกษาตอนปลาย: "3 มัธยมศึกษาตอนปลาย",
      "3มัธยมศึกษาตอนปลาย": "3 มัธยมศึกษาตอนปลาย",
    };
    return aliases[key] || "";
  }

  function rosterKey(value) {
    return cleanText(value).toLowerCase().replace(/[\s._\-/()]/g, "");
  }

  const ROSTER_ALIASES = {
    teacher: ["ชื่อครู", "ครูผู้รับผิดชอบ", "ชื่อครูผู้รับผิดชอบ", "ครูประจำชั้น", "ครูที่ปรึกษา", "ครู", "teacher", "teachername", "teacher_name"],
    student: ["ชื่อผู้เรียน", "ชื่อนักศึกษา", "ชื่อนักเรียน", "ชื่อนามสกุล", "ชื่อสกุล", "นักศึกษา", "นักเรียน", "ผู้เรียน", "student", "studentname", "student_name"],
    code: ["รหัสนักศึกษา", "รหัสนักเรียน", "รหัสผู้เรียน", "รหัส", "studentcode", "student_code"],
    level: ["ระดับการศึกษา", "ระดับ", "ชั้นเรียน", "ชั้น", "level", "levelname", "level_name"],
  };

  function findRosterHeader(row) {
    const keys = row.map((cell) => rosterKey(cell));
    const index = {};
    Object.keys(ROSTER_ALIASES).forEach((kind) => {
      const aliases = ROSTER_ALIASES[kind].map(rosterKey);
      let found = keys.findIndex((key) => aliases.includes(key));
      if (found < 0) {
        found = keys.findIndex((key) => aliases.some((alias) => alias.length >= 4 && key.includes(alias)));
      }
      index[kind] = found;
    });
    return index.teacher >= 0 && index.student >= 0 ? index : null;
  }

  function mapRosterTable(table) {
    const rows = (table || []).map((row) => (Array.isArray(row) ? row.map(cleanText) : []));
    let headerAt = -1;
    let header = null;
    for (let i = 0; i < Math.min(rows.length, 8); i++) {
      const found = findRosterHeader(rows[i]);
      if (found) {
        headerAt = i;
        header = found;
        break;
      }
    }
    const entries = [];
    const start = header ? headerAt + 1 : 0;
    for (let i = start; i < rows.length; i++) {
      const row = rows[i];
      const entry = header
        ? {
            line: i + 1,
            teacher: header.teacher >= 0 ? row[header.teacher] || "" : "",
            student: header.student >= 0 ? row[header.student] || "" : "",
            level: header.level >= 0 ? row[header.level] || "" : "",
            code: header.code >= 0 ? row[header.code] || "" : "",
          }
        : {
            line: i + 1,
            teacher: row[0] || "",
            student: row[1] || "",
            level: row[2] || "",
            code: row[3] || "",
          };
      if (entry.teacher || entry.student || entry.level || entry.code) entries.push(entry);
    }
    return entries;
  }

  function planRosterImport(db, entries, defaultLevelId) {
    const defaultLevel = db.levels.find((level) => level.id === defaultLevelId) || null;
    const preview = [];
    const createLevels = [];
    const knownLevels = new Set(db.levels.map((level) => cleanText(level.name)));
    const createTeachers = [];
    const knownTeachers = new Set(db.teachers.map((teacher) => cleanTeacher(teacher.name)));
    const teacherLevels = [];
    const linked = new Set();
    const createStudents = [];
    const updateStudents = [];
    const seenStudents = new Set();
    const seenCodes = new Set();
    // Codes that appear somewhere in this file: a student holding one of them is matched by code, never by name.
    const fileCodes = new Set((entries || []).map((entry) => cleanCode(entry.code)).filter(Boolean));

    function rememberLevel(name) {
      const clean = canonicalLevelName(name);
      if (!clean) return "";
      knownLevels.add(clean);
      return clean;
    }

    function rememberTeacher(name) {
      const clean = cleanTeacher(name);
      if (!clean) return "";
      if (!knownTeachers.has(clean)) {
        createTeachers.push({ name: clean });
        knownTeachers.add(clean);
      }
      return clean;
    }

    function rememberLink(teacherName, levelName) {
      if (!teacherName || !levelName) return;
      const key = teacherName + "\n" + levelName;
      if (linked.has(key)) return;
      linked.add(key);
      teacherLevels.push({ teacherName, levelName });
    }

    (entries || []).forEach((entry) => {
      const teacher = cleanTeacher(entry.teacher);
      const student = cleanText(entry.student);
      const code = cleanCode(entry.code);
      const rawLevel = cleanText(entry.level);
      let level = rawLevel ? canonicalLevelName(rawLevel) : "";
      if (!teacher && !student && !code && !rawLevel) return;
      if (rawLevel && !level) {
        preview.push({
          line: entry.line,
          teacher,
          student,
          level: rawLevel,
          code,
          result: "error",
          detail: "ระดับต้องเป็น 1 ประถมศึกษา, 2 มัธยมศึกษาตอนต้น หรือ 3 มัธยมศึกษาตอนปลาย",
        });
        return;
      }
      if (!teacher) {
        preview.push({ line: entry.line, teacher: "", student, level, code, result: "error", detail: "ไม่มีชื่อครู" });
        return;
      }
      if (!student) {
        const existed = knownTeachers.has(teacher);
        const levelName = level || (defaultLevel ? defaultLevel.name : "");
        rememberTeacher(teacher);
        if (levelName) rememberLink(teacher, rememberLevel(levelName));
        preview.push({
          line: entry.line,
          teacher,
          student: "",
          level: levelName,
          code: "",
          result: existed ? "exists" : "add-teacher",
          detail: existed ? "มีครูคนนี้อยู่แล้ว" : "เพิ่มเฉพาะครู",
        });
        return;
      }
      if (!level) {
        if (!defaultLevel) {
          preview.push({
            line: entry.line,
            teacher,
            student,
            level: "",
            code,
            result: "error",
            detail: "ไม่ได้ระบุระดับ เลือกระดับเริ่มต้นก่อนนำเข้า",
          });
          return;
        }
        level = defaultLevel.name;
      }
      // Two people can share a name under one teacher; when the file gives codes, the code decides.
      if (!code && seenStudents.has(teacher + "\n" + student)) {
        preview.push({ line: entry.line, teacher, student, level, code, result: "duplicate", detail: "ชื่อนี้ซ้ำในไฟล์" });
        return;
      }
      if (code && seenCodes.has(code)) {
        preview.push({ line: entry.line, teacher, student, level, code, result: "error", detail: "รหัสซ้ำในไฟล์" });
        return;
      }
      seenStudents.add(teacher + "\n" + student);
      if (code) seenCodes.add(code);
      rememberLevel(level);
      rememberTeacher(teacher);
      rememberLink(teacher, level);

      const byCode = code ? db.students.find((item) => cleanCode(item.student_code) === code) : null;
      const teacherRow = db.teachers.find((item) => cleanTeacher(item.name) === teacher);
      const byName =
        !byCode && teacherRow
          ? db.students.find(
              (item) =>
                cleanText(item.student_name) === student &&
                item.teacher_id === teacherRow.id &&
                !(code && fileCodes.has(cleanCode(item.student_code)))
            )
          : null;
      const existing = byCode || byName;
      if (existing) {
        const levelName = cleanText((db.levels.find((item) => item.id === existing.level_id) || {}).name || "");
        const same =
          cleanText(existing.student_name) === student &&
          (!code || cleanCode(existing.student_code) === code) &&
          !!teacherRow &&
          existing.teacher_id === teacherRow.id &&
          levelName === level;
        if (same) {
          preview.push({ line: entry.line, teacher, student, level, code, result: "exists", detail: "มีอยู่แล้ว" });
          return;
        }
        updateStudents.push({ id: existing.id, student, code, teacher, level });
        preview.push({ line: entry.line, teacher, student, level, code, result: "update", detail: "อัปเดตรายการเดิม" });
        return;
      }
      createStudents.push({ student, code, teacher, level });
      preview.push({ line: entry.line, teacher, student, level, code, result: "add-student", detail: "เพิ่มผู้เรียน" });
    });

    const actionable =
      createTeachers.length > 0 ||
      createStudents.length > 0 ||
      updateStudents.length > 0 ||
      createLevels.length > 0 ||
      teacherLevels.some((link) => {
        const teacher = db.teachers.find((item) => cleanTeacher(item.name) === link.teacherName);
        const level = db.levels.find((item) => cleanText(item.name) === link.levelName);
        return !teacher || !level || !(teacher.level_ids || []).includes(level.id);
      });

    return {
      preview,
      createLevels,
      createTeachers,
      teacherLevels,
      createStudents,
      updateStudents,
      actionable,
      counts: {
        teachers: createTeachers.length,
        students: createStudents.length,
        updated: updateStudents.length,
        levels: createLevels.length,
        unchanged: preview.filter((row) => row.result === "exists" || row.result === "duplicate").length,
        errors: preview.filter((row) => row.result === "error").length,
      },
    };
  }

  function nextStudentCode(db) {
    let max = 6900000;
    db.students.forEach((student) => {
      const number = parseInt(String(student.student_code).replace(/\D/g, ""), 10);
      if (!isNaN(number)) max = Math.max(max, number);
    });
    return String(max + 1);
  }

  function applyRosterImport(db, plan) {
    const levelByName = new Map();
    db.levels.forEach((level) => levelByName.set(cleanText(level.name), level));
    plan.createLevels.forEach((item) => {
      const level = { id: nextId(db.levels, "l"), name: item.name };
      db.levels.push(level);
      levelByName.set(cleanText(item.name), level);
    });
    const teacherByName = new Map();
    db.teachers.forEach((teacher) => teacherByName.set(cleanTeacher(teacher.name), teacher));
    plan.createTeachers.forEach((item) => {
      const teacher = { id: nextId(db.teachers, "t"), name: item.name, is_active: true, level_ids: [] };
      db.teachers.push(teacher);
      teacherByName.set(cleanTeacher(item.name), teacher);
    });
    plan.teacherLevels.forEach((link) => {
      const teacher = teacherByName.get(cleanTeacher(link.teacherName));
      const level = levelByName.get(cleanText(link.levelName));
      if (!teacher || !level) return;
      if (!(teacher.level_ids || []).includes(level.id)) teacher.level_ids.push(level.id);
      teacher.is_active = true;
    });
    let updated = 0;
    plan.updateStudents.forEach((item) => {
      const student = db.students.find((row) => row.id === item.id);
      const teacher = teacherByName.get(cleanTeacher(item.teacher));
      const level = levelByName.get(cleanText(item.level));
      if (!student || !teacher || !level) return;
      student.student_name = item.student;
      if (item.code) student.student_code = item.code;
      student.teacher_id = teacher.id;
      student.level_id = level.id;
      student.is_active = true;
      updated += 1;
    });
    let students = 0;
    plan.createStudents.forEach((item) => {
      const teacher = teacherByName.get(cleanTeacher(item.teacher));
      const level = levelByName.get(cleanText(item.level));
      if (!teacher || !level) return;
      db.students.push({
        id: nextId(db.students, "s"),
        student_code: item.code || nextStudentCode(db),
        student_name: item.student,
        level_id: level.id,
        teacher_id: teacher.id,
        is_active: true,
      });
      students += 1;
    });
    return { teachers: plan.createTeachers.length, students, updated, levels: plan.createLevels.length };
  }

  return {
    STATUSES,
    ROLES,
    statusById,
    isValidStatus,
    nowIso,
    nextId,
    reduceForm,
    canSave,
    levelsForTeacher,
    studentsFor,
    filterReports,
    latestByStudent,
    studentsInScope,
    kpi,
    groupOverview,
    mapRosterTable,
    planRosterImport,
    applyRosterImport,
    emptyData,
  };
})();

globalThis.Edu = Edu;
