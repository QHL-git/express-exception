// ============ 模拟数据（M5 会换成后端接口） ============
const shipments = {
  SF1001: {
    id: "SF1001",
    status: "运输中",
    from: "杭州",
    to: "武汉",
    updated: "2026-10-26 09:12",
    exception: "物流信息已连续 3 天未更新（延误）",
    traces: [
      { text: "包裹已到达武汉转运中心", time: "10-23 08:20" },
      { text: "包裹已从杭州发出", time: "10-22 22:05" },
      { text: "包裹已揽收", time: "10-22 14:30" },
    ],
  },
  SF1002: {
    id: "SF1002",
    status: "派送中",
    from: "广州",
    to: "武汉",
    updated: "2026-10-27 16:40",
    exception: "外包装破损，已退回站点重新打包（物品破损）",
    traces: [
      { text: "快件外包装破损，站点重新加固", time: "10-27 16:40" },
      { text: "派送员派送中", time: "10-27 09:10" },
      { text: "包裹已到达武汉网点", time: "10-26 21:30" },
    ],
  },
  SF1003: {
    id: "SF1003",
    status: "已签收",
    from: "上海",
    to: "武汉",
    updated: "2026-10-25 11:02",
    exception: null,
    traces: [
      { text: "本人签收", time: "10-25 11:02" },
      { text: "派送员派送中", time: "10-25 08:45" },
      { text: "包裹已到达武汉网点", time: "10-24 20:10" },
    ],
  },
};

// ============ 视图切换 ============
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("view-" + btn.dataset.view).classList.add("active");

    // 切换视图时重新渲染，避免看到旧数据
    if (btn.dataset.view === "service") renderTickets();
    if (btn.dataset.view === "ops") renderOps();
  });
});

// ============ 客户查件（M1） ============
const form = document.getElementById("query-form");
const input = document.getElementById("tracking-input");
const result = document.getElementById("result");

form.addEventListener("submit", (event) => {
  event.preventDefault();          // 阻止表单刷新页面
  const id = input.value.trim().toUpperCase();
  if (!id) return;

  const shipment = shipments[id];
  if (!shipment) {
    result.innerHTML = `<p class="empty">没有找到运单 ${id}，请检查单号是否正确。</p>`;
    return;
  }
  renderCustomerResult(id);
});

