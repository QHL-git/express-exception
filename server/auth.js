// 密码哈希与 JWT 签发/校验
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");

// 生产环境必须从环境变量读取，并且是随机长字符串
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-secret-change-in-production";
const TOKEN_TTL = "7d";

// 密码绝不明文存储。scrypt 是 Node 内置的慢哈希算法，专门用来抗暴力破解
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const computed = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(expectedHash, "hex");
  // 等长比较 + timingSafeEqual，避免通过响应时间猜密码
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// JWT 里只放"身份"，不放密码等敏感信息——payload 是 Base64，任何人都能解出来
function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.display_name },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;   // 过期、签名不对、格式错，一律视为无效
  }
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken };
