// 后端入口：Express 服务器
const express = require("express");
const path = require("node:path");

const db = require("./db");
const shipments = require("./shipments");
const seed = require("./seed");

seed.run();   // 首次启动时写入演示数据

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// ==================== 状态机（服务端也要有一份） ====================
// 前端那份只负责体验，真正防止非法流转的是这里
const TRANSITIONS = {
  pending: ["processing"],
  processing: ["resolved"],
  resolved: ["closed", "processing"],
  closed: [],
};

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

// ==================== 数据库小工具 ====================
function toTicket(row) {
  return {
    id: row.id,
    trackingId: row.tracking_id,
    type: row.type,
    status: row.status,
    assignee: row.assignee,
    createdAt: row.created_at,
    note: row.note,
    internalNotes: row.internal_notes,
    result: row.result,
    customerVisibleNote: row.customer_visible_note,
    history: historyOf(row.id),
  };
}

function historyOf(ticketId) {
  return db
    .prepare("SELECT time, text, visible FROM ticket_history WHERE ticket_id = ? ORDER BY time ASC")
    .all(ticketId)
    .map((h) => ({ time: h.time, text: h.text, visible: Boolean(h.visible) }));
}

function findTicket(id) {
  const row = db.prepare("SELECT * FROM tickets WHERE id = ?").get(id);
  return row ? toTicket(row) : null;
}

function addHistory(ticketId, text, visible) {
  db.prepare("INSERT INTO ticket_history (ticket_id, time, text, visible) VALUES (?, ?, ?, ?)")
    .run(ticketId, new Date().toISOString(), text, visible ? 1 : 0);
}

function nextTicketId() {
  const row = db.prepare("SELECT id FROM tickets ORDER BY id DESC LIMIT 1").get();
  const last = row ? Number(String(row.id).replace("GD-", "")) : 0;
  return "GD-" + String(last + 1).padStart(4, "0");
}

// ==================== 查询接口 ====================
app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get("/api/shipments/:id", (req, res) => {
  const shipment = shipments[req.params.id.toUpperCase()];
  if (!shipment) return res.status(404).json({ error: "运单不存在" });
  res.json(shipment);
});

app.get("/api/tickets", (req, res) => {
  const conditions = [];
  const params = [];

  if (req.query.status) {
    conditions.push("status = ?");
    params.push(String(req.query.status));
  }
  if (req.query.assignee) {
    conditions.push("assignee = ?");
    params.push(String(req.query.assignee));
  }
  if (req.query.trackingId) {
    conditions.push("tracking_id = ?");
    params.push(String(req.query.trackingId).toUpperCase());
  }

  let sql = "SELECT * FROM tickets";
  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY created_at DESC";

  res.json(db.prepare(sql).all(...params).map(toTicket));
});

app.get("/api/tickets/:id", (req, res) => {
  const ticket = findTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: "工单不存在" });
  res.json(ticket);
});

// ==================== 写接口 ====================
// 建工单（客户提交异常反馈）
app.post("/api/tickets", (req, res) => {
  const trackingId = String(req.body.trackingId || "").trim().toUpperCase();
  const type = String(req.body.type || "").trim();
  const note = String(req.body.note || "").trim();

  if (!trackingId) return res.status(400).json({ error: "缺少运单号" });
  if (!type) return res.status(400).json({ error: "缺少异常类型" });

  const id = nextTicketId();
  db.prepare(`
    INSERT INTO tickets (id, tracking_id, type, status, assignee, created_at, note)
    VALUES (?, ?, ?, 'pending', '', ?, ?)
  `).run(id, trackingId, type, new Date().toISOString(), note);

  addHistory(id, "客户提交了异常反馈", true);
  res.status(201).json(findTicket(id));
});

// 指派（客服操作）
app.post("/api/tickets/:id/assign", (req, res) => {
  const ticket = findTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: "工单不存在" });

  const assignee = String(req.body.assignee || "").trim();
  if (!assignee) return res.status(400).json({ error: "缺少处理人" });

  if (!canTransition(ticket.status, "processing")) {
    return res.status(409).json({ error: `状态 ${ticket.status} 不能指派` });
  }

  db.prepare("UPDATE tickets SET status = 'processing', assignee = ? WHERE id = ?")
    .run(assignee, ticket.id);
  addHistory(ticket.id, `客服已创建工单并分派给 ${assignee}`, false);

  res.json(findTicket(ticket.id));
});

// 提交处理结果（运营操作，必须是被分派人）
app.post("/api/tickets/:id/result", (req, res) => {
  const ticket = findTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: "工单不存在" });

  // 关键：服务端校验身份。前端那层校验可以被绕过，这层不行
  // 注意：身份放在请求体里，不放请求头——HTTP 头只允许 ASCII，中文会被编码破坏
  const operator = String(req.body.operator || req.get("x-operator") || "").trim();
  if (!operator || operator !== ticket.assignee) {
    return res.status(403).json({ error: "只有被分派的运营人员可以提交处理结果" });
  }

  if (!canTransition(ticket.status, "resolved")) {
    return res.status(409).json({ error: `状态 ${ticket.status} 不能提交结果` });
  }

  const internalNotes = String(req.body.internalNotes || "").trim();
  const result = String(req.body.result || "").trim();

  db.prepare(`
    UPDATE tickets SET status = 'resolved', internal_notes = ?, result = ? WHERE id = ?
  `).run(internalNotes, result, ticket.id);

  addHistory(ticket.id, `运营已提交处理结果：${result || "（未填写）"}`, false);
  res.json(findTicket(ticket.id));
});

// 生成对外说明（客服操作）
app.post("/api/tickets/:id/explain", (req, res) => {
  const ticket = findTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: "工单不存在" });

  const text = String(req.body.text || "").trim();
  if (!text) return res.status(400).json({ error: "说明内容不能为空" });

  db.prepare("UPDATE tickets SET customer_visible_note = ? WHERE id = ?").run(text, ticket.id);
  addHistory(ticket.id, "客服已回复处理说明", true);

  res.json(findTicket(ticket.id));
});

// 客户确认解决
app.post("/api/tickets/:id/confirm", (req, res) => {
  const ticket = findTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: "工单不存在" });

  if (!canTransition(ticket.status, "closed")) {
    return res.status(409).json({ error: "当前状态不能关闭" });
  }

  db.prepare("UPDATE tickets SET status = 'closed' WHERE id = ?").run(ticket.id);
  addHistory(ticket.id, "客户确认问题已解决，工单关闭", true);

  res.json(findTicket(ticket.id));
});

// 客户不认可：退回处理中，旧说明作废，但内部记录保留
app.post("/api/tickets/:id/reject", (req, res) => {
  const ticket = findTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: "工单不存在" });

  if (!canTransition(ticket.status, "processing")) {
    return res.status(409).json({ error: "当前状态不能退回" });
  }

  db.prepare("UPDATE tickets SET status = 'processing', customer_visible_note = '' WHERE id = ?")
    .run(ticket.id);
  addHistory(ticket.id, "客户不认可处理结果，工单退回重新处理", true);

  res.json(findTicket(ticket.id));
});

// 统一错误处理
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "服务器内部错误" });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`API 已启动：http://localhost:${port}`);
  console.log(`前端页面：  http://localhost:${port}/index.html`);
});
