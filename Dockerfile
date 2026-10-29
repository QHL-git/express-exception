# 生产镜像：Node 24 + 内置 SQLite，无需额外数据库
FROM node:24-slim

WORKDIR /app

# 先装依赖，利用 Docker 层缓存（package.json 没变就不重复安装）
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

# 再拷源码
COPY server ./server
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

# 数据库文件放在这里，部署时请挂载持久卷，否则重启会丢数据
VOLUME ["/app/data"]

EXPOSE 3000

CMD ["node", "server/index.js"]
