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

// ============ 查询 ============
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