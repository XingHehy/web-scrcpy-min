import { spawn } from "child_process";
import fs from "fs";
import path from "path";

console.log("🔍 检查系统依赖...\n");

// 检查工具是否安装
function checkCommand(command, args, name) {
    return new Promise((resolve) => {
        const proc = spawn(command, args);
        let output = "";

        proc.stdout.on("data", (d) => (output += d.toString()));
        proc.stderr.on("data", (d) => (output += d.toString()));

        proc.on("close", (code) => {
            if (code === 0) {
                const version = output.split("\n")[0];
                console.log(`✅ ${name}: ${version}`);
                resolve(true);
            } else {
                console.log(`❌ ${name}: 未安装或不在 PATH 中`);
                resolve(false);
            }
        });

        proc.on("error", () => {
            console.log(`❌ ${name}: 未安装或不在 PATH 中`);
            resolve(false);
        });
    });
}

async function main() {
    const adbOk = await checkCommand("adb", ["--version"], "ADB");

    console.log("\n📱 检查 ADB 设备连接...\n");

    const adbDevices = spawn("adb", ["devices"]);
    let devices = "";

    adbDevices.stdout.on("data", (d) => (devices += d.toString()));

    adbDevices.on("close", () => {
        const lines = devices.split("\n").slice(1).filter(l => l.trim());
        if (lines.length === 0) {
            console.log("⚠️  未检测到设备");
            console.log("   请确保：");
            console.log("   1. 设备已启用 USB 调试");
            console.log("   2. 设备已通过 USB 连接或 WiFi 连接");
            console.log("   3. 已在设备上授权此计算机");
        } else {
            console.log(`✅ 检测到 ${lines.length} 个设备：`);
            lines.forEach(line => {
                const [id, state] = line.trim().split("\t");
                console.log(`   - ${id} (${state})`);
            });
        }

        // 检查 scrcpy-server.jar
        console.log("\n📦 检查 scrcpy-server.jar...\n");
        const serverPath = path.resolve('scrcpy-server.jar');
        const serverExists = fs.existsSync(serverPath);

        if (serverExists) {
            const stats = fs.statSync(serverPath);
            console.log(`✅ scrcpy-server.jar: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        } else {
            console.log(`❌ scrcpy-server.jar: 未找到`);
        }

        console.log("\n" + "=".repeat(50));
        console.log("📋 诊断总结\n");

        if (adbOk && serverExists && lines.length > 0) {
            console.log("✅ 所有依赖已正确安装，可以启动服务器");
            console.log("   运行: npm start");
        } else {
            console.log("⚠️  请先解决以上问题：\n");
            if (!adbOk) console.log("   - 安装 ADB (Android Platform Tools)");
            if (!serverExists) console.log("   - 下载 scrcpy-server.jar 到项目根目录");
            if (lines.length === 0) console.log("   - 连接 Android 设备并启用 USB 调试");
        }
        console.log("=".repeat(50) + "\n");
    });
}

main();

