// ===================================================
// 生産反数管理アプリ - メインロジック
// ===================================================

'use strict';

// ---- アプリ状態 ----

const App = {
  user:         null,   // { email, name }
  idToken:      null,   // Google IDトークン
  year:         new Date().getFullYear(),
  month:        new Date().getMonth() + 1,
  monthData:    [],     // 当月の全データ
  summary:      null,   // 月次サマリー
  selectedDate: null,   // 入力画面の選択日 (YYYY-MM-DD)
  miniChart:    null,   // ミニチャートインスタンス
  mainChart:    null,   // メインチャートインスタンス
};

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const DAY_NAMES_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---- 初期化 ----

window.addEventListener('DOMContentLoaded', () => {
  // CONFIG チェック
  if (!window.CONFIG) {
    showError('config.js が読み込まれていません。');
    return;
  }

  // Google Sign-In ボタンを初期化（GIS ライブラリ読み込み後）
  waitForGoogle(() => initGoogleSignIn());

  // イベントリスナー設定
  bindEvents();

  // キャッシュ済みトークンがあれば復元
  restoreSession();
});

function waitForGoogle(callback) {
  if (window.google && google.accounts) {
    callback();
  } else {
    setTimeout(() => waitForGoogle(callback), 100);
  }
}

function initGoogleSignIn() {
  google.accounts.id.initialize({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    callback:  onGoogleSignIn,
    auto_select: false,
    cancel_on_tap_outside: true,
  });

  google.accounts.id.renderButton(
    document.getElementById('google-signin-btn'),
    {
      theme: 'outline',
      size:  'large',
      text:  'signin_with',
      locale: 'ja',
      width: 280,
    }
  );
}

// Google サインインコールバック（グローバル関数として宣言）
window.onGoogleSignIn = function(response) {
  if (!response.credential) {
    showAuthError('サインインに失敗しました。');
    return;
  }

  const token = response.credential;
  const payload = decodeJWT(token);

  if (!payload) {
    showAuthError('トークンの解析に失敗しました。');
    return;
  }

  App.idToken = token;
  App.user = { email: payload.email, name: payload.name || payload.email };

  // sessionStorage に保存
  sessionStorage.setItem('idToken',    token);
  sessionStorage.setItem('userEmail',  App.user.email);
  sessionStorage.setItem('userName',   App.user.name);

  enterApp();
};

function restoreSession() {
  const token = sessionStorage.getItem('idToken');
  if (!token) return;

  // 有効期限チェック
  const payload = decodeJWT(token);
  if (!payload || Date.now() / 1000 > payload.exp - 120) {
    sessionStorage.clear();
    return;
  }

  App.idToken = token;
  App.user = {
    email: sessionStorage.getItem('userEmail'),
    name:  sessionStorage.getItem('userName'),
  };

  enterApp();
}

function enterApp() {
  document.getElementById('user-name').textContent = App.user.name;
  showScreen('screen-home');
  loadMonthData();
}

// ---- イベントバインド ----

function bindEvents() {
  // ホーム
  document.getElementById('btn-help').addEventListener('click', () => {
    document.getElementById('help-modal').classList.remove('hidden');
  });
  document.getElementById('btn-close-help').addEventListener('click', () => {
    document.getElementById('help-modal').classList.add('hidden');
  });
  document.getElementById('help-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('help-modal')) {
      document.getElementById('help-modal').classList.add('hidden');
    }
  });
  document.getElementById('btn-signout').addEventListener('click', signOut);
  document.getElementById('btn-prev-month').addEventListener('click', () => changeMonth(-1));
  document.getElementById('btn-next-month').addEventListener('click', () => changeMonth(+1));
  document.getElementById('btn-today-input').addEventListener('click', () => {
    const today = formatISO(new Date());
    openInputScreen(today);
  });
  document.getElementById('btn-view-graph').addEventListener('click', openGraphScreen);

  // 入力画面
  document.getElementById('btn-back-from-input').addEventListener('click', () => {
    showScreen('screen-home');
    loadMonthData(); // データが変わった可能性があるのでリロード
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
  document.getElementById('btn-back-from-graph').addEventListener('click', () => {
    showScreen('screen-home');
  });

  // ダイアログ
  document.getElementById('confirm-cancel').addEventListener('click', () => {
    document.getElementById('confirm-dialog').classList.add('hidden');
  });
}

// ---- 画面遷移 ----

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.classList.add('hidden');
  });
  const target = document.getElementById(id);
  target.classList.remove('hidden');
  target.classList.add('active');
  window.scrollTo(0, 0);
}

