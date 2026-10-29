// ================================================================
//  前端：所有数据都来自后端 API（M5）
//  页面里不再有任何假数据
// ================================================================

const SLA_HOURS = 24;        // 处理时限：24 小时
const NEAR_DUE_HOURS = 4;    // 剩余不足 4 小时算"即将超时"

const STATUS_META = {
  pending: { label: "待分派", badge: "warn" },
  processing: { label: "处理中", badge: "info" },
  resolved: { label: "待客户确认", badge: "ok" },
  closed: { label: "已关闭", badge: "muted" },
};

// 同一个状态，客户看到的说法不一样
const CUSTOMER_STATUS = {
  pending: { label: "已受理，等待处理", badge: "warn" },
  processing: { label: "处理中", badge: "info" },
  resolved: { label: "待您确认", badge: "ok" },
  closed: { label: "已解决", badge: "muted" },
};

// ==================== 全局状态 ====================
let tickets = [];              // 从后端拿到的工单列表
let currentFilter = "all";
let currentOpsUser = "王运营";
let editingTicketId = null;
let lastQueryId = "";          // 记住客户上次查的运单号，操作后自动刷新

// ==================== 请求封装 ====================
// 统一处理：解析 JSON、非 2xx 抛错（错误信息用后端返回的 error 字段）
async function request(path, options = {}) {
  const res = await fetch(path, options);
  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await res.json() : null;

  if (!res.ok) {
    throw new Error((data && data.error) || `请求失败（${res.status}）`);
  }
  return data;
}

function postJson(path, body, headers = {}) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
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

  const createdAt = new Date(ticket.createdAt);
  const deadline = createdAt.getTime() + SLA_HOURS * 3600 * 1000;
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

// ==================== 数据加载 ====================
async function loadTickets() {
  tickets = await request("/api/tickets");
  renderTickets();
  renderOps();
}

// ==================== 视图切换 ====================
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
    const deadline = new Date(t.createdAt).getTime() + SLA_HOURS * 3600 * 1000;
    return deadline < Date.now();
  }).length;

  document.getElementById("stat-overdue").textContent = overdue;
}

// ---------- 指派 ----------
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
  const assignee = name.trim() || "王运营";

  try {
    await postJson(`/api/tickets/${id}/assign`, { assignee });
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

// ---------- 筛选 ----------
document.getElementById("ticket-filters").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-status]");
  if (!chip) return;

  document.querySelectorAll("#ticket-filters .chip").forEach((c) => c.classList.remove("active"));
  chip.classList.add("active");
  currentFilter = chip.dataset.status;
  renderTickets();
});

// ---------- 新建工单 ----------
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
  const processing = tickets.filter(
    (t) => t.assignee === currentOpsUser && t.status === "processing"
  );
  const submitted = tickets.filter(
    (t) => t.assignee === currentOpsUser && t.status === "resolved"
  );

  let html = "";

  if (processing.length === 0) {
    html += `<p class="empty">${currentOpsUser} 目前没有处理中的工单。</p>`;
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

  // 前端这层只是体验；真正的拦截在后端
  if (t.assignee !== currentOpsUser) {
    alert("这张工单没有指派给你。");
    return;
  }

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

  try {
    // 身份放在请求体里，后端会校验它是否等于 assignee
    await postJson(`/api/tickets/${t.id}/result`, {
      internalNotes: document.getElementById("ops-notes").value.trim(),
      result: document.getElementById("ops-result").value.trim(),
      operator: currentOpsUser,
    });

    closeOpsPanel();
    await loadTickets();
    if (lastQueryId === t.trackingId) await queryShipment(lastQueryId);
  } catch (err) {
    alert(err.message);   // 403 时这里会显示后端返回的原文
  }
});

document.getElementById("ops-user").addEventListener("change", (event) => {
  currentOpsUser = event.target.value;
  closeOpsPanel();
  renderOps();
});

// ================================================================
//  客户：查件 + 工单进度
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

    result.innerHTML = renderShipment(shipment) + ticketsHtml;
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

// ================================================================
//  启动
// ================================================================
loadTickets().catch((err) => {
  ticketBody.innerHTML = `<tr><td colspan="8" class="empty">加载失败：${err.message}</td></tr>`;
  opsList.innerHTML = `<p class="empty">加载失败：${err.message}</p>`;
});

// 每分钟重算一次时限显示（不重新请求数据）
setInterval(() => {
  renderTickets();
  renderOps();
}, 60 * 1000);
