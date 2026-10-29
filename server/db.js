// 数据库连接与建表
// 用的是 Node 24 内置的 node:sqlite，不需要额外安装任何数据库
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");

const dataDir = path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, "app.db"));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS tickets (
    id                    TEXT PRIMARY KEY,
    tracking_id           TEXT NOT NULL,
    type                  TEXT NOT NULL,
    status                TEXT NOT NULL,
    assignee              TEXT NOT NULL DEFAULT '',
    created_at            TEXT NOT NULL,
    note                  TEXT NOT NULL DEFAULT '',
    internal_notes        TEXT NOT NULL DEFAULT '',
    result                TEXT NOT NULL DEFAULT '',
    customer_visible_note TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS ticket_history (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id TEXT NOT NULL,
    time      TEXT NOT NULL,
    text      TEXT NOT NULL,
    visible   INTEGER NOT NULL DEFAULT 0
  );
`);

module.exports = db;