// ---- 月ナビゲーション ----

function changeMonth(delta) {
  App.month += delta;
  if (App.month > 12) { App.month = 1;  App.year++; }
  if (App.month < 1)  { App.month = 12; App.year--; }
  loadMonthData();
}

function updateMonthLabel() {
  document.getElementById('current-month-label').textContent =
    `${App.year}年 ${App.month}月`;
}

// ---- データ読み込み ----

async function loadMonthData() {
  updateMonthLabel();
  showLoading(true);

  try {
    const result = await apiCall('getMonthData', { year: App.year, month: App.month });
    if (!result.success) throw new Error(result.error);
    App.monthData = result.data || [];

    const sumResult = await apiCall('getMonthlySummary', { year: App.year, month: App.month });
    App.summary = sumResult.success ? sumResult.summary : null;

    updateSummaryDisplay();
    renderMiniChart();
    renderRecentEntries();
  } catch (err) {
    console.error('loadMonthData:', err);
  } finally {
    showLoading(false);
  }
}

function updateSummaryDisplay() {
  const s = App.summary;
  if (s) {
    document.getElementById('sum-total').textContent =
      s.totalSeisan > 0 ? s.totalSeisan.toFixed(1) : '-';
    document.getElementById('sum-daily').textContent =
      s.dailyAvg > 0 ? s.dailyAvg.toFixed(2) : '-';
    document.getElementById('sum-days').textContent =
      s.activeDays > 0 ? s.activeDays : '-';
  } else {
    ['sum-total', 'sum-daily', 'sum-days'].forEach(id => {
      document.getElementById(id).textContent = '-';
    });
  }
}

function renderRecentEntries() {
  const list = document.getElementById('recent-list');
  // 直近5件（生産データがある日）
  const entries = App.monthData
    .filter(d => d.seisan !== null && d.seisan > 0)
    .sort((a, b) => b.isoDate.localeCompare(a.isoDate))
    .slice(0, 5);

  if (entries.length === 0) {
    list.innerHTML = '<div class="recent-empty">データなし</div>';
    return;
  }

  list.innerHTML = entries.map(d => {
    const parts = d.isoDate.split('-');
    const label = `${parseInt(parts[1])}/${parseInt(parts[2])}`;
    return `
      <div class="recent-item" onclick="openInputScreen('${d.isoDate}')">
        <div class="recent-date">${label}</div>
        <div class="recent-day">${d.dayOfWeek}</div>
        <div class="recent-values">
          生産 ${d.seisan} &nbsp;BC ${d.bc ?? '-'} &nbsp;胴継 ${d.doji ?? '-'}
        </div>
        <div class="recent-edit">編集</div>
      </div>`;
  }).join('');
}

// ---- ミニチャート ----

function renderMiniChart() {
  const ctx = document.getElementById('mini-chart').getContext('2d');

  if (App.miniChart) {
    App.miniChart.destroy();
    App.miniChart = null;
  }

  const { labels, seisanData, bcData, dojiData } = buildChartData(App.year, App.month, App.monthData);

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
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
      scales: {
        x: {
          ticks: { display: false },
          grid:  { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { font: { size: 9 }, maxTicksLimit: 4 },
          grid: { color: '#f3f4f6' },
        },
      },
    },
  });
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
  picker.showPicker ? picker.showPicker() : picker.click();
};