function renderShipment(s) {
  const badge = s.exception
    ? '<span class="badge warn">存在异常</span>'
    : '<span class="badge ok">运输正常</span>';

  const notice = s.exception
    ? `<div class="notice">${s.exception}</div>`
    : "";

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

// ================================================================
//  客户侧：工单进度与确认（M4）
// ================================================================

// 同一个状态，客户看到的说法和内部不一样
const CUSTOMER_STATUS = {
  pending: { label: "已受理，等待处理", badge: "warn" },
  processing: { label: "处理中", badge: "info" },
  resolved: { label: "待您确认", badge: "ok" },
  closed: { label: "已解决", badge: "muted" },
};

function fmtTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderCustomerResult(trackingId) {
  const shipment = shipments[trackingId];
  const myTickets = tickets.filter((t) => t.trackingId === trackingId);

  const ticketsHtml = myTickets.length
    ? `<h2 class="section-title">我的工单</h2>` + myTickets.map(customerTicketCard).join("")
    : `<p class="empty">这件包裹目前没有异常工单。</p>`;

  result.innerHTML = renderShipment(shipment) + ticketsHtml;
}

function customerTicketCard(t) {
  const meta = CUSTOMER_STATUS[t.status] || CUSTOMER_STATUS.pending;

  const message = t.customerVisibleNote
    ? `<div class="message">${t.customerVisibleNote}</div>`
    : `<div class="message muted">客服正在核实，有结果后会在这里回复您。</div>`;

  // 只展示标记为"客户可见"的历史，内部记录不会出现在这里
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

// 客户确认或拒绝，都要走状态机
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

function resolveTicket(id, accepted) {
  const ticket = tickets.find((t) => t.id === id);
  if (!ticket) return;

  const target = accepted ? "closed" : "processing";
  if (!canTransition(ticket.status, target)) {
    console.warn(`非法流转：${ticket.status} → ${target}`);
    return;
  }

  if (accepted) {
    ticket.status = "closed";
    addHistory(ticket, "客户确认问题已解决，工单关闭", true);
  } else {
    ticket.status = "processing";
    ticket.customerVisibleNote = "";   // 旧说明作废，客服要重新写
    addHistory(ticket, "客户不认可处理结果，工单退回重新处理", true);
  }

  saveTickets();

  const currentId = input.value.trim().toUpperCase();
  if (shipments[currentId]) renderCustomerResult(currentId);

  renderTickets();
  renderOps();
}

// ================================================================
//  工单模块（M2）
// ================================================================

// ---------- 状态机 ----------
// 每个状态只能流转到数组里列出的状态，不在列表里的流转一律拒绝。
// 这是整个系统的"规则核心"：客户不认可 → 从 resolved 退回 processing。
const TRANSITIONS = {
  pending: ["processing"],              // 待分派 → 指派后进入处理中
  processing: ["resolved"],             // 处理中 → 运营提交结果
  resolved: ["closed", "processing"],   // 待确认 → 客户确认关闭 / 客户不认可退回
  closed: [],                           // 已关闭是终态
};

const STATUS_META = {
  pending: { label: "待分派", badge: "warn" },
  processing: { label: "处理中", badge: "info" },
  resolved: { label: "待客户确认", badge: "ok" },
  closed: { label: "已关闭", badge: "muted" },
};

const SLA_HOURS = 24;        // 处理时限：24 小时
const NEAR_DUE_HOURS = 4;    // 剩余不足 4 小时算"即将超时"

// 用"几小时前"生成时间，保证演示时总有超时/临期的工单
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000);

let tickets = [
  { id: "GD-0001", trackingId: "SF1001", type: "延误", status: "pending", assignee: "", createdAt: hoursAgo(30), note: "包裹三天没有更新", internalNotes: "", result: "", customerVisibleNote: "" },
  { id: "GD-0002", trackingId: "SF1002", type: "物品破损", status: "processing", assignee: "王运营", createdAt: hoursAgo(20), note: "外包装破损，客户拒收", internalNotes: "已联系武汉站点确认外箱破损，正在重新打包", result: "", customerVisibleNote: "" },
  { id: "GD-0003", trackingId: "SF1002", type: "标签破损", status: "processing", assignee: "李运营", createdAt: hoursAgo(2), note: "面单模糊，地址无法辨认", internalNotes: "", result: "", customerVisibleNote: "" },
  { id: "GD-0004", trackingId: "SF1003", type: "签收争议", status: "resolved", assignee: "王运营", createdAt: hoursAgo(10), note: "显示已签收但客户称未收到", internalNotes: "监控显示快件被同楼住户代收", result: "已上门取回并重新派送", customerVisibleNote: "您反馈的签收问题我们已核实：快件由同楼住户代收，我们已取回并重新安排派送，预计今天送达。" },
  { id: "GD-0005", trackingId: "SF1001", type: "联系人异常", status: "closed", assignee: "李运营", createdAt: hoursAgo(50), note: "收件电话为空号", internalNotes: "三次拨打均提示空号", result: "已按寄件人地址退回", customerVisibleNote: "因收件电话无法接通，包裹已退回寄件人" },
];

// 给每条工单补上历史记录字段（旧数据可能没有）
// 演示用的客户可见历史，让客户页面一打开就有内容
const seedHistory = {
  "GD-0004": [
    { time: hoursAgo(9), text: "客户提交了异常反馈", visible: true },
    { time: hoursAgo(3), text: "客服已回复处理说明", visible: true },
  ],
  "GD-0005": [
    { time: hoursAgo(49), text: "客户提交了异常反馈", visible: true },
    { time: hoursAgo(20), text: "客服已回复处理说明", visible: true },
    { time: hoursAgo(18), text: "客户确认问题已解决，工单关闭", visible: true },
  ],
};
tickets.forEach((t) => { t.history = seedHistory[t.id] || []; });

// ============ 本地持久化（M4） ============
// 浏览器 localStorage 只能存字符串，所以 Date 要转成 ISO 字符串再存回来转回 Date
const STORAGE_KEY = "express-exception:tickets:v1";

function saveTickets() {
  const plain = tickets.map((t) => ({
    ...t,
    createdAt: t.createdAt.toISOString(),
  }));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plain));
  } catch (err) {
    console.warn("保存到本地失败（可能是浏览器限制了本地存储）", err);
  }
}

