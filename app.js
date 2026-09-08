(function () {
  "use strict";

  var STORAGE_KEY = "riley-job-hub-v1";
  var TIP_KEY = "riley-job-hub-tip-dismissed";
  var PIN_SESSION_KEY = "riley-job-hub-unlocked";
  var APP_PIN = "5295";
  var ARCHIVE_DAYS = 30;
  var ALL_STRENGTHS = [
    "Cash handling",
    "Training/coaching",
    "De-escalation",
    "High-volume hospitality",
    "POS accuracy",
    "Guest experience",
    "Shift leadership"
  ];
  var ROLE_TYPES = ["Bartending", "Leadership", "Retail", "Helping careers", "Other"];
  var MONTHS = [
    { v: "01", l: "Jan" }, { v: "02", l: "Feb" }, { v: "03", l: "Mar" },
    { v: "04", l: "Apr" }, { v: "05", l: "May" }, { v: "06", l: "Jun" },
    { v: "07", l: "Jul" }, { v: "08", l: "Aug" }, { v: "09", l: "Sep" },
    { v: "10", l: "Oct" }, { v: "11", l: "Nov" }, { v: "12", l: "Dec" }
  ];
  var YEARS = (function () {
    var y = [], i, now = new Date().getFullYear();
    for (i = now + 1; i >= 2005; i--) y.push(String(i));
    return y;
  })();

  var state = null;
  var openExpId = null;
  var editingJobId = null;
  var profileView = "edit";
  var resumeView = "edit";
  var jobsView = "edit";
  var calendarView = "edit";
  var diaryView = "edit";
  var activeTab = "home";
  var pinBuffer = "";
  var calCursor = null; // {y,m}
  var selectedCalDate = null;
  var resizeTimer = null;
  var JOB_STATUSES = [
    "Researching", "Applied", "Interview", "Offer", "Rejected", "On Hold", "Withdrawn"
  ];

  function $(id) { return document.getElementById(id); }

  function toast(msg) {
    var el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("show"); }, 2200);
  }

  function uid(prefix) {
    return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function deepClone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function loadLocal() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function saveLocal() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function fetchServer() {
    return fetch("data/app-state.json", { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("Failed to load seed data");
      return r.json();
    });
  }

  function mergeState(server, local) {
    if (!local) return deepClone(server);
    var out = deepClone(server);
    if (local.profile) out.profile = local.profile;
    if (local.resume) out.resume = local.resume;
    if (local.applications) out.applications = local.applications;
    if (local.calendarEvents) out.calendarEvents = local.calendarEvents;
    if (local.diary) out.diary = local.diary;
    if (local.aspirations) out.aspirations = local.aspirations;
    if (local.letterDrafts) out.letterDrafts = local.letterDrafts;
    if (local.currentLetter) out.currentLetter = local.currentLetter;
    if (local.recentSearches) out.recentSearches = local.recentSearches;
    if (!out.calendarEvents) out.calendarEvents = [];
    if (!out.recentSearches) out.recentSearches = [];
    if (!out.diary) {
      out.diary = server.diary || { interests: "", patterns: "", desires: "", entries: [] };
    }
    if (!out.aspirations) {
      out.aspirations = server.aspirations || { entries: [] };
    }
    if (!out.letterDrafts) out.letterDrafts = server.letterDrafts || [];
    if (!out.currentLetter) {
      out.currentLetter = server.currentLetter || { to: "", subject: "", body: "" };
    }
    out.version = Math.max(local.version || 1, server.version || 1);
    return out;
  }

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
  }

  function setupTip() {
    var tip = $("iosTip");
    if (isStandalone() || localStorage.getItem(TIP_KEY) === "1") {
      tip.hidden = true;
      return;
    }
    tip.hidden = false;
    $("dismissTip").addEventListener("click", function () {
      localStorage.setItem(TIP_KEY, "1");
      tip.hidden = true;
    });
  }

  function navHighlightFor(name) {
    if (name === "jobs" || name === "calendar") return "board";
    if (name === "aspirations" || name === "letter" || name === "profile" || name === "diary") return "more";
    return name;
  }

  function switchTab(name) {
    activeTab = name;
    document.querySelectorAll(".tab-panel").forEach(function (p) {
      p.hidden = p.getAttribute("data-tab") !== name;
    });
    var navName = navHighlightFor(name);
    document.querySelectorAll("[data-tab-btn]").forEach(function (b) {
      var on = b.getAttribute("data-tab-btn") === navName || b.getAttribute("data-tab-btn") === name;
      // Prefer exact match for home/resume/search; secondary screens map to board/more
      if (name === "jobs" || name === "calendar" || name === "aspirations" || name === "letter" || name === "profile" || name === "diary") {
        on = b.getAttribute("data-tab-btn") === navName;
      } else {
        on = b.getAttribute("data-tab-btn") === name;
      }
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll("#orgPath [data-path]").forEach(function (s) {
      var path = s.getAttribute("data-path");
      var on = path === name || (path === "board" && (name === "jobs" || name === "calendar")) ||
        (path === "more" && (name === "aspirations" || name === "letter" || name === "profile" || name === "diary")) ||
        (path === "search" && name === "search");
      s.classList.toggle("on", on);
    });
    if (name === "home") { renderHome(); updateInboxBadges(); }
    if (name === "board") renderJobBoard();
    if (name === "calendar") renderCalendar();
    if (name === "diary") renderDiary();
    if (name === "search") renderJobSearch();
    if (name === "more") renderAssistantInboxLists();
    if (name === "aspirations") renderAspirations();
    if (name === "letter") renderLetter();
    if (name === "resume") {
      renderResumeMeta();
      renderExperience();
    }
    refreshActivePaper();
    window.scrollTo(0, 0);
  }

  function formatDateRange(job) {
    var sm = MONTHS.find(function (m) { return m.v === job.startMonth; });
    var em = MONTHS.find(function (m) { return m.v === job.endMonth; });
    var start = (sm ? sm.l : "") + (job.startYear ? " " + job.startYear : "");
    start = start.trim() || "?";
    if (job.current) return start + "-Present";
    var end = (em ? em.l : "") + (job.endYear ? " " + job.endYear : "");
    end = end.trim() || "?";
    return start + "-" + end;
  }

  function monthOptions(selected) {
    return MONTHS.map(function (m) {
      return '<option value="' + m.v + '"' + (m.v === selected ? " selected" : "") + ">" + m.l + "</option>";
    }).join("");
  }

  function yearOptions(selected) {
    return YEARS.map(function (y) {
      return '<option value="' + y + '"' + (y === selected ? " selected" : "") + ">" + y + "</option>";
    }).join("");
  }

  function roleTypeOptions(selected) {
    return ROLE_TYPES.map(function (r) {
      return '<option' + (r === selected ? " selected" : "") + ">" + r + "</option>";
    }).join("");
  }


  /* ---------- Calendar ---------- */
  function toLocalISODate(d) {
    var dt = d || new Date();
    var y = dt.getFullYear();
    var m = String(dt.getMonth() + 1).padStart(2, "0");
    var day = String(dt.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function ensureCalCursor() {
    if (!calCursor) {
      var n = new Date();
      calCursor = { y: n.getFullYear(), m: n.getMonth() };
    }
    if (!selectedCalDate) selectedCalDate = toLocalISODate();
  }

  function jobsByDateMap() {
    var map = {};
    (state.applications || []).forEach(function (a) {
      var d = a.appliedDate || a.date || "";
      if (!d) return;
      if (!map[d]) map[d] = [];
      map[d].push(a);
    });
    return map;
  }

  function setCalendarView(mode) {
    calendarView = mode === "paper" ? "paper" : "edit";
    var edit = $("calendarEdit");
    var paper = $("calendarPaper");
    document.querySelectorAll("[data-cal-view]").forEach(function (b) {
      var on = b.getAttribute("data-cal-view") === calendarView;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (edit) edit.hidden = calendarView !== "edit";
    if (paper) paper.hidden = calendarView !== "paper";
    if (calendarView === "paper") renderPaperCalendar();
    else renderCalendar();
  }

  function renderCalendar() {
    if (!state) return;
    ensureCalCursor();
    var y = calCursor.y;
    var m = calCursor.m;
    var title = new Date(y, m, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
    var titleEl = $("calTitle");
    if (titleEl) titleEl.textContent = title;

    var map = jobsByDateMap();
    var today = toLocalISODate();
    var first = new Date(y, m, 1);
    var startPad = (first.getDay() + 6) % 7; // Mon=0
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var cells = [];
    var i;
    for (i = 0; i < startPad; i++) cells.push(null);
    for (i = 1; i <= daysInMonth; i++) cells.push(i);
    while (cells.length % 7 !== 0) cells.push(null);

    var grid = $("calGrid");
    if (!grid) return;
    grid.innerHTML = cells.map(function (day, idx) {
      if (day === null) return '<div class="cal-cell empty"></div>';
      var iso = y + "-" + String(m + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      var dayJobs = map[iso] || [];
      var cls = "cal-cell";
      if (iso === today) cls += " today";
      if (iso === selectedCalDate) cls += " selected";
      if (dayJobs.length) cls += " has-jobs";
      var dots = dayJobs.slice(0, 3).map(function (j) {
        return '<span class="cal-dot" data-status="' + escapeHtml(j.status || "") + '"></span>';
      }).join("");
      if (dayJobs.length > 3) {
        dots += '<span class="cal-more">+' + (dayJobs.length - 3) + "</span>";
      }
      return (
        '<button type="button" class="' + cls + '" data-cal-iso="' + iso + '" aria-label="' +
        iso + ", " + dayJobs.length + ' application(s)">' +
        '<span class="cal-day-num">' + day + "</span>" +
        '<span class="cal-dots">' + dots + "</span></button>"
      );
    }).join("");

    renderDayAgenda();
  }

  function formatAgendaDate(iso) {
    if (!iso) return "Select a day";
    var parts = iso.split("-");
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }

  function renderDayAgenda() {
    ensureCalCursor();
    var title = $("agendaTitle");
    var list = $("agendaList");
    if (title) title.textContent = formatAgendaDate(selectedCalDate);
    if (!list) return;
    var map = jobsByDateMap();
    var dayJobs = (map[selectedCalDate] || []).slice().sort(function (a, b) {
      return (a.company || "").localeCompare(b.company || "");
    });
    if (!dayJobs.length) {
      list.innerHTML = '<p style="margin:0;color:var(--muted);font-size:.88rem;">No applications on this day. Tap + Application to add one dated here.</p>';
      return;
    }
    list.innerHTML = dayJobs.map(function (j) {
      return (
        '<div class="job-card" style="margin-bottom:8px;">' +
          '<div class="job-card-top">' +
            "<div><h3>" + escapeHtml(j.company || "") + "</h3>" +
            '<div class="sub">' + escapeHtml(j.role || "") +
            (j.location ? " · " + escapeHtml(j.location) : "") + "</div></div>" +
            '<span class="badge" data-status="' + escapeHtml(j.status || "") + '">' +
            escapeHtml(j.status || "") + "</span>" +
          "</div>" +
          (j.pay ? '<div class="pay">' + escapeHtml(j.pay) + "</div>" : "") +
          '<div class="job-actions">' +
            '<button type="button" class="small" data-edit-job="' + escapeHtml(j.id) + '">Open</button>' +
          "</div>" +
        "</div>"
      );
    }).join("");
  }

  function renderPaperCalendar() {
    paginateAndRender("calendarPaperStack", function () {
      var p = state.profile || {};
      var contactParts = [];
      if (p.phone) contactParts.push(escapeHtml(p.phone));
      if (p.email) contactParts.push(escapeHtml(p.email));
      if (p.address) contactParts.push(escapeHtml(p.address));
      var apps = (state.applications || []).slice().filter(function (a) {
        return !!(a.appliedDate || a.date);
      }).sort(function (a, b) {
        return String(b.appliedDate || b.date).localeCompare(String(a.appliedDate || a.date));
      });
      var blocks = [];
      blocks.push({
        id: "cal-header",
        html:
          '<h1 class="paper-name">' + escapeHtml(p.name || "Name") + "</h1>" +
          (contactParts.length
            ? '<p class="paper-contact">' + contactParts.join("  |  ") + "</p>"
            : "") +
          '<p class="paper-doc-title" style="margin-top:0.85em;">Job Hunt Calendar</p>'
      });
      if (!apps.length) {
        blocks.push({
          id: "cal-empty",
          html:
            '<div class="paper-section">' +
              '<h2 class="paper-section-title">Dates</h2>' +
              '<p class="paper-empty">No dated applications yet.</p>' +
            "</div>"
        });
      } else {
        var rows = apps.map(function (a) {
          return (
            '<p class="paper-kv"><strong>' + escapeHtml(a.appliedDate || a.date) +
            " — " + escapeHtml(a.company || "") + ":</strong> " +
            escapeHtml(a.role || "") + " (" + escapeHtml(a.status || "") + ")" +
            (a.pay ? " · " + escapeHtml(a.pay) : "") + "</p>"
          );
        }).join("");
        blocks.push({
          id: "cal-dates",
          html:
            '<div class="paper-section">' +
              '<h2 class="paper-section-title">Application dates</h2>' +
              rows +
            "</div>"
        });
      }
      return blocks;
    });
  }


  /* ---------- PIN ---------- */
  function isUnlocked() {
    try { return sessionStorage.getItem(PIN_SESSION_KEY) === "1"; } catch (e) { return false; }
  }
  function setUnlocked(on) {
    try {
      if (on) sessionStorage.setItem(PIN_SESSION_KEY, "1");
      else sessionStorage.removeItem(PIN_SESSION_KEY);
    } catch (e) {}
  }
  function updatePinDots(err) {
    var dots = document.querySelectorAll("#pinDots .pin-dot");
    dots.forEach(function (d, i) {
      d.classList.toggle("filled", i < pinBuffer.length);
      d.classList.toggle("err", !!err);
    });
  }
  function showPinLock() {
    var lock = $("pinLock");
    var shell = $("appShell");
    if (lock) lock.hidden = false;
    if (shell) shell.hidden = true;
    pinBuffer = "";
    updatePinDots(false);
    var err = $("pinError");
    if (err) err.hidden = true;
  }
  function unlockApp() {
    setUnlocked(true);
    var lock = $("pinLock");
    var shell = $("appShell");
    if (lock) lock.hidden = true;
    if (shell) shell.hidden = false;
    pinBuffer = "";
    activeTab = "home";
    renderAll();
  }
  function lockApp() {
    setUnlocked(false);
    showPinLock();
    toast("Locked");
  }
  function handlePinKey(key) {
    var err = $("pinError");
    var card = $("pinCard");
    if (err) err.hidden = true;
    if (key === "del") {
      pinBuffer = pinBuffer.slice(0, -1);
      updatePinDots(false);
      return;
    }
    if (!/^\d$/.test(key)) return;
    if (pinBuffer.length >= 4) return;
    pinBuffer += key;
    updatePinDots(false);
    if (pinBuffer.length < 4) return;
    if (pinBuffer === APP_PIN) {
      unlockApp();
      return;
    }
    if (err) err.hidden = false;
    updatePinDots(true);
    if (card) {
      card.classList.remove("shake");
      void card.offsetWidth;
      card.classList.add("shake");
    }
    setTimeout(function () {
      pinBuffer = "";
      updatePinDots(false);
    }, 350);
  }


  function appDateIso(a) {
    return (a && (a.appliedDate || a.date)) || "";
  }

  function parseIsoDate(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    var p = iso.split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function daysSinceApplied(a) {
    var d = parseIsoDate(appDateIso(a));
    if (!d) return null;
    var today = parseIsoDate(toLocalISODate());
    var ms = today.getTime() - d.getTime();
    return Math.floor(ms / 86400000);
  }

  function daysLeftOnBoard(a) {
    if (a && a.keepOnBoard) return null;
    var since = daysSinceApplied(a);
    if (since === null) return ARCHIVE_DAYS;
    return ARCHIVE_DAYS - since;
  }

  function shouldAutoArchive(a) {
    if (!a || a.keepOnBoard) return false;
    var left = daysLeftOnBoard(a);
    return left !== null && left <= 0;
  }

  function isArchivedApp(a) {
    return !!(a && (a.archived || shouldAutoArchive(a)));
  }

  function autoArchiveApplications() {
    if (!state || !state.applications) return false;
    var changed = false;
    state.applications.forEach(function (a) {
      if (a.keepOnBoard) {
        if (a.archived) { a.archived = false; changed = true; }
        return;
      }
      if (shouldAutoArchive(a) && !a.archived) {
        a.archived = true;
        a.archivedAt = toLocalISODate();
        changed = true;
      }
    });
    if (changed) saveLocal();
    return changed;
  }

  function activeApps() {
    return (state.applications || []).filter(function (a) { return !isArchivedApp(a); });
  }

  function countdownLabel(a) {
    if (a.keepOnBoard) return { text: "Kept on board", cls: "" };
    if (isArchivedApp(a)) return { text: "Archived", cls: "danger" };
    var left = daysLeftOnBoard(a);
    if (left === null) return { text: "No date", cls: "" };
    if (left <= 0) return { text: "Archiving", cls: "danger" };
    if (left <= 7) return { text: left + "d left", cls: "danger" };
    if (left <= 14) return { text: left + "d left", cls: "warn" };
    return { text: left + "d left", cls: "" };
  }

  /* ---------- Jobs board ---------- */
  function renderJobBoard() {
    var board = $("jobBoard");
    if (!board || !state) return;
    autoArchiveApplications();
    var apps = activeApps().slice().sort(function (a, b) {
      return (b.important ? 1 : 0) - (a.important ? 1 : 0) ||
        String(b.appliedDate || b.date || "").localeCompare(String(a.appliedDate || a.date || ""));
    });
    if (!apps.length) {
      board.innerHTML =
        '<button type="button" class="board-empty" id="emptyBoardAdd">' +
          "<strong>No active applications</strong>" +
          "Add one, or check Archived in the full list for 30+ day apps." +
        "</button>";
      return;
    }
    board.innerHTML = apps.map(function (a) {
      var cls = "board-card" + (a.important ? " important" : "");
      var cd = countdownLabel(a);
      return (
        '<button type="button" class="' + cls + '" data-edit-job="' + escapeAttr(a.id) + '" data-status="' + escapeAttr(a.status || "Researching") + '">' +
          '<div class="bc-top">' +
            '<div><div class="bc-company">' + escapeHtml(a.company || "Company") + "</div>" +
            '<div class="bc-role">' + escapeHtml(a.role || "") + "</div></div>" +
            '<span class="badge" data-status="' + escapeAttr(a.status || "") + '">' + escapeHtml(a.status || "") + "</span>" +
          "</div>" +
          '<div class="bc-meta">' +
            '<span class="countdown-pill' + (cd.cls ? " " + cd.cls : "") + '">' + escapeHtml(cd.text) + "</span>" +
            (a.appliedDate || a.date
              ? '<span style="color:var(--muted);font-size:.78rem;">' + escapeHtml(a.appliedDate || a.date) + "</span>"
              : "") +
            (a.important ? '<span class="bc-flag">Important</span>' : "") +
          "</div>" +
        "</button>"
      );
    }).join("");
  }

  /* ---------- Journal (persisted as state.diary) ---------- */
  function ensureDiary() {
    if (!state.diary) {
      state.diary = { interests: "", patterns: "", desires: "", entries: [] };
    }
    if (!state.diary.entries) state.diary.entries = [];
  }

  function ensureDiaryDate() {
    if (!selectedCalDate) selectedCalDate = toLocalISODate();
  }

  function shiftDiaryDay(delta) {
    ensureDiaryDate();
    var parts = selectedCalDate.split("-");
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    d.setDate(d.getDate() + delta);
    selectedCalDate = toLocalISODate(d);
    calCursor = { y: d.getFullYear(), m: d.getMonth() };
    renderDiary();
  }

  function diaryPromptForDate(iso) {
    ensureDiary();
    var parts = iso.split("-");
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var dow = d.getDay(); // 0 Sun
    var today = toLocalISODate();
    var map = jobsByDateMap();
    var apps = map[iso] || [];
    var hasInterview = apps.some(function (a) { return a.status === "Interview"; });
    var hasOffer = apps.some(function (a) { return a.status === "Offer"; });
    var hasImportant = apps.some(function (a) { return !!a.important; });

    if (hasOffer) return "What is it — an offer on the board. What’s coming up for you?";
    if (hasInterview) return "What’s up — interview energy today. How are you feeling?";
    if (hasImportant) return "What is it — something flagged important. Dump it here.";
    if (iso === today && dow === 1) return "What’s up — Monday. What’s on your mind?";
    if (iso === today && dow === 5) return "What’s up — Friday. How’s the week sitting?";
    if (dow === 0 || dow === 6) return "What’s up — weekend. Anything you want to catch?";
    if (apps.length) return "What is it — you’ve got applications on this day.";
    if (iso === today) return "What’s up?";
    if (iso > today) return "What’s up — looking ahead. What do you want from this day?";
    return "What is it — looking back. What do you remember?";
  }

  function setDiaryView(mode) {
    diaryView = mode === "paper" ? "paper" : "edit";
    var edit = $("diaryEdit");
    var paper = $("diaryPaper");
    document.querySelectorAll("[data-diary-view]").forEach(function (b) {
      var on = b.getAttribute("data-diary-view") === diaryView;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (edit) edit.hidden = diaryView !== "edit";
    if (paper) paper.hidden = diaryView !== "paper";
    if (diaryView === "paper") renderPaperDiary();
    else renderDiary();
  }

  function renderDiary() {
    if (!state) return;
    ensureDiary();
    ensureDiaryDate();
    ensureCalCursor();

    var title = $("diaryDayTitle");
    if (title) title.textContent = formatAgendaDate(selectedCalDate);

    var prompt = $("diaryPrompt");
    if (prompt) prompt.textContent = diaryPromptForDate(selectedCalDate);

    var d = state.diary;
    if ($("d-interests")) $("d-interests").value = d.interests || "";
    if ($("d-patterns")) $("d-patterns").value = d.patterns || "";
    if ($("d-desires")) $("d-desires").value = d.desires || "";
    if ($("d-freewrite")) $("d-freewrite").value = "";
    if ($("d-important")) $("d-important").checked = false;

    renderDiaryDayApps();
    renderDiaryDayEntries();
  }

  function renderDiaryDayApps() {
    var wrap = $("diaryDayApps");
    if (!wrap) return;
    var map = jobsByDateMap();
    var apps = (map[selectedCalDate] || []).slice().sort(function (a, b) {
      return (isArchivedApp(a) ? 1 : 0) - (isArchivedApp(b) ? 1 : 0) ||
        (b.important ? 1 : 0) - (a.important ? 1 : 0) ||
        (a.company || "").localeCompare(b.company || "");
    });
    if (!apps.length) {
      wrap.innerHTML = '<p style="margin:0;color:var(--muted);font-size:.88rem;">No applications on this date.</p>';
      return;
    }
    wrap.innerHTML = apps.map(function (a) {
      var cd = countdownLabel(a);
      return (
        '<button type="button" class="stream-item' + (a.important ? " important" : "") + '" data-edit-job="' + escapeAttr(a.id) + '">' +
          '<div><div class="si-main">' + escapeHtml(a.company || "") + '</div>' +
          '<div class="si-sub">' + escapeHtml(a.status || "") + " · " + escapeHtml(cd.text) +
          (isArchivedApp(a) ? " · archived" : "") + "</div></div>" +
          (a.important ? '<span class="si-flag">Important</span>' : "") +
        "</button>"
      );
    }).join("");
  }

  function renderDiaryDayEntries() {
    var list = $("diaryList");
    if (!list) return;
    var entries = (state.diary.entries || []).filter(function (e) {
      return e.date === selectedCalDate;
    }).sort(function (a, b) {
      return (b.important ? 1 : 0) - (a.important ? 1 : 0);
    });
    if (!entries.length) {
      list.innerHTML = '<p style="margin:0;color:var(--muted);font-size:.88rem;">Nothing written for this day yet — use the prompt above.</p>';
      return;
    }
    list.innerHTML = entries.map(function (e) {
      return (
        '<div class="diary-card' + (e.important ? " important" : "") + '" data-diary-id="' + escapeAttr(e.id) + '">' +
          (e.important ? '<div class="meta" style="color:#fecaca;font-weight:800;">Important</div>' : "") +
          '<div class="body">' + escapeHtml(e.body || "") + "</div>" +
          '<div class="btn-row">' +
            '<button type="button" class="small" data-toggle-diary-important="' + escapeAttr(e.id) + '">' +
              (e.important ? "Unflag" : "Flag important") + "</button>" +
            '<button type="button" class="small danger" data-del-diary="' + escapeAttr(e.id) + '">Delete</button>' +
          "</div>" +
        "</div>"
      );
    }).join("");
  }

  function saveFreewrite() {
    ensureDiary();
    ensureDiaryDate();
    var body = ($("d-freewrite") && $("d-freewrite").value.trim()) || "";
    if (!body) {
      toast("Write something first");
      return;
    }
    var important = !!($("d-important") && $("d-important").checked);
    state.diary.entries.unshift({
      id: uid("diary"),
      date: selectedCalDate,
      mood: "",
      title: important ? "Important" : "Note",
      body: body,
      important: important
    });
    saveLocal();
    if ($("d-freewrite")) $("d-freewrite").value = "";
    if ($("d-important")) $("d-important").checked = false;
    renderDiaryDayEntries();
    renderAllPapers();
    toast(important ? "Saved (important)" : "Saved");
  }

  function saveDiaryMeta() {
    ensureDiary();
    state.diary.interests = ($("d-interests") && $("d-interests").value.trim()) || "";
    state.diary.patterns = ($("d-patterns") && $("d-patterns").value.trim()) || "";
    state.diary.desires = ($("d-desires") && $("d-desires").value.trim()) || "";
    saveLocal();
    renderAllPapers();
    toast("Catalogue saved");
  }

  function renderPaperDiary() {
    ensureDiary();
    paginateAndRender("diaryPaperStack", function () {
      var p = state.profile || {};
      var d = state.diary || {};
      var blocks = [];
      blocks.push({
        id: "diary-header",
        html:
          '<h1 class="paper-name">' + escapeHtml(p.name || "Journal") + "</h1>" +
          '<p class="paper-doc-title" style="margin-top:0.85em;">Journal · Applications · Catalogue</p>'
      });

      var importantEntries = (d.entries || []).filter(function (e) { return e.important; });
      var otherEntries = (d.entries || []).filter(function (e) { return !e.important; })
        .sort(function (a, b) { return String(b.date || "").localeCompare(String(a.date || "")); });

      if (importantEntries.length) {
        blocks.push({
          id: "imp-notes",
          html: '<div class="paper-section"><h2 class="paper-section-title">Important notes</h2>' +
            importantEntries.map(function (e) {
              return '<p class="paper-kv"><strong>' + escapeHtml(e.date || "") + ":</strong> " +
                escapeHtml(e.body || "") + "</p>";
            }).join("") + "</div>"
        });
      }

      var impApps = (state.applications || []).filter(function (a) { return a.important; });
      if (impApps.length) {
        blocks.push({
          id: "imp-apps",
          html: '<div class="paper-section"><h2 class="paper-section-title">Important applications</h2>' +
            impApps.map(function (a) {
              return '<p class="paper-kv"><strong>' + escapeHtml(a.company || "") +
                " — " + escapeHtml(a.role || "") + ":</strong> " +
                escapeHtml(a.status || "") +
                (a.appliedDate ? " · " + escapeHtml(a.appliedDate) : "") +
                (a.pay ? " · " + escapeHtml(a.pay) : "") + "</p>";
            }).join("") + "</div>"
        });
      }

      blocks.push({
        id: "interests",
        html: '<div class="paper-section"><h2 class="paper-section-title">Interests</h2><p class="paper-notes">' +
          escapeHtml(d.interests || "—") + "</p></div>"
      });
      blocks.push({
        id: "patterns",
        html: '<div class="paper-section"><h2 class="paper-section-title">Patterns</h2><p class="paper-notes">' +
          escapeHtml(d.patterns || "—") + "</p></div>"
      });
      blocks.push({
        id: "desires",
        html: '<div class="paper-section"><h2 class="paper-section-title">Desires</h2><p class="paper-notes">' +
          escapeHtml(d.desires || "—") + "</p></div>"
      });

      otherEntries.slice(0, 40).forEach(function (e, i) {
        blocks.push({
          id: "entry-" + (e.id || i),
          html:
            '<div class="paper-section">' +
              (i === 0 ? '<h2 class="paper-section-title">Day notes</h2>' : "") +
              '<p class="paper-kv"><strong>' + escapeHtml(e.date || "") + ":</strong> " +
              escapeHtml(e.body || "") + "</p></div>"
        });
      });
      return blocks;
    });
  }


  /* ---------- Home ---------- */
  function renderHome() {
    if (!state) return;
    var r = state.resume || {};
    var target = $("homeTarget");
    if (target) {
      target.textContent = r.targetRole
        ? ("Target: " + r.targetRole)
        : "Set a target role on your resume";
    }
    var chips = $("homeSkillChips");
    if (chips) {
      var strengths = (r.strengths || []).slice(0, 8);
      if (!strengths.length && r.skills) {
        strengths = String(r.skills).split(/[,\n]/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 8);
      }
      chips.innerHTML = strengths.length
        ? strengths.map(function (s) {
            return '<span class="chip on">' + escapeHtml(s) + "</span>";
          }).join("")
        : '<span style="color:var(--muted);font-size:.88rem;">Add strengths on Resume</span>';
    }
  }


  /* ---------- Job Search ---------- */
  var FALLBACK_ASK_EMAIL = "Hoppb6@gmail.com";
  var ASK_EMAIL_TO = "Hoppb6@gmail.com";
  var MAX_RECENT_SEARCHES = 8;
  var INBOX_SEEN_KEY = "riley-job-hub-inbox-seen";
  var searchPrefillDone = false;
  var lastAskPacket = "";
  var assistantInbox = { version: 1, updatedAt: "", messages: [] };
  var viewingInboxMsgId = null;

  function ensureRecentSearches() {
    if (!state.recentSearches || !Array.isArray(state.recentSearches)) {
      state.recentSearches = [];
    }
  }

  function getSearchLocation() {
    var addr = (state.profile && state.profile.address) || "";
    var m = String(addr).match(/,\s*([^,]+),\s*([A-Z]{2})\b/);
    if (m) return m[1].trim() + ", " + m[2];
    if (/\bGrand Rapids\b/i.test(addr) && /\bMI\b/.test(addr)) return "Grand Rapids, MI";
    if (/\bMI\b/.test(addr) || /Michigan/i.test(addr)) return "Michigan";
    return "";
  }

  function getSearchSkills() {
    var r = state.resume || {};
    var strengths = (r.strengths || []).slice();
    if (!strengths.length && r.skills) {
      strengths = String(r.skills).split(/[,\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
    }
    return strengths.slice(0, 8);
  }

  function getSearchQuery() {
    var input = $("jobSearchInput");
    return input ? String(input.value || "").trim() : "";
  }

  function buildLiveSearches(query, location) {
    var q = String(query || "").trim();
    var loc = String(location || "").trim();
    var qEnc = encodeURIComponent(q);
    var locEnc = encodeURIComponent(loc);
    var googleParts = [q, "jobs"];
    if (loc) googleParts.push(loc);
    var googleQ = encodeURIComponent(googleParts.filter(Boolean).join(" "));
    var links = [
      {
        name: "Indeed",
        url: "https://www.indeed.com/jobs?q=" + qEnc + (loc ? "&l=" + locEnc : "")
      },
      {
        name: "LinkedIn Jobs",
        url: "https://www.linkedin.com/jobs/search/?keywords=" + qEnc + (loc ? "&location=" + locEnc : "")
      },
      {
        name: "Google Jobs",
        url: "https://www.google.com/search?ibp=htl;jobs&q=" + googleQ
      },
      {
        name: "ZipRecruiter",
        url: "https://www.ziprecruiter.com/jobs-search?search=" + qEnc + (loc ? "&location=" + locEnc : "")
      }
    ];
    var miLoc = loc && /MI|Michigan|Grand Rapids/i.test(loc) ? loc : "Michigan";
    links.push({
      name: "Indeed · Michigan / local",
      url: "https://www.indeed.com/jobs?q=" + qEnc + "&l=" + encodeURIComponent(miLoc)
    });
    return links;
  }

  function rememberSearch(query, location) {
    var q = String(query || "").trim();
    if (!q) return;
    ensureRecentSearches();
    var loc = String(location || "").trim();
    state.recentSearches = state.recentSearches.filter(function (item) {
      return !(item && item.query === q && (item.location || "") === loc);
    });
    state.recentSearches.unshift({
      query: q,
      location: loc,
      at: toLocalISODate()
    });
    state.recentSearches = state.recentSearches.slice(0, MAX_RECENT_SEARCHES);
    saveLocal();
  }

  function renderLiveSearchLinks() {
    var wrap = $("liveSearchLinks");
    var preview = $("searchQueryPreview");
    if (!wrap) return;
    var q = getSearchQuery();
    var loc = getSearchLocation();
    if (!q) {
      if (preview) {
        preview.innerHTML = "Type a role or tap a chip — live board links appear here.";
      }
      wrap.innerHTML = '<p style="margin:0;color:var(--muted);font-size:.88rem;">Waiting for a search query.</p>';
      return;
    }
    var links = buildLiveSearches(q, loc);
    if (preview) {
      preview.innerHTML = "Query: <strong>" + escapeHtml(q) + "</strong>" +
        (loc ? " · Location: <strong>" + escapeHtml(loc) + "</strong>" : "");
    }
    wrap.innerHTML = links.map(function (link) {
      return '<a class="live-search-link" href="' + escapeAttr(link.url) + '" target="_blank" rel="noopener noreferrer" data-live-search="1">' +
        '<span class="ls-name">' + escapeHtml(link.name) + "</span>" +
        '<span class="ls-url">' + escapeHtml(link.url) + "</span>" +
        "</a>";
    }).join("");
  }

  function renderSearchSuggestChips() {
    var wrap = $("searchSuggestChips");
    if (!wrap || !state) return;
    var r = state.resume || {};
    var chips = [];
    if (r.targetRole) chips.push({ kind: "target", label: r.targetRole, value: r.targetRole });
    getSearchSkills().forEach(function (s) {
      chips.push({ kind: "skill", label: s, value: s });
    });
    var loc = getSearchLocation();
    if (loc) chips.push({ kind: "loc", label: loc, value: loc });
    if (!chips.length) {
      wrap.innerHTML = '<span style="color:var(--muted);font-size:.88rem;">Add a target role or strengths on Resume</span>';
      return;
    }
    wrap.innerHTML = chips.map(function (c) {
      return '<button type="button" class="chip' + (c.kind === "target" ? " on" : "") + '" data-search-chip="' +
        escapeAttr(c.kind) + '" data-chip-value="' + escapeAttr(c.value) + '">' +
        escapeHtml(c.label) + "</button>";
    }).join("");
  }

  function renderRecentSearches() {
    var list = $("recentSearchesList");
    if (!list || !state) return;
    ensureRecentSearches();
    if (!state.recentSearches.length) {
      list.innerHTML = '<p style="margin:0;color:var(--muted);font-size:.88rem;">No recent searches yet.</p>';
      return;
    }
    list.innerHTML = state.recentSearches.map(function (item, idx) {
      var label = item.query + (item.location ? " · " + item.location : "");
      return '<div class="recent-search-item">' +
        '<button type="button" class="ghost recent-q" data-recent-idx="' + idx + '">' +
        escapeHtml(label) + "</button>" +
        '<button type="button" class="small danger" data-del-recent="' + idx + '" aria-label="Remove">X</button>' +
        "</div>";
    }).join("");
  }

  function renderJobSearch() {
    if (!state) return;
    var locLine = $("searchLocLine");
    var loc = getSearchLocation();
    if (locLine) {
      locLine.textContent = loc
        ? ("Location from profile: " + loc)
        : "Add city/state on Profile to bias local results (e.g. Grand Rapids, MI).";
    }
    var input = $("jobSearchInput");
    if (input && !searchPrefillDone) {
      var target = (state.resume && state.resume.targetRole) || "";
      if (!input.value && target) input.value = target;
      searchPrefillDone = true;
    }
    renderSearchSuggestChips();
    renderLiveSearchLinks();
    renderRecentSearches();
    renderAssistantInboxLists();
  }

  function applySearchChip(kind, value) {
    var input = $("jobSearchInput");
    if (!input) return;
    value = String(value || "").trim();
    if (!value) return;
    if (kind === "loc") {
      // location is always from profile; chip is informational / reinforces query with city
      var cur = input.value.trim();
      if (cur && cur.toLowerCase().indexOf(value.toLowerCase()) === -1) {
        input.value = cur + " " + value;
      } else if (!cur) {
        input.value = ((state.resume && state.resume.targetRole) || "") + (value ? " " + value : "");
        input.value = input.value.trim();
      }
    } else if (kind === "target") {
      input.value = value;
    } else {
      var q = input.value.trim();
      if (!q) input.value = value;
      else if (q.toLowerCase().indexOf(value.toLowerCase()) === -1) input.value = q + " " + value;
    }
    renderLiveSearchLinks();
  }

  function buildAskPacket() {
    var q = getSearchQuery();
    var loc = getSearchLocation();
    var r = state.resume || {};
    var skills = getSearchSkills().slice(0, 5);
    var links = q ? buildLiveSearches(q, loc).slice(0, 5) : [];
    var lines = [
      "JOB HUB SEARCH ASK",
      "",
      "Query: " + (q || "(empty)"),
      "Resume target: " + (r.targetRole || "(none)"),
      "Top skills: " + (skills.length ? skills.join(", ") : "(none)"),
      "Location: " + (loc || "(none)"),
      ""
    ];
    if (links.length) {
      lines.push("Live search URLs:");
      links.forEach(function (link) {
        lines.push("- " + link.name + ": " + link.url);
      });
    } else {
      lines.push("Live search URLs: (type a query first)");
    }
    lines.push("");
    lines.push("Please help refine this job search and suggest next steps.");
    lines.push("");
    lines.push("Note: When you reply, Riley will see it under From Job Search in the app (assistant-inbox.json). Use Apply to merge jobs/searches/letters into the hub.");
    return lines.join("\n");
  }

  function showAskPacket() {
    lastAskPacket = buildAskPacket();
    var box = $("askPacketBox");
    var pre = $("askPacketPreview");
    if (pre) pre.textContent = lastAskPacket;
    if (box) box.hidden = false;
    if (getSearchQuery()) {
      rememberSearch(getSearchQuery(), getSearchLocation());
      renderRecentSearches();
    }
  }

  function copyAskPacket() {
    if (!lastAskPacket) lastAskPacket = buildAskPacket();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(lastAskPacket).then(function () {
        toast("Ask copied");
      }).catch(function () {
        toast("Copy failed");
      });
    } else {
      toast("Clipboard unavailable");
    }
  }

  function shareAskPacket() {
    if (!lastAskPacket) lastAskPacket = buildAskPacket();
    if (navigator.share) {
      navigator.share({
        title: "JOB HUB SEARCH ASK",
        text: lastAskPacket
      }).then(function () {
        toast("Shared");
      }).catch(function () {
        /* user cancel or fail — ignore */
      });
    } else {
      toast("Share not available — use Copy ask");
    }
  }

  function buildAskGmailUrl(body) {
    var to = ASK_EMAIL_TO || FALLBACK_ASK_EMAIL;
    var subject = "JOB HUB SEARCH ASK";
    return "https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent(to) +
      "&su=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  }

  function buildAskMailtoUrl(body) {
    var to = ASK_EMAIL_TO || FALLBACK_ASK_EMAIL;
    var subject = "JOB HUB SEARCH ASK";
    return "mailto:" + encodeURIComponent(to) +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(body);
  }

  function emailAskPacket() {
    lastAskPacket = buildAskPacket();
    showAskPacket();
    var body = lastAskPacket;
    var gmail = buildAskGmailUrl(body);
    var opened = null;
    try {
      opened = window.open(gmail, "_blank", "noopener,noreferrer");
    } catch (e) {
      opened = null;
    }
    if (!opened) {
      window.location.href = buildAskMailtoUrl(body);
      toast("Opening mail compose");
    } else {
      toast("Opening Gmail to Brandon");
    }
    if (getSearchQuery()) {
      rememberSearch(getSearchQuery(), getSearchLocation());
      renderRecentSearches();
    }
  }

  /* ---------- From Job Search inbox ---------- */
  function loadInboxSeen() {
    try {
      var raw = localStorage.getItem(INBOX_SEEN_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function saveInboxSeen(ids) {
    var uniq = [];
    (ids || []).forEach(function (id) {
      if (id && uniq.indexOf(id) === -1) uniq.push(id);
    });
    localStorage.setItem(INBOX_SEEN_KEY, JSON.stringify(uniq));
  }

  function isInboxUnread(id) {
    return loadInboxSeen().indexOf(id) === -1;
  }

  function markInboxRead(id) {
    if (!id) return;
    var seen = loadInboxSeen();
    if (seen.indexOf(id) === -1) {
      seen.push(id);
      saveInboxSeen(seen);
    }
  }

  function normalizeInboxPayload(data) {
    if (!data) return null;
    if (Array.isArray(data.messages)) {
      return {
        version: data.version || 1,
        updatedAt: data.updatedAt || "",
        messages: data.messages.slice()
      };
    }
    if (data.id && (data.body != null || data.subject != null || data.actions)) {
      return {
        version: 1,
        updatedAt: data.createdAt || "",
        messages: [data]
      };
    }
    return null;
  }

  function mergeInboxData(incoming) {
    var norm = normalizeInboxPayload(incoming);
    if (!norm) throw new Error("Invalid inbox JSON");
    var byId = {};
    (assistantInbox.messages || []).forEach(function (m) {
      if (m && m.id) byId[m.id] = m;
    });
    norm.messages.forEach(function (m) {
      if (m && m.id) byId[m.id] = m;
    });
    var messages = Object.keys(byId).map(function (k) { return byId[k]; });
    messages.sort(function (a, b) {
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
    assistantInbox = {
      version: Math.max(assistantInbox.version || 1, norm.version || 1),
      updatedAt: norm.updatedAt || assistantInbox.updatedAt || "",
      messages: messages
    };
    return assistantInbox;
  }

  function setInboxStatus(text) {
    ["inboxStatusLine", "inboxStatusLineMore"].forEach(function (id) {
      if ($(id)) $(id).textContent = text || "";
    });
  }

  function unreadInboxCount() {
    return (assistantInbox.messages || []).filter(function (m) {
      return m && m.id && isInboxUnread(m.id);
    }).length;
  }

  function updateInboxBadges() {
    var n = unreadInboxCount();
    ["searchInboxBadge", "moreInboxBadge", "homeInboxBadge"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      if (n > 0) {
        el.hidden = false;
        el.textContent = String(n);
      } else {
        el.hidden = true;
        el.textContent = "0";
      }
    });
  }

  function formatInboxWhen(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso).slice(0, 16);
      return d.toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
      });
    } catch (e) {
      return String(iso).slice(0, 16);
    }
  }

  function renderAssistantInboxLists() {
    var messages = (assistantInbox.messages || []).slice().sort(function (a, b) {
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
    var html;
    if (!messages.length) {
      html = '<p style="margin:0;color:var(--muted);font-size:.88rem;">No messages yet. Tap Refresh after Brandon updates the inbox, or Paste reply.</p>';
    } else {
      html = messages.map(function (m) {
        var unread = isInboxUnread(m.id);
        return (
          '<button type="button" class="stream-item' + (unread ? " inbox-unread" : "") + '" data-inbox-id="' + escapeAttr(m.id) + '">' +
            '<div><div class="si-main">' + escapeHtml(m.subject || "(No subject)") +
            (unread ? ' <span class="badge" data-status="Applied">new</span>' : "") +
            "</div>" +
            '<div class="si-sub">' + escapeHtml(m.from || "Rileys Job Search") +
            (m.createdAt ? " · " + escapeHtml(formatInboxWhen(m.createdAt)) : "") +
            "</div></div>" +
          "</button>"
        );
      }).join("");
    }
    if ($("assistantInboxList")) $("assistantInboxList").innerHTML = html;
    if ($("assistantInboxListMore")) $("assistantInboxListMore").innerHTML = html;
    updateInboxBadges();
  }

  function fetchAssistantInbox(opts) {
    opts = opts || {};
    setInboxStatus(opts.silent ? "" : "Refreshing…");
    var url = "./data/assistant-inbox.json?t=" + Date.now();
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (data) {
      assistantInbox = normalizeInboxPayload(data) || { version: 1, updatedAt: "", messages: [] };
      assistantInbox.messages.sort(function (a, b) {
        return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
      });
      renderAssistantInboxLists();
      var n = (assistantInbox.messages || []).length;
      setInboxStatus("Updated" + (assistantInbox.updatedAt ? (" · " + formatInboxWhen(assistantInbox.updatedAt)) : "") + " · " + n + " message" + (n === 1 ? "" : "s"));
      if (!opts.silent) toast("Inbox refreshed");
      return assistantInbox;
    }).catch(function (err) {
      setInboxStatus("Refresh failed — try Paste reply. " + (err && err.message ? err.message : ""));
      renderAssistantInboxLists();
      if (!opts.silent) toast("Inbox refresh failed");
      throw err;
    });
  }

  function summarizeActions(actions) {
    actions = actions || {};
    var bits = [];
    var apps = actions.applications || [];
    var searches = actions.searches || [];
    if (apps.length) bits.push(apps.length + " application" + (apps.length === 1 ? "" : "s"));
    if (searches.length) bits.push(searches.length + " search" + (searches.length === 1 ? "" : "es"));
    if (actions.letterDraft && (actions.letterDraft.subject || actions.letterDraft.body || actions.letterDraft.to)) {
      bits.push("letter draft");
    }
    if (actions.aspiration) bits.push("aspiration");
    if (actions.journalNote && actions.journalNote.text) bits.push("journal note");
    return bits;
  }

  function openInboxMessage(id) {
    var msg = (assistantInbox.messages || []).find(function (m) { return m.id === id; });
    if (!msg) {
      toast("Message not found");
      return;
    }
    viewingInboxMsgId = id;
    if ($("inboxModalTitle")) $("inboxModalTitle").textContent = msg.subject || "From Job Search";
    if ($("inboxMsgMeta")) {
      $("inboxMsgMeta").textContent = (msg.from || "Rileys Job Search") +
        (msg.createdAt ? " · " + formatInboxWhen(msg.createdAt) : "") +
        (isInboxUnread(id) ? " · unread" : " · read");
    }
    if ($("inboxMsgBody")) $("inboxMsgBody").textContent = msg.body || "";
    var bits = summarizeActions(msg.actions);
    var preview = $("inboxActionsPreview");
    if (preview) {
      if (!bits.length) {
        preview.innerHTML = "No structured actions in this message (body only).";
      } else {
        var acts = msg.actions || {};
        var lines = ["Will merge on Apply: " + bits.join(", ") + "."];
        if ((acts.applications || []).length) {
          lines.push("<ul>" + acts.applications.slice(0, 6).map(function (a) {
            return "<li>" + escapeHtml((a.company || "?") + " - " + (a.role || "?")) + "</li>";
          }).join("") + "</ul>");
        }
        preview.innerHTML = lines.join("");
      }
    }
    if ($("inboxModal")) $("inboxModal").hidden = false;
  }

  function closeInboxModal() {
    if ($("inboxModal")) $("inboxModal").hidden = true;
    viewingInboxMsgId = null;
  }

  function openPasteInboxModal() {
    if ($("pasteInboxText")) $("pasteInboxText").value = "";
    if ($("pasteInboxModal")) $("pasteInboxModal").hidden = false;
  }

  function closePasteInboxModal() {
    if ($("pasteInboxModal")) $("pasteInboxModal").hidden = true;
  }

  function appDedupeKey(app) {
    return [
      String(app.company || "").trim().toLowerCase(),
      String(app.role || "").trim().toLowerCase(),
      String(app.url || "").trim().toLowerCase()
    ].join("|");
  }

  function applyInboxMessage(id, alsoMarkRead) {
    var msg = (assistantInbox.messages || []).find(function (m) { return m.id === id; });
    if (!msg) {
      toast("Message not found");
      return;
    }
    var actions = msg.actions || {};
    var added = { apps: 0, searches: 0, letter: 0, asp: 0, journal: 0, skipped: 0 };

    if (!state.applications) state.applications = [];
    ensureRecentSearches();
    ensureAspirations();
    ensureLetter();
    ensureDiary();

    var existingKeys = {};
    state.applications.forEach(function (a) {
      existingKeys[appDedupeKey(a)] = true;
    });

    (actions.applications || []).forEach(function (raw) {
      if (!raw) return;
      var app = {
        id: uid("app"),
        company: String(raw.company || "").trim(),
        role: String(raw.role || "").trim(),
        location: String(raw.location || "").trim(),
        pay: String(raw.pay || "").trim(),
        status: String(raw.status || "Researching").trim() || "Researching",
        appliedDate: String(raw.appliedDate || "").trim() || toLocalISODate(),
        important: false,
        keepOnBoard: false,
        url: String(raw.url || "").trim(),
        notes: String(raw.notes || "").trim(),
        archived: false
      };
      if (!app.company && !app.role) {
        added.skipped += 1;
        return;
      }
      var key = appDedupeKey(app);
      if (existingKeys[key]) {
        added.skipped += 1;
        return;
      }
      existingKeys[key] = true;
      if (shouldAutoArchive(app)) {
        app.archived = true;
        app.archivedAt = toLocalISODate();
      }
      state.applications.push(app);
      added.apps += 1;
    });

    (actions.searches || []).forEach(function (s) {
      if (!s) return;
      var q = String(s.query || "").trim();
      if (!q) return;
      var loc = String(s.location || "").trim();
      rememberSearch(q, loc);
      // Optional labeled URLs: store as notes on recent item via query suffix only if needed
      if (s.urls && s.urls.length && state.recentSearches[0] && state.recentSearches[0].query === q) {
        state.recentSearches[0].urls = (s.urls || []).map(function (u) {
          return { label: String((u && u.label) || ""), href: String((u && u.href) || "") };
        }).filter(function (u) { return u.href; });
      }
      added.searches += 1;
    });

    var ld = actions.letterDraft;
    if (ld && (ld.to || ld.subject || ld.body)) {
      state.letterDrafts.unshift({
        id: uid("letter"),
        to: String(ld.to || ""),
        subject: String(ld.subject || ""),
        body: String(ld.body || ""),
        updatedAt: toLocalISODate()
      });
      state.letterDrafts = state.letterDrafts.slice(0, 20);
      added.letter += 1;
    }

    if (actions.aspiration && String(actions.aspiration).trim()) {
      state.aspirations.entries.unshift({
        id: uid("asp"),
        date: toLocalISODate(),
        body: String(actions.aspiration).trim()
      });
      added.asp += 1;
    }

    var jn = actions.journalNote;
    if (jn && String(jn.text || "").trim()) {
      var jdate = String(jn.date || "").trim() || toLocalISODate();
      state.diary.entries.unshift({
        id: uid("diary"),
        date: jdate,
        mood: "",
        title: jn.important ? "Important" : "From Job Search",
        body: String(jn.text).trim(),
        important: !!jn.important
      });
      added.journal += 1;
    }

    saveLocal();
    if (alsoMarkRead) markInboxRead(id);
    renderJobs();
    renderJobBoard();
    renderCalendar();
    renderDiary();
    renderRecentSearches();
    renderAspirations();
    renderLetter();
    renderAssistantInboxLists();
    if ($("inboxMsgMeta") && viewingInboxMsgId === id) {
      $("inboxMsgMeta").textContent = (msg.from || "Rileys Job Search") +
        (msg.createdAt ? " · " + formatInboxWhen(msg.createdAt) : "") +
        (isInboxUnread(id) ? " · unread" : " · read");
    }

    var parts = [];
    if (added.apps) parts.push(added.apps + " app" + (added.apps === 1 ? "" : "s"));
    if (added.searches) parts.push(added.searches + " search" + (added.searches === 1 ? "" : "es"));
    if (added.letter) parts.push("letter");
    if (added.asp) parts.push("aspiration");
    if (added.journal) parts.push("journal");
    if (added.skipped) parts.push(added.skipped + " skipped");
    toast(parts.length ? ("Applied: " + parts.join(", ")) : "Nothing new to apply");
  }

  function handlePasteInbox() {
    var raw = ($("pasteInboxText") && $("pasteInboxText").value) || "";
    raw = raw.trim();
    if (!raw) {
      toast("Paste JSON first");
      return;
    }
    try {
      var data = JSON.parse(raw);
      mergeInboxData(data);
      renderAssistantInboxLists();
      setInboxStatus("Loaded from paste · " + (assistantInbox.messages || []).length + " message(s)");
      closePasteInboxModal();
      toast("Paste loaded");
    } catch (err) {
      toast("Invalid JSON");
    }
  }

  /* ---------- Resume drawer (persistent peek) ---------- */
  function openResumeDrawer(opts) {
    opts = opts || {};
    var drawer = $("resumeDrawer");
    if (!drawer || !state) return;
    renderResumeDrawer(!!opts.insertable);
    drawer.hidden = false;
  }

  function closeResumeDrawer() {
    var drawer = $("resumeDrawer");
    if (drawer) drawer.hidden = true;
  }

  function renderResumeDrawer(insertable) {
    var body = $("resumeDrawerBody");
    if (!body || !state) return;
    var r = state.resume || {};
    var p = state.profile || {};
    var html = "";
    html += '<p class="rd-target">' + escapeHtml(r.targetRole || p.name || "Resume") + "</p>";
    if (r.summary) html += '<p class="rd-summary">' + escapeHtml(r.summary) + "</p>";

    var strengths = r.strengths || [];
    if (strengths.length) {
      html += '<div class="rd-section"><h3>Skills / strengths</h3><div class="chips">';
      strengths.forEach(function (s) {
        if (insertable) {
          html += '<button type="button" class="chip on" data-insert-text="' + escapeAttr(s) + '">' + escapeHtml(s) + "</button>";
        } else {
          html += '<span class="chip on">' + escapeHtml(s) + "</span>";
        }
      });
      html += "</div></div>";
    }

    var jobs = r.jobs || [];
    if (jobs.length) {
      html += '<div class="rd-section"><h3>Experience</h3>';
      jobs.slice(0, 4).forEach(function (job) {
        html += "<p class=\"rd-bullet\"><strong>" + escapeHtml(job.title || "") + "</strong> — " +
          escapeHtml(job.employer || "") + "</p>";
        (job.bullets || []).slice(0, 3).forEach(function (b) {
          if (!b) return;
          if (insertable) {
            html += '<button type="button" class="rd-insert" data-insert-text="' + escapeAttr(b) + '">+ ' +
              escapeHtml(b.length > 90 ? b.slice(0, 87) + "…" : b) + "</button>";
          } else {
            html += '<p class="rd-bullet">• ' + escapeHtml(b) + "</p>";
          }
        });
      });
      html += "</div>";
    }

    if (insertable) {
      if (r.targetRole) {
        html = '<div class="rd-section"><h3>Quick insert</h3>' +
          '<button type="button" class="rd-insert" data-insert-text="' + escapeAttr(r.targetRole) + '">Target: ' +
          escapeHtml(r.targetRole) + "</button></div>" + html;
      }
      html = '<p style="margin:0 0 10px;color:var(--muted);font-size:.85rem;">Tap a chip or bullet to insert into your letter without leaving this screen.</p>' + html;
    }

    body.innerHTML = html || '<p class="empty">Add resume content to peek here.</p>';
  }

  function insertIntoLetter(text) {
    var ta = $("l-body");
    if (!ta || !text) return;
    var start = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
    var end = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;
    var before = ta.value.slice(0, start);
    var after = ta.value.slice(end);
    var padBefore = before && !/\s$/.test(before) ? "\n" : "";
    var padAfter = after && !/^\s/.test(after) ? "\n" : "";
    ta.value = before + padBefore + text + padAfter + after;
    persistCurrentLetter();
    toast("Inserted into letter");
  }

  /* ---------- Aspirations ---------- */
  function ensureAspirations() {
    if (!state.aspirations) state.aspirations = { entries: [] };
    if (!state.aspirations.entries) state.aspirations.entries = [];
  }

  function renderAspirations() {
    if (!state) return;
    ensureAspirations();
    if ($("a-freewrite")) $("a-freewrite").value = "";
    var list = $("aspirationsList");
    if (!list) return;
    var entries = (state.aspirations.entries || []).slice();
    if (!entries.length) {
      list.innerHTML = '<p style="margin:0;color:var(--muted);font-size:.88rem;">Nothing saved yet — write what’s on your mind above.</p>';
      return;
    }
    list.innerHTML = entries.map(function (e) {
      return (
        '<div class="diary-card" data-asp-id="' + escapeAttr(e.id) + '">' +
          '<div class="meta">' + escapeHtml(e.date || "") + "</div>" +
          '<div class="body">' + escapeHtml(e.body || "") + "</div>" +
          '<div class="btn-row">' +
            '<button type="button" class="small danger" data-del-asp="' + escapeAttr(e.id) + '">Delete</button>' +
          "</div>" +
        "</div>"
      );
    }).join("");
  }

  function saveAspiration() {
    ensureAspirations();
    var body = ($("a-freewrite") && $("a-freewrite").value.trim()) || "";
    if (!body) {
      toast("Write something first");
      return;
    }
    state.aspirations.entries.unshift({
      id: uid("asp"),
      date: toLocalISODate(),
      body: body
    });
    saveLocal();
    if ($("a-freewrite")) $("a-freewrite").value = "";
    renderAspirations();
    toast("Aspiration saved");
  }

  /* ---------- Draft Letter ---------- */
  var LETTER_TEMPLATES = {
    cover: {
      subject: "Application for [Role] — Riley LaMar",
      body: "Dear Hiring Manager,\n\nI am writing to express my interest in the [Role] position at [Company]. With a strong background in hospitality leadership, cash handling, and guest experience, I am excited to bring reliability and energy to your team.\n\n[Insert a strength or experience bullet from Resume]\n\nThank you for your time and consideration. I look forward to the opportunity to discuss how I can contribute.\n\nSincerely,\nRiley LaMar"
    },
    thankyou: {
      subject: "Thank you — [Role] conversation",
      body: "Dear [Name],\n\nThank you for taking the time to speak with me about the [Role] role at [Company]. I enjoyed learning more about the team and am even more interested in contributing.\n\n[Optional: one resume highlight]\n\nPlease let me know if I can share anything else. I appreciate your consideration.\n\nBest regards,\nRiley LaMar"
    },
    followup: {
      subject: "Following up — [Role] application",
      body: "Dear Hiring Manager,\n\nI am following up on my application for the [Role] position at [Company]. I remain very interested and would welcome the chance to talk further.\n\nPlease let me know if there is any additional information I can provide.\n\nThank you,\nRiley LaMar"
    }
  };

  function ensureLetter() {
    if (!state.currentLetter) state.currentLetter = { to: "", subject: "", body: "" };
    if (!state.letterDrafts) state.letterDrafts = [];
  }

  function persistCurrentLetter() {
    ensureLetter();
    state.currentLetter = {
      to: ($("l-to") && $("l-to").value) || "",
      subject: ($("l-subject") && $("l-subject").value) || "",
      body: ($("l-body") && $("l-body").value) || ""
    };
    saveLocal();
  }

  function renderLetterInsertChips() {
    var wrap = $("letterInsertChips");
    if (!wrap || !state) return;
    var r = state.resume || {};
    var chips = [];
    if (r.targetRole) chips.push({ label: "Target", text: r.targetRole });
    (r.strengths || []).slice(0, 6).forEach(function (s) {
      chips.push({ label: s, text: s });
    });
    (r.jobs || []).slice(0, 2).forEach(function (job) {
      (job.bullets || []).slice(0, 2).forEach(function (b) {
        if (b) chips.push({
          label: (b.length > 28 ? b.slice(0, 25) + "…" : b),
          text: b
        });
      });
    });
    if (!chips.length) {
      wrap.innerHTML = '<span style="color:var(--muted);font-size:.85rem;">Add resume skills/experience to insert here</span>';
      return;
    }
    wrap.innerHTML = chips.map(function (c) {
      return '<button type="button" class="chip" data-insert-text="' + escapeAttr(c.text) + '">' +
        escapeHtml(c.label) + "</button>";
    }).join("");
  }

  function renderLetter() {
    if (!state) return;
    ensureLetter();
    var cur = state.currentLetter || {};
    if ($("l-to")) $("l-to").value = cur.to || "";
    if ($("l-subject")) $("l-subject").value = cur.subject || "";
    if ($("l-body")) $("l-body").value = cur.body || "";
    renderLetterInsertChips();
    renderLetterDraftsList();
  }

  function renderLetterDraftsList() {
    var list = $("letterDraftsList");
    if (!list) return;
    ensureLetter();
    var drafts = state.letterDrafts || [];
    if (!drafts.length) {
      list.innerHTML = '<p style="margin:0;color:var(--muted);font-size:.88rem;">No saved drafts yet.</p>';
      return;
    }
    list.innerHTML = drafts.map(function (d) {
      return (
        '<button type="button" class="stream-item" data-load-draft="' + escapeAttr(d.id) + '">' +
          '<div><div class="si-main">' + escapeHtml(d.subject || "(No subject)") + "</div>" +
          '<div class="si-sub">' + escapeHtml(d.to || "No recipient") +
          (d.updatedAt ? " · " + escapeHtml(d.updatedAt) : "") + "</div></div>" +
        "</button>"
      );
    }).join("");
  }

  function applyLetterTemplate(key) {
    var tpl = LETTER_TEMPLATES[key];
    if (!tpl) return;
    var r = (state && state.resume) || {};
    var role = r.targetRole || "[Role]";
    var subject = tpl.subject.replace(/\[Role\]/g, role);
    var body = tpl.body.replace(/\[Role\]/g, role);
    if ($("l-subject")) $("l-subject").value = subject;
    if ($("l-body")) $("l-body").value = body;
    document.querySelectorAll("[data-letter-tpl]").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-letter-tpl") === key);
    });
    persistCurrentLetter();
    toast("Template applied");
  }

  function buildGmailUrl() {
    var to = ($("l-to") && $("l-to").value.trim()) || "";
    var su = ($("l-subject") && $("l-subject").value) || "";
    var body = ($("l-body") && $("l-body").value) || "";
    return "https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent(to) +
      "&su=" + encodeURIComponent(su) + "&body=" + encodeURIComponent(body);
  }

  function buildMailtoUrl() {
    var to = ($("l-to") && $("l-to").value.trim()) || "";
    var su = ($("l-subject") && $("l-subject").value) || "";
    var body = ($("l-body") && $("l-body").value) || "";
    return "mailto:" + encodeURIComponent(to) +
      "?subject=" + encodeURIComponent(su) + "&body=" + encodeURIComponent(body);
  }

  function openGmail() {
    persistCurrentLetter();
    var url = buildGmailUrl();
    window.open(url, "_blank", "noopener,noreferrer");
    toast("Opening Gmail");
  }

  function openMailto() {
    persistCurrentLetter();
    window.location.href = buildMailtoUrl();
  }

  function copyLetter() {
    persistCurrentLetter();
    var to = ($("l-to") && $("l-to").value) || "";
    var su = ($("l-subject") && $("l-subject").value) || "";
    var body = ($("l-body") && $("l-body").value) || "";
    var text = "To: " + to + "\nSubject: " + su + "\n\n" + body;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast("Copied");
      }).catch(function () {
        toast("Copy failed");
      });
    } else {
      toast("Clipboard unavailable");
    }
  }

  function downloadLetter() {
    persistCurrentLetter();
    var to = ($("l-to") && $("l-to").value) || "";
    var su = ($("l-subject") && $("l-subject").value) || "";
    var body = ($("l-body") && $("l-body").value) || "";
    var text = "To: " + to + "\nSubject: " + su + "\n\n" + body;
    var blob = new Blob([text], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "letter-draft.txt";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast("Downloaded .txt");
  }

  function saveLetterDraft() {
    ensureLetter();
    persistCurrentLetter();
    var cur = state.currentLetter;
    if (!(cur.subject || cur.body || cur.to)) {
      toast("Nothing to save");
      return;
    }
    var draft = {
      id: uid("letter"),
      to: cur.to || "",
      subject: cur.subject || "",
      body: cur.body || "",
      updatedAt: toLocalISODate()
    };
    state.letterDrafts.unshift(draft);
    state.letterDrafts = state.letterDrafts.slice(0, 20);
    saveLocal();
    renderLetterDraftsList();
    toast("Draft saved");
  }

  function loadLetterDraft(id) {
    ensureLetter();
    var d = (state.letterDrafts || []).find(function (x) { return x.id === id; });
    if (!d) return;
    state.currentLetter = { to: d.to || "", subject: d.subject || "", body: d.body || "" };
    saveLocal();
    renderLetter();
    toast("Draft loaded");
  }

  /* ---------- Profile ---------- */
  function renderProfile() {
    var p = state.profile;
    $("p-name").value = p.name || "";
    $("p-phone").value = p.phone || "";
    $("p-email").value = p.email || "";
    $("p-address").value = p.address || "";
    $("p-notes").value = p.notes || "";
  }

  function saveProfileFromForm(e) {
    e.preventDefault();
    state.profile = {
      name: $("p-name").value.trim(),
      phone: $("p-phone").value.trim(),
      email: $("p-email").value.trim(),
      address: $("p-address").value.trim(),
      notes: $("p-notes").value.trim()
    };
    saveLocal();
    renderAllPapers();
    toast("Profile saved");
  }

  /* ---------- Resume ---------- */
  function renderStrengths() {
    var selected = state.resume.strengths || [];
    var wrap = $("strengthChips");
    wrap.innerHTML = ALL_STRENGTHS.map(function (s) {
      var on = selected.indexOf(s) >= 0 ? " on" : "";
      return '<button type="button" class="chip' + on + '" data-strength="' + escapeAttr(s) + '">' + escapeHtml(s) + "</button>";
    }).join("");
  }

  function renderAvatar() {
    var url = (state.profile && state.profile.avatarDataUrl) || "";
    var img = $("avatarImg");
    var ph = $("avatarPh");
    var clear = $("btnAvatarClear");
    var pick = $("btnAvatarPick");
    if (!img) return;
    if (url) {
      img.src = url;
      img.hidden = false;
      if (ph) ph.hidden = true;
      if (clear) clear.hidden = false;
      if (pick) pick.textContent = "Change photo";
    } else {
      img.removeAttribute("src");
      img.hidden = true;
      if (ph) {
        ph.hidden = false;
        var n = (state.profile && state.profile.name) || "R";
        ph.textContent = (n.trim()[0] || "R").toUpperCase();
      }
      if (clear) clear.hidden = true;
      if (pick) pick.textContent = "Add photo";
    }
  }

  function renderResumeMeta() {
    var p = state.profile || {};
    var r = state.resume || {};
    if ($("r-name")) $("r-name").value = p.name || "";
    if ($("r-phone")) $("r-phone").value = p.phone || "";
    if ($("r-email")) $("r-email").value = p.email || "";
    if ($("r-address")) $("r-address").value = p.address || "";
    if ($("r-notes")) $("r-notes").value = p.notes || "";
    if ($("r-target")) $("r-target").value = r.targetRole || "";
    if ($("r-summary")) $("r-summary").value = r.summary || "";
    if ($("r-skills")) $("r-skills").value = r.skillsText || (r.strengths || []).join(", ");
    if ($("r-education")) $("r-education").value = r.education || "";
    renderAvatar();
    renderStrengths();
  }

  function saveResumeMeta() {
    if (!state.profile) state.profile = {};
    if (!state.resume) state.resume = {};
    state.profile.name = ($("r-name") && $("r-name").value.trim()) || state.profile.name || "";
    state.profile.phone = ($("r-phone") && $("r-phone").value.trim()) || "";
    state.profile.email = ($("r-email") && $("r-email").value.trim()) || "";
    state.profile.address = ($("r-address") && $("r-address").value.trim()) || "";
    state.profile.notes = ($("r-notes") && $("r-notes").value.trim()) || "";
    state.resume.targetRole = ($("r-target") && $("r-target").value.trim()) || "";
    state.resume.summary = ($("r-summary") && $("r-summary").value.trim()) || "";
    state.resume.skillsText = ($("r-skills") && $("r-skills").value.trim()) || "";
    state.resume.education = ($("r-education") && $("r-education").value.trim()) || "";
    saveLocal();
    renderProfile();
    renderAvatar();
    renderAllPapers();
    toast("Profile & resume saved");
  }

  function renderExperience() {
    var list = $("experienceList");
    var jobs = state.resume.jobs || [];
    if (!jobs.length) {
      list.innerHTML = '<div class="empty">No experience yet.</div>';
      return;
    }
    list.innerHTML = jobs.map(function (job, idx) {
      var open = openExpId === job.id ? " open" : "";
      return (
        '<div class="acc-item' + open + '" data-exp-id="' + escapeAttr(job.id) + '">' +
          '<button type="button" class="acc-head" data-acc-toggle="' + escapeAttr(job.id) + '">' +
            "<div><strong>" + escapeHtml(job.employer || "") + " — " + escapeHtml(job.title || "") + "</strong>" +
            '<div class="meta">' + escapeHtml(formatDateRange(job)) + "</div></div>" +
            '<span class="chev" aria-hidden="true">></span>' +
          "</button>" +
          '<div class="exp-reorder">' +
            '<button type="button" class="small" data-move-exp="-1" data-exp-move="' + escapeAttr(job.id) + '"' + (idx === 0 ? " disabled" : "") + ">↑</button>" +
            '<button type="button" class="small" data-move-exp="1" data-exp-move="' + escapeAttr(job.id) + '"' + (idx === jobs.length - 1 ? " disabled" : "") + ">↓</button>" +
          "</div>" +
          '<div class="acc-body">' + renderExpEditor(job) + "</div>" +
        "</div>"
      );
    }).join("");
  }

  function renderExpEditor(job) {
    var bullets = (job.bullets || []).map(function (b, i) {
      return (
        '<div class="bullet-row" data-bi="' + i + '">' +
          '<input type="text" class="bullet-input" maxlength="160" value="' + escapeAttr(b) + '">' +
          '<button type="button" class="small danger" data-remove-bullet="' + i + '">Remove</button>' +
        "</div>"
      );
    }).join("");

    var endDisabled = job.current ? " disabled" : "";
    return (
      '<label>Employer</label>' +
      '<input type="text" class="exp-employer" maxlength="120" value="' + escapeAttr(job.employer || "") + '">' +
      '<label>Title</label>' +
      '<input type="text" class="exp-title" maxlength="100" value="' + escapeAttr(job.title || "") + '">' +
      '<label>Role type</label>' +
      '<select class="exp-roletype">' + roleTypeOptions(job.roleType || "Bartending") + "</select>" +
      '<label>Start</label>' +
      '<div class="row-2">' +
        '<select class="exp-sm">' + monthOptions(job.startMonth || "01") + "</select>" +
        '<select class="exp-sy">' + yearOptions(job.startYear || "2020") + "</select>" +
      "</div>" +
      '<label class="check-row"><input type="checkbox" class="exp-current"' + (job.current ? " checked" : "") + "> Currently work here</label>" +
      '<label>End</label>' +
      '<div class="row-2">' +
        '<select class="exp-em"' + endDisabled + ">" + monthOptions(job.endMonth || "01") + "</select>" +
        '<select class="exp-ey"' + endDisabled + ">" + yearOptions(job.endYear || "2024") + "</select>" +
      "</div>" +
      "<label>Bullets</label>" +
      '<div class="bullet-list">' + bullets + "</div>" +
      '<div class="btn-row">' +
        '<button type="button" class="small" data-add-bullet>Add bullet</button>' +
        '<button type="button" class="primary small" data-save-exp>Save job</button>' +
      "</div>"
    );
  }

  function getExpFromEditor(item) {
    var bullets = [];
    item.querySelectorAll(".bullet-input").forEach(function (inp) {
      var t = inp.value.trim();
      if (t) bullets.push(t);
    });
    var current = item.querySelector(".exp-current").checked;
    return {
      id: item.getAttribute("data-exp-id"),
      employer: item.querySelector(".exp-employer").value.trim(),
      title: item.querySelector(".exp-title").value.trim(),
      roleType: item.querySelector(".exp-roletype").value,
      startMonth: item.querySelector(".exp-sm").value,
      startYear: item.querySelector(".exp-sy").value,
      endMonth: current ? "" : item.querySelector(".exp-em").value,
      endYear: current ? "" : item.querySelector(".exp-ey").value,
      current: current,
      bullets: bullets
    };
  }

  function saveExperience(item) {
    var updated = getExpFromEditor(item);
    var idx = state.resume.jobs.findIndex(function (j) { return j.id === updated.id; });
    if (idx >= 0) state.resume.jobs[idx] = updated;
    saveLocal();
    openExpId = updated.id;
    renderExperience();
    renderAllPapers();
    toast("Experience saved");
  }

  /* ---------- View toggles ---------- */
  function setProfileView(mode) {
    profileView = mode === "paper" ? "paper" : "edit";
    var edit = $("profileEdit");
    var paper = $("profilePaper");
    if (edit) edit.hidden = profileView !== "edit";
    if (paper) paper.hidden = profileView !== "paper";
    document.querySelectorAll("[data-profile-view]").forEach(function (b) {
      var on = b.getAttribute("data-profile-view") === profileView;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (profileView === "paper") renderPaperProfile();
  }

  function setResumeView(mode) {
    resumeView = mode === "paper" ? "paper" : "edit";
    var edit = $("resumeEdit");
    var paper = $("resumePaper");
    if (edit) edit.hidden = resumeView !== "edit";
    if (paper) paper.hidden = resumeView !== "paper";
    document.querySelectorAll("[data-resume-view]").forEach(function (b) {
      var on = b.getAttribute("data-resume-view") === resumeView;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (resumeView === "paper") renderPaperResume();
  }

  function setJobsView(mode) {
    jobsView = mode === "paper" ? "paper" : "edit";
    var edit = $("jobsEdit");
    var paper = $("jobsPaper");
    if (edit) edit.hidden = jobsView !== "edit";
    if (paper) paper.hidden = jobsView !== "paper";
    document.querySelectorAll("[data-jobs-view]").forEach(function (b) {
      var on = b.getAttribute("data-jobs-view") === jobsView;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (jobsView === "paper") renderPaperJobs();
  }

  function refreshActivePaper() {
    if (activeTab === "profile" && profileView === "paper") renderPaperProfile();
    if (activeTab === "resume" && resumeView === "paper") renderPaperResume();
    if (activeTab === "jobs" && jobsView === "paper") renderPaperJobs();
    if (activeTab === "calendar" && calendarView === "paper") renderPaperCalendar();
    if (activeTab === "diary" && diaryView === "paper") renderPaperDiary();
  }

  function panelIsVisible(tabName) {
    var panel = document.querySelector('.tab-panel[data-tab="' + tabName + '"]');
    return !!(panel && !panel.hidden);
  }

  function renderAllPapers() {
    if (panelIsVisible("profile") && !$("profilePaper").hidden) renderPaperProfile();
    if (panelIsVisible("resume") && !$("resumePaper").hidden) renderPaperResume();
    if (panelIsVisible("jobs") && !$("jobsPaper").hidden) renderPaperJobs();
    if (panelIsVisible("calendar") && $("calendarPaper") && !$("calendarPaper").hidden) renderPaperCalendar();
    if (panelIsVisible("diary") && $("diaryPaper") && !$("diaryPaper").hidden) renderPaperDiary();
  }

  /* ---------- Paper pagination helpers ---------- */
  function ensureMeasureRoot() {
    var root = $("paperMeasureRoot");
    if (root) return root;
    root = document.createElement("div");
    root.id = "paperMeasureRoot";
    root.className = "paper-measure-root";
    document.body.appendChild(root);
    return root;
  }

  function probePaperMetrics(stackEl) {
    var probe = document.createElement("div");
    probe.className = "paper-page";
    probe.innerHTML =
      '<div class="paper-page-inner">' +
        '<div class="paper-page-body"></div>' +
        '<div class="paper-page-footer"><span class="page-num">0 / 0</span></div>' +
      "</div>";
    stackEl.appendChild(probe);
    var body = probe.querySelector(".paper-page-body");
    var main = document.querySelector("main");
    var width = body.clientWidth || stackEl.clientWidth;
    if (!width) {
      width = (main && main.clientWidth) ? Math.max(240, main.clientWidth - 28) : 320;
    }
    var pageH = probe.clientHeight || Math.floor(width * 11 / 8.5);
    var maxHeight = body.clientHeight;
    if (!maxHeight) {
      maxHeight = Math.floor(pageH * 0.78);
    }
    /* Leave headroom for continuation titles and rounding */
    maxHeight = Math.floor(maxHeight * 0.94);
    stackEl.removeChild(probe);
    if (maxHeight < 80) maxHeight = 80;
    return { width: width, maxHeight: maxHeight };
  }

  function measureHtml(html, width, fontSize) {
    var root = ensureMeasureRoot();
    var wrap = document.createElement("div");
    wrap.className = "paper-page-body";
    wrap.style.width = width + "px";
    if (fontSize) wrap.style.fontSize = fontSize;
    wrap.innerHTML = html;
    root.appendChild(wrap);
    var h = wrap.offsetHeight;
    root.removeChild(wrap);
    return h;
  }

  function packBlocks(blocks, maxHeight) {
    var pages = [];
    var current = [];
    var used = 0;
    var i, block, h, add;
    /* Approximate collapsed margins between stacked .paper-section blocks */
    var collapse = 12;

    for (i = 0; i < blocks.length; i++) {
      block = blocks[i];
      h = block.height;
      add = current.length ? Math.max(0, h - collapse) : h;
      if (current.length && used + add > maxHeight) {
        pages.push(current);
        current = [];
        used = 0;
        add = h;
      }
      current.push(block);
      used += add;
    }
    if (current.length) pages.push(current);
    if (!pages.length) pages.push([]);
    return pages;
  }

  function renderPageStack(stackEl, pagesHtml) {
    var total = pagesHtml.length || 1;
    if (!pagesHtml.length) pagesHtml = [""];
    stackEl.innerHTML = pagesHtml.map(function (bodyHtml, i) {
      return (
        '<div class="paper-page">' +
          '<div class="paper-page-inner">' +
            '<div class="paper-page-body">' + bodyHtml + "</div>" +
            '<div class="paper-page-footer"><span class="page-num">' +
              (i + 1) + " / " + total +
            "</span></div>" +
          "</div>" +
        "</div>"
      );
    }).join("");
  }

  function paginateAndRender(stackId, buildBlocks) {
    var stack = $(stackId);
    if (!stack || !state) return;
    stack.innerHTML = "";
    var metrics = probePaperMetrics(stack);
    var fontSize = "";
    try {
      var probe = document.createElement("div");
      probe.className = "paper-page";
      probe.innerHTML = '<div class="paper-page-inner"><div class="paper-page-body"></div></div>';
      stack.appendChild(probe);
      fontSize = window.getComputedStyle(probe.querySelector(".paper-page-body")).fontSize;
      stack.removeChild(probe);
    } catch (e) {}
    var blocks = buildBlocks(metrics);
    var measured = blocks.map(function (b) {
      return {
        html: b.html,
        height: measureHtml(b.html, metrics.width, fontSize),
        id: b.id || ""
      };
    });
    var pages = packBlocks(measured, metrics.maxHeight);
    var pagesHtml = pages.map(function (pageBlocks) {
      return pageBlocks.map(function (b) { return b.html; }).join("");
    });
    renderPageStack(stack, pagesHtml);
  }

  /* ---------- Paper: Profile ---------- */
  function renderPaperProfile() {
    paginateAndRender("profilePaperStack", function () {
      var p = state.profile || {};
      var r = state.resume || {};
      var contactParts = [];
      if (p.phone) contactParts.push(escapeHtml(p.phone));
      if (p.email) contactParts.push(escapeHtml(p.email));
      if (p.address) contactParts.push(escapeHtml(p.address));

      var blocks = [];
      blocks.push({
        id: "header",
        html:
          '<h1 class="paper-name">' + escapeHtml(p.name || "Name") + "</h1>" +
          (contactParts.length
            ? '<p class="paper-contact">' + contactParts.join("  |  ") + "</p>"
            : "") +
          '<p class="paper-doc-title" style="margin-top:0.85em;">Profile</p>'
      });

      blocks.push({
        id: "contact",
        html:
          '<div class="paper-section">' +
            '<h2 class="paper-section-title">Contact</h2>' +
            '<p class="paper-kv"><strong>Name:</strong> ' + escapeHtml(p.name || "-") + "</p>" +
            '<p class="paper-kv"><strong>Phone:</strong> ' + escapeHtml(p.phone || "-") + "</p>" +
            '<p class="paper-kv"><strong>Email:</strong> ' + escapeHtml(p.email || "-") + "</p>" +
            '<p class="paper-kv"><strong>Address:</strong> ' + escapeHtml(p.address || "-") + "</p>" +
          "</div>"
      });

      blocks.push({
        id: "notes",
        html:
          '<div class="paper-section">' +
            '<h2 class="paper-section-title">Notes</h2>' +
            '<p class="paper-notes">' + escapeHtml(p.notes || "No notes yet.") + "</p>" +
          "</div>"
      });

      var strengths = r.strengths || [];
      var strengthsHtml = strengths.length
        ? '<ul class="paper-strengths">' + strengths.map(function (s) {
            return "<li>" + escapeHtml(s) + "</li>";
          }).join("") + "</ul>"
        : '<p class="paper-empty">No strengths selected.</p>';

      blocks.push({
        id: "prefs",
        html:
          '<div class="paper-section">' +
            '<h2 class="paper-section-title">Key Preferences</h2>' +
            '<p class="paper-pref-line"><strong>Target role:</strong> ' +
              escapeHtml(r.targetRole || "-") + "</p>" +
            '<p class="paper-pref-line" style="margin-top:0.45em;"><strong>Strengths:</strong></p>' +
            strengthsHtml +
          "</div>"
      });

      return blocks;
    });
  }

  /* ---------- Paper: Resume ---------- */
  function buildResumeJobHtml(job) {
    var bullets = (job.bullets || []).filter(Boolean);
    var bulletsHtml = bullets.length
      ? '<ul class="paper-bullets">' + bullets.map(function (b) {
          return "<li>" + escapeHtml(b) + "</li>";
        }).join("") + "</ul>"
      : "";
    var titleLine = (job.employer || "") && (job.title || "")
      ? escapeHtml(job.employer) + " — " + escapeHtml(job.title)
      : escapeHtml(job.employer || job.title || "Role");
    return (
      '<div class="paper-job">' +
        '<div class="paper-job-head">' +
          '<p class="paper-job-title">' + titleLine + "</p>" +
          '<span class="paper-dates">' + escapeHtml(formatDateRange(job)) + "</span>" +
        "</div>" +
        (job.roleType
          ? '<p class="paper-job-meta">' + escapeHtml(job.roleType) + "</p>"
          : "") +
        bulletsHtml +
      "</div>"
    );
  }

  function renderPaperResume() {
    paginateAndRender("resumePaperStack", function () {
      var p = state.profile || {};
      var r = state.resume || {};
      var contactParts = [];
      if (p.phone) contactParts.push(escapeHtml(p.phone));
      if (p.email) contactParts.push(escapeHtml(p.email));
      if (p.address) contactParts.push(escapeHtml(p.address));

      var blocks = [];
      blocks.push({
        id: "header",
        html:
          '<h1 class="paper-name">' + escapeHtml(p.name || "Name") + "</h1>" +
          (contactParts.length
            ? '<p class="paper-contact">' + contactParts.join("  |  ") + "</p>"
            : "")
      });

      blocks.push({
        id: "summary",
        html:
          '<div class="paper-section">' +
            '<h2 class="paper-section-title">Summary</h2>' +
            '<p class="paper-summary">' + escapeHtml(r.summary || "No summary yet.") + "</p>" +
          "</div>"
      });

      /* Skills: free-text + strength chips (Freddy order: skills then education then experience) */
      var skillItems = [];
      var skillsText = (r.skillsText || "").trim();
      if (skillsText) {
        skillsText.split(/[,\n]+/).forEach(function (s) {
          s = s.trim();
          if (s && skillItems.indexOf(s) < 0) skillItems.push(s);
        });
      }
      (r.strengths || []).forEach(function (s) {
        if (s && skillItems.indexOf(s) < 0) skillItems.push(s);
      });
      var skillsHtml = skillItems.length
        ? '<ul class="paper-strengths">' + skillItems.map(function (s) {
            return "<li>" + escapeHtml(s) + "</li>";
          }).join("") + "</ul>"
        : '<p class="paper-empty">No skills listed yet.</p>';

      blocks.push({
        id: "skills",
        html:
          '<div class="paper-section">' +
            '<h2 class="paper-section-title">Skills</h2>' +
            skillsHtml +
          "</div>"
      });

      if (r.targetRole) {
        blocks.splice(1, 0, {
          id: "headline",
          html:
            '<div class="paper-section">' +
              '<h2 class="paper-section-title">Target</h2>' +
              '<p class="paper-edu">' + escapeHtml(r.targetRole) + "</p>" +
            "</div>"
        });
      }

      blocks.push({
        id: "education",
        html:
          '<div class="paper-section">' +
            '<h2 class="paper-section-title">Education</h2>' +
            '<p class="paper-edu">' + escapeHtml(r.education || "No education listed.") + "</p>" +
          "</div>"
      });

      var jobs = r.jobs || [];
      if (!jobs.length) {
        blocks.push({
          id: "exp-empty",
          html:
            '<div class="paper-section">' +
              '<h2 class="paper-section-title">Experience</h2>' +
              '<p class="paper-empty">No experience listed.</p>' +
            "</div>"
        });
      } else {
        jobs.forEach(function (job, idx) {
          var titleHtml = idx === 0
            ? '<h2 class="paper-section-title">Experience</h2>'
            : "";
          blocks.push({
            id: "job-" + (job.id || idx),
            html:
              '<div class="paper-section">' +
                titleHtml +
                buildResumeJobHtml(job) +
              "</div>",
            isJob: true,
            jobIndex: idx
          });
        });
      }

      return blocks;
    });

    /* Add "Experience (continued)" when a page starts mid-experience */
    var stack = $("resumePaperStack");
    if (!stack) return;
    var pages = stack.querySelectorAll(".paper-page-body");
    pages.forEach(function (body, pageIdx) {
      if (pageIdx === 0) return;
      var firstSection = body.querySelector(".paper-section");
      if (!firstSection) return;
      var hasTitle = firstSection.querySelector(".paper-section-title");
      var hasJob = firstSection.querySelector(".paper-job");
      if (!hasTitle && hasJob) {
        var h = document.createElement("h2");
        h.className = "paper-section-title";
        h.textContent = "Experience (continued)";
        firstSection.insertBefore(h, firstSection.firstChild);
      }
    });
  }

  /* ---------- Paper: Jobs ---------- */
  function sortedApps() {
    return (state.applications || []).slice().sort(function (a, b) {
      var da = a.appliedDate || "";
      var db = b.appliedDate || "";
      if (da !== db) return db.localeCompare(da);
      return (b.id || "").localeCompare(a.id || "");
    });
  }

  function countByStatus() {
    var counts = {};
    JOB_STATUSES.forEach(function (s) { counts[s] = 0; });
    (state.applications || []).forEach(function (a) {
      if (counts[a.status] == null) counts[a.status] = 0;
      counts[a.status]++;
    });
    return counts;
  }

  function buildJobsSummaryHtml() {
    var counts = countByStatus();
    var total = (state.applications || []).length;
    var items = JOB_STATUSES.map(function (s) {
      return (
        '<span class="paper-status-item"><strong>' + escapeHtml(s) + ":</strong> " +
        (counts[s] || 0) + "</span>"
      );
    }).join("");
    return (
      '<h1 class="paper-doc-title">Job Applications</h1>' +
      '<div class="paper-section">' +
        '<h2 class="paper-section-title">Status Summary</h2>' +
        '<p class="paper-kv"><strong>Total:</strong> ' + total + "</p>" +
        '<div class="paper-status-grid">' + items + "</div>" +
      "</div>"
    );
  }

  function buildJobAppBlockHtml(a) {
    return (
      '<div class="paper-app-block">' +
        '<div class="paper-app-head">' +
          '<p class="paper-app-title">' + escapeHtml(a.company || "-") + " - " +
            escapeHtml(a.role || "-") + "</p>" +
          '<span class="paper-dates">' + escapeHtml(a.status || "-") + "</span>" +
        "</div>" +
        '<p class="paper-app-meta">' +
          escapeHtml(a.pay || "Pay n/a") + "  |  " +
          escapeHtml(a.appliedDate || "No date") + "  |  " +
          escapeHtml(a.location || "No location") +
        "</p>" +
        (a.notes
          ? '<p class="paper-app-notes">' + escapeHtml(a.notes) + "</p>"
          : "") +
      "</div>"
    );
  }

  function renderPaperJobs() {
    paginateAndRender("jobsPaperStack", function () {
      var blocks = [];
      blocks.push({ id: "summary", html: buildJobsSummaryHtml() });

      var apps = sortedApps();
      if (!apps.length) {
        blocks.push({
          id: "empty",
          html:
            '<div class="paper-section">' +
              '<h2 class="paper-section-title">Applications</h2>' +
              '<p class="paper-empty">No applications yet.</p>' +
            "</div>"
        });
      } else {
        apps.forEach(function (a, idx) {
          var title = idx === 0
            ? '<h2 class="paper-section-title">Applications</h2>'
            : "";
          blocks.push({
            id: "app-" + (a.id || idx),
            html: '<div class="paper-section">' + title + buildJobAppBlockHtml(a) + "</div>"
          });
        });
      }
      return blocks;
    });

    var stack = $("jobsPaperStack");
    if (!stack) return;
    var pages = stack.querySelectorAll(".paper-page-body");
    pages.forEach(function (body, pageIdx) {
      if (pageIdx === 0) return;
      var firstSection = body.querySelector(".paper-section");
      if (!firstSection) return;
      var hasTitle = firstSection.querySelector(".paper-section-title");
      var hasApp = firstSection.querySelector(".paper-app-block");
      if (!hasTitle && hasApp) {
        var h = document.createElement("h2");
        h.className = "paper-section-title";
        h.textContent = "Applications (continued)";
        firstSection.insertBefore(h, firstSection.firstChild);
      }
    });
  }

  /* ---------- Jobs edit UI ---------- */
  function renderJobsBreakdown() {
    var chips = $("statusChips");
    var bars = $("statusBars");
    var body = $("glanceBody");
    if (!chips || !bars || !body || !state) return;

    var counts = countByStatus();
    var total = (state.applications || []).length;
    var max = 1;
    JOB_STATUSES.forEach(function (s) {
      if (counts[s] > max) max = counts[s];
    });

    chips.innerHTML = JOB_STATUSES.map(function (s) {
      var n = counts[s] || 0;
      var cls = "status-chip" + (n ? " has-count" : "");
      return (
        '<span class="' + cls + '" data-status="' + escapeAttr(s) + '">' +
          escapeHtml(s) + ' <span class="count">' + n + "</span>" +
        "</span>"
      );
    }).join("") +
      '<span class="status-chip has-count">Total <span class="count">' + total + "</span></span>";

    bars.innerHTML = JOB_STATUSES.map(function (s) {
      var n = counts[s] || 0;
      var pct = Math.round((n / max) * 100);
      if (n === 0) pct = 0;
      return (
        '<div class="status-bar-row">' +
          '<span class="lbl">' + escapeHtml(s) + "</span>" +
          '<div class="status-bar-track">' +
            '<div class="status-bar-fill" data-status="' + escapeAttr(s) + '" style="width:' + pct + '%"></div>' +
          "</div>" +
          '<span class="n">' + n + "</span>" +
        "</div>"
      );
    }).join("");

    var apps = sortedApps();
    if (!apps.length) {
      body.innerHTML = '<tr><td colspan="6" class="glance-empty">No applications yet.</td></tr>';
      return;
    }
    body.innerHTML = apps.map(function (a) {
      return (
        '<tr data-glance-id="' + escapeAttr(a.id) + '" tabindex="0">' +
          "<td>" + escapeHtml(a.company || "-") + "</td>" +
          "<td>" + escapeHtml(a.role || "-") + "</td>" +
          '<td class="pay-cell">' + escapeHtml(a.pay || "-") + "</td>" +
          '<td><span class="badge" data-status="' + escapeAttr(a.status || "") + '">' +
            escapeHtml(a.status || "-") + "</span></td>" +
          '<td class="muted-cell">' + escapeHtml(a.appliedDate || "-") + "</td>" +
          '<td class="muted-cell">' + escapeHtml(a.location || "-") + "</td>" +
        "</tr>"
      );
    }).join("");
  }

  function renderJobs() {
    autoArchiveApplications();
    renderJobsBreakdown();
    var filter = $("jobFilter") ? $("jobFilter").value : "All";
    var boardF = $("jobBoardFilter") ? $("jobBoardFilter").value : "active";
    var apps = sortedApps().filter(function (a) {
      if (filter !== "All" && a.status !== filter) return false;
      var arch = isArchivedApp(a);
      if (boardF === "active" && arch) return false;
      if (boardF === "archived" && !arch) return false;
      return true;
    });
    var list = $("jobList");
    if (!apps.length) {
      list.innerHTML = '<div class="empty">No applications match this filter.</div>';
      return;
    }
    list.innerHTML = apps.map(function (a) {
      var statusCls = "badge";
      var cd = countdownLabel(a);
      var cardCls = "job-card" + (isArchivedApp(a) ? " archived-card" : "");
      return (
        '<article class="' + cardCls + '" data-job-id="' + escapeAttr(a.id) + '">' +
          '<div class="job-card-top">' +
            "<div><h3>" + escapeHtml(a.company) + " - " + escapeHtml(a.role) + "</h3>" +
            '<div class="sub">' + escapeHtml(a.location || "-") +
            (a.appliedDate ? " - " + escapeHtml(a.appliedDate) : "") + "</div></div>" +
            '<span class="' + statusCls + '" data-status="' + escapeAttr(a.status) + '">' + escapeHtml(a.status) + "</span>" +
          "</div>" +
          '<div class="countdown-line' + (cd.cls ? " " + cd.cls : "") + '">' + escapeHtml(cd.text) +
            (isArchivedApp(a) ? " · off board" : " on board") + "</div>" +
          (a.pay ? '<div class="pay">' + escapeHtml(a.pay) + "</div>" : "") +
          (a.notes ? '<div class="notes">' + escapeHtml(a.notes) + "</div>" : "") +
          (a.url ? '<div class="sub" style="margin-top:8px;"><a href="' + escapeAttr(a.url) + '" target="_blank" rel="noopener" style="color:#86efac;">Open link</a></div>' : "") +
          '<div class="job-actions">' +
            '<button type="button" class="small" data-edit-job="' + escapeAttr(a.id) + '">Edit</button>' +
          "</div>" +
        "</article>"
      );
    }).join("");
  }

  function openJobModal(job, presetDate) {
    editingJobId = job ? job.id : null;
    $("jobModalTitle").textContent = job ? "Edit application" : "Add application";
    $("j-id").value = job ? job.id : "";
    $("j-company").value = job ? job.company : "";
    $("j-role").value = job ? job.role : "";
    $("j-location").value = job ? (job.location || "") : "";
    $("j-pay").value = job ? (job.pay || "") : "";
    $("j-status").value = job ? job.status : "Researching";
    $("j-date").value = job
      ? (job.appliedDate || "")
      : (presetDate || selectedCalDate || toLocalISODate());
    if ($("j-important")) $("j-important").checked = !!(job && job.important);
    if ($("j-keepOnBoard")) $("j-keepOnBoard").checked = !!(job && job.keepOnBoard);
    if ($("j-keepRow")) $("j-keepRow").hidden = !job;
    var hint = $("j-archivedHint");
    if (hint) {
      if (job && isArchivedApp(job)) {
        hint.hidden = false;
        hint.textContent = "Archived off the board (30-day timer). Check Keep on board to restore it.";
      } else if (job) {
        var cd = countdownLabel(job);
        hint.hidden = false;
        hint.textContent = "Board timer: " + cd.text + " (auto-archives 30 days after applied date).";
      } else {
        hint.hidden = true;
        hint.textContent = "";
      }
    }
    $("j-url").value = job ? (job.url || "") : "";
    $("j-notes").value = job ? (job.notes || "") : "";
    $("btnDeleteJob").hidden = !job;
    $("jobModal").hidden = false;
  }

  function closeJobModal() {
    $("jobModal").hidden = true;
    editingJobId = null;
  }

  function saveJobForm(e) {
    e.preventDefault();
    var id = $("j-id").value || uid("app");
    var app = {
      id: id,
      company: $("j-company").value.trim(),
      role: $("j-role").value.trim(),
      location: $("j-location").value.trim(),
      pay: $("j-pay").value.trim(),
      status: $("j-status").value,
      appliedDate: $("j-date").value,
      important: !!($("j-important") && $("j-important").checked),
      keepOnBoard: !!($("j-keepOnBoard") && $("j-keepOnBoard").checked),
      url: $("j-url").value.trim(),
      notes: $("j-notes").value.trim()
    };
    var idx = state.applications.findIndex(function (a) { return a.id === id; });
    if (idx >= 0) {
      app.archived = state.applications[idx].archived;
      app.archivedAt = state.applications[idx].archivedAt;
    }
    if (app.keepOnBoard) {
      app.archived = false;
      app.archivedAt = "";
    } else if (shouldAutoArchive(app)) {
      app.archived = true;
      app.archivedAt = app.archivedAt || toLocalISODate();
    } else {
      app.archived = false;
    }
    if (idx >= 0) state.applications[idx] = app;
    else state.applications.push(app);
    saveLocal();
    closeJobModal();
    renderJobs();
    renderCalendar();
    renderJobBoard();
    renderAllPapers();
    toast("Application saved");
  }

  function deleteJob() {
    if (!editingJobId) return;
    if (!confirm("Delete this application?")) return;
    state.applications = state.applications.filter(function (a) { return a.id !== editingJobId; });
    saveLocal();
    closeJobModal();
    renderJobs();
    renderCalendar();
    renderJobBoard();
    renderAllPapers();
    toast("Application deleted");
  }

  /* ---------- Import / Export / Reset ---------- */
  function exportJson() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "riley-job-hub-export.json";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast("Exported JSON");
  }

  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data || !data.profile || !data.resume || !data.applications) {
          throw new Error("Invalid file shape");
        }
        state = data;
        saveLocal();
        renderAll();
        toast("Imported JSON");
      } catch (err) {
        toast("Import failed");
      }
    };
    reader.readAsText(file);
  }

  function resetFromServer() {
    if (!confirm("Reset all local edits from server data/app-state.json?")) return;
    fetchServer().then(function (server) {
      state = deepClone(server);
      saveLocal();
      renderAll();
      toast("Reset from server");
    }).catch(function () {
      toast("Could not load server data");
    });
  }

  /* ---------- Helpers ---------- */
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function renderAll() {
    if (!isUnlocked()) {
      showPinLock();
      return;
    }
    var shell = $("appShell");
    if (shell) shell.hidden = false;
    var lock = $("pinLock");
    if (lock) lock.hidden = true;
    autoArchiveApplications();
    ensureAspirations();
    ensureLetter();
    renderProfile();
    renderResumeMeta();
    renderExperience();
    renderJobs();
    renderJobBoard();
    renderDiary();
    renderHome();
    renderJobSearch();
    renderAssistantInboxLists();
    renderAspirations();
    renderLetter();
    setProfileView(profileView);
    setResumeView(resumeView);
    setJobsView(jobsView);
    setCalendarView(calendarView);
    setDiaryView(diaryView);
    switchTab(activeTab || "home");
  }

  function printActivePaper() {
    setTimeout(function () { window.print(); }, 60);
  }

  function bindEvents() {
    document.querySelectorAll("[data-tab-btn]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        switchTab(btn.getAttribute("data-tab-btn"));
      });
    });
    if ($("pinPad")) {
      $("pinPad").addEventListener("click", function (e) {
        var key = e.target.closest("[data-pin]");
        if (!key) return;
        handlePinKey(key.getAttribute("data-pin"));
      });
    }
    if ($("btnLockApp")) $("btnLockApp").addEventListener("click", lockApp);

    function peekResume(insertable) {
      openResumeDrawer({ insertable: !!insertable || activeTab === "letter" });
    }
    if ($("btnResumePeek")) $("btnResumePeek").addEventListener("click", function () { peekResume(activeTab === "letter"); });
    if ($("btnBoardResumePeek")) $("btnBoardResumePeek").addEventListener("click", function () { peekResume(false); });
    if ($("btnLetterResumePeek")) $("btnLetterResumePeek").addEventListener("click", function () { peekResume(true); });
    if ($("btnAspirationsResumePeek")) $("btnAspirationsResumePeek").addEventListener("click", function () { peekResume(false); });
    if ($("btnJobResumePeek")) $("btnJobResumePeek").addEventListener("click", function () { peekResume(false); });

    /* Job Search */
    if ($("btnSearchResumePeek")) {
      $("btnSearchResumePeek").addEventListener("click", function () { peekResume(false); });
    }
    if ($("jobSearchInput")) {
      $("jobSearchInput").addEventListener("input", function () {
        renderLiveSearchLinks();
      });
      $("jobSearchInput").addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          renderLiveSearchLinks();
          if (getSearchQuery()) {
            rememberSearch(getSearchQuery(), getSearchLocation());
            renderRecentSearches();
          }
        }
      });
    }
    if ($("searchSuggestChips")) {
      $("searchSuggestChips").addEventListener("click", function (e) {
        var btn = e.target.closest("[data-search-chip]");
        if (!btn) return;
        applySearchChip(btn.getAttribute("data-search-chip"), btn.getAttribute("data-chip-value"));
      });
    }
    if ($("liveSearchLinks")) {
      $("liveSearchLinks").addEventListener("click", function (e) {
        var a = e.target.closest("[data-live-search]");
        if (!a) return;
        if (getSearchQuery()) {
          rememberSearch(getSearchQuery(), getSearchLocation());
          renderRecentSearches();
        }
      });
    }
    if ($("btnClearSearchQuery")) {
      $("btnClearSearchQuery").addEventListener("click", function () {
        if ($("jobSearchInput")) $("jobSearchInput").value = "";
        renderLiveSearchLinks();
      });
    }
    if ($("btnClearRecentSearches")) {
      $("btnClearRecentSearches").addEventListener("click", function () {
        ensureRecentSearches();
        state.recentSearches = [];
        saveLocal();
        renderRecentSearches();
        toast("Recent cleared");
      });
    }
    if ($("recentSearchesList")) {
      $("recentSearchesList").addEventListener("click", function (e) {
        var del = e.target.closest("[data-del-recent]");
        if (del) {
          var di = Number(del.getAttribute("data-del-recent"));
          ensureRecentSearches();
          if (!isNaN(di)) state.recentSearches.splice(di, 1);
          saveLocal();
          renderRecentSearches();
          return;
        }
        var rec = e.target.closest("[data-recent-idx]");
        if (!rec) return;
        var ri = Number(rec.getAttribute("data-recent-idx"));
        ensureRecentSearches();
        var item = state.recentSearches[ri];
        if (!item) return;
        if ($("jobSearchInput")) $("jobSearchInput").value = item.query || "";
        renderLiveSearchLinks();
      });
    }
    if ($("btnAskJobSearch")) $("btnAskJobSearch").addEventListener("click", showAskPacket);
    if ($("btnCopyAskPacket")) $("btnCopyAskPacket").addEventListener("click", copyAskPacket);
    if ($("btnShareAskPacket")) $("btnShareAskPacket").addEventListener("click", shareAskPacket);
    if ($("btnEmailAskPacket")) $("btnEmailAskPacket").addEventListener("click", emailAskPacket);
    if ($("btnEmailJobSearch")) $("btnEmailJobSearch").addEventListener("click", emailAskPacket);
    if ($("btnHomeEmailJobSearch")) $("btnHomeEmailJobSearch").addEventListener("click", function () {
      switchTab("search");
      emailAskPacket();
    });
    if ($("btnSearchResumePeek2")) $("btnSearchResumePeek2").addEventListener("click", function () { peekResume(false); });

    function bindInboxList(el) {
      if (!el) return;
      el.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-inbox-id]");
        if (!btn) return;
        openInboxMessage(btn.getAttribute("data-inbox-id"));
      });
    }
    bindInboxList($("assistantInboxList"));
    bindInboxList($("assistantInboxListMore"));
    if ($("btnRefreshInbox")) $("btnRefreshInbox").addEventListener("click", function () { fetchAssistantInbox(); });
    if ($("btnRefreshInboxMore")) $("btnRefreshInboxMore").addEventListener("click", function () { fetchAssistantInbox(); });
    if ($("btnPasteInboxReply")) $("btnPasteInboxReply").addEventListener("click", openPasteInboxModal);
    if ($("btnPasteInboxReplyMore")) $("btnPasteInboxReplyMore").addEventListener("click", openPasteInboxModal);
    if ($("btnCloseInboxModal")) $("btnCloseInboxModal").addEventListener("click", closeInboxModal);
    if ($("inboxModal")) {
      $("inboxModal").addEventListener("click", function (e) {
        if (e.target === $("inboxModal")) closeInboxModal();
      });
    }
    if ($("btnClosePasteInbox")) $("btnClosePasteInbox").addEventListener("click", closePasteInboxModal);
    if ($("pasteInboxModal")) {
      $("pasteInboxModal").addEventListener("click", function (e) {
        if (e.target === $("pasteInboxModal")) closePasteInboxModal();
      });
    }
    if ($("btnPasteInboxApply")) $("btnPasteInboxApply").addEventListener("click", handlePasteInbox);
    if ($("btnApplyInboxMsg")) {
      $("btnApplyInboxMsg").addEventListener("click", function () {
        if (viewingInboxMsgId) applyInboxMessage(viewingInboxMsgId, false);
      });
    }
    if ($("btnApplyInboxMsgRead")) {
      $("btnApplyInboxMsgRead").addEventListener("click", function () {
        if (viewingInboxMsgId) {
          applyInboxMessage(viewingInboxMsgId, true);
          closeInboxModal();
        }
      });
    }
    if ($("btnMarkInboxRead")) {
      $("btnMarkInboxRead").addEventListener("click", function () {
        if (!viewingInboxMsgId) return;
        markInboxRead(viewingInboxMsgId);
        renderAssistantInboxLists();
        openInboxMessage(viewingInboxMsgId);
        toast("Marked read");
      });
    }

    if ($("btnCloseResumeDrawer")) $("btnCloseResumeDrawer").addEventListener("click", closeResumeDrawer);
    if ($("btnDrawerOpenResume")) {
      $("btnDrawerOpenResume").addEventListener("click", function () {
        closeResumeDrawer();
        switchTab("resume");
      });
    }
    if ($("resumeDrawer")) {
      $("resumeDrawer").addEventListener("click", function (e) {
        if (e.target === $("resumeDrawer")) closeResumeDrawer();
        var ins = e.target.closest("[data-insert-text]");
        if (ins) {
          insertIntoLetter(ins.getAttribute("data-insert-text"));
          if (activeTab !== "letter") switchTab("letter");
        }
      });
    }

    if ($("btnSaveAspiration")) $("btnSaveAspiration").addEventListener("click", saveAspiration);
    if ($("aspirationsList")) {
      $("aspirationsList").addEventListener("click", function (e) {
        var del = e.target.closest("[data-del-asp]");
        if (!del) return;
        var id = del.getAttribute("data-del-asp");
        if (!confirm("Delete this aspiration?")) return;
        ensureAspirations();
        state.aspirations.entries = state.aspirations.entries.filter(function (x) { return x.id !== id; });
        saveLocal();
        renderAspirations();
        toast("Deleted");
      });
    }

    document.querySelectorAll("[data-letter-tpl]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        applyLetterTemplate(btn.getAttribute("data-letter-tpl"));
      });
    });
    if ($("btnOpenGmail")) $("btnOpenGmail").addEventListener("click", openGmail);
    if ($("btnMailto")) $("btnMailto").addEventListener("click", openMailto);
    if ($("btnCopyLetter")) $("btnCopyLetter").addEventListener("click", copyLetter);
    if ($("btnDownloadLetter")) $("btnDownloadLetter").addEventListener("click", downloadLetter);
    if ($("btnSaveLetterDraft")) $("btnSaveLetterDraft").addEventListener("click", saveLetterDraft);
    ["l-to", "l-subject", "l-body"].forEach(function (id) {
      if ($(id)) $(id).addEventListener("change", persistCurrentLetter);
      if ($(id)) $(id).addEventListener("blur", persistCurrentLetter);
    });
    if ($("letterInsertChips")) {
      $("letterInsertChips").addEventListener("click", function (e) {
        var chip = e.target.closest("[data-insert-text]");
        if (!chip) return;
        insertIntoLetter(chip.getAttribute("data-insert-text"));
      });
    }
    if ($("letterDraftsList")) {
      $("letterDraftsList").addEventListener("click", function (e) {
        var btn = e.target.closest("[data-load-draft]");
        if (!btn) return;
        loadLetterDraft(btn.getAttribute("data-load-draft"));
      });
    }

    if ($("jobBoard")) {
      $("jobBoard").addEventListener("click", function (e) {
        if (e.target.closest("#emptyBoardAdd")) {
          openJobModal(null);
          return;
        }
        var edit = e.target.closest("[data-edit-job]");
        if (!edit) return;
        var id = edit.getAttribute("data-edit-job");
        var job = state.applications.find(function (a) { return a.id === id; });
        if (job) openJobModal(job);
      });
    }
    if ($("btnAddFromBoard")) {
      $("btnAddFromBoard").addEventListener("click", function () { openJobModal(null); });
    }
    document.querySelectorAll("[data-diary-view]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setDiaryView(btn.getAttribute("data-diary-view"));
      });
    });
    if ($("btnSaveDiaryMeta")) $("btnSaveDiaryMeta").addEventListener("click", saveDiaryMeta);
    if ($("btnSaveFreewrite")) $("btnSaveFreewrite").addEventListener("click", saveFreewrite);
    if ($("diaryPrev")) $("diaryPrev").addEventListener("click", function () { shiftDiaryDay(-1); });
    if ($("diaryNext")) $("diaryNext").addEventListener("click", function () { shiftDiaryDay(1); });
    if ($("diaryToday")) {
      $("diaryToday").addEventListener("click", function () {
        selectedCalDate = toLocalISODate();
        var n = new Date();
        calCursor = { y: n.getFullYear(), m: n.getMonth() };
        renderDiary();
      });
    }
    if ($("btnDiaryOpenCal")) {
      $("btnDiaryOpenCal").addEventListener("click", function () {
        switchTab("calendar");
      });
    }
    if ($("btnPrintDiary")) {
      $("btnPrintDiary").addEventListener("click", function () {
        setDiaryView("paper");
        printActivePaper();
      });
    }
    if ($("diaryDayApps")) {
      $("diaryDayApps").addEventListener("click", function (e) {
        var edit = e.target.closest("[data-edit-job]");
        if (!edit) return;
        var id = edit.getAttribute("data-edit-job");
        var job = state.applications.find(function (a) { return a.id === id; });
        if (job) openJobModal(job);
      });
    }
    if ($("diaryList")) {
      $("diaryList").addEventListener("click", function (e) {
        var tog = e.target.closest("[data-toggle-diary-important]");
        if (tog) {
          var tid = tog.getAttribute("data-toggle-diary-important");
          var entry = (state.diary.entries || []).find(function (x) { return x.id === tid; });
          if (entry) {
            entry.important = !entry.important;
            saveLocal();
            renderDiaryDayEntries();
            toast(entry.important ? "Flagged important" : "Unflagged");
          }
          return;
        }
        var del = e.target.closest("[data-del-diary]");
        if (del) {
          var did = del.getAttribute("data-del-diary");
          if (!confirm("Delete this note?")) return;
          state.diary.entries = (state.diary.entries || []).filter(function (x) { return x.id !== did; });
          saveLocal();
          renderDiaryDayEntries();
          toast("Deleted");
        }
      });
    }

    $("profileForm").addEventListener("submit", saveProfileFromForm);
    $("btnResetServer").addEventListener("click", resetFromServer);
    $("btnExport").addEventListener("click", exportJson);
    $("btnImport").addEventListener("click", function () { $("importFile").click(); });
    $("importFile").addEventListener("change", function () {
      if (this.files && this.files[0]) importJson(this.files[0]);
      this.value = "";
    });

    document.querySelectorAll("[data-profile-view]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setProfileView(btn.getAttribute("data-profile-view"));
      });
    });
    document.querySelectorAll("[data-resume-view]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setResumeView(btn.getAttribute("data-resume-view"));
      });
    });
    document.querySelectorAll("[data-jobs-view]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setJobsView(btn.getAttribute("data-jobs-view"));
      });
    });
    document.querySelectorAll("[data-cal-view]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setCalendarView(btn.getAttribute("data-cal-view"));
      });
    });
    $("calPrev").addEventListener("click", function () {
      ensureCalCursor();
      calCursor.m -= 1;
      if (calCursor.m < 0) { calCursor.m = 11; calCursor.y -= 1; }
      renderCalendar();
    });
    $("calNext").addEventListener("click", function () {
      ensureCalCursor();
      calCursor.m += 1;
      if (calCursor.m > 11) { calCursor.m = 0; calCursor.y += 1; }
      renderCalendar();
    });
    $("calToday").addEventListener("click", function () {
      var n = new Date();
      calCursor = { y: n.getFullYear(), m: n.getMonth() };
      selectedCalDate = toLocalISODate();
      renderCalendar();
    });
    $("calGrid").addEventListener("click", function (e) {
      var cell = e.target.closest("[data-cal-iso]");
      if (!cell) return;
      selectedCalDate = cell.getAttribute("data-cal-iso");
      renderCalendar();
    });
    $("btnAddJobFromCal").addEventListener("click", function () {
      openJobModal(null, selectedCalDate || toLocalISODate());
    });
    $("btnPrintCalendar").addEventListener("click", function () {
      setCalendarView("paper");
      printActivePaper();
    });
    document.querySelectorAll("[data-jump]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var t = btn.getAttribute("data-jump");
        if (t === "calendar") {
          var n = new Date();
          calCursor = { y: n.getFullYear(), m: n.getMonth() };
          selectedCalDate = toLocalISODate();
          switchTab("calendar");
          renderCalendar();
        } else {
          switchTab(t);
        }
      });
    });
    document.querySelectorAll("#orgPath [data-path]").forEach(function (s) {
      s.addEventListener("click", function () {
        switchTab(s.getAttribute("data-path"));
      });
    });
    $("agendaList").addEventListener("click", function (e) {
      var edit = e.target.closest("[data-edit-job]");
      if (!edit) return;
      var id = edit.getAttribute("data-edit-job");
      var job = state.applications.find(function (a) { return a.id === id; });
      if (job) openJobModal(job);
    });

    $("btnPrintProfile").addEventListener("click", function () {
      setProfileView("paper");
      printActivePaper();
    });
    $("btnPrintResume").addEventListener("click", function () {
      setResumeView("paper");
      printActivePaper();
    });
    $("btnPrintJobs").addEventListener("click", function () {
      setJobsView("paper");
      printActivePaper();
    });

    $("btnSaveResumeMeta").addEventListener("click", saveResumeMeta);
    if ($("btnAddExp")) {
      $("btnAddExp").addEventListener("click", function () {
        var job = {
          id: uid("exp"),
          employer: "",
          title: "New role",
          roleType: "Other",
          startMonth: "01",
          startYear: String(new Date().getFullYear()),
          endMonth: "",
          endYear: "",
          current: true,
          bullets: [""]
        };
        state.resume.jobs = state.resume.jobs || [];
        state.resume.jobs.unshift(job);
        openExpId = job.id;
        saveLocal();
        renderExperience();
        toast("Role added");
      });
    }
    function readAvatarFile(file) {
      if (!file) return;
      if (file.size > 2.5 * 1024 * 1024) {
        toast("Photo too large (max ~2.5MB)");
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        state.profile.avatarDataUrl = String(reader.result || "");
        saveLocal();
        renderAvatar();
        toast("Photo saved");
      };
      reader.readAsDataURL(file);
    }
    if ($("btnAvatarPick")) {
      $("btnAvatarPick").addEventListener("click", function () { $("avatarFile").click(); });
    }
    if ($("btnAvatar")) {
      $("btnAvatar").addEventListener("click", function () { $("avatarFile").click(); });
    }
    if ($("btnAvatarClear")) {
      $("btnAvatarClear").addEventListener("click", function () {
        state.profile.avatarDataUrl = "";
        saveLocal();
        renderAvatar();
        toast("Photo removed");
      });
    }
    if ($("avatarFile")) {
      $("avatarFile").addEventListener("change", function () {
        if (this.files && this.files[0]) readAvatarFile(this.files[0]);
        this.value = "";
      });
    }
    $("strengthChips").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-strength]");
      if (!btn) return;
      var s = btn.getAttribute("data-strength");
      var list = state.resume.strengths || [];
      var i = list.indexOf(s);
      if (i >= 0) list.splice(i, 1);
      else list.push(s);
      state.resume.strengths = list;
      saveLocal();
      renderStrengths();
      renderAllPapers();
    });

    $("experienceList").addEventListener("click", function (e) {
      var moveBtn = e.target.closest("[data-exp-move]");
      if (moveBtn) {
        var mid = moveBtn.getAttribute("data-exp-move");
        var dir = Number(moveBtn.getAttribute("data-move-exp"));
        var arr = state.resume.jobs || [];
        var ix = arr.findIndex(function (j) { return j.id === mid; });
        var nix = ix + dir;
        if (ix < 0 || nix < 0 || nix >= arr.length) return;
        var tmp = arr[ix];
        arr[ix] = arr[nix];
        arr[nix] = tmp;
        saveLocal();
        renderExperience();
        renderAllPapers();
        return;
      }
      var toggle = e.target.closest("[data-acc-toggle]");
      if (toggle) {
        var id = toggle.getAttribute("data-acc-toggle");
        openExpId = openExpId === id ? null : id;
        renderExperience();
        return;
      }
      var item = e.target.closest(".acc-item");
      if (!item) return;
      if (e.target.closest("[data-add-bullet]")) {
        var draft = getExpFromEditor(item);
        draft.bullets.push("");
        var ix = state.resume.jobs.findIndex(function (j) { return j.id === draft.id; });
        if (ix >= 0) state.resume.jobs[ix] = draft;
        openExpId = draft.id;
        renderExperience();
        return;
      }
      var rem = e.target.closest("[data-remove-bullet]");
      if (rem) {
        var draft2 = getExpFromEditor(item);
        draft2.bullets.splice(Number(rem.getAttribute("data-remove-bullet")), 1);
        var ix2 = state.resume.jobs.findIndex(function (j) { return j.id === draft2.id; });
        if (ix2 >= 0) state.resume.jobs[ix2] = draft2;
        openExpId = draft2.id;
        renderExperience();
        return;
      }
      if (e.target.closest("[data-save-exp]")) {
        saveExperience(item);
      }
    });

    $("experienceList").addEventListener("change", function (e) {
      if (!e.target.classList.contains("exp-current")) return;
      var item = e.target.closest(".acc-item");
      if (!item) return;
      var disabled = e.target.checked;
      item.querySelector(".exp-em").disabled = disabled;
      item.querySelector(".exp-ey").disabled = disabled;
    });

    $("jobFilter").addEventListener("change", renderJobs);
    if ($("jobBoardFilter")) $("jobBoardFilter").addEventListener("change", renderJobs);
    $("btnAddJob").addEventListener("click", function () { openJobModal(null); });
    $("jobList").addEventListener("click", function (e) {
      var edit = e.target.closest("[data-edit-job]");
      if (!edit) return;
      var id = edit.getAttribute("data-edit-job");
      var job = state.applications.find(function (a) { return a.id === id; });
      if (job) openJobModal(job);
    });
    $("glanceBody").addEventListener("click", function (e) {
      var row = e.target.closest("[data-glance-id]");
      if (!row) return;
      var id = row.getAttribute("data-glance-id");
      var job = state.applications.find(function (a) { return a.id === id; });
      if (job) openJobModal(job);
    });
    $("glanceBody").addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var row = e.target.closest("[data-glance-id]");
      if (!row) return;
      e.preventDefault();
      var id = row.getAttribute("data-glance-id");
      var job = state.applications.find(function (a) { return a.id === id; });
      if (job) openJobModal(job);
    });
    $("statusChips").addEventListener("click", function (e) {
      var chip = e.target.closest(".status-chip[data-status]");
      if (!chip) return;
      $("jobFilter").value = chip.getAttribute("data-status");
      renderJobs();
    });
    $("jobForm").addEventListener("submit", saveJobForm);
    $("btnCancelJob").addEventListener("click", closeJobModal);
    $("btnDeleteJob").addEventListener("click", deleteJob);
    $("jobModal").addEventListener("click", function (e) {
      if (e.target === $("jobModal")) closeJobModal();
    });

    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        refreshActivePaper();
      }, 180);
    });
  }

  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("sw.js").then(function () {
      console.log("SW registered");
    }).catch(function (err) {
      console.warn("SW register failed", err);
    });
  }

  function init() {
    setupTip();
    bindEvents();
    registerSW();
    if (!isUnlocked()) showPinLock();
    var local = loadLocal();
    fetchServer().then(function (server) {
      state = mergeState(server, local);
      if (!local) saveLocal();
      if (isUnlocked()) renderAll();
      fetchAssistantInbox({ silent: true }).catch(function () {});
    }).catch(function () {
      if (local) {
        state = local;
        if (isUnlocked()) {
          renderAll();
          toast("Offline: using saved data");
        }
      } else if (isUnlocked()) {
        toast("Could not load app data");
      }
      fetchAssistantInbox({ silent: true }).catch(function () {});
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
