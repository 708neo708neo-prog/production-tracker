// ===================================================
// 生産反数管理アプリ v1.5 - Firebase版
// ===================================================

'use strict';

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

// ---- アプリ状態 ----
const App = {
  user:         null,
  year:         new Date().getFullYear(),
  month:        new Date().getMonth() + 1,
  monthData:    [],
  summary:      null,
  selectedDate: null,
  miniChart:    null,
  mainChart:    null,
};

let db, auth;

// ---- 初期化 ----
window.addEventListener('DOMContentLoaded', () => {
  if (!window.CONFIG || !CONFIG.firebase || CONFIG.firebase.apiKey === 'YOUR_API_KEY') {
    showAuthError('config.js のFirebase設定が未完了です。SETUP.md を参照してください。');
    return;
  }

  try {
    firebase.initializeApp(CONFIG.firebase);
    auth = firebase.auth();
    db   = firebase.firestore();
  } catch (e) {
    showAuthError('Firebase初期化エラー: ' + e.message);
    return;
  }

  // 認証状態監視
  auth.onAuthStateChanged((user) => {
    if (user) {
      App.user = { email: user.email, name: user.displayName || user.email };
      showScreen('screen-home');
      loadMonthData();
    } else {
      showScreen('screen-auth');
    }
  });

  bindEvents();
});

// ---- イベント ----
function bindEvents() {
  // 認証
  document.getElementById('btn-google-signin').addEventListener('click', signInWithGoogle);

  // ホーム
  document.getElementById('btn-help').addEventListener('click', () =>
    document.getElementById('help-modal').classList.remove('hidden'));
  document.getElementById('btn-close-help').addEventListener('click', () =>
    document.getElementById('help-modal').classList.add('hidden'));
  document.getElementById('help-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('help-modal'))
      document.getElementById('help-modal').classList.add('hidden');
  });
  document.getElementById('btn-signout').addEventListener('click', signOutUser);
  document.getElementById('btn-prev-month').addEventListener('click', () => changeMonth(-1));
  document.getElementById('btn-next-month').addEventListener('click', () => changeMonth(+1));
  document.getElementById('btn-today-input').addEventListener('click', () =>
    openInputScreen(formatISO(new Date())));
  document.getElementById('btn-view-graph').addEventListener('click', openGraphScreen);
  document.getElementById('btn-view-weekly').addEventListener('click', openWeeklyScreen);

  // 週次集計画面
  document.getElementById('btn-back-from-weekly').addEventListener('click', () =>
    showScreen('screen-home'));
  document.getElementById('btn-weekly-prev-month').addEventListener('click', () => {
    changeMonth(-1); renderWeeklyTable();
  });
  document.getElementById('btn-weekly-next-month').addEventListener('click', () => {
    changeMonth(+1); renderWeeklyTable();
  });

  // 入力画面
  document.getElementById('btn-back-from-input').addEventListener('click', () => {
    showScreen('screen-home');
    loadMonthData();
  });
  document.getElementById('btn-prev-day').addEventListener('click', () => changeDay(-1));
  document.getElementById('btn-next-day').addEventListener('click', () => changeDay(+1));
  document.getElementById('date-picker-input').addEventListener('change', (e) => {
    if (e.target.value) setSelectedDate(e.target.value);
  });
  document.getElementById('input-seisan').addEventListener('input', updatePctDisplay);
  document.getElementById('input-bc').addEventListener('input', updatePctDisplay);
  document.getElementById('input-doji').addEventListener('input', updatePctDisplay);
  document.getElementById('btn-save').addEventListener('click', saveEntry);
  document.getElementById('btn-delete').addEventListener('click', deleteEntry);

  // グラフ画面
  document.getElementById('btn-back-from-graph').addEventListener('click', () =>
    showScreen('screen-home'));

  // ダイアログ
  document.getElementById('confirm-cancel').addEventListener('click', () =>
    document.getElementById('confirm-dialog').classList.add('hidden'));
}

