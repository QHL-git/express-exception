// ================================================================
//  前端：JWT 登录 + 按角色渲染
// ================================================================

const TOKEN_KEY = "express-exception:token";
const USER_KEY = "express-exception:user";

const SLA_HOURS = 24;
const NEAR_DUE_HOURS = 4;

const ROLE_LABEL = { customer: "客户", agent: "客服", ops: "运营" };

const STATUS_META = {
  pending: { label: "待分派", badge: "warn" },
  processing: { label: "处理中", badge: "info" },
  resolved: { label: "待客户确认", badge: "ok" },
  closed: { label: "已关闭", badge: "muted" },
};

const CUSTOMER_STATUS = {
  pending: { label: "已受理，等待处理", badge: "warn" },
  processing: { label: "处理中", badge: "info" },
  resolved: { label: "待您确认", badge: "ok" },
  closed: { label: "已解决", badge: "muted" },
};

// ==================== 全局状态 ====================
let token = localStorage.getItem(TOKEN_KEY) || "";
let currentUser = null;
try {
  currentUser = JSON.parse(localStorage.getItem(USER_KEY) || "null");
} catch {
  currentUser = null;
}

let tickets = [];
let currentFilter = "all";
let editingTicketId = null;
let lastQueryId = "";

// ==================== 请求封装 ====================
async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { ...options, headers });
  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await res.json() : null;

  // token 失效：清理本地状态，回到登录页
  if (res.status === 401) {
    logout();
    throw new Error((data && data.error) || "登录已过期，请重新登录");
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `请求失败（${res.status}）`);
  }
  return data;
}

function postJson(path, body) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

// ==================== 工具函数 ====================
function formatDuration(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分钟`;
}

function slaOf(ticket) {
  if (ticket.status === "closed") return { text: "—", badge: "muted" };
  if (ticket.status === "resolved") return { text: "等待客户确认", badge: "ok" };

  const deadline = new Date(ticket.createdAt).getTime() + SLA_HOURS * 3600 * 1000;
  const left = deadline - Date.now();

  if (left < 0) return { text: `已超时 ${formatDuration(-left)}`, badge: "danger" };
  if (left < NEAR_DUE_HOURS * 3600 * 1000) return { text: `即将超时 ${formatDuration(left)}`, badge: "warn" };
  return { text: `剩余 ${formatDuration(left)}`, badge: "muted" };
}

function fmtTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function setBusy(button, text) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = text;
  return () => {
    button.disabled = false;
    button.textContent = original;
  };
}

// ==================== 登录 / 退出 ====================
const loginScreen = document.getElementById("login-screen");
const appShell = document.getElementById("app");

document.getElementById("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const button = document.getElementById("login-submit");
  const errorBox = document.getElementById("login-error");
  errorBox.textContent = "";

  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  if (!username || !password) {
    errorBox.textContent = "请输入账号和密码";
    return;
  }

  const restore = setBusy(button, "登录中…");
  try {
    const data = await postJson("/api/auth/login", { username, password });
    token = data.token;
    currentUser = data.user;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
    document.getElementById("login-password").value = "";
    await enterApp();
  } catch (err) {
    errorBox.textContent = err.message;
  } finally {
    restore();
  }
});

document.getElementById("logout-btn").addEventListener("click", () => logout());

function logout() {
  token = "";
  currentUser = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  appShell.classList.add("hidden");
  loginScreen.classList.remove("hidden");
}

async function enterApp() {
  loginScreen.classList.add("hidden");
  appShell.classList.remove("hidden");

  document.getElementById("user-name").textContent =
    `${currentUser.name} · ${ROLE_LABEL[currentUser.role]}`;
  document.getElementById("ops-user-name").textContent = currentUser.name;

  // 只显示当前角色能用的入口
  document.querySelectorAll("#tabs .tab").forEach((tab) => {
    tab.classList.toggle("hidden", tab.dataset.role !== currentUser.role);
  });

  const ownTab = document.querySelector(`#tabs .tab[data-role="${currentUser.role}"]`);
  if (ownTab) {
    document.querySelectorAll("#tabs .tab").forEach((t) => t.classList.remove("active"));
    ownTab.classList.add("active");
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.getElementById("view-" + ownTab.dataset.view).classList.add("active");
  }

  try {
    await loadTickets();
  } catch (err) {
    console.error(err);
  }
}

// ==================== 数据加载 ====================
async function loadTickets() {
  tickets = await request("/api/tickets");
  renderTickets();
  renderOps();
}

