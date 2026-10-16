/*
 * Project 05 — Nginx feature dashboard
 * 使用原生 fetch() 呼叫既有 Nginx / Express 端點。
 * 不改動既有 API、不需要打包工具，所有輸出都用 textContent 插入以避免 HTML 注入。
 */

const element = (id) => document.getElementById(id);

function create(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

// 統一建立測試結果，避免大量複製 HTML 與更新畫面邏輯。
function renderResult(panelId, { state = 'success', title, status, badgeTone, items = [], note, chips = [], counts = [], raw }) {
  const panel = element(panelId);
  panel.replaceChildren();
  panel.dataset.state = state;

  const head = create('div', 'result-heading');
  head.append(create('strong', '', title));
  if (status) head.append(create('span', `status-code ${badgeTone ?? (state === 'error' ? 'bad' : '')}`, status));
  panel.append(head);

  if (counts.length) {
    const container = create('div', 'result-counts');
    for (const [label, value] of counts) {
      const item = create('span', '', `${label} `);
      item.append(create('b', '', value));
      container.append(item);
    }
    panel.append(container);
  }

  if (chips.length) {
    const container = create('div', 'instance-strip');
    for (const chip of chips) container.append(create('span', chip.className, chip.text));
    panel.append(container);
  }

  if (items.length) {
    const dl = create('dl', 'kv-list');
    for (const [label, value] of items) {
      const row = create('div', 'kv-row');
      row.append(create('dt', '', label), create('dd', '', value ?? '—'));
      dl.append(row);
    }
    panel.append(dl);
  }

  if (note) panel.append(create('p', 'result-note', note));

  if (raw !== undefined) {
    const details = document.createElement('details');
    details.append(create('summary', '', '查看完整 JSON 回應'));
    details.append(create('pre', '', JSON.stringify(raw, null, 2)));
    panel.append(details);
  }
}

// 一張卡片的按鈕在執行期間暫時停用，避免同一實驗重複並發。
async function run(panelId, buttonIds, action) {
  const buttons = buttonIds.map(element);
  buttons.forEach((button) => { button.disabled = true; });
  const panel = element(panelId);
  panel.dataset.state = 'loading';
  panel.replaceChildren(create('p', 'result-placeholder', '正在送出請求並等待回應…'));

  try {
    await action();
  } catch (error) {
    renderResult(panelId, {
      state: 'error', title: '請求失敗', status: 'NETWORK ERROR',
      note: `${error instanceof Error ? error.message : String(error)}。請確認 Nginx、Docker Compose 服務均已啟動。`,
    });
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function tryJson(response) {
  try { return await response.json(); } catch { return null; }
}

// Health：liveness 與 readiness 是兩個不同的檢查，不能混為一談。
async function runHealth() {
  const button = element('run-health');
  button.disabled = true;

  const targets = [
    { url: '/health/live', lamp: 'nginx-lamp', value: 'nginx-health' },
    { url: '/health/ready', lamp: 'api-lamp', value: 'api-health' },
  ];

  await Promise.all(targets.map(async ({ url, lamp, value }) => {
    element(lamp).dataset.state = 'loading';
    element(value).textContent = '檢查中…';
    try {
      const response = await fetch(url, { cache: 'no-store' });
      element(lamp).dataset.state = response.ok ? 'success' : 'failed';
      element(value).textContent = `HTTP ${response.status} · ${response.ok ? '正常' : '異常'}`;
    } catch {
      element(lamp).dataset.state = 'failed';
      element(value).textContent = '連線失敗';
    }
  }));

  button.disabled = false;
}

async function runProxy() {
  await run('result-proxy', ['run-proxy'], async () => {
    const response = await fetch('/api/info', { cache: 'no-store' });
    const data = await tryJson(response);
    renderResult('result-proxy', {
      state: response.ok ? 'success' : 'error',
      title: response.ok ? 'Nginx → Express 回應成功' : 'API 回應異常',
      status: `HTTP ${response.status}`,
      items: [
        ['Instance', data?.instance],
        ['Request path', data?.request?.path],
        ['Forwarded proto', data?.headers?.xForwardedProto],
        ['Node.js', data?.runtime?.nodeVersion],
      ],
      note: '外部瀏覽器只存取 Nginx，API 容器未直接公開 Host Port。',
      raw: data ?? undefined,
    });
  });
}

async function runBalance() {
  await run('result-balance', ['run-balance'], async () => {
    const results = [];
    // 序列化送出，方便觀察預設 Round Robin 的回應順序。
    for (let i = 0; i < 8; i += 1) {
      const response = await fetch('/lab/balance', { cache: 'no-store' });
      const body = await tryJson(response);
      results.push(response.ok ? (body?.instance ?? 'unknown') : `HTTP ${response.status}`);
    }

    const api1 = results.filter((item) => item === 'api-1').length;
    const api2 = results.filter((item) => item === 'api-2').length;
    const allOk = results.every((item) => item === 'api-1' || item === 'api-2');
    renderResult('result-balance', {
      state: allOk ? 'success' : 'error',
      title: allOk ? '8 次請求已完成' : '部分後端回應異常',
      status: `${results.length} REQUESTS`,
      counts: [['api-1', api1], ['api-2', api2]],
      chips: results.map((item) => ({
        text: item,
        className: item === 'api-1' ? 'instance-item' : item === 'api-2' ? 'instance-item alt' : 'instance-item unknown',
      })),
      note: '負載分配順序由 Nginx 決定；若同時有其他使用者發出請求，可能不會嚴格交替。',
    });
  });
}

async function runRate() {
  await run('result-rate', ['run-rate'], async () => {
    // 同時發出請求，才能明顯觸發 Nginx 端的 burst / rate 限制。
    const statuses = await Promise.all(Array.from({ length: 12 }, async () => {
      try {
        const response = await fetch('/lab/rate', { cache: 'no-store' });
        await response.text();
        return response.status;
      } catch { return 'ERR'; }
    }));

    const success = statuses.filter((status) => status === 200).length;
    const rejected = statuses.filter((status) => status === 429).length;
    const other = statuses.length - success - rejected;
    renderResult('result-rate', {
      state: other ? 'error' : 'success',
      title: '12 次並發請求結果',
      status: `${rejected} × HTTP 429`,
      badgeTone: rejected ? 'bad' : 'neutral',
      counts: [['允許 200', success], ['拒絕 429', rejected], ...(other ? [['其他', other]] : [])],
      chips: statuses.map((status) => ({ text: String(status), className: status === 429 ? 'request-item denied' : 'request-item' })),
      note: '實際數量取決於瀏覽器並發限制及來源 IP 近期的請求；429 是預期的流量限制結果。',
    });
  });
}

async function runTimeout(seconds) {
  await run('result-timeout', ['run-timeout-2', 'run-timeout-5'], async () => {
    const started = performance.now();
    const response = await fetch(`/lab/timeout?seconds=${seconds}`, { cache: 'no-store' });
    const elapsed = ((performance.now() - started) / 1000).toFixed(2);
    const data = response.ok ? await tryJson(response) : null;
    const expected = seconds === 2 ? response.status === 200 : response.status === 504;
    renderResult('result-timeout', {
      state: expected ? 'success' : 'error',
      title: expected ? '回應符合預期' : '回應與預期不同',
      status: `HTTP ${response.status}`,
      badgeTone: response.status === 504 ? 'neutral' : (response.ok ? '' : 'bad'),
      items: [
        ['後端設定延遲', `${seconds} 秒`],
        ['瀏覽器實測耗時', `${elapsed} 秒`],
        ['Nginx read timeout', '3 秒'],
        ['實際 Instance', data?.instance ?? (response.status === 504 ? 'Nginx 回傳錯誤頁' : '—')],
      ],
      note: seconds === 5
        ? '504 是預期結果：Nginx 在後端回應前先等到讀取逾時，自訂 50x 頁面不改變 HTTP Status。'
        : '200 是預期結果：Express 在 Nginx 的 3 秒讀取逾時前完成回應。',
    });
  });
}

async function runGzip() {
  await run('result-gzip', ['run-gzip'], async () => {
    // 瀏覽器自動協商 Accept-Encoding；JavaScript 不能自行設定該 Header。
    const response = await fetch('/lab/gzip/large.txt', { cache: 'no-store' });
    const text = await response.text();
    const encoding = response.headers.get('content-encoding') ?? '未回傳';
    const varied = response.headers.get('vary') ?? '未回傳';
    const compressed = encoding.toLowerCase().includes('gzip');
    renderResult('result-gzip', {
      state: response.ok ? 'success' : 'error',
      title: compressed ? '已收到 Gzip 回應' : '已取得回應，未看到 Gzip Header',
      status: `HTTP ${response.status}`,
      items: [
        ['Content-Encoding', encoding],
        ['Vary', varied],
        ['解壓縮後內容', `${new TextEncoder().encode(text).length.toLocaleString()} bytes`],
      ],
      note: '瀏覽器會自動解壓縮；上面的 bytes 不是網路實際傳輸量。若需比較壓縮前後大小，請看 Network 面板或 Nginx gzip_ratio 日誌。',
    });
  });
}

async function runCache() {
  await run('result-cache', ['run-cache'], async () => {
    // 先產生一個新的 URL，避免沿用其他測試留下的 Cache。
    // 兩次都用「同一個」URL，讓瀏覽器有機會從自身快取回應。
    const url = `/lab/cache/cache.css?dashboard-test=${Date.now()}`;
    const fullUrl = new URL(url, document.baseURI).href;
    const first = await fetch(url);
    await first.text();
    const second = await fetch(url);
    await second.text();

    const timing = performance.getEntriesByName(fullUrl, 'resource');
    const lastTiming = timing.at(-1);
    const transfer = timing.length >= 2 && lastTiming && typeof lastTiming.transferSize === 'number'
      ? `${lastTiming.transferSize} bytes` : '無可用資料';
    renderResult('result-cache', {
      state: first.ok && second.ok ? 'success' : 'error',
      title: first.ok && second.ok ? '相同資源請求兩次完成' : '其中一次請求失敗',
      status: `HTTP ${first.status} / ${second.status}`,
      items: [
        ['Cache-Control', first.headers.get('cache-control')],
        ['Expires', first.headers.get('expires')],
        ['X-Lab-Cache', first.headers.get('x-lab-cache')],
        ['第二次 transferSize', transfer],
      ],
      note: 'transferSize 為瀏覽器 Resource Timing 的參考資訊；0 bytes 可能代表快取，不保證一定如此。請使用 DevTools → Network 確認是否命中快取。',
    });
  });
}

async function runNotFound() {
  await run('result-not-found', ['run-not-found'], async () => {
    const response = await fetch('/__nginx_lab_missing_resource', { cache: 'no-store' });
    const html = await response.text();
    const custom = html.includes('Resource Not Found');
    const expected = response.status === 404 && custom;
    renderResult('result-not-found', {
      state: expected ? 'success' : 'error',
      title: expected ? 'Nginx 自訂 404 頁面正常' : '404 回應未符合預期',
      status: `HTTP ${response.status}`,
      items: [['自訂頁內容', custom ? '找到 Resource Not Found' : '未找到預期文字'], ['HTTP Status 保留', response.status === 404 ? '是' : '否']],
      note: 'Nginx 在內部以 /404.html 回應，但對外的 HTTP Status 應維持 404。',
    });
  });
}

element('run-health').addEventListener('click', runHealth);
element('run-proxy').addEventListener('click', runProxy);
element('run-balance').addEventListener('click', runBalance);
element('run-rate').addEventListener('click', runRate);
element('run-timeout-2').addEventListener('click', () => runTimeout(2));
element('run-timeout-5').addEventListener('click', () => runTimeout(5));
element('run-gzip').addEventListener('click', runGzip);
element('run-cache').addEventListener('click', runCache);
element('run-not-found').addEventListener('click', runNotFound);
