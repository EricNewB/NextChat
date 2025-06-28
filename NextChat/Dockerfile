# --- Builder Stage ---
# 使用一个包含 git 的基础镜像
FROM docker.m.daocloud.io/library/node:18-alpine AS builder

# 设置 Alpine 包管理器使用阿里云镜像源，并安装 git
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories && \
    apk add --no-cache git

# 在容器内克隆您的仓库，这使得构建过程完全独立，绕开阿里云的文件系统问题
RUN git clone https://github.com/EricNewB/NextChat.git /build

# 设置工作目录为项目文件夹
WORKDIR /build/NextChat

# 设置 npm 镜像源并安装依赖
RUN yarn config set registry 'https://registry.npmmirror.com/' && \
    yarn install

# 执行构建
RUN yarn build


# --- Runner Stage ---
# 使用一个干净的 Node.js 镜像作为最终运行环境
FROM docker.m.daocloud.io/library/node:18-alpine AS runner

# 设置 Alpine 包管理器使用阿里云镜像源，并安装必要的工具
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories && \
    apk add --no-cache proxychains-ng libc6-compat

# 设置最终的工作目录
WORKDIR /app

# 从 builder 阶段复制构建好的产物到当前阶段
COPY --from=builder /build/NextChat/public ./public
COPY --from=builder /build/NextChat/.next/standalone ./
COPY --from=builder /build/NextChat/.next/static ./.next/static
COPY --from=builder /build/NextChat/.next/server ./.next/server

# 创建并设置 MCP 目录的权限
RUN mkdir -p /app/app/mcp && chmod 777 /app/app/mcp
# 复制 MCP 配置文件
COPY --from=builder /build/NextChat/app/mcp/mcp_config.default.json /app/app/mcp/mcp_config.json

# 暴露端口
EXPOSE 3000

# 保持环境变量和启动命令不变
ENV PROXY_URL=""
ENV OPENAI_API_KEY=""
ENV GOOGLE_API_KEY=""
ENV CODE=""
ENV ENABLE_MCP=""

CMD if [ -n "$PROXY_URL" ]; then \
    export HOSTNAME="0.0.0.0"; \
    protocol=$(echo $PROXY_URL | cut -d: -f1); \
    host=$(echo $PROXY_URL | cut -d/ -f3 | cut -d: -f1); \
    port=$(echo $PROXY_URL | cut -d: -f3); \
    conf=/etc/proxychains.conf; \
    echo "strict_chain" > $conf; \
    echo "proxy_dns" >> $conf; \
    echo "remote_dns_subnet 224" >> $conf; \
    echo "tcp_read_time_out 15000" >> $conf; \
    echo "tcp_connect_time_out 8000" >> $conf; \
    echo "localnet 127.0.0.0/255.0.0.0" >> $conf; \
    echo "localnet ::1/128" >> $conf; \
    echo "[ProxyList]" >> $conf; \
    echo "$protocol $host $port" >> $conf; \
    cat /etc/proxychains.conf; \
    proxychains -f $conf node server.js; \
    else \
    node server.js; \
    fi