// ---- 認証 ----
async function signInWithGoogle() {
  const btn = document.getElementById('btn-google-signin');
  btn.disabled = true;
  btn.textContent = 'サインイン中...';
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
    // onAuthStateChanged が自動で画面遷移する
  } catch (err) {
    showAuthError('サインインに失敗しました: ' + err.message);
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>Googleでサインイン`;
  }
}

async function signOutUser() {
  await auth.signOut();
  App.monthData = [];
  App.summary   = null;
}

// ---- データ取得（Firestore） ----
async function loadMonthData() {
  updateMonthLabel();
  showLoading(true);
  try {
    const yearMonth = fmtYearMonth(App.year, App.month);
    const snapshot  = await db.collection('entries')
      .where('yearMonth', '==', yearMonth)
      .get();

    App.monthData = snapshot.docs
      .map(d => d.data())
      .sort((a, b) => a.isoDate.localeCompare(b.isoDate));

    recalcSummary();
    updateSummaryDisplay();
    renderMiniChart();
    renderRecentEntries();
  } catch (err) {
    console.error('loadMonthData:', err);
  } finally {
    showLoading(false);
  }
}

// ---- データ保存 ----
async function saveEntry() {
  const seisan = parseFloat(document.getElementById('input-seisan').value);
  const bc     = parseFloat(document.getElementById('input-bc').value)   || 0;
  const doji   = parseFloat(document.getElementById('input-doji').value) || 0;

  if (isNaN(seisan) || seisan <= 0) {
    showStatus('生産数を入力してください。', 'error');
    return;
  }

  const existing = App.monthData.find(d => d.isoDate === App.selectedDate);
  if (existing) {
    const ok = await confirm2('データを上書きします。よろしいですか？');
    if (!ok) return;
  }

  showLoading(true);
  document.getElementById('btn-save').disabled = true;

  try {
    const isoDate    = App.selectedDate;
    const parts      = isoDate.split('-');
    const yearMonth  = fmtYearMonth(parseInt(parts[0]), parseInt(parts[1]));
    const date       = new Date(isoDate + 'T12:00:00');
    const dayOfWeek  = DAY_NAMES[date.getDay()];
    const displayDate = parseInt(parts[1]) + '/' + parseInt(parts[2]);

    const seisanNum = seisan;
    const bcNum     = bc;
    const dojiNum   = doji;
    const bcPct     = seisanNum > 0 ? r2(bcNum   / seisanNum * 100) : 0;
    const dojiPct   = seisanNum > 0 ? r2(dojiNum / seisanNum * 100) : 0;

    const entry = {
      isoDate, displayDate, dayOfWeek, yearMonth,
      seisan: seisanNum, bc: bcNum, bcPct, doji: dojiNum, dojiPct,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: App.user.email,
    };

    await db.collection('entries').doc(isoDate).set(entry);

    // ローカルキャッシュ更新
    const idx = App.monthData.findIndex(d => d.isoDate === isoDate);
    if (idx >= 0) App.monthData[idx] = entry;
    else          App.monthData.push(entry);
    App.monthData.sort((a, b) => a.isoDate.localeCompare(b.isoDate));

    recalcSummary();
    updateSummaryDisplay();
    renderMiniChart();
    renderRecentEntries();
    loadEntryData(isoDate); // 削除ボタンの表示更新

    showStatus('保存しました！', 'success');
  } catch (err) {
    showStatus('保存に失敗しました: ' + err.message, 'error');
  } finally {
    showLoading(false);
    document.getElementById('btn-save').disabled = false;
  }
}

// ---- データ削除 ----
async function deleteEntry() {
  const ok = await confirm2('このデータを削除します。よろしいですか？');
  if (!ok) return;

  showLoading(true);
  try {
    await db.collection('entries').doc(App.selectedDate).delete();

    const idx = App.monthData.findIndex(d => d.isoDate === App.selectedDate);
    if (idx >= 0) App.monthData.splice(idx, 1);

    document.getElementById('input-seisan').value = '';
    document.getElementById('input-bc').value     = '';
    document.getElementById('input-doji').value   = '';
    document.getElementById('pct-bc').textContent   = '-';
    document.getElementById('pct-doji').textContent = '-';
    document.getElementById('btn-delete').classList.add('hidden');

    recalcSummary();
    updateSummaryDisplay();
    renderMiniChart();
    renderRecentEntries();
    showStatus('削除しました。', 'success');
  } catch (err) {
    showStatus('削除に失敗しました: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

// ---- 月ナビ ----
function changeMonth(delta) {
  App.month += delta;
  if (App.month > 12) { App.month = 1;  App.year++; }
  if (App.month < 1)  { App.month = 12; App.year--; }
  loadMonthData();
}

function updateMonthLabel() {
  document.getElementById('current-month-label').textContent =
    App.year + '年 ' + App.month + '月';
}

// ---- サマリー ----
function recalcSummary() {
  let totalSeisan = 0, totalBc = 0, totalDoji = 0, activeDays = 0;
  for (const d of App.monthData) {
    if (d.seisan > 0) {
      totalSeisan += d.seisan;
      totalBc     += d.bc   || 0;
      totalDoji   += d.doji || 0;
      activeDays++;
    }
  }
  App.summary = {
    totalSeisan:  r2(totalSeisan),
    activeDays,
    dailyAvg:     activeDays > 0 ? r2(totalSeisan / activeDays) : 0,
    totalBc:      r2(totalBc),
    totalBcPct:   totalSeisan > 0 ? r2(totalBc   / totalSeisan * 100) : 0,
    totalDoji:    r2(totalDoji),
    totalDojiPct: totalSeisan > 0 ? r2(totalDoji / totalSeisan * 100) : 0,
  };
  return App.summary;
}

function updateSummaryDisplay() {
  const s = App.summary;
  document.getElementById('sum-total').textContent =
    s && s.totalSeisan > 0 ? s.totalSeisan.toFixed(1) : '-';
  document.getElementById('sum-daily').textContent =
    s && s.dailyAvg > 0 ? s.dailyAvg.toFixed(2) : '-';
  document.getElementById('sum-days').textContent =
    s && s.activeDays > 0 ? s.activeDays : '-';
}

// ---- 最近の入力 ----
function renderRecentEntries() {
  const list = document.getElementById('recent-list');
  const entries = App.monthData
    .filter(d => d.seisan > 0)
    .sort((a, b) => b.isoDate.localeCompare(a.isoDate))
    .slice(0, 5);

  if (!entries.length) {
    list.innerHTML = '<div class="recent-empty">データなし</div>';
    return;
  }
  list.innerHTML = entries.map(d => `
    <div class="recent-item" onclick="openInputScreen('${d.isoDate}')">
      <div class="recent-date">${d.displayDate}</div>
      <div class="recent-day">${d.dayOfWeek}</div>
      <div class="recent-values">生産 ${d.seisan} &nbsp;BC ${d.bc ?? '-'} &nbsp;胴継 ${d.doji ?? '-'}</div>
      <div class="recent-edit">編集</div>
    </div>`).join('');
}

// ---- 入力画面 ----
function openInputScreen(isoDate) {
  setSelectedDate(isoDate);
  showScreen('screen-input');
  document.getElementById('input-seisan').focus();
}

window.showDatePicker = function() {
  const picker = document.getElementById('date-picker-input');
  picker.value = App.selectedDate;
  if (picker.showPicker) picker.showPicker(); else picker.click();
};

function setSelectedDate(isoDate) {
  App.selectedDate = isoDate;
  const parts   = isoDate.split('-');
  const date    = new Date(isoDate + 'T12:00:00');
  const dayIdx  = date.getDay();
  const dayName = DAY_NAMES[dayIdx];

  document.getElementById('input-date-day').textContent =
    parseInt(parts[1]) + '/' + parseInt(parts[2]);

  let dayLabel = dayName + '曜日';
  if (dayIdx === 0) dayLabel += ' <span class="sunday-badge">日曜</span>';
  if (dayIdx === 6) dayLabel += ' <span class="saturday-badge">土曜</span>';
  document.getElementById('input-date-weekday').innerHTML = dayLabel;

  document.getElementById('input-header-title').textContent =
    App.year + '年' + parseInt(parts[1]) + '月' + parseInt(parts[2]) + '日';

  loadEntryData(isoDate);
}

function loadEntryData(isoDate) {
  const existing = App.monthData.find(d => d.isoDate === isoDate);
  const deleteBtn = document.getElementById('btn-delete');
  document.getElementById('input-status').classList.add('hidden');

  if (existing && existing.seisan > 0) {
    document.getElementById('input-seisan').value = existing.seisan ?? '';
    document.getElementById('input-bc').value     = existing.bc     ?? '';
    document.getElementById('input-doji').value   = existing.doji   ?? '';
    deleteBtn.classList.remove('hidden');
  } else {
    document.getElementById('input-seisan').value = '';
    document.getElementById('input-bc').value     = '';
    document.getElementById('input-doji').value   = '';
    deleteBtn.classList.add('hidden');
  }
  updatePctDisplay();

  const isSunday = new Date(isoDate + 'T12:00:00').getDay() === 0;
  document.getElementById('btn-save').disabled = isSunday;
  if (isSunday) showStatus('日曜日はデータ入力できません。', 'error');
}

function changeDay(delta) {
  const date = new Date(App.selectedDate + 'T12:00:00');
  date.setDate(date.getDate() + delta);
  setSelectedDate(formatISO(date));
}

function updatePctDisplay() {
  const seisan = parseFloat(document.getElementById('input-seisan').value) || 0;
  const bc     = parseFloat(document.getElementById('input-bc').value)     || 0;
  const doji   = parseFloat(document.getElementById('input-doji').value)   || 0;
  document.getElementById('pct-bc').textContent =
    seisan > 0 ? (bc / seisan * 100).toFixed(1) + '%' : '-';
  document.getElementById('pct-doji').textContent =
    seisan > 0 ? (doji / seisan * 100).toFixed(1) + '%' : '-';
}

function showStatus(msg, type) {
  const el = document.getElementById('input-status');
  el.textContent = msg;
  el.className   = 'status-msg ' + type;
  el.classList.remove('hidden');
  if (type === 'success') setTimeout(() => el.classList.add('hidden'), 3000);
}

// ---- グラフ ----
function openGraphScreen() {
  showScreen('screen-graph');
  renderMainChart();
}

function buildChartData() {
  const daysInMonth = new Date(App.year, App.month, 0).getDate();
  const dataMap     = {};
  for (const d of App.monthData) dataMap[d.isoDate] = d;

  const labels = [], seisanData = [], bcData = [], dojiData = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = App.year + '-' +
      String(App.month).padStart(2,'0') + '-' +
      String(day).padStart(2,'0');
    labels.push(String(day));
    const d = dataMap[iso];
    if (d && d.seisan > 0) {
      seisanData.push(d.seisan);
      bcData.push(d.bc   || 0);
      dojiData.push(d.doji || 0);
    } else {
      seisanData.push(null);
      bcData.push(null);
      dojiData.push(null);
    }
  }
  return { labels, seisanData, bcData, dojiData };
}

function renderMiniChart() {
  const ctx = document.getElementById('mini-chart').getContext('2d');
  if (App.miniChart) { App.miniChart.destroy(); App.miniChart = null; }
  const { labels, seisanData, bcData, dojiData } = buildChartData();
  App.miniChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: '生産数', data: seisanData, backgroundColor: '#4472C4', borderWidth: 0 },
        { label: 'B.C反',  data: bcData,     backgroundColor: '#FFC000', borderWidth: 0 },
        { label: '胴継反', data: dojiData,   backgroundColor: '#ED7D31', borderWidth: 0 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { ticks: { display: false }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { font: { size: 9 }, maxTicksLimit: 4 },
             grid: { color: '#f3f4f6' } },
      },
    },
  });
}

function renderMainChart() {
  const ctx = document.getElementById('main-chart').getContext('2d');
  if (App.mainChart) { App.mainChart.destroy(); App.mainChart = null; }
  const { labels, seisanData, bcData, dojiData } = buildChartData();
  const s = App.summary || recalcSummary();

  document.getElementById('graph-title').textContent =
    App.year + '年 ' + App.month + '月 生産反数';
  document.getElementById('graph-subtitle').textContent =
    '生産 ' + (s.totalSeisan || 0).toFixed(1) + '反　日産 ' +
    (s.dailyAvg || 0).toFixed(2) + '反/' + (s.activeDays || 0) + '日　' +
    'BC ' + (s.totalBc || 0).toFixed(1) + '反(' + (s.totalBcPct || 0).toFixed(2) + '%)　' +
    '胴継 ' + (s.totalDoji || 0).toFixed(1) + '反(' + (s.totalDojiPct || 0).toFixed(2) + '%)';

  document.getElementById('pt-total').textContent    = (s.totalSeisan || 0).toFixed(1) + '反';
  document.getElementById('pt-days').textContent     = (s.activeDays  || 0) + '日';
  document.getElementById('pt-daily').textContent    = (s.dailyAvg    || 0).toFixed(2) + '反/日';
  document.getElementById('pt-bc-pct').textContent   = (s.totalBcPct  || 0).toFixed(2) + '%';
  document.getElementById('pt-doji-pct').textContent = (s.totalDojiPct|| 0).toFixed(2) + '%';

  App.mainChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: '生産数', data: seisanData, backgroundColor: '#4472C4', borderWidth: 0, barPercentage: 0.75 },
        { label: 'B.C反',  data: bcData,     backgroundColor: '#FFC000', borderWidth: 0, barPercentage: 0.75 },
        { label: '胴継反', data: dojiData,   backgroundColor: '#ED7D31', borderWidth: 0, barPercentage: 0.75 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 12 }, padding: 16, usePointStyle: true } },
        tooltip: {
          callbacks: {
            title: (items) => App.month + '/' + items[0].label,
            label: (item)  => ' ' + item.dataset.label + ': ' + item.raw,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
        y: { beginAtZero: true, grid: { color: '#e5e7eb' }, ticks: { font: { size: 11 } } },
      },
    },
  });
}

// ---- 週次集計 ----
function openWeeklyScreen() {
  showScreen('screen-weekly');
  document.getElementById('weekly-month-label').textContent =
    App.year + '年 ' + App.month + '月';
  renderWeeklyTable();
}

function calcWeeks() {
  // その月の全日付を生成し、月〜土でグループ化
  const daysInMonth = new Date(App.year, App.month, 0).getDate();
  const dataMap = {};
  for (const d of App.monthData) dataMap[d.isoDate] = d;

  const weeks = [];
  let weekIdx = -1;
  let prevMonday = null;

  for (let day = 1; day <= daysInMonth; day++) {
    const iso  = App.year + '-' + String(App.month).padStart(2,'0') + '-' + String(day).padStart(2,'0');
    const date = new Date(iso + 'T12:00:00');
    const dow  = date.getDay(); // 0=日,1=月,...,6=土

    // 月曜日（または月初）で新しい週を開始
    if (dow === 1 || (day === 1 && dow !== 0)) {
      weeks.push({ monday: iso, saturday: null, days: [] });
      weekIdx = weeks.length - 1;
    }

    // 日曜はスキップ（集計対象外）
    if (dow === 0) continue;

    // 土曜日なら週末を記録
    if (dow === 6 && weekIdx >= 0) {
      weeks[weekIdx].saturday = iso;
    }

    // データがある日だけ追加
    if (dataMap[iso] && dataMap[iso].seisan > 0) {
      if (weekIdx < 0) { weeks.push({ monday: iso, saturday: null, days: [] }); weekIdx = 0; }
      weeks[weekIdx].days.push(dataMap[iso]);
    }
  }

  return weeks;
}

function renderWeeklyTable() {
  document.getElementById('weekly-month-label').textContent =
    App.year + '年 ' + App.month + '月';

  const tbody = document.getElementById('weekly-tbody');
  const tfoot = document.getElementById('weekly-tfoot');

  if (!App.monthData.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="weekly-empty">データなし</td></tr>';
    tfoot.innerHTML = '';
    return;
  }

  const weeks = calcWeeks();
  let grandSeisan = 0, grandBc = 0, grandDoji = 0, grandDays = 0;
  const rows = [];

  weeks.forEach((week, i) => {
    if (!week.days.length) return; // データがない週はスキップ

    let wSeisan = 0, wBc = 0, wDoji = 0;
    for (const d of week.days) {
      wSeisan += d.seisan || 0;
      wBc     += d.bc     || 0;
      wDoji   += d.doji   || 0;
    }
    grandSeisan += wSeisan; grandBc += wBc; grandDoji += wDoji;
    grandDays   += week.days.length;

    const wBcPct   = wSeisan > 0 ? r2(wBc   / wSeisan * 100) : 0;
    const wDojiPct = wSeisan > 0 ? r2(wDoji / wSeisan * 100) : 0;

    // 期間ラベル（M/D〜M/D）
    const firstDay = week.days[0].isoDate;
    const lastDay  = week.days[week.days.length - 1].isoDate;
    const fParts   = firstDay.split('-');
    const lParts   = lastDay.split('-');
    const label    = `第${i+1}週\n${parseInt(fParts[1])}/${parseInt(fParts[2])}〜${parseInt(lParts[1])}/${parseInt(lParts[2])}`;

    rows.push(`
      <tr>
        <td style="white-space:pre-line">${label}</td>
        <td>${week.days.length}日</td>
        <td>${r2(wSeisan).toFixed(1)}</td>
        <td>${r2(wBc).toFixed(1)}</td>
        <td>${wBcPct.toFixed(2)}%</td>
        <td>${r2(wDoji).toFixed(1)}</td>
        <td>${wDojiPct.toFixed(2)}%</td>
      </tr>`);
  });

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="weekly-empty">データなし</td></tr>';
    tfoot.innerHTML = '';
    return;
  }

  const gBcPct   = grandSeisan > 0 ? r2(grandBc   / grandSeisan * 100) : 0;
  const gDojiPct = grandSeisan > 0 ? r2(grandDoji / grandSeisan * 100) : 0;

  tbody.innerHTML = rows.join('');
  tfoot.innerHTML = `
    <tr>
      <td>月計</td>
      <td>${grandDays}日</td>
      <td>${r2(grandSeisan).toFixed(1)}</td>
      <td>${r2(grandBc).toFixed(1)}</td>
      <td>${gBcPct.toFixed(2)}%</td>
      <td>${r2(grandDoji).toFixed(1)}</td>
      <td>${gDojiPct.toFixed(2)}%</td>
    </tr>`;
}

// ---- 印刷・PDF ----
window.printGraph = function() { window.print(); };
window.saveAsPDF  = function() {
  const n = document.createElement('div');
  n.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1f2937;color:#fff;padding:10px 20px;border-radius:8px;font-size:.9rem;z-index:9999;';
  n.textContent = '印刷ダイアログで「PDFに保存」を選択してください';
  document.body.appendChild(n);
  setTimeout(() => { document.body.removeChild(n); window.print(); }, 800);
};

// ---- 画面遷移 ----
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active'); s.classList.add('hidden');
  });
  const t = document.getElementById(id);
  t.classList.remove('hidden'); t.classList.add('active');
  window.scrollTo(0, 0);
}

// ---- ユーティリティ ----
function showLoading(show) {
  document.getElementById('loading-overlay').classList.toggle('hidden', !show);
}
function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function formatISO(date) {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2,'0') + '-' +
    String(date.getDate()).padStart(2,'0');
}
function fmtYearMonth(y, m) {
  return y + '-' + String(m).padStart(2,'0');
}
function r2(n) { return Math.round(n * 100) / 100; }

function confirm2(message) {
  return new Promise(resolve => {
    document.getElementById('confirm-message').textContent = message;
    const dialog = document.getElementById('confirm-dialog');
    dialog.classList.remove('hidden');
    const ok     = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');
    function cleanup() {
      dialog.classList.add('hidden');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
    }
    function onOk()     { cleanup(); resolve(true);  }
    function onCancel() { cleanup(); resolve(false); }
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
  });
}