// ==================== 视图切换（单角色只有一个 tab，保留扩展性）====================
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("view-" + btn.dataset.view).classList.add("active");

    if (btn.dataset.view === "service") renderTickets();
    if (btn.dataset.view === "ops") renderOps();
  });
});

// ================================================================
//  客服：工单列表
// ================================================================
const ticketBody = document.getElementById("ticket-body");

function renderTickets() {
  const list = tickets.filter((t) => currentFilter === "all" || t.status === currentFilter);

  if (list.length === 0) {
    ticketBody.innerHTML = `<tr><td colspan="8" class="empty">当前筛选下没有工单</td></tr>`;
  } else {
    ticketBody.innerHTML = list.map(ticketRow).join("");
  }

  updateStats();
}

function ticketRow(t) {
  const meta = STATUS_META[t.status];
  const sla = slaOf(t);

  let action = `<span class="empty">—</span>`;
  if (t.status === "pending") {
    action = `<button class="btn small" data-assign="${t.id}">指派</button>`;
  } else if (t.status === "resolved") {
    const label = t.customerVisibleNote ? "修改对外说明" : "生成对外说明";
    action = `<button class="btn small" data-explain="${t.id}">${label}</button>`;
  }

  return `
    <tr>
      <td class="code">${t.id}</td>
      <td>${t.trackingId}</td>
      <td>${t.type}</td>
      <td class="note">${t.note || '<span class="empty">—</span>'}</td>
      <td><span class="badge ${meta.badge}">${meta.label}</span></td>
      <td>${t.assignee || '<span class="empty">未分派</span>'}</td>
      <td><span class="badge ${sla.badge}">${sla.text}</span></td>
      <td>${action}</td>
    </tr>
  `;
}

function updateStats() {
  const count = (status) => tickets.filter((t) => t.status === status).length;

  document.getElementById("stat-pending").textContent = count("pending");
  document.getElementById("stat-processing").textContent = count("processing");

  const overdue = tickets.filter((t) => {
    if (t.status === "closed" || t.status === "resolved") return false;
    return new Date(t.createdAt).getTime() + SLA_HOURS * 3600 * 1000 < Date.now();
  }).length;

  document.getElementById("stat-overdue").textContent = overdue;
}

ticketBody.addEventListener("click", (event) => {
  const assignBtn = event.target.closest("[data-assign]");
  if (assignBtn) {
    assignTicket(assignBtn.dataset.assign);
    return;
  }
  const explainBtn = event.target.closest("[data-explain]");
  if (explainBtn) {
    writeCustomerNote(explainBtn.dataset.explain);
  }
});

async function assignTicket(id) {
  const name = prompt("把这个工单指派给谁？", "王运营");
  if (name === null) return;

  try {
    await postJson(`/api/tickets/${id}/assign`, { assignee: name.trim() || "王运营" });
    await loadTickets();
  } catch (err) {
    alert(err.message);
  }
}

async function writeCustomerNote(id) {
  const ticket = tickets.find((t) => t.id === id);
  if (!ticket) return;

  const hint = ticket.customerVisibleNote || "我们已核实您反馈的情况，正在处理，稍后会同步结果。";
  const text = prompt("写给客户看的说明（内部记录不会出现在这里）：", hint);
  if (text === null) return;
  if (!text.trim()) {
    alert("说明不能为空");
    return;
  }

  try {
    await postJson(`/api/tickets/${id}/explain`, { text: text.trim() });
    await loadTickets();
    if (lastQueryId) await queryShipment(lastQueryId);
  } catch (err) {
    alert(err.message);
  }
}

document.getElementById("ticket-filters").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-status]");
  if (!chip) return;

  document.querySelectorAll("#ticket-filters .chip").forEach((c) => c.classList.remove("active"));
  chip.classList.add("active");
  currentFilter = chip.dataset.status;
  renderTickets();
});

const createForm = document.getElementById("create-form");

document.getElementById("create-ticket-btn").addEventListener("click", () => {
  createForm.classList.remove("hidden");
  document.getElementById("f-tracking").focus();
});

document.getElementById("cancel-create").addEventListener("click", () => {
  createForm.classList.add("hidden");
});

