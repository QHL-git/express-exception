// 初始演示数据：只在数据库为空时写入一次
const db = require("./db");

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

const seedTickets = [
  {
    id: "GD-0001", trackingId: "SF1001", type: "延误", status: "pending",
    assignee: "", createdAt: hoursAgo(30), note: "包裹三天没有更新",
    internalNotes: "", result: "", customerVisibleNote: "",
  },
  {
    id: "GD-0002", trackingId: "SF1002", type: "物品破损", status: "processing",
    assignee: "王运营", createdAt: hoursAgo(20), note: "外包装破损，客户拒收",
    internalNotes: "已联系武汉站点确认外箱破损，正在重新打包", result: "", customerVisibleNote: "",
  },
  {
    id: "GD-0003", trackingId: "SF1002", type: "标签破损", status: "processing",
    assignee: "李运营", createdAt: hoursAgo(2), note: "面单模糊，地址无法辨认",
    internalNotes: "", result: "", customerVisibleNote: "",
  },
  {
    id: "GD-0004", trackingId: "SF1003", type: "签收争议", status: "resolved",
    assignee: "王运营", createdAt: hoursAgo(10), note: "显示已签收但客户称未收到",
    internalNotes: "监控显示快件被同楼住户代收", result: "已上门取回并重新派送",
    customerVisibleNote: "您反馈的签收问题我们已核实：快件由同楼住户代收，我们已取回并重新安排派送，预计今天送达。",
  },
  {
    id: "GD-0005", trackingId: "SF1001", type: "联系人异常", status: "closed",
    assignee: "李运营", createdAt: hoursAgo(50), note: "收件电话为空号",
    internalNotes: "三次拨打均提示空号", result: "已按寄件人地址退回",
    customerVisibleNote: "因收件电话无法接通，包裹已退回寄件人",
  },
];

const seedHistory = {
  "GD-0004": [
    { time: hoursAgo(9), text: "客户提交了异常反馈", visible: 1 },
    { time: hoursAgo(3), text: "客服已回复处理说明", visible: 1 },
  ],
  "GD-0005": [
    { time: hoursAgo(49), text: "客户提交了异常反馈", visible: 1 },
    { time: hoursAgo(20), text: "客服已回复处理说明", visible: 1 },
    { time: hoursAgo(18), text: "客户确认问题已解决，工单关闭", visible: 1 },
  ],
};

function run() {
  const existing = db.prepare("SELECT COUNT(*) AS c FROM tickets").get().c;
  if (existing > 0) return;

  const insertTicket = db.prepare(`
    INSERT INTO tickets (id, tracking_id, type, status, assignee, created_at, note, internal_notes, result, customer_visible_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertHistory = db.prepare(`
    INSERT INTO ticket_history (ticket_id, time, text, visible) VALUES (?, ?, ?, ?)
  `);

  for (const t of seedTickets) {
    insertTicket.run(
      t.id, t.trackingId, t.type, t.status, t.assignee,
      t.createdAt, t.note, t.internalNotes, t.result, t.customerVisibleNote
    );

    for (const h of seedHistory[t.id] || []) {
      insertHistory.run(t.id, h.time, h.text, h.visible);
    }
  }

  console.log(`已写入 ${seedTickets.length} 条工单`);
}

module.exports = { run };