function setSelectedDate(isoDate) {
  App.selectedDate = isoDate;
  const date = new Date(isoDate + 'T12:00:00');
  const parts = isoDate.split('-');
  const label = `${App.year}年${parseInt(parts[1])}月${parseInt(parts[2])}日`;
  const dayIdx = date.getDay();
  const dayName = DAY_NAMES[dayIdx];

  document.getElementById('input-date-day').textContent =
    `${parseInt(parts[1])}/${parseInt(parts[2])}`;

  let dayLabel = `${dayName}曜日`;
  if (dayIdx === 0) dayLabel += ' <span class="sunday-badge">日曜</span>';
  if (dayIdx === 6) dayLabel += ' <span class="saturday-badge">土曜</span>';
  document.getElementById('input-date-weekday').innerHTML = dayLabel;

  document.getElementById('input-header-title').textContent = label;

  // 既存データを読み込む
  loadEntryData(isoDate);
}

function loadEntryData(isoDate) {
  // 入力フィールドをクリア
  document.getElementById('input-seisan').value = '';
  document.getElementById('input-bc').value = '';
  document.getElementById('input-doji').value = '';
  document.getElementById('pct-bc').textContent = '-';
  document.getElementById('pct-doji').textContent = '-';
  document.getElementById('input-status').classList.add('hidden');

  const existing = App.monthData.find(d => d.isoDate === isoDate);
  const deleteBtn = document.getElementById('btn-delete');

  if (existing && existing.seisan !== null) {
    document.getElementById('input-seisan').value = existing.seisan ?? '';
    document.getElementById('input-bc').value     = existing.bc     ?? '';
    document.getElementById('input-doji').value   = existing.doji   ?? '';
    updatePctDisplay();
    deleteBtn.classList.remove('hidden');
  } else {
    deleteBtn.classList.add('hidden');
  }

  // 日曜は入力不可
  const date = new Date(isoDate + 'T12:00:00');
  const isSunday = date.getDay() === 0;
  document.getElementById('btn-save').disabled = isSunday;
  if (isSunday) {
    showStatus('日曜日はデータ入力できません。', 'error');
  }
}

