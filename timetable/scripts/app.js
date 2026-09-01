(() => {
  const STORAGE_KEY = 'st-timetable-courses';
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  // Period 0x0=8:00 .. 0x9=17:00, 0xa=18:00 .. 0xf=23:00
  const periodToTime = (hex) => {
    const n = parseInt(hex, 16);
    const hour = 8 + n;
    return `${hour}:00–${hour}:50`;
  };
  const periodLabel = (code) => {
    const day = parseInt(code[0]) - 1;
    const pHex = code[1];
    return `${DAYS[day]} ${periodToTime(pHex)}`;
  };

  let courses = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  let editingId = null;

  const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(courses));

  // Color palette for courses
  const PALETTE = [
    { bg: '#dbeafe', border: '#2563eb' },
    { bg: '#dcfce7', border: '#16a34a' },
    { bg: '#fce7f3', border: '#db2777' },
    { bg: '#e0e7ff', border: '#4f46e5' },
    { bg: '#ffedd5', border: '#ea580c' },
    { bg: '#f3e8ff', border: '#9333ea' },
    { bg: '#ccfbf1', border: '#0d9488' },
    { bg: '#fee2e2', border: '#dc2626' },
    { bg: '#e0f2fe', border: '#0284c7' },
    { bg: '#fdf4ff', border: '#a21caf' },
  ];
  function courseColor(c) {
    const idx = courses.indexOf(c);
    return PALETTE[idx % PALETTE.length];
  }

  // DOM refs
  const timelineBody = document.getElementById('timeline-body');
  const timelineGutter = document.getElementById('timeline-gutter');
  const courseList = document.getElementById('course-list');
  const detailsModal = document.getElementById('details-modal');
  const formModal = document.getElementById('form-modal');

  // --- Size slider ---
  const SIZE_STORAGE_KEY = 'st-timetable-size';
  const SIZE_VALUES = [30, 60, 120]; // px per hour
  const sizeSlider = document.getElementById('size-slider');
  sizeSlider.value = localStorage.getItem(SIZE_STORAGE_KEY) ?? '1';
  sizeSlider.addEventListener('input', () => {
    localStorage.setItem(SIZE_STORAGE_KEY, sizeSlider.value);
    render();
  });
  function pxPerHour() { return SIZE_VALUES[parseInt(sizeSlider.value)]; }

  // --- Meal times (in fractional hours from midnight) ---
  const MEALS = [
    { label: 'Breakfast', startH: 7.5, endH: 9 },
    { label: 'Lunch', startH: 11.5, endH: 13 + 40/60 },
    { label: 'Dinner', startH: 17.5, endH: 18 + 50/60 },
  ];
  const MEAL_STORAGE_KEY = 'st-timetable-meals';
  const chkMeals = document.getElementById('chk-meals');
  chkMeals.checked = localStorage.getItem(MEAL_STORAGE_KEY) === '1';
  chkMeals.addEventListener('change', () => {
    localStorage.setItem(MEAL_STORAGE_KEY, chkMeals.checked ? '1' : '0');
    render();
  });

  // --- Rendering ---
  function getTimeRange() {
    let minH = 8, maxH = 18; // default 8:00-18:00
    for (const c of courses) {
      for (const p of c.periods) {
        const h = 8 + parseInt(p[1], 16);
        if (h < minH) minH = h;
        if (h + 1 > maxH) maxH = h + 1;
      }
    }
    if (chkMeals.checked) {
      for (const m of MEALS) {
        if (m.startH < minH) minH = Math.floor(m.startH);
        if (m.endH > maxH) maxH = Math.ceil(m.endH);
      }
    }
    return { minH, maxH };
  }

  function renderTable() {
    const scale = pxPerHour();
    const { minH, maxH } = getTimeRange();
    const totalPx = (maxH - minH) * scale;

    // Set height
    timelineBody.style.height = `${totalPx}px`;

    // Gutter hour labels + day hour lines
    timelineGutter.innerHTML = '';
    document.querySelectorAll('.timeline-day').forEach(col => {
      // Clear old content
      col.innerHTML = '';
    });

    for (let h = minH; h <= maxH; h++) {
      const y = (h - minH) * scale;
      // Gutter label
      const label = document.createElement('div');
      label.className = 'hour-label';
      label.style.top = `${y}px`;
      label.textContent = `${h}:00`;
      timelineGutter.appendChild(label);

      // Hour lines on each day column
      if (h < maxH) {
        document.querySelectorAll('.timeline-day').forEach(col => {
          const line = document.createElement('div');
          line.className = 'hour-line';
          line.style.top = `${y}px`;
          col.appendChild(line);
        });
      }
    }

    // Meal blocks
    if (chkMeals.checked) {
      for (const meal of MEALS) {
        const y = (meal.startH - minH) * scale;
        const h = (meal.endH - meal.startH) * scale;
        document.querySelectorAll('.timeline-day').forEach(col => {
          const div = document.createElement('div');
          div.className = 'meal-block';
          div.style.top = `${y}px`;
          div.style.height = `${h}px`;
          div.textContent = meal.label;
          col.appendChild(div);
        });
      }
    }

    // Course blocks — merge consecutive periods per course per day, then split width on overlaps
    // 1. Build merged spans: { course, day, startPeriod, endPeriod }
    const spans = [];
    for (const c of courses) {
      // Group periods by day
      const byDay = {};
      for (const p of c.periods) {
        const day = parseInt(p[0]);
        const pN = parseInt(p[1], 16);
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push(pN);
      }
      for (const [day, periods] of Object.entries(byDay)) {
        periods.sort((a, b) => a - b);
        let start = periods[0], end = periods[0];
        for (let i = 1; i < periods.length; i++) {
          if (periods[i] === end + 1) {
            end = periods[i];
          } else {
            spans.push({ course: c, day: parseInt(day), start, end });
            start = end = periods[i];
          }
        }
        spans.push({ course: c, day: parseInt(day), start, end });
      }
    }

    // 2. For each span, find overlapping spans on same day to split width
    // Two spans overlap if their time ranges intersect
    const overlaps = (a, b) => a.day === b.day && a.start <= b.end && b.start <= a.end;

    // Group overlapping spans into clusters per day
    const placed = new Set();
    for (const span of spans) {
      if (placed.has(span)) continue;
      // Find all spans overlapping with this cluster
      const cluster = [span];
      placed.add(span);
      let changed = true;
      while (changed) {
        changed = false;
        for (const other of spans) {
          if (placed.has(other)) continue;
          if (cluster.some(s => overlaps(s, other))) {
            cluster.push(other);
            placed.add(other);
            changed = true;
          }
        }
      }
      const count = cluster.length;
      cluster.forEach((s, i) => {
        const startH = 8 + s.start;
        const durationH = (s.end - s.start) + 50 / 60; // spans + last period's 50min
        const y = (startH - minH) * scale;
        const h = durationH * scale;
        const col = document.querySelector(`.timeline-day[data-day="${s.day}"]`);
        if (!col) return;

        const color = courseColor(s.course);
        const div = document.createElement('div');
        div.className = 'course-block';
        div.style.top = `${y}px`;
        div.style.height = `${h}px`;
        div.style.left = `calc(2px + ${(i / count)} * (100% - 4px))`;
        div.style.width = `calc(${(1 / count)} * (100% - 4px))`;
        div.style.right = 'auto';
        div.style.background = color.bg;
        div.style.borderLeftColor = color.border;
        div.innerHTML = `<div class="cb-name">${esc(s.course.name)}</div>${s.course.location ? `<div class="cb-loc">${esc(s.course.location)}</div>` : ''}`;
        div.addEventListener('click', () => showDetails(s.course.id, s));
        col.appendChild(div);
      });
    }
  }

  function renderList() {
    courseList.innerHTML = '';
    for (const c of courses) {
      const color = courseColor(c);
      const li = document.createElement('li');
      li.style.borderLeft = `4px solid ${color.border}`;
      li.style.background = color.bg;
      li.innerHTML = `<div><div class="course-info">${esc(c.name)}</div><div class="course-sub">${esc(c.location)} · ${esc(c.professor)}</div></div>`;
      li.addEventListener('click', () => showDetails(c.id));
      courseList.appendChild(li);
    }
    if (!courses.length) {
      courseList.innerHTML = '<li style="color:#999;cursor:default">No courses added yet.</li>';
    }
  }

  function render() { renderTable(); renderList(); }

  // --- Details modal ---
  function showDetails(id, span) {
    const c = courses.find(x => x.id === id);
    if (!c) return;
    document.getElementById('details-name').textContent = c.name;
    document.getElementById('details-location').textContent = c.location || '—';
    document.getElementById('details-professor').textContent = c.professor || '—';
    document.getElementById('details-email').textContent = c.email || '—';

    if (span) {
      const dayName = DAYS[span.day - 1];
      const startHour = 8 + span.start;
      const endHour = 8 + span.end;
      const timeStr = `${dayName} ${startHour}:00–${endHour}:50`;
      const periodStr = span.start === span.end
        ? `period ${span.start.toString(16)}`
        : `periods ${span.start.toString(16)}–${span.end.toString(16)}`;
      document.getElementById('details-periods').textContent = `${timeStr} (${periodStr})`;
    } else {
      document.getElementById('details-periods').textContent = c.periods.map(periodLabel).join(', ') || '—';
    }
    detailsModal.classList.add('open');

    document.getElementById('details-edit').onclick = () => {
      detailsModal.classList.remove('open');
      openForm(c);
    };
    document.getElementById('details-delete').onclick = () => {
      if (confirm(`Delete "${c.name}"?`)) {
        courses = courses.filter(x => x.id !== id);
        save(); render();
        detailsModal.classList.remove('open');
      }
    };
    document.getElementById('details-close').onclick = () => detailsModal.classList.remove('open');
  }

  // --- Form modal ---
  function openForm(course) {
    editingId = course ? course.id : null;
    document.getElementById('form-title').textContent = course ? 'Edit Course' : 'Add Course';
    document.getElementById('f-name').value = course ? course.name : '';
    document.getElementById('f-location').value = course ? course.location : '';
    document.getElementById('f-professor').value = course ? course.professor : '';
    document.getElementById('f-email').value = course ? course.email : '';
    document.getElementById('f-periods').value = course ? course.periods.join(',') : '';
    formModal.classList.add('open');
  }

  function parsePeriods(raw) {
    return raw.split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(s => {
      if (s.length !== 2) return false;
      const d = parseInt(s[0]);
      const p = parseInt(s[1], 16);
      return d >= 1 && d <= 5 && !isNaN(p) && p >= 0 && p <= 15;
    });
  }

  document.getElementById('course-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('f-name').value.trim();
    const location = document.getElementById('f-location').value.trim();
    const professor = document.getElementById('f-professor').value.trim();
    const email = document.getElementById('f-email').value.trim();
    const periods = parsePeriods(document.getElementById('f-periods').value);

    if (!name || !periods.length) {
      alert('Name and at least one valid period are required.');
      return;
    }

    if (editingId) {
      const c = courses.find(x => x.id === editingId);
      if (c) { Object.assign(c, { name, location, professor, email, periods }); }
    } else {
      courses.push({ id: crypto.randomUUID(), name, location, professor, email, periods });
    }
    save(); render();
    formModal.classList.remove('open');
    editingId = null;
  });

  document.getElementById('form-cancel').addEventListener('click', () => {
    formModal.classList.remove('open');
    editingId = null;
  });

  // --- Tabs ---
  document.querySelectorAll('.tabs-controls .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelector(`.tab-content[data-tab="${tab.dataset.tab}"]`).classList.add('active');
    });
  });

  // --- Add button ---
  document.getElementById('btn-add').addEventListener('click', () => openForm(null));

  // --- Share ---
  const shareModal = document.getElementById('share-modal');
  const importModal = document.getElementById('import-modal');

  document.getElementById('btn-share').addEventListener('click', () => {
    if (!courses.length) { alert('No courses to share.'); return; }
    const stripped = courses.map(({ name, location, professor, email, periods }) =>
      ({ name, location, professor, email, periods }));
    const payload = btoa(JSON.stringify(stripped));
    const url = `${window.location.origin}${window.location.pathname}?courses=${encodeURIComponent(payload)}`;
    document.getElementById('share-link').value = url;
    shareModal.classList.add('open');
  });

  document.getElementById('share-copy').addEventListener('click', () => {
    const input = document.getElementById('share-link');
    navigator.clipboard.writeText(input.value).then(() => {
      document.getElementById('share-copy').textContent = 'Copied!';
      setTimeout(() => { document.getElementById('share-copy').textContent = 'Copy'; }, 1500);
    });
  });
  document.getElementById('share-close').addEventListener('click', () => shareModal.classList.remove('open'));

  // --- Import from URL ---
  function checkImport() {
    const params = new URLSearchParams(window.location.search);
    const b64 = params.get('courses');
    if (!b64) return;
    try {
      const imported = JSON.parse(atob(b64));
      if (!Array.isArray(imported) || !imported.length) return;
      // Validate structure
      for (const c of imported) {
        if (!c.name || !Array.isArray(c.periods)) return;
      }
      // Show preview
      const preview = document.getElementById('import-preview');
      preview.innerHTML = '';
      for (const c of imported) {
        const li = document.createElement('li');
        li.textContent = `${c.name} (${c.periods.length} period${c.periods.length !== 1 ? 's' : ''})`;
        preview.appendChild(li);
      }
      importModal.classList.add('open');

      document.getElementById('import-add').onclick = () => {
        for (const c of imported) {
          courses.push({ ...c, id: crypto.randomUUID() });
        }
        save(); render();
        importModal.classList.remove('open');
        clearUrlParam();
      };
      document.getElementById('import-replace').onclick = () => {
        courses = imported.map(c => ({ ...c, id: crypto.randomUUID() }));
        save(); render();
        importModal.classList.remove('open');
        clearUrlParam();
      };
      document.getElementById('import-cancel').onclick = () => {
        importModal.classList.remove('open');
        clearUrlParam();
      };
    } catch { /* invalid payload, ignore */ }
  }

  function clearUrlParam() {
    const url = new URL(window.location);
    url.searchParams.delete('courses');
    history.replaceState(null, '', url);
  }

  // --- Close modals on overlay click ---
  [detailsModal, formModal, shareModal, importModal].forEach(m => {
    m.addEventListener('click', (e) => {
      if (e.target === m) { m.classList.remove('open'); editingId = null; }
    });
  });

  // --- Utility ---
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // --- Download as PNG ---
  document.getElementById('btn-download').addEventListener('click', () => {
    const target = document.querySelector('.timeline-wrapper');
    html2canvas(target, { backgroundColor: '#ffffff' }).then(canvas => {
      const a = document.createElement('a');
      a.download = 'timetable.png';
      a.href = canvas.toDataURL('image/png');
      a.click();
    });
  });

  render();
  checkImport();
})();
