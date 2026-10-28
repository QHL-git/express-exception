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
  result.innerHTML = renderShipment(shipment);
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
  { id: "GD-0001", trackingId: "SF1001", type: "延误", status: "pending", assignee: "", createdAt: hoursAgo(30), note: "包裹三天没有更新" },
  { id: "GD-0002", trackingId: "SF1002", type: "物品破损", status: "processing", assignee: "王运营", createdAt: hoursAgo(20), note: "外包装破损，客户拒收" },
  { id: "GD-0003", trackingId: "SF1002", type: "标签破损", status: "processing", assignee: "李运营", createdAt: hoursAgo(2), note: "面单模糊，地址无法辨认" },
  { id: "GD-0004", trackingId: "SF1003", type: "签收争议", status: "resolved", assignee: "王运营", createdAt: hoursAgo(10), note: "显示已签收但客户称未收到" },
  { id: "GD-0005", trackingId: "SF1001", type: "联系人异常", status: "closed", assignee: "李运营", createdAt: hoursAgo(50), note: "收件电话为空号" },
];

let ticketSeq = 6;
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

  const action =
    t.status === "pending"
      ? `<button class="btn small" data-assign="${t.id}">指派</button>`
      : `<span class="empty">—</span>`;

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

// ---------- 交互：指派 ----------
ticketBody.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-assign]");
  if (!btn) return;
  assignTicket(btn.dataset.assign);
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
  renderTickets();
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
  });

  event.target.reset();
  createForm.classList.add("hidden");
  currentFilter = "all";
  document.querySelectorAll("#ticket-filters .chip").forEach((c) =>
    c.classList.toggle("active", c.dataset.status === "all")
  );
  renderTickets();
});

// ---------- 初始化 ----------
renderTickets();

// 每分钟重算一次时限，让"剩余时间"真的在走
setInterval(renderTickets, 60 * 1000);