function changeDay(delta) {
  if (!App.selectedDate) return;
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

async function saveEntry() {
  const seisan = parseFloat(document.getElementById('input-seisan').value);
  const bc     = parseFloat(document.getElementById('input-bc').value)     || 0;
  const doji   = parseFloat(document.getElementById('input-doji').value)   || 0;

  if (isNaN(seisan) || seisan <= 0) {
    showStatus('生産数を入力してください。', 'error');
    return;
  }

  // 既存データがある場合は上書き確認
  const existing = App.monthData.find(d => d.isoDate === App.selectedDate && d.seisan !== null);
  if (existing) {
    const ok = await confirm2('データを上書きします。よろしいですか？');
    if (!ok) return;
  }

  showLoading(true);
  document.getElementById('btn-save').disabled = true;

  try {
    const result = await apiCall('saveEntry', {
      date:   App.selectedDate,
      seisan, bc, doji,
    });
    if (!result.success) throw new Error(result.error);

    // ローカルのキャッシュを更新
    const idx = App.monthData.findIndex(d => d.isoDate === App.selectedDate);
    const bcPct   = seisan > 0 ? Math.round(bc   / seisan * 10000) / 100 : 0;
    const dojiPct = seisan > 0 ? Math.round(doji / seisan * 10000) / 100 : 0;
    const date = new Date(App.selectedDate + 'T12:00:00');
    const parts = App.selectedDate.split('-');

    const newEntry = {
      isoDate:     App.selectedDate,
      displayDate: `${parseInt(parts[1])}/${parseInt(parts[2])}`,
      dayOfWeek:   DAY_NAMES[date.getDay()],
      seisan, bc, bcPct, doji, dojiPct,
      weekSeisan: null, weekBc: null, weekBcPct: null, weekDoji: null, weekDojiPct: null,
    };

    if (idx >= 0) App.monthData[idx] = newEntry;
    else          App.monthData.push(newEntry);

    showStatus('保存しました！', 'success');
    document.getElementById('btn-delete').classList.remove('hidden');

    // サマリー再計算
    recalcSummary();
    renderMiniChart();
    renderRecentEntries();
    updateSummaryDisplay();

  } catch (err) {
    showStatus('保存に失敗しました: ' + err.message, 'error');
    console.error(err);
  } finally {
    showLoading(false);
    document.getElementById('btn-save').disabled = false;
  }
}

async function deleteEntry() {
  const ok = await confirm2('このデータを削除します。よろしいですか？');
  if (!ok) return;

  showLoading(true);
  try {
    const result = await apiCall('deleteEntry', { date: App.selectedDate });
    if (!result.success) throw new Error(result.error);

    // ローカルキャッシュ更新
    const idx = App.monthData.findIndex(d => d.isoDate === App.selectedDate);
    if (idx >= 0) {
      App.monthData[idx].seisan = null;
      App.monthData[idx].bc     = null;
      App.monthData[idx].bcPct  = null;
      App.monthData[idx].doji   = null;
      App.monthData[idx].dojiPct = null;
    }

    document.getElementById('input-seisan').value = '';
    document.getElementById('input-bc').value = '';
    document.getElementById('input-doji').value = '';
    document.getElementById('pct-bc').textContent = '-';
    document.getElementById('pct-doji').textContent = '-';
    document.getElementById('btn-delete').classList.add('hidden');

    showStatus('削除しました。', 'success');
    recalcSummary();
    renderMiniChart();
    renderRecentEntries();
    updateSummaryDisplay();

  } catch (err) {
    showStatus('削除に失敗しました: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

function showStatus(msg, type) {
  const el = document.getElementById('input-status');
  el.textContent = msg;
  el.className = 'status-msg ' + type;
  el.classList.remove('hidden');

  if (type === 'success') {
    setTimeout(() => el.classList.add('hidden'), 3000);
  }
}

// ---- グラフ画面 ----

function openGraphScreen() {
  showScreen('screen-graph');
  renderMainChart();
}

function renderMainChart() {
  const ctx = document.getElementById('main-chart').getContext('2d');

  if (App.mainChart) {
    App.mainChart.destroy();
    App.mainChart = null;
  }

  const { labels, seisanData, bcData, dojiData } = buildChartData(App.year, App.month, App.monthData);

  // タイトル・サブタイトル
  document.getElementById('graph-title').textContent =
    `${App.year}年 ${App.month}月 生産反数`;

  const s = App.summary || recalcSummary();
  const totalStr = s && s.totalSeisan > 0 ? s.totalSeisan.toFixed(1) : '0.0';
  const avgStr   = s && s.dailyAvg   > 0 ? s.dailyAvg.toFixed(2)   : '0.00';
  const daysStr  = s && s.activeDays  > 0 ? s.activeDays             : '0';
  document.getElementById('graph-subtitle').textContent =
    `生産 ${totalStr}反　日産 ${avgStr}反/${daysStr}日`;

  // 印刷用サマリーテーブル
  if (s) {
    document.getElementById('pt-total').textContent  = s.totalSeisan.toFixed(1) + '反';
    document.getElementById('pt-days').textContent   = s.activeDays + '日';
    document.getElementById('pt-daily').textContent  = s.dailyAvg.toFixed(2) + '反/日';
    document.getElementById('pt-bc-pct').textContent = s.totalBcPct.toFixed(2) + '%';
    document.getElementById('pt-doji-pct').textContent = s.totalDojiPct.toFixed(2) + '%';
  }

  App.mainChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '生産数',
          data: seisanData,
          backgroundColor: '#4472C4',
          borderWidth: 0,
          barPercentage: 0.75,
        },
        {
          label: 'B.C反',
          data: bcData,
          backgroundColor: '#FFC000',
          borderWidth: 0,
          barPercentage: 0.75,
        },
        {
          label: '胴継反',
          data: dojiData,
          backgroundColor: '#ED7D31',
          borderWidth: 0,
          barPercentage: 0.75,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { size: 12 }, padding: 16, usePointStyle: true },
        },
        tooltip: {
          callbacks: {
            title: (items) => `${App.month}/${items[0].label}`,
            label: (item) => ` ${item.dataset.label}: ${item.raw}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { size: 10 },
            color: (ctx) => {
              // 日曜日はラベルを赤に
              const day = new Date(App.year, App.month - 1, parseInt(ctx.tick.label)).getDay();
              return day === 0 ? '#ef4444' : '#4b5563';
            },
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: '#e5e7eb' },
          ticks: { font: { size: 11 } },
        },
      },
    },
  });
}

// ---- チャートデータ生成 ----

function buildChartData(year, month, monthData) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const labels     = [];
  const seisanData = [];
  const bcData     = [];
  const dojiData   = [];

  // データをisoDateでマップ化
  const dataMap = {};
  for (const d of monthData) {
    if (d.seisan !== null) dataMap[d.isoDate] = d;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const isoDate = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    labels.push(String(day));

    if (dataMap[isoDate] && dataMap[isoDate].seisan > 0) {
      seisanData.push(dataMap[isoDate].seisan);
      bcData.push(dataMap[isoDate].bc   ?? 0);
      dojiData.push(dataMap[isoDate].doji ?? 0);
    } else {
      seisanData.push(null);
      bcData.push(null);
      dojiData.push(null);
    }
  }

  return { labels, seisanData, bcData, dojiData };
}

// ---- 印刷・PDF ----

window.printGraph = function() {
  window.print();
};

window.saveAsPDF = function() {
  const notice = document.createElement('div');
  notice.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1f2937;color:#fff;padding:10px 20px;border-radius:8px;font-size:0.9rem;z-index:9999;';
  notice.textContent = '印刷ダイアログで「PDFに保存」を選択してください';
  document.body.appendChild(notice);
  setTimeout(() => {
    document.body.removeChild(notice);
    window.print();
  }, 800);
};

// ---- API ----

async function apiCall(action, params = {}) {
  if (!App.idToken) throw new Error('Not authenticated');

  // トークン期限チェック
  const payload = decodeJWT(App.idToken);
  if (payload && Date.now() / 1000 > payload.exp - 120) {
    // 再認証が必要
    sessionStorage.clear();
    showScreen('screen-auth');
    throw new Error('Token expired. Please sign in again.');
  }

  const res = await fetch(CONFIG.GAS_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' },
    body:    JSON.stringify({ action, token: App.idToken, ...params }),
  });

  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// ---- 月次サマリー再計算（ローカル） ----

function recalcSummary() {
  let totalSeisan = 0, totalBc = 0, totalDoji = 0, activeDays = 0;
  for (const d of App.monthData) {
    if (d.seisan !== null && d.seisan > 0) {
      totalSeisan += d.seisan;
      totalBc     += d.bc   || 0;
      totalDoji   += d.doji || 0;
      activeDays++;
    }
  }
  const dailyAvg    = activeDays > 0 ? Math.round(totalSeisan / activeDays * 100) / 100 : 0;
  const totalBcPct  = totalSeisan > 0 ? Math.round(totalBc   / totalSeisan * 10000) / 100 : 0;
  const totalDojiPct = totalSeisan > 0 ? Math.round(totalDoji / totalSeisan * 10000) / 100 : 0;

  App.summary = {
    year: App.year, month: App.month,
    totalSeisan: Math.round(totalSeisan * 10) / 10,
    activeDays, dailyAvg,
    totalBc:     Math.round(totalBc   * 10) / 10,
    totalBcPct,
    totalDoji:   Math.round(totalDoji * 10) / 10,
    totalDojiPct,
  };
  return App.summary;
}

// ---- サインアウト ----

function signOut() {
  if (window.google && google.accounts) {
    google.accounts.id.disableAutoSelect();
  }
  App.user     = null;
  App.idToken  = null;
  App.monthData = [];
  App.summary   = null;
  sessionStorage.clear();
  showScreen('screen-auth');
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

function showError(msg) {
  alert(msg);
}

function formatISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function decodeJWT(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
  } catch (e) {
    return null;
  }
}

// Promise ベースの確認ダイアログ
function confirm2(message) {
  return new Promise(resolve => {
    document.getElementById('confirm-message').textContent = message;
    const dialog = document.getElementById('confirm-dialog');
    dialog.classList.remove('hidden');

    const okBtn     = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');

    function cleanup() {
      dialog.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
    }
    function onOk()     { cleanup(); resolve(true);  }
    function onCancel() { cleanup(); resolve(false); }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}
