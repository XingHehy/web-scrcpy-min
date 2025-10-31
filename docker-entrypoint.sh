#!/bin/bash
set -e

echo "=================================================="
echo "        web-scrcpy Docker 容器启动"
echo "=================================================="

# 检查 ADB 密钥
ADB_KEY_PATH="/root/.android/adbkey"

if [ -f "$ADB_KEY_PATH" ]; then
    echo "[✓] 使用预置的 ADB 密钥"
    echo "    设备应该已经授权过此密钥，可以直接连接"
    ls -lh /root/.android/adbkey* 2>/dev/null
else
    echo "[INFO] 未找到预置密钥，正在生成新密钥..."
    mkdir -p /root/.android
    
    # 生成新密钥
    adb start-server 2>/dev/null || true
    sleep 2
    adb kill-server 2>/dev/null || true
    
    if [ -f "$ADB_KEY_PATH" ]; then
        echo "[✓] 新密钥已生成"
        chmod 600 "$ADB_KEY_PATH"
        chmod 644 "${ADB_KEY_PATH}.pub"
        echo ""
        echo "[!] 重要：首次连接设备时需要授权"
        echo "    1. 设备会弹出授权对话框"
        echo "    2. 勾选'始终允许'并点击'允许'"
    fi
fi

echo ""
echo "=================================================="
echo "[INFO] 启动 web-scrcpy 服务..."
echo "=================================================="
echo ""

exec node server.js