function loadTickets() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    return null;      // 某些环境下不允许访问 localStorage，直接用默认数据
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw).map((t) => ({ ...t, createdAt: new Date(t.createdAt) }));
  } catch (err) {
    console.warn("本地数据损坏，已忽略", err);
    return null;
  }
}

const savedTickets = loadTickets();
if (savedTickets && savedTickets.length > 0) {
  tickets = savedTickets;
}

// 记录一条历史，visible 决定客户能不能看到
function addHistory(ticket, text, visible) {
  ticket.history.push({ time: new Date().toISOString(), text, visible });
}

let ticketSeq =
  tickets.reduce((max, t) => Math.max(max, Number(t.id.replace("GD-", "")) || 0), 0) + 1;
let currentFilter = "all";

const ticketBody = document.getElementById("ticket-body");

// ---------- 时限计算 ----------
function formatDuration(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分钟`;
}

function slaOf(ticket) {
  if (ticket.status === "closed") return { text: "—", badge: "muted" };
  if (ticket.status === "resolved") return { text: "等待客户确认", badge: "ok" };

  const deadline = ticket.createdAt.getTime() + SLA_HOURS * 3600 * 1000;
  const left = deadline - Date.now();

  if (left < 0) return { text: `已超时 ${formatDuration(-left)}`, badge: "danger" };
  if (left < NEAR_DUE_HOURS * 3600 * 1000) return { text: `即将超时 ${formatDuration(left)}`, badge: "warn" };
  return { text: `剩余 ${formatDuration(left)}`, badge: "muted" };
}

// ---------- 状态机判定 ----------
function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

// ---------- 渲染 ----------
function renderTickets() {
  const list = tickets.filter(
    (t) => currentFilter === "all" || t.status === currentFilter
  );

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
    return t.createdAt.getTime() + SLA_HOURS * 3600 * 1000 < Date.now();
  }).length;

  document.getElementById("stat-overdue").textContent = overdue;
}

// ---------- 交互：指派 / 对外说明 ----------
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

function assignTicket(id) {
  const ticket = tickets.find((t) => t.id === id);
  if (!ticket) return;

  // 状态机校验：只有 pending 才能流转到 processing
  if (!canTransition(ticket.status, "processing")) {
    console.warn(`非法流转：${ticket.status} → processing`);
    return;
  }

  // 让客服自己选处理人；点"取消"就什么都不做
  const name = prompt("把这个工单指派给谁？", "王运营");
  if (name === null) return;                   // 用户点了取消
  ticket.assignee = name.trim() || "王运营";    // 输入为空时回退到默认值

  ticket.status = "processing";
  addHistory(ticket, `客服已创建工单并分派给 ${ticket.assignee}`, false);
  saveTickets();
  renderTickets();
}

// 客服把运营的内部结论整理成"客户能看懂"的说明
function writeCustomerNote(id) {
  const ticket = tickets.find((t) => t.id === id);
  if (!ticket) return;

  const hint = ticket.customerVisibleNote || "我们已核实您反馈的情况，正在处理，稍后会同步结果。";
  const text = prompt("写给客户看的说明（内部记录不会出现在这里）：", hint);
  if (text === null) return;              // 取消
  ticket.customerVisibleNote = text.trim();
  addHistory(ticket, "客服已回复处理说明", true);
  saveTickets();

  renderTickets();
  renderOps();
}

// ---------- 交互：筛选 ----------
document.getElementById("ticket-filters").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-status]");
  if (!chip) return;

  document.querySelectorAll("#ticket-filters .chip").forEach((c) => c.classList.remove("active"));
  chip.classList.add("active");
  currentFilter = chip.dataset.status;
  renderTickets();
});

// ---------- 交互：新建工单 ----------
const createForm = document.getElementById("create-form");

document.getElementById("create-ticket-btn").addEventListener("click", () => {
  createForm.classList.remove("hidden");
  document.getElementById("f-tracking").focus();
});

document.getElementById("cancel-create").addEventListener("click", () => {
  createForm.classList.add("hidden");
});

document.getElementById("ticket-form").addEventListener("submit", (event) => {
  event.preventDefault();

  const trackingId = document.getElementById("f-tracking").value.trim().toUpperCase();
  if (!trackingId) return;

  tickets.unshift({
    id: "GD-" + String(ticketSeq++).padStart(4, "0"),
    trackingId,
    type: document.getElementById("f-type").value,
    status: "pending",
    assignee: "",
    createdAt: new Date(),
    note: document.getElementById("f-desc").value.trim(),
    internalNotes: "",
    result: "",
    customerVisibleNote: "",
    history: [{ time: new Date().toISOString(), text: "客户提交了异常反馈", visible: true }],
  });
  saveTickets();

  event.target.reset();
  createForm.classList.add("hidden");
  currentFilter = "all";
  document.querySelectorAll("#ticket-filters .chip").forEach((c) =>
    c.classList.toggle("active", c.dataset.status === "all")
  );
  renderTickets();
});

// ================================================================
//  运营处理模块（M3）
// ================================================================

let currentOpsUser = "王运营";
let editingTicketId = null;

const opsList = document.getElementById("ops-list");
const opsPanel = document.getElementById("ops-panel");

// 只渲染"指派给我"的工单：这就是最小权限原则
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

// 打开处理面板（先校验身份和状态，再展示表单）
function openOpsPanel(id) {
  const t = tickets.find((x) => x.id === id);
  if (!t) return;

  if (t.assignee !== currentOpsUser) {
    alert("这张工单没有指派给你，你不能处理。");
    return;
  }
  if (!canTransition(t.status, "resolved")) {
    alert("当前状态不允许提交处理结果。");
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

// 提交处理结果：状态机 + 身份 双重校验
document.getElementById("ops-form").addEventListener("submit", (event) => {
  event.preventDefault();

  const t = tickets.find((x) => x.id === editingTicketId);
  if (!t) return;

  if (t.assignee !== currentOpsUser) {
    alert("只有被分派的人可以提交处理结果。");
    return;
  }
  if (!canTransition(t.status, "resolved")) {
    alert("当前状态不允许提交处理结果。");
    return;
  }

  t.internalNotes = document.getElementById("ops-notes").value.trim();
  t.result = document.getElementById("ops-result").value.trim();
  t.status = "resolved";          // 处理中 → 待客户确认
  addHistory(t, `运营已提交处理结果：${t.result || "（未填写）"}`, false);
  saveTickets();

  closeOpsPanel();
  renderOps();
  renderTickets();
});

// 切换身份：重新渲染，列表跟着变
document.getElementById("ops-user").addEventListener("change", (event) => {
  currentOpsUser = event.target.value;
  closeOpsPanel();
  renderOps();
});

// ---------- 初始化 ----------
renderTickets();
renderOps();

// 每分钟重算一次时限，让"剩余时间"真的在走
setInterval(() => {
  renderTickets();
  renderOps();
}, 60 * 1000);
