// 后端入口：Express 服务器
const express = require("express");
const path = require("node:path");

const db = require("./db");
const shipments = require("./shipments");
const seed = require("./seed");
const auth = require("./auth");

seed.run();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// ==================== 状态机 ====================
const TRANSITIONS = {
  pending: ["processing"],
  processing: ["resolved"],
  resolved: ["closed", "processing"],
  closed: [],
};

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

const EXCEPTION_TYPES = ["延误", "物品破损", "标签破损", "联系人异常", "签收争议"];

// ==================== 鉴权 ====================
// 身份来自 JWT，不再相信请求体里的任何"我是谁"
function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const payload = token ? auth.verifyToken(token) : null;

  if (!payload) {
    return res.status(401).json({ error: "未登录或登录已过期" });
  }

  req.user = { id: payload.sub, role: payload.role, name: payload.name };
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "没有权限执行该操作" });
    }
    next();
  };
}

// ==================== 数据库小工具 ====================
function toTicket(row) {
  return {
    id: row.id,
    trackingId: row.tracking_id,
    customerId: row.customer_id,
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

// ==================== 登录 ====================
app.post("/api/auth/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (!username || !password) {
    return res.status(400).json({ error: "请输入账号和密码" });
  }

  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username);

  // 账号不存在时也返回同一句错误，避免泄露"哪些账号存在"
  const ok = row ? auth.verifyPassword(password, row.password_salt, row.password_hash) : false;
  if (!ok) {
    return res.status(401).json({ error: "账号或密码错误" });
  }

  res.json({
    token: auth.signToken(row),
    user: { id: row.id, username: row.username, name: row.display_name, role: row.role },
  });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ==================== 查询接口 ====================
app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get("/api/shipments/:id", requireAuth, (req, res) => {
  const shipment = shipments[req.params.id.toUpperCase()];
  if (!shipment) return res.status(404).json({ error: "运单不存在" });
  res.json(shipment);
});

// 工单列表：不同角色看到的数据范围不同
app.get("/api/tickets", requireAuth, (req, res) => {
  const conditions = [];
  const params = [];

  if (req.user.role === "customer") {
    // 客户只能看自己提的工单
    conditions.push("customer_id = ?");
    params.push(req.user.id);
  }
  if (req.user.role === "ops") {
    // 运营只能看指派给自己的
    conditions.push("assignee = ?");
    params.push(req.user.name);
  }

  if (req.query.status) {
    conditions.push("status = ?");
    params.push(String(req.query.status));
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

app.get("/api/tickets/:id", requireAuth, (req, res) => {
  const ticket = findTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: "工单不存在" });

  if (req.user.role === "customer" && ticket.customerId !== req.user.id) {
    return res.status(403).json({ error: "无权查看该工单" });
  }

  res.json(ticket);
});

// ==================== 写接口 ====================
// 建工单（客户提交异常反馈）
app.post("/api/tickets", requireAuth, requireRole("customer", "agent"), (req, res) => {
  const trackingId = String(req.body.trackingId || "").trim().toUpperCase();
  const type = String(req.body.type || "").trim();
  const note = String(req.body.note || "").trim();

  if (!trackingId) return res.status(400).json({ error: "缺少运单号" });
  if (!shipments[trackingId]) return res.status(400).json({ error: "运单不存在，请核对单号" });
  if (!EXCEPTION_TYPES.includes(type)) return res.status(400).json({ error: "异常类型不合法" });
  if (note.length > 200) return res.status(400).json({ error: "问题描述不能超过 200 字" });

  const id = nextTicketId();
  db.prepare(`
    INSERT INTO tickets (id, tracking_id, customer_id, type, status, assignee, created_at, note)
    VALUES (?, ?, ?, ?, 'pending', '', ?, ?)
  `).run(id, trackingId, req.user.role === "customer" ? req.user.id : "", type, new Date().toISOString(), note);

  addHistory(id, "客户提交了异常反馈", true);
  res.status(201).json(findTicket(id));
});

// 指派（客服）
app.post("/api/tickets/:id/assign", requireAuth, requireRole("agent"), (req, res) => {
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

// 提交处理结果（运营，且必须是被分派人）
app.post("/api/tickets/:id/result", requireAuth, requireRole("ops"), (req, res) => {
  const ticket = findTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: "工单不存在" });

  // 身份取自 token，客户端无法伪造
  if (ticket.assignee !== req.user.name) {
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

// 生成对外说明（客服）
app.post("/api/tickets/:id/explain", requireAuth, requireRole("agent"), (req, res) => {
  const ticket = findTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: "工单不存在" });

  const text = String(req.body.text || "").trim();
  if (!text) return res.status(400).json({ error: "说明内容不能为空" });

  db.prepare("UPDATE tickets SET customer_visible_note = ? WHERE id = ?").run(text, ticket.id);
  addHistory(ticket.id, "客服已回复处理说明", true);

  res.json(findTicket(ticket.id));
});

// 客户确认解决
app.post("/api/tickets/:id/confirm", requireAuth, requireRole("customer"), (req, res) => {
  const ticket = findTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: "工单不存在" });
  if (ticket.customerId !== req.user.id) return res.status(403).json({ error: "无权操作该工单" });

  if (!canTransition(ticket.status, "closed")) {
    return res.status(409).json({ error: "当前状态不能关闭" });
  }

  db.prepare("UPDATE tickets SET status = 'closed' WHERE id = ?").run(ticket.id);
  addHistory(ticket.id, "客户确认问题已解决，工单关闭", true);

  res.json(findTicket(ticket.id));
});

// 客户不认可：退回处理中，旧说明作废，内部记录保留
app.post("/api/tickets/:id/reject", requireAuth, requireRole("customer"), (req, res) => {
  const ticket = findTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: "工单不存在" });
  if (ticket.customerId !== req.user.id) return res.status(403).json({ error: "无权操作该工单" });

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
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "请求体不是合法的 JSON" });
  }
  console.error(err);
  res.status(500).json({ error: "服务器内部错误" });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`API 已启动：http://localhost:${port}`);
  console.log(`前端页面：  http://localhost:${port}/index.html`);
});
