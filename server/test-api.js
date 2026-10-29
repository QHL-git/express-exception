// 接口测试脚本：先启动服务，再执行 node test-api.js
const base = "http://localhost:3000";

let passed = 0;
let failed = 0;

async function api(path, { method = "GET", body, token } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(base + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, text };
}

function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "✅" : "❌"} ${label}  期望 ${expected}，实际 ${actual}`);
}

async function login(username, password = "123456") {
  const res = await api("/api/auth/login", { method: "POST", body: { username, password } });
  return res.status === 200 ? JSON.parse(res.text).token : null;
}

(async () => {
  // 1. 未登录
  check("未登录访问工单列表", (await api("/api/tickets")).status, 401);

  // 2. 错误密码
  check(
    "错误密码登录",
    (await api("/api/auth/login", { method: "POST", body: { username: "customer", password: "bad" } })).status,
    401
  );

  // 3. 各角色登录
  const customer = await login("customer");
  const agent = await login("agent");
  const opsWang = await login("wang");
  const opsLi = await login("li");
  check("客户登录", customer ? 200 : 0, 200);
  check("客服登录", agent ? 200 : 0, 200);
  check("运营登录", opsWang && opsLi ? 200 : 0, 200);

  // 4. 客户视角
  const customerList = await api("/api/tickets", { token: customer });
  check("客户可查询自己的工单", customerList.status, 200);
  check("客户不能指派工单", (await api("/api/tickets/GD-0001/assign", { method: "POST", body: { assignee: "王运营" }, token: customer })).status, 403);

  // 5. 客服指派
  check("客服可以指派", (await api("/api/tickets/GD-0001/assign", { method: "POST", body: { assignee: "王运营" }, token: agent })).status, 200);

  // 6. 运营提交（GD-0001 现在指派给王运营）
  check(
    "李运营提交别人工单",
    (await api("/api/tickets/GD-0001/result", { method: "POST", body: { result: "越权" }, token: opsLi })).status,
    403
  );
  check(
    "王运营提交自己的工单",
    (await api("/api/tickets/GD-0001/result", { method: "POST", body: { internalNotes: "已联系站点", result: "重新派送" }, token: opsWang })).status,
    200
  );

  // 7. 客户确认
  check("客户确认解决", (await api("/api/tickets/GD-0001/confirm", { method: "POST", token: customer })).status, 200);

  console.log(`\n通过 ${passed}，失败 ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
})();