document.getElementById("ticket-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const trackingId = document.getElementById("f-tracking").value.trim().toUpperCase();
  const type = document.getElementById("f-type").value;
  const note = document.getElementById("f-desc").value.trim();
  if (!trackingId) return;

  try {
    await postJson("/api/tickets", { trackingId, type, note });
    event.target.reset();
    createForm.classList.add("hidden");
    currentFilter = "all";
    document.querySelectorAll("#ticket-filters .chip").forEach((c) =>
      c.classList.toggle("active", c.dataset.status === "all")
    );
    await loadTickets();
    if (lastQueryId === trackingId) await queryShipment(trackingId);
  } catch (err) {
    alert(err.message);
  }
});

// ================================================================
//  运营：处理工单
// ================================================================
const opsList = document.getElementById("ops-list");
const opsPanel = document.getElementById("ops-panel");

function renderOps() {
  if (!currentUser) return;

  const processing = tickets.filter(
    (t) => t.assignee === currentUser.name && t.status === "processing"
  );
  const submitted = tickets.filter(
    (t) => t.assignee === currentUser.name && t.status === "resolved"
  );

  let html = "";

  if (processing.length === 0) {
    html += `<p class="empty">${currentUser.name} 目前没有处理中的工单。</p>`;
  } else {
    html += processing.map((t) => opsCard(t, true)).join("");
  }

  if (submitted.length > 0) {
    html += `<h2 class="section-title">已提交，等待客服对外说明</h2>`;
    html += submitted.map((t) => opsCard(t, false)).join("");
  }

  opsList.innerHTML = html;
}

function opsCard(t, actionable) {
  const sla = slaOf(t);
  return `
    <div class="ops-card">
      <div class="ops-main">
        <div class="code">${t.id} <span class="empty">· ${t.trackingId} · ${t.type}</span></div>
        <div class="ops-note">${t.note || "（客户未填写描述）"}</div>
      </div>
      <div class="ops-side">
        <span class="badge ${sla.badge}">${sla.text}</span>
        ${actionable ? `<button class="btn small primary" data-open="${t.id}">处理</button>` : `<span class="empty">已提交</span>`}
      </div>
    </div>
  `;
}

function openOpsPanel(id) {
  const t = tickets.find((x) => x.id === id);
  if (!t) return;

  editingTicketId = id;
  document.getElementById("ops-title").textContent = `${t.id} · ${t.trackingId}`;
  document.getElementById("ops-subtitle").textContent = `${t.type} · ${t.note || "无描述"}`;
  document.getElementById("ops-notes").value = t.internalNotes || "";
  document.getElementById("ops-result").value = t.result || "";

  opsPanel.classList.remove("hidden");
  opsPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function closeOpsPanel() {
  editingTicketId = null;
  opsPanel.classList.add("hidden");
}

opsList.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-open]");
  if (!btn) return;
  openOpsPanel(btn.dataset.open);
});

document.getElementById("ops-cancel").addEventListener("click", closeOpsPanel);

document.getElementById("ops-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const t = tickets.find((x) => x.id === editingTicketId);
  if (!t) return;

  const button = event.target.querySelector("button[type=submit]");
  const restore = setBusy(button, "提交中…");

  try {
    await postJson(`/api/tickets/${t.id}/result`, {
      internalNotes: document.getElementById("ops-notes").value.trim(),
      result: document.getElementById("ops-result").value.trim(),
    });

    closeOpsPanel();
    await loadTickets();
    if (lastQueryId === t.trackingId) await queryShipment(lastQueryId);
  } catch (err) {
    alert(err.message);   // 403 时显示后端返回的原文
  } finally {
    restore();
  }
});

// ================================================================
//  客户：查件 + 工单 + 反馈
// ================================================================
const form = document.getElementById("query-form");
const input = document.getElementById("tracking-input");
const result = document.getElementById("result");

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const id = input.value.trim().toUpperCase();
  if (!id) return;
  queryShipment(id);
});

async function queryShipment(trackingId) {
  lastQueryId = trackingId;
  result.innerHTML = `<p class="empty">正在查询…</p>`;

  try {
    const [shipment, list] = await Promise.all([
      request(`/api/shipments/${encodeURIComponent(trackingId)}`),
      request(`/api/tickets?trackingId=${encodeURIComponent(trackingId)}`),
    ]);

    const ticketsHtml = list.length
      ? `<h2 class="section-title">我的工单</h2>` + list.map(customerTicketCard).join("")
      : `<p class="empty">这件包裹目前没有异常工单。</p>`;

    const toolbar = `
      <div class="actions" style="margin: 8px 0 4px">
        <button class="btn" data-feedback="${trackingId}">这个包裹有问题，去反馈</button>
      </div>`;

    result.innerHTML = renderShipment(shipment) + toolbar + ticketsHtml;
  } catch (err) {
    result.innerHTML = `<p class="empty">${err.message}</p>`;
  }
}

