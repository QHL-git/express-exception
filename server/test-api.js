// 接口测试脚本：node test-api.js
const base = "http://localhost:3000";

async function call(label, path, body) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.text();
  console.log(`\n${label}`);
  console.log(`  HTTP ${res.status}  ${data.slice(0, 200)}`);
}

(async () => {
  await call("不存在的运单", "/api/tickets", { trackingId: "SF9999", type: "延误", note: "x" });
  await call("非法类型", "/api/tickets", { trackingId: "SF1001", type: "随便写", note: "x" });
  await call("描述超长", "/api/tickets", { trackingId: "SF1001", type: "延误", note: "a".repeat(201) });
  await call("正常提交", "/api/tickets", { trackingId: "SF1003", type: "延误", note: "客户从页面提交" });
})();
