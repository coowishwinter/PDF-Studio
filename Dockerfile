# 第一阶段：构建前端静态文件
FROM node:20-alpine AS builder
WORKDIR /app

# 复制依赖声明文件并进行安装
COPY package.json ./
RUN npm install

# 复制其余源码并编译
COPY . .
RUN npm run build

# 第二阶段：使用轻量级 Nginx 服务器提供网页服务
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html

# 暴露常用的 80 端口
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