function renderShipment(s) {
  const badge = s.exception
    ? '<span class="badge warn">存在异常</span>'
    : '<span class="badge ok">运输正常</span>';

  const notice = s.exception ? `<div class="notice">${s.exception}</div>` : "";

  const traces = s.traces
    .map((t) => `<li>${t.text}<time>${t.time}</time></li>`)
    .join("");

  return `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="code">${s.id}</div>
          <div class="empty">${s.from} → ${s.to}</div>
        </div>
        ${badge}
      </div>
      <div class="meta">
        <div>当前状态<b>${s.status}</b></div>
        <div>最近更新<b>${s.updated}</b></div>
      </div>
      ${notice}
      <ul class="timeline">${traces}</ul>
    </div>
  `;
}

function customerTicketCard(t) {
  const meta = CUSTOMER_STATUS[t.status] || CUSTOMER_STATUS.pending;

  const message = t.customerVisibleNote
    ? `<div class="message">${t.customerVisibleNote}</div>`
    : `<div class="message muted">客服正在核实，有结果后会在这里回复您。</div>`;

  const history = t.history
    .filter((h) => h.visible)
    .map((h) => `<li>${h.text}<time>${fmtTime(h.time)}</time></li>`)
    .join("");

  const actions =
    t.status === "resolved"
      ? `<div class="actions">
           <button class="btn primary" data-confirm="${t.id}">确认已解决</button>
           <button class="btn" data-reject="${t.id}">不认可</button>
         </div>`
      : "";

  return `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="code">${t.id}</div>
          <div class="empty">${t.type} · 提交于 ${fmtTime(t.createdAt)}</div>
        </div>
        <span class="badge ${meta.badge}">${meta.label}</span>
      </div>
      ${message}
      <ul class="timeline">${history}</ul>
      ${actions}
    </div>
  `;
}

result.addEventListener("click", (event) => {
  const feedbackBtn = event.target.closest("[data-feedback]");
  if (feedbackBtn) {
    openFeedback(feedbackBtn.dataset.feedback);
    return;
  }

  const confirmBtn = event.target.closest("[data-confirm]");
  if (confirmBtn) {
    resolveTicket(confirmBtn.dataset.confirm, true);
    return;
  }
  const rejectBtn = event.target.closest("[data-reject]");
  if (rejectBtn) {
    resolveTicket(rejectBtn.dataset.reject, false);
  }
});

async function resolveTicket(id, accepted) {
  try {
    await postJson(`/api/tickets/${id}/${accepted ? "confirm" : "reject"}`);
    await loadTickets();
    if (lastQueryId) await queryShipment(lastQueryId);
  } catch (err) {
    alert(err.message);
  }
}

// ---------- 提交异常反馈 ----------
const feedbackPanel = document.getElementById("feedback-panel");
let feedbackTrackingId = "";

function openFeedback(trackingId) {
  feedbackTrackingId = trackingId;
  document.getElementById("fb-tracking").textContent = trackingId;
  feedbackPanel.classList.remove("hidden");
  feedbackPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

document.getElementById("fb-cancel").addEventListener("click", () => {
  feedbackPanel.classList.add("hidden");
});

document.getElementById("feedback-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const button = document.getElementById("fb-submit");
  const restore = setBusy(button, "提交中…");

  try {
    await postJson("/api/tickets", {
      trackingId: feedbackTrackingId,
      type: document.getElementById("fb-type").value,
      note: document.getElementById("fb-desc").value.trim(),
    });

    event.target.reset();
    feedbackPanel.classList.add("hidden");

    await loadTickets();
    await queryShipment(feedbackTrackingId);
  } catch (err) {
    alert(err.message);
  } finally {
    restore();
  }
});

// ================================================================
//  启动：有 token 就静默续登，没有就停在登录页
// ================================================================
(async function boot() {
  if (!token) {
    loginScreen.classList.remove("hidden");
    return;
  }

  try {
    const me = await request("/api/auth/me");
    currentUser = me.user;
    await enterApp();
  } catch (err) {
    logout();
  }
})();

// 每分钟刷新时限显示（不重新请求）
setInterval(() => {
  if (!currentUser) return;
  renderTickets();
  renderOps();
}, 60 * 1000);
