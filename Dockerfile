# 使用 Node.js 官方镜像作为基础镜像
FROM docker.1ms.run/library/node:20-slim

# 设置工作目录
WORKDIR /app

# 安装 ADB 和其他必要工具
RUN apt-get update && \
    apt-get install -y \
    android-tools-adb \
    android-tools-fastboot \
    curl \
    wget \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装 Node.js 依赖
RUN npm ci --only=production

# 复制项目文件
COPY . .

# 确保 scrcpy-server.jar 存在
RUN if [ ! -f "./scrcpy-server.jar" ]; then \
    echo "警告: scrcpy-server.jar 不存在，请确保在构建前已添加到项目目录"; \
    fi

# 创建 .android 目录
RUN mkdir -p /root/.android

# 复制整个项目（包含 adb-keys 目录）
# 然后检查并移动密钥文件
RUN if [ -d "./adb-keys" ] && [ -f "./adb-keys/adbkey" ]; then \
    cp ./adb-keys/adbkey /root/.android/ && \
    cp ./adb-keys/adbkey.pub /root/.android/ && \
    chmod 600 /root/.android/adbkey && \
    chmod 644 /root/.android/adbkey.pub && \
    echo "✓ 已导入预置 ADB 密钥"; \
    else \
    echo "未找到预置密钥，将在首次运行时自动生成"; \
    fi

# 复制并设置启动脚本权限
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 暴露端口 (虽然使用 host 模式，但保留作为文档说明)
EXPOSE 8280

# 设置环境变量
ENV NODE_ENV=production

# 使用启动脚本作为入口点
ENTRYPOINT ["docker-entrypoint.sh"]

