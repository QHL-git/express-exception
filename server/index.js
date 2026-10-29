// 后端入口：Express 服务器
const express = require("express");
const path = require("node:path");

const db = require("./db");
const shipments = require("./shipments");
const seed = require("./seed");

seed.run();   // 首次启动时写入演示数据

const app = express();

app.use(express.json());                                   // 解析 JSON 请求体
app.use(express.static(path.join(__dirname, "..", "public")));  // 顺便把前端也托管了

// ---------- 数据库行 → 前端要的对象 ----------
// 数据库里是 snake_case，前端习惯 camelCase，这里做一次转换
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

// ---------- 接口 ----------
app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// 运单查询
app.get("/api/shipments/:id", (req, res) => {
  const shipment = shipments[req.params.id.toUpperCase()];
  if (!shipment) {
    return res.status(404).json({ error: "运单不存在" });
  }
  res.json(shipment);
});

// 工单列表，支持 ?status=pending 和 ?assignee=王运营
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

  let sql = "SELECT * FROM tickets";
  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY created_at DESC";

  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(toTicket));
});

// 单个工单
app.get("/api/tickets/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM tickets WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "工单不存在" });
  res.json(toTicket(row));
});

// 统一错误处理（放在所有路由后面）
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "服务器内部错误" });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`API 已启动：http://localhost:${port}`);
  console.log(`前端页面：  http://localhost:${port}/index.html`);
});
