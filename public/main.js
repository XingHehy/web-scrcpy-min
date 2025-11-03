const video = document.getElementById("screen");
const deviceListEl = document.getElementById("device-list");
const refreshBtn = document.getElementById("refresh");
const statusEl = document.getElementById("status");
const bitrateInput = document.getElementById("bitrate-input");
const bitrateUnit = document.getElementById("bitrate-unit");
const resolutionSelect = document.getElementById("resolution-select");
const fpsSelect = document.getElementById("fps-select");

let ws = null;
let screenWidth = 0;
let screenHeight = 0;
let frameCount = 0;
let currentDeviceId = null; // 保存当前连接的设备ID
let isConnected = false; // 连接状态标志
let allDevices = []; // 存储所有设备
let currentFilter = 'all'; // 当前过滤器
let isLoggedIn = false; // 登录状态
let authToken = null; // 认证 token

// 性能统计
let fpsCounter = 0;
let lastFpsTime = Date.now();
let currentFps = 0;
let totalFrames = 0;
let startTime = 0;
let bytesReceived = 0;
let lastBytesTime = Date.now();
let currentBitrate = 0;
let totalBytesReceived = 0;

// 检查登录状态
function checkLoginStatus() {
  const token = sessionStorage.getItem('scrcpy-auth-token');
  if (token) {
    authToken = token;
    isLoggedIn = true;
    document.getElementById('login-overlay').style.display = 'none';
  }
}

// 获取认证请求头
function getAuthHeaders() {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  return headers;
}

// 处理登录
async function handleLogin(event) {
  event.preventDefault();
  const passwordInput = document.getElementById('password-input');
  const loginError = document.getElementById('login-error');
  const password = passwordInput.value;

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password })
    });

    const data = await response.json();

    if (data.success && data.token) {
      authToken = data.token;
      isLoggedIn = true;
      sessionStorage.setItem('scrcpy-auth-token', data.token);
      document.getElementById('login-overlay').style.display = 'none';
      showStatus('登录成功', 'success');
      fetchDevices(); // 登录后加载设备列表
    } else {
      loginError.textContent = data.message || '密码错误';
      loginError.style.display = 'block';
      passwordInput.value = '';
      passwordInput.focus();
    }
  } catch (error) {
    console.error('Login error:', error);
    loginError.textContent = '登录失败，请检查网络连接';
    loginError.style.display = 'block';
  }
}

// 连接设备
async function connectDevice() {
  const input = document.getElementById('device-address-input');
  const address = input.value.trim();

  if (!address) {
    showStatus('请输入设备地址', 'error');
    return;
  }

  try {
    showStatus('正在连接设备...', 'info');
    const response = await fetch('/api/connect', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ address })
    });

    const data = await response.json();

    if (data.success) {
      showStatus(data.message, 'success');
      input.value = '';
      // 等待一下再刷新设备列表
      setTimeout(() => fetchDevices(), 1000);
    } else {
      showStatus(data.message, 'error');
    }
  } catch (error) {
    console.error('Connect error:', error);
    showStatus('连接失败，请检查网络', 'error');
  }
}

// 断开设备
async function disconnectDevice() {
  const input = document.getElementById('device-address-input');
  const address = input.value.trim();

  if (!address) {
    showStatus('请输入设备地址', 'error');
    return;
  }

  try {
    showStatus('正在断开设备...', 'info');
    const response = await fetch('/api/disconnect', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ address })
    });

    const data = await response.json();

    if (data.success) {
      showStatus(data.message, 'success');
      input.value = '';
      // 等待一下再刷新设备列表
      setTimeout(() => fetchDevices(), 1000);
    } else {
      showStatus(data.message, 'error');
    }
  } catch (error) {
    console.error('Disconnect error:', error);
    showStatus('断开失败，请检查网络', 'error');
  }
}

// 从 localStorage 加载设置
function loadSettings() {
  // 清除旧的模式设置（已废弃）
  localStorage.removeItem('scrcpy-mode');

  const savedBitrateValue = localStorage.getItem('scrcpy-bitrate-value');
  const savedBitrateUnit = localStorage.getItem('scrcpy-bitrate-unit');
  const savedResolution = localStorage.getItem('scrcpy-resolution');
  const savedFps = localStorage.getItem('scrcpy-fps');

  if (savedBitrateValue) bitrateInput.value = savedBitrateValue;
  if (savedBitrateUnit) bitrateUnit.value = savedBitrateUnit;
  if (savedResolution) resolutionSelect.value = savedResolution;
  if (savedFps) fpsSelect.value = savedFps;
}

// 保存设置到 localStorage
function saveSettings() {
  localStorage.setItem('scrcpy-bitrate-value', bitrateInput.value);
  localStorage.setItem('scrcpy-bitrate-unit', bitrateUnit.value);
  localStorage.setItem('scrcpy-resolution', resolutionSelect.value);
  localStorage.setItem('scrcpy-fps', fpsSelect.value);
}

// 获取实际比特率值（bps）
function getBitrateValue() {
  const value = parseFloat(bitrateInput.value) || 2;
  const unit = parseInt(bitrateUnit.value);
  return Math.round(value * unit);
}

// 监听码率、分辨率和帧率变化
bitrateInput.addEventListener('change', () => {
  saveSettings();
  // 如果已连接设备，重新连接
  if (currentDeviceId && ws && ws.readyState === WebSocket.OPEN) {
    showStatus("参数已更改，正在重新连接...", "info");
    startScrcpy(currentDeviceId);
  }
});

bitrateUnit.addEventListener('change', () => {
  saveSettings();
  // 如果已连接设备，重新连接
  if (currentDeviceId && ws && ws.readyState === WebSocket.OPEN) {
    showStatus("参数已更改，正在重新连接...", "info");
    startScrcpy(currentDeviceId);
  }
});

resolutionSelect.addEventListener('change', () => {
  saveSettings();
  // 如果已连接设备，重新连接
  if (currentDeviceId && ws && ws.readyState === WebSocket.OPEN) {
    showStatus("参数已更改，正在重新连接...", "info");
    startScrcpy(currentDeviceId);
  }
});

fpsSelect.addEventListener('change', () => {
  saveSettings();
  // 如果已连接设备，重新连接
  if (currentDeviceId && ws && ws.readyState === WebSocket.OPEN) {
    showStatus("参数已更改，正在重新连接...", "info");
    startScrcpy(currentDeviceId);
  }
});

// H264 解码相关
let videoDecoder = null;
let canvas = null;
let ctx = null;
let h264Timestamp = 0;

// 触摸/鼠标状态
let isDragging = false;
let startX = 0;
let startY = 0;
let lastTouchTime = 0;
let longPressTimer = null; // 长按计时器
let longPressTriggered = false; // 长按是否已触发
const LONG_PRESS_DURATION = 500; // 长按触发时间（毫秒）

// 显示状态消息
function showStatus(message, type = "info") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  statusEl.style.display = "block";

  if (type !== "error") {
    setTimeout(() => {
      statusEl.style.display = "none";
    }, 3000);
  }
}

// 获取设备列表
async function fetchDevices() {
  try {
    const res = await fetch("/devices", {
      headers: getAuthHeaders()
    });

    // 检查是否未授权
    if (res.status === 401) {
      showStatus('登录已过期，请重新登录', 'error');
      sessionStorage.removeItem('scrcpy-auth-token');
      authToken = null;
      isLoggedIn = false;
      document.getElementById('login-overlay').style.display = 'flex';
      return;
    }

    const data = await res.json();
    allDevices = data.devices;

    if (allDevices.length === 0) {
      deviceListEl.innerHTML = '<div class="loading">未检测到设备，请检查 ADB 连接</div>';
      updateDeviceCounts(0, 0, 0);
      return;
    }

    // 统计设备数量
    const totalCount = allDevices.length;
    const onlineCount = allDevices.filter(d => d.state === "device").length;
    const offlineCount = allDevices.filter(d => d.state === "offline").length;

    // 更新设备统计显示
    updateDeviceCounts(totalCount, onlineCount, offlineCount);

    // 显示设备列表
    renderDevices();

    showStatus(`找到 ${allDevices.length} 个设备`, "success");
  } catch (e) {
    console.error("Failed to fetch devices:", e);
    showStatus("无法获取设备列表，请检查服务器连接", "error");
    updateDeviceCounts(0, 0, 0);
  }
}

// 更新设备数量统计
function updateDeviceCounts(total, online, offline) {
  document.getElementById("count-all").textContent = total;
  document.getElementById("count-online").textContent = online;
  document.getElementById("count-offline").textContent = offline;
}

// 渲染设备列表
function renderDevices() {
  deviceListEl.innerHTML = "";

  let devicesToShow = allDevices;

  // 根据当前过滤器筛选设备
  if (currentFilter === 'online') {
    devicesToShow = allDevices.filter(d => d.state === "device");
  } else if (currentFilter === 'offline') {
    devicesToShow = allDevices.filter(d => d.state === "offline");
  }

  if (devicesToShow.length === 0) {
    const filterText = currentFilter === 'online' ? '在线' : currentFilter === 'offline' ? '离线' : '';
    deviceListEl.innerHTML = `<div class="loading">没有${filterText}设备</div>`;
    return;
  }

  devicesToShow.forEach((dev) => {
    const btn = document.createElement("button");
    btn.className = "device-btn";
    // 如果是当前连接的设备，添加选中状态
    if (currentDeviceId === dev.id) {
      btn.classList.add("selected");
    }
    btn.textContent = `${dev.id} (${dev.state})`;
    btn.disabled = dev.state !== "device";
    btn.onclick = () => startScrcpy(dev.id);
    deviceListEl.appendChild(btn);
  });
}

// 存储 SPS 和 PPS
let spsData = null;
let ppsData = null;
let waitingForKeyFrame = false; // 配置后等待关键帧

// 提取 NAL unit
function extractNALUnit(data, startIndex) {
  // 找到下一个起始码
  for (let i = startIndex + 4; i < data.length - 3; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {
      return data.slice(startIndex + 4, i);
    }
  }
  // 如果没找到下一个起始码，返回到末尾
  return data.slice(startIndex + 4);
}

// 创建 avcC 格式的 description
function createAvcCDescription(sps, pps) {
  const avcC = new Uint8Array(11 + sps.length + pps.length);
  let offset = 0;

  avcC[offset++] = 1; // configurationVersion
  avcC[offset++] = sps[1]; // AVCProfileIndication
  avcC[offset++] = sps[2]; // profile_compatibility
  avcC[offset++] = sps[3]; // AVCLevelIndication
  avcC[offset++] = 0xFF; // lengthSizeMinusOne (4 bytes)
  avcC[offset++] = 0xE1; // numOfSequenceParameterSets (1)

  // SPS length (big endian)
  avcC[offset++] = (sps.length >> 8) & 0xFF;
  avcC[offset++] = sps.length & 0xFF;

  // SPS data
  avcC.set(sps, offset);
  offset += sps.length;

  // numOfPictureParameterSets
  avcC[offset++] = 1;

  // PPS length (big endian)
  avcC[offset++] = (pps.length >> 8) & 0xFF;
  avcC[offset++] = pps.length & 0xFF;

  // PPS data
  avcC.set(pps, offset);

  return avcC;
}

// 将 Annex B 格式转换为 AVCC 格式（起始码 -> 长度前缀）
function annexBToAvcc(data) {
  const result = [];
  let i = 0;

  while (i < data.length) {
    // 查找起始码
    if (i + 3 < data.length &&
      data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {

      // 找到下一个起始码或数据末尾
      let nextStart = data.length;
      for (let j = i + 4; j < data.length - 3; j++) {
        if (data[j] === 0 && data[j + 1] === 0 && data[j + 2] === 0 && data[j + 3] === 1) {
          nextStart = j;
          break;
        }
      }

      // NAL unit 数据（不包括起始码）
      const nalUnit = data.slice(i + 4, nextStart);
      const nalLength = nalUnit.length;

      // 写入长度（4字节，大端序）
      result.push((nalLength >> 24) & 0xFF);
      result.push((nalLength >> 16) & 0xFF);
      result.push((nalLength >> 8) & 0xFF);
      result.push(nalLength & 0xFF);

      // 写入 NAL unit 数据
      result.push(...nalUnit);

      i = nextStart;
    } else {
      i++;
    }
  }

  return new Uint8Array(result);
}

// 初始化 H264 解码器（WebCodecs）
function initH264Decoder() {
  if (!('VideoDecoder' in window)) {
    showStatus("浏览器不支持 WebCodecs，请使用 Chrome 94+", "error");
    return false;
  }

  // 创建 Canvas（用于 H264 渲染）
  if (!canvas) {
    video.style.display = 'none';
    canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = '100%';
    canvas.style.objectFit = 'contain';
    canvas.style.backgroundColor = '#000';
    canvas.id = 'videoCanvas';
    video.parentNode.insertBefore(canvas, video);
    ctx = canvas.getContext('2d');

    // 更新事件监听目标
    setupCanvasEvents();
  }

  try {
    let isConfigured = false;

    videoDecoder = new VideoDecoder({
      output: (frame) => {
        try {
          // 统计帧率
          fpsCounter++;
          totalFrames++;
          const now = Date.now();
          if (now - lastFpsTime >= 1000) {
            currentFps = fpsCounter;
            fpsCounter = 0;
            lastFpsTime = now;
            updateStats(); // 更新统计显示
          }

          if (totalFrames <= 5 || totalFrames % 50 === 0) {
            console.log(`Frame ${totalFrames}: ${frame.displayWidth}x${frame.displayHeight}, FPS: ${currentFps}`);
          }

          // 调整 Canvas 尺寸（仅在尺寸变化时）
          if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
            canvas.width = frame.displayWidth;
            canvas.height = frame.displayHeight;
            // 更新 canvas 的宽高比，确保横竖屏切换时正确显示
            canvas.style.aspectRatio = `${frame.displayWidth}/${frame.displayHeight}`;
            console.log(`Canvas resized to ${frame.displayWidth}x${frame.displayHeight}, aspect ratio: ${frame.displayWidth}:${frame.displayHeight}`);
          }

          // 清除整个 Canvas，避免旧帧残留（关键修复！）
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          // 填充黑色背景（避免透明区域）
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // 使用帧的实际尺寸绘制，避免拉伸
          ctx.drawImage(
            frame,
            0, 0, frame.displayWidth, frame.displayHeight,  // 源区域
            0, 0, canvas.width, canvas.height               // 目标区域
          );

          frame.close();
        } catch (err) {
          console.error("Error rendering frame:", err);
          frame.close();
        }
      },
      error: (e) => {
        console.error("VideoDecoder error:", e);
        showStatus(`解码错误: ${e.message}`, "error");
      }
    });

    // 暂时不配置，等收到第一个 SPS/PPS 数据
    console.log("H264 decoder created (will configure on first SPS/PPS)");
    return true;
  } catch (e) {
    console.error("Failed to init H264 decoder:", e);
    showStatus("无法初始化 H264 解码器", "error");
    return false;
  }
}

// 重置解码器（切换模式时）
function resetDecoder() {
  if (videoDecoder) {
    try {
      videoDecoder.close();
    } catch (e) {
      // ignore
    }
    videoDecoder = null;
  }

  spsData = null;
  ppsData = null;
  waitingForKeyFrame = false;

  if (canvas) {
    canvas.style.display = 'none';
  }

  video.style.display = 'none'; // 初始隐藏，等待画面
  h264Timestamp = 0;
  frameCount = 0;
}

// 显示加载动画
function showLoader(text = "正在连接设备...") {
  const loader = document.getElementById("screen-loader");
  if (loader) {
    loader.querySelector(".loader-text").textContent = text;
    loader.style.display = "flex";
  }
}

// 隐藏加载动画
function hideLoader() {
  const loader = document.getElementById("screen-loader");
  if (loader) {
    loader.style.display = "none";
  }
}

// 显示占位提示
function showPlaceholder() {
  const placeholder = document.getElementById("screen-placeholder");
  if (placeholder) {
    placeholder.style.display = "flex";
  }
  video.style.display = "none";
  if (canvas) {
    canvas.style.display = "none";
  }
}

// 隐藏占位提示
function hidePlaceholder() {
  const placeholder = document.getElementById("screen-placeholder");
  if (placeholder) {
    placeholder.style.display = "none";
  }
}

// 显示断开连接遮罩
function showBrokenScreen() {
  const brokenScreen = document.getElementById("screen-broken");
  if (brokenScreen) {
    brokenScreen.style.display = "flex";
  }
}

// 隐藏断开连接遮罩
function hideBrokenScreen() {
  const brokenScreen = document.getElementById("screen-broken");
  if (brokenScreen) {
    brokenScreen.style.display = "none";
  }
}

// 清除屏幕画面
function clearScreen() {
  // 清除 video 的 src
  if (video.src && video.src.startsWith('blob:')) {
    URL.revokeObjectURL(video.src);
  }
  video.src = "";
  video.removeAttribute('src');

  // 彻底清除 canvas（避免残留色块）
  if (canvas && ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 填充黑色，彻底清除残留
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // 显示占位提示
  showPlaceholder();

  // 隐藏断开连接遮罩
  hideBrokenScreen();
}

// 连接设备
function startScrcpy(deviceId) {
  currentDeviceId = deviceId; // 保存当前设备ID

  // 更新设备列表显示（标记选中状态）
  renderDevices();

  // 先关闭旧的 WebSocket（在设置 isConnected 之前，避免触发断开遮罩）
  if (ws) {
    // 移除旧的 WebSocket 事件监听器，防止 onclose 触发显示占位提示
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    ws.close();
    ws = null;
  }

  // 清除画面但不显示占位提示（直接显示加载动画）
  // 清除 video 的 src
  if (video.src && video.src.startsWith('blob:')) {
    URL.revokeObjectURL(video.src);
  }
  video.src = "";
  video.removeAttribute('src');
  video.style.display = 'none';

  // 彻底清除 canvas（避免残留色块）
  if (canvas && ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    canvas.style.display = 'none';
  }

  // 隐藏占位提示和断开遮罩
  hidePlaceholder();
  hideBrokenScreen();

  // 显示加载动画
  showLoader(`正在启动 H264 视频流...`);

  showStatus(`正在启动 H264 视频流...`, "info");

  // 重置统计
  fpsCounter = 0;
  lastFpsTime = Date.now();
  currentFps = 0;
  totalFrames = 0;
  startTime = Date.now();
  bytesReceived = 0;
  lastBytesTime = Date.now();
  currentBitrate = 0;
  totalBytesReceived = 0;

  // 重置状态
  resetDecoder();

  // 初始化解码器
  if (!initH264Decoder()) {
    showStatus("H264 模式不可用，请使用支持 WebCodecs 的浏览器 (Chrome 94+)", "error");
    hideLoader();
    showPlaceholder();
    return;
  }
  video.style.display = 'none';
  canvas.style.display = 'none'; // 初始隐藏，等待第一帧
  console.log(`Canvas will be displayed when first frame arrives`);

  // 根据当前页面协议自动选择 ws:// 或 wss://
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}`;
  console.log(`Connecting to WebSocket: ${wsUrl}`);

  ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    console.log(`WebSocket connected`);

    // WebSocket 连接成功后，设置为已连接状态
    isConnected = true;

    const bitrate = getBitrateValue();
    const maxSize = parseInt(resolutionSelect.value);

    const startConfig = {
      action: "start",
      deviceId,
      bitrate: bitrate,
      maxSize: maxSize,
      maxFps: parseInt(fpsSelect.value),
      token: authToken // 传递认证 token
    };

    const bitrateDisplay = bitrateUnit.value === '1000000'
      ? `${bitrateInput.value} Mbps`
      : `${bitrateInput.value} Kbps`;
    const resolutionDisplay = maxSize === 0 ? '原始' : `${maxSize}p`;

    console.log(`Bitrate: ${bitrateDisplay}, Resolution: ${resolutionDisplay}, FPS: ${startConfig.maxFps}`);

    ws.send(JSON.stringify(startConfig));
    showStatus(`已连接，正在启动...`, "info");
  };

  ws.onmessage = async (event) => {
    if (typeof event.data === "string") {
      const msg = JSON.parse(event.data);
      console.log("Received:", msg);

      if (msg.type === "error") {
        showStatus(msg.message, "error");
        // 如果是认证错误，返回登录页面
        if (msg.message.includes("未授权") || msg.message.includes("登录")) {
          sessionStorage.removeItem('scrcpy-auth-token');
          authToken = null;
          isLoggedIn = false;
          document.getElementById('login-overlay').style.display = 'flex';
          if (ws) {
            ws.close();
          }
        }
      } else if (msg.type === "screenSize") {
        screenWidth = msg.width;
        screenHeight = msg.height;
        console.log(`Screen size: ${screenWidth}x${screenHeight}`);

        // 更新 video 和 canvas 的宽高比
        video.style.aspectRatio = `${screenWidth}/${screenHeight}`;
        if (canvas) {
          canvas.style.aspectRatio = `${screenWidth}/${screenHeight}`;
          console.log(`Canvas aspect ratio updated to ${screenWidth}:${screenHeight}`);
        }

        showStatus(`正在接收画面...`, "success");
        showLoader("正在接收画面...");
      } else if (msg.type === "ended") {
        showStatus("设备已断开连接", "error");
        isConnected = false; // 设置为未连接状态
        showBrokenScreen(); // 显示断开连接遮罩
        hideLoader();
      } else if (msg.type === "clipboard") {
        // 收到设备剪贴板内容，复制到浏览器剪贴板
        const clipboardText = msg.text;
        console.log(`Received clipboard from device: ${clipboardText.substring(0, 50)}...`);

        navigator.clipboard.writeText(clipboardText).then(() => {
          showStatus(`已复制到浏览器剪贴板: ${clipboardText.substring(0, 30)}...`, "success");
        }).catch(err => {
          console.error('Failed to copy to clipboard:', err);
          showStatus("复制到剪贴板失败", "error");
        });
      }
    } else {
      // 二进制数据 - H264 视频流
      frameCount++;
      bytesReceived += event.data.byteLength;
      totalBytesReceived += event.data.byteLength;

      // 计算码率（每秒更新一次）
      const now = Date.now();
      if (now - lastBytesTime >= 1000) {
        currentBitrate = (bytesReceived * 8) / ((now - lastBytesTime) / 1000);
        console.log(`Current bitrate: ${(currentBitrate / 1000000).toFixed(2)} Mbps`);
        bytesReceived = 0;
        lastBytesTime = now;
      }

      if (frameCount <= 5 || frameCount % 50 === 0) {
        console.log(`Received frame ${frameCount}: ${event.data.byteLength} bytes`);
      }

      // 使用 WebCodecs 解码
      if (videoDecoder) {
        try {
          const data = new Uint8Array(event.data);

          // 提取 SPS 和 PPS（包括检测配置变化，用于横竖屏切换）
          let newSpsData = null;
          let newPpsData = null;
          let configChanged = false;

          for (let i = 0; i < data.length - 4; i++) {
            if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {
              const nalType = data[i + 4] & 0x1F;

              if (nalType === 7) { // SPS
                newSpsData = extractNALUnit(data, i);
                // 检查 SPS 是否变化（可能是横竖屏切换）
                if (!spsData || newSpsData.length !== spsData.length ||
                  !newSpsData.every((val, idx) => val === spsData[idx])) {
                  configChanged = true;
                  spsData = newSpsData;
                  console.log(`SPS ${configChanged && videoDecoder.state === 'configured' ? 'changed (screen rotation?)' : 'extracted'}: ${spsData.length} bytes`);
                }
              } else if (nalType === 8) { // PPS
                newPpsData = extractNALUnit(data, i);
                if (!ppsData || newPpsData.length !== ppsData.length ||
                  !newPpsData.every((val, idx) => val === ppsData[idx])) {
                  configChanged = true;
                  ppsData = newPpsData;
                  console.log(`PPS ${configChanged && videoDecoder.state === 'configured' ? 'changed (screen rotation?)' : 'extracted'}: ${ppsData.length} bytes`);
                }
              }

              if (spsData && ppsData) break;
            }
          }

          // 配置解码器（当有 SPS 和 PPS 且未配置，或配置变化时）
          if (spsData && ppsData && (videoDecoder.state === 'unconfigured' || configChanged)) {
            // 如果配置变化（横竖屏切换），需要重新配置解码器
            if (configChanged && videoDecoder.state === 'configured') {
              console.log("⚠️ Configuration changed (screen rotation detected), reconfiguring decoder...");
              waitingForKeyFrame = true; // 等待新的关键帧
            }

            console.log("Configuring H264 decoder with avcC description...");

            const avcC = createAvcCDescription(spsData, ppsData);
            console.log(`avcC description created: ${avcC.length} bytes`);

            videoDecoder.configure({
              codec: 'avc1.42E01E', // H.264 Baseline Profile
              codedWidth: screenWidth || 1080,
              codedHeight: screenHeight || 1920,
              optimizeForLatency: true,
              hardwareAcceleration: 'prefer-hardware',
              description: avcC
            });

            console.log("H264 decoder configured with description");
            if (!waitingForKeyFrame) {
              // 如果不是配置变化导致的重新配置，才设置等待关键帧标志
              waitingForKeyFrame = true;
              console.log("Waiting for first IDR frame...");
            }
            return;
          }

          // 只在配置后解码帧
          if (videoDecoder.state === 'configured') {
            // 检查这一帧的类型
            let isKeyFrame = false;
            for (let i = 0; i < Math.min(data.length - 4, 100); i++) {
              if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {
                const nalType = data[i + 4] & 0x1F;
                if (nalType === 5) { // IDR
                  isKeyFrame = true;
                  console.log("Found IDR frame (NAL type 5)");
                  break;
                } else if (nalType === 1) {
                  console.log("Found non-IDR frame (NAL type 1)");
                  break;
                }
              }
            }

            // 跳过纯配置帧（只有 SPS/PPS）
            let hasOnlyConfig = true;
            for (let i = 0; i < data.length - 4; i++) {
              if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {
                const nalType = data[i + 4] & 0x1F;
                if (nalType !== 7 && nalType !== 8) {
                  hasOnlyConfig = false;
                  break;
                }
              }
            }

            if (!hasOnlyConfig) {
              // 如果在等待关键帧，跳过非关键帧
              if (waitingForKeyFrame && !isKeyFrame) {
                console.log(`Skipping DELTA frame ${frameCount}, waiting for IDR...`);
                return;
              }

              console.log(`Decoding frame ${frameCount}, type: ${isKeyFrame ? 'KEY' : 'DELTA'}, size: ${event.data.byteLength} bytes`);

              // 转换为 AVCC 格式
              const avccData = annexBToAvcc(data);
              console.log(`Converted to AVCC: ${data.byteLength} -> ${avccData.byteLength} bytes`);

              const chunk = new EncodedVideoChunk({
                type: isKeyFrame ? 'key' : 'delta',
                timestamp: h264Timestamp * 16666,
                data: avccData
              });

              h264Timestamp++;

              try {
                videoDecoder.decode(chunk);
                console.log(`Decode queued, decoder queue size: ${videoDecoder.decodeQueueSize}`);

                // 如果这是配置后的第一个关键帧，清除等待标志
                if (waitingForKeyFrame && isKeyFrame) {
                  waitingForKeyFrame = false;
                  console.log("First IDR frame decoded, now accepting all frames");
                  showStatus("H264 视频流已启动", "success");
                  hideLoader();
                  hidePlaceholder();
                  if (canvas) {
                    canvas.style.display = 'block';
                  }
                }
              } catch (err) {
                console.error(`Decode failed:`, err);
              }
            }
          }
        } catch (e) {
          if (frameCount <= 10) {
            console.error("Decode error:", e);
          }
        }
      }
    }
  };

  ws.onclose = () => {
    console.log("WebSocket disconnected");
    showStatus("设备已断开连接", "error");
    hideLoader();

    // 如果之前是连接状态，显示断开遮罩
    if (isConnected) {
      isConnected = false; // 设置为未连接状态
      showBrokenScreen();
    } else {
      clearScreen(); // 清除画面并显示占位提示
    }

    currentDeviceId = null; // 清除设备ID
    renderDevices(); // 更新设备列表显示（移除选中状态）
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    showStatus("WebSocket 连接错误", "error");
    hideLoader();
  };
}

// 获取相对坐标（自动适配 canvas，处理 object-fit: contain 的黑边）
function getRelativePosition(event) {
  const element = canvas || video;
  const rect = element.getBoundingClientRect();
  let clientX, clientY;

  if (event.touches && event.touches.length > 0) {
    clientX = event.touches[0].clientX;
    clientY = event.touches[0].clientY;
  } else {
    clientX = event.clientX;
    clientY = event.clientY;
  }

  // 如果是 Canvas 且有内部分辨率，需要考虑 object-fit: contain 的影响
  if (canvas && canvas.width > 0 && canvas.height > 0) {
    const canvasAspectRatio = canvas.width / canvas.height;
    const displayAspectRatio = rect.width / rect.height;

    let actualLeft = rect.left;
    let actualTop = rect.top;
    let actualWidth = rect.width;
    let actualHeight = rect.height;

    // object-fit: contain 会在某个方向上产生黑边
    if (displayAspectRatio > canvasAspectRatio) {
      // 显示区域更宽，左右有黑边
      actualWidth = rect.height * canvasAspectRatio;
      actualLeft = rect.left + (rect.width - actualWidth) / 2;
      const blackBorder = (rect.width - actualWidth) / 2;
      if (blackBorder > 1) {
        console.log(`Canvas has ${blackBorder.toFixed(0)}px horizontal black borders`);
      }
    } else {
      // 显示区域更高，上下有黑边
      actualHeight = rect.width / canvasAspectRatio;
      actualTop = rect.top + (rect.height - actualHeight) / 2;
      const blackBorder = (rect.height - actualHeight) / 2;
      if (blackBorder > 1) {
        console.log(`Canvas has ${blackBorder.toFixed(0)}px vertical black borders`);
      }
    }

    const x = (clientX - actualLeft) / actualWidth;
    const y = (clientY - actualTop) / actualHeight;

    // 调试信息（只在坐标超出范围时显示）
    if (x < 0 || x > 1 || y < 0 || y > 1) {
      console.warn(`⚠️ 坐标超出范围: (${x.toFixed(3)}, ${y.toFixed(3)})`);
      console.log(`Canvas显示: ${rect.width.toFixed(0)}x${rect.height.toFixed(0)}, 实际区域: ${actualWidth.toFixed(0)}x${actualHeight.toFixed(0)}`);
    }

    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }

  // 降级处理（video 或 canvas 未初始化）
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;

  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

// 发送触摸事件
function sendTouch(x, y, duration) {
  if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
    console.warn("WebSocket not connected");
    showStatus("设备未连接，无法操作", "error");
    return;
  }

  const msg = {
    action: "touch",
    x,
    y
  };

  if (duration) {
    msg.duration = duration;
  }

  ws.send(JSON.stringify(msg));
}

// 发送滑动事件
function sendSwipe(x1, y1, x2, y2, duration) {
  if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
    console.warn("WebSocket not connected");
    showStatus("设备未连接，无法操作", "error");
    return;
  }

  console.log(`Sending swipe: (${x1.toFixed(2)}, ${y1.toFixed(2)}) -> (${x2.toFixed(2)}, ${y2.toFixed(2)}), ${duration}ms`);
  ws.send(JSON.stringify({
    action: "swipe",
    x1,
    y1,
    x2,
    y2,
    duration
  }));
}

// 发送按键事件
function sendKey(keyCode) {
  if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
    showStatus("设备未连接，无法操作", "error");
    return;
  }

  ws.send(JSON.stringify({
    action: "keyevent",
    keyCode
  }));
}

// 发送文本输入
function sendText(text) {
  if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
    showStatus("设备未连接，无法操作", "error");
    return;
  }

  console.log(`Sending text: ${text}`);
  ws.send(JSON.stringify({
    action: "text",
    text
  }));
}

// 获取设备剪贴板
function getDeviceClipboard() {
  if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
    showStatus("设备未连接，无法操作", "error");
    return;
  }

  console.log("Getting device clipboard");
  ws.send(JSON.stringify({
    action: "getClipboard"
  }));
}

// 设置设备剪贴板
function setDeviceClipboard(text) {
  if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
    showStatus("设备未连接，无法操作", "error");
    return;
  }

  console.log(`Setting device clipboard: ${text.substring(0, 50)}...`);
  ws.send(JSON.stringify({
    action: "setClipboard",
    text
  }));
}

// 鼠标事件（video 元素，虽然现在主要用 canvas）
video.addEventListener("mousedown", (e) => {
  e.preventDefault();
  const pos = getRelativePosition(e);

  // 右键点击直接触发长按
  if (e.button === 2) {
    console.log("Right click on video - triggering long press");
    sendTouch(pos.x, pos.y, 800);
    return;
  }

  isDragging = true;
  startX = pos.x;
  startY = pos.y;
  lastTouchTime = Date.now();
  longPressTriggered = false;

  // 设置长按计时器
  longPressTimer = setTimeout(() => {
    if (isDragging) {
      longPressTriggered = true;
      sendTouch(startX, startY, 800);
      console.log("Long press triggered on video");
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }
  }, LONG_PRESS_DURATION);
});

video.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  e.preventDefault();

  const pos = getRelativePosition(e);
  const distance = Math.sqrt(
    Math.pow((pos.x - startX) * screenWidth, 2) +
    Math.pow((pos.y - startY) * screenHeight, 2)
  );

  // 如果移动超过 10 像素，取消长按
  if (distance > 10 && longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
});

video.addEventListener("mouseup", (e) => {
  if (!isDragging) return;
  e.preventDefault();

  // 清除长按计时器
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  // 如果已经触发了长按，就不再发送其他事件
  if (longPressTriggered) {
    isDragging = false;
    longPressTriggered = false;
    return;
  }

  const pos = getRelativePosition(e);
  const endX = pos.x;
  const endY = pos.y;
  const duration = Date.now() - lastTouchTime;

  const distance = Math.sqrt(
    Math.pow((endX - startX) * screenWidth, 2) +
    Math.pow((endY - startY) * screenHeight, 2)
  );

  if (distance < 10 && duration < 300) {
    sendTouch(startX, startY);
  } else {
    sendSwipe(startX, startY, endX, endY, Math.min(duration, 500));
  }

  isDragging = false;
});

// 禁用右键菜单
video.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  return false;
});

// 触摸事件
video.addEventListener("touchstart", (e) => {
  e.preventDefault();
  const pos = getRelativePosition(e);
  isDragging = true;
  startX = pos.x;
  startY = pos.y;
  lastTouchTime = Date.now();
});

video.addEventListener("touchmove", (e) => {
  e.preventDefault();
});

video.addEventListener("touchend", (e) => {
  if (!isDragging) return;
  e.preventDefault();

  const pos = getRelativePosition(e.changedTouches[0]);
  const endX = pos.x;
  const endY = pos.y;
  const duration = Date.now() - lastTouchTime;

  const distance = Math.sqrt(
    Math.pow((endX - startX) * screenWidth, 2) +
    Math.pow((endY - startY) * screenHeight, 2)
  );

  if (distance < 10 && duration < 300) {
    sendTouch(startX, startY);
  } else {
    sendSwipe(startX, startY, endX, endY, Math.min(duration, 500));
  }

  isDragging = false;
});

// 滚轮事件（JPEG 模式使用）
video.addEventListener("wheel", handleWheel, { passive: false });

// 滚轮滚动处理
function handleWheel(e) {
  e.preventDefault();

  const pos = getRelativePosition(e);
  const centerX = pos.x;
  const centerY = pos.y;

  // 根据滚轮方向模拟滑动
  const scrollAmount = 0.15; // 滚动距离（屏幕高度的15%）

  let startY, endY;
  if (e.deltaY < 0) {
    // 向上滚动：从下往上滑
    startY = Math.min(centerY + scrollAmount, 0.9);
    endY = Math.max(centerY - scrollAmount, 0.1);
  } else {
    // 向下滚动：从上往下滑
    startY = Math.max(centerY - scrollAmount, 0.1);
    endY = Math.min(centerY + scrollAmount, 0.9);
  }

  // 发送滑动命令
  sendSwipe(centerX, startY, centerX, endY, 200);
}

// 为 Canvas 设置事件监听（H264 模式使用）
function setupCanvasEvents() {
  if (!canvas) return;

  canvas.addEventListener("mousedown", handleMouseDown);
  canvas.addEventListener("contextmenu", handleContextMenu); // 右键菜单
  canvas.addEventListener("touchstart", handleTouchStart);
  canvas.addEventListener("touchmove", handleTouchMove);
  canvas.addEventListener("touchend", handleTouchEnd);
  canvas.addEventListener("wheel", handleWheel, { passive: false });

  // mousemove 和 mouseup 必须绑定到 document，防止鼠标移出 canvas 时事件丢失
  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("mouseup", handleMouseUp);
}

// 统一的事件处理函数
function handleMouseDown(e) {
  e.preventDefault();
  const pos = getRelativePosition(e);

  // 右键点击直接触发长按
  if (e.button === 2) {
    console.log("Right click - triggering long press");
    sendTouch(pos.x, pos.y, 800);
    return;
  }

  // 左键正常处理
  isDragging = true;
  startX = pos.x;
  startY = pos.y;
  lastTouchTime = Date.now();
  longPressTriggered = false;

  // 设置长按计时器
  longPressTimer = setTimeout(() => {
    if (isDragging) {
      longPressTriggered = true;
      // 触发长按（800ms）
      sendTouch(startX, startY, 800);
      console.log("Long press triggered");
      // 可选：添加触觉反馈
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }
  }, LONG_PRESS_DURATION);
}

// 处理右键菜单（禁用并触发长按）
function handleContextMenu(e) {
  e.preventDefault(); // 阻止默认右键菜单
  return false;
}

function handleMouseMove(e) {
  if (!isDragging) return;
  e.preventDefault();

  const pos = getRelativePosition(e);
  const distance = Math.sqrt(
    Math.pow((pos.x - startX) * screenWidth, 2) +
    Math.pow((pos.y - startY) * screenHeight, 2)
  );

  // 如果移动超过 10 像素，取消长按
  if (distance > 10 && longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function handleMouseUp(e) {
  if (!isDragging) return;
  e.preventDefault();

  // 清除长按计时器
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  // 如果已经触发了长按，就不再发送其他事件
  if (longPressTriggered) {
    isDragging = false;
    longPressTriggered = false;
    return;
  }

  const pos = getRelativePosition(e);
  const endX = pos.x;
  const endY = pos.y;
  const duration = Date.now() - lastTouchTime;

  const distance = Math.sqrt(
    Math.pow((endX - startX) * screenWidth, 2) +
    Math.pow((endY - startY) * screenHeight, 2)
  );

  if (distance < 10 && duration < 300) {
    sendTouch(startX, startY);
  } else {
    sendSwipe(startX, startY, endX, endY, Math.min(duration, 500));
  }

  isDragging = false;
}

function handleTouchStart(e) {
  e.preventDefault();
  const pos = getRelativePosition(e);
  isDragging = true;
  startX = pos.x;
  startY = pos.y;
  lastTouchTime = Date.now();
  longPressTriggered = false;

  // 设置长按计时器
  longPressTimer = setTimeout(() => {
    if (isDragging) {
      longPressTriggered = true;
      // 触发长按（800ms）
      sendTouch(startX, startY, 800);
      console.log("Long press triggered");
      // 触觉反馈
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }
  }, LONG_PRESS_DURATION);
}

function handleTouchMove(e) {
  e.preventDefault();

  if (!isDragging) return;

  const pos = getRelativePosition(e);
  const distance = Math.sqrt(
    Math.pow((pos.x - startX) * screenWidth, 2) +
    Math.pow((pos.y - startY) * screenHeight, 2)
  );

  // 如果移动超过 10 像素，取消长按
  if (distance > 10 && longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function handleTouchEnd(e) {
  if (!isDragging) return;
  e.preventDefault();

  // 清除长按计时器
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  // 如果已经触发了长按，就不再发送其他事件
  if (longPressTriggered) {
    isDragging = false;
    longPressTriggered = false;
    return;
  }

  const pos = getRelativePosition(e.changedTouches[0]);
  const endX = pos.x;
  const endY = pos.y;
  const duration = Date.now() - lastTouchTime;

  const distance = Math.sqrt(
    Math.pow((endX - startX) * screenWidth, 2) +
    Math.pow((endY - startY) * screenHeight, 2)
  );

  if (distance < 10 && duration < 300) {
    sendTouch(startX, startY);
  } else {
    sendSwipe(startX, startY, endX, endY, Math.min(duration, 500));
  }

  isDragging = false;
}

// 刷新设备按钮
refreshBtn.onclick = fetchDevices;

// 标签页切换
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // 更新激活状态
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // 更新过滤器
    currentFilter = btn.dataset.filter;

    // 重新渲染设备列表
    renderDevices();
  });
});

// 切换主标签页
function switchMainTab(tabName) {
  // 更新标签按钮状态
  document.querySelectorAll('.main-tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  event.target.classList.add('active');

  // 更新内容显示
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.getElementById('tab-' + tabName).classList.add('active');
}

// 键盘事件监听
document.addEventListener('keydown', (e) => {
  // 只在连接状态且不在输入框中时处理
  if (!isConnected || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    return;
  }

  // Ctrl+C: 从设备复制到浏览器
  if (e.ctrlKey && e.key === 'c') {
    e.preventDefault();
    getDeviceClipboard();
    return;
  }

  // Ctrl+V: 从浏览器粘贴到设备
  if (e.ctrlKey && e.key === 'v') {
    e.preventDefault();
    navigator.clipboard.readText().then(text => {
      if (text) {
        setDeviceClipboard(text);
        showStatus(`已粘贴到设备: ${text.substring(0, 30)}...`, "success");
      }
    }).catch(err => {
      console.error('Failed to read clipboard:', err);
      showStatus("读取剪贴板失败", "error");
    });
    return;
  }

  // 映射特殊键
  const keyMap = {
    'Backspace': 67,   // DEL
    'Enter': 66,       // ENTER
    'Escape': 4,       // BACK
    'ArrowUp': 19,     // DPAD_UP
    'ArrowDown': 20,   // DPAD_DOWN
    'ArrowLeft': 21,   // DPAD_LEFT
    'ArrowRight': 22,  // DPAD_RIGHT
    'Home': 3,         // HOME
    'Tab': 61,         // TAB
  };

  if (keyMap[e.key]) {
    e.preventDefault();
    sendKey(keyMap[e.key]);
    return;
  }

  // 处理普通字符输入
  if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    sendText(e.key);
  }
});

// 统计面板显示状态
let statsVisible = false;

// 切换统计面板显示/隐藏
function toggleStats() {
  const statsEl = document.getElementById('stats-display');
  const toggleBtn = document.getElementById('stats-toggle-btn');

  if (!statsEl || !toggleBtn) return;

  statsVisible = !statsVisible;

  if (statsVisible && isConnected) {
    statsEl.style.display = 'block';
    toggleBtn.style.opacity = '0.5';
  } else {
    statsEl.style.display = 'none';
    toggleBtn.style.opacity = '1';
  }
}

// 更新统计显示
function updateStats() {
  const statsEl = document.getElementById('stats-display');
  if (!statsEl || !isConnected) {
    if (statsEl) statsEl.style.display = 'none';
    return;
  }

  // 如果统计面板不可见，则不更新
  if (!statsVisible) {
    statsEl.style.display = 'none';
    return;
  }

  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const avgFps = totalFrames / (uptime || 1);
  const avgBitrate = uptime > 0 ? (totalBytesReceived * 8) / uptime : 0;

  // 获取设置的参数
  const settingBitrate = getBitrateValue();
  const settingResolution = parseInt(resolutionSelect.value);
  const settingFps = parseInt(fpsSelect.value);

  // 格式化显示
  const settingBitrateDisplay = bitrateUnit.value === '1000000'
    ? `${bitrateInput.value} Mbps`
    : `${bitrateInput.value} Kbps`;
  const settingResolutionDisplay = settingResolution === 0 ? '原始' : `${settingResolution}p`;

  statsEl.innerHTML = `
    <div class="stat-item">
      <span class="stat-label">分辨率:</span>
      <span class="stat-value">${screenWidth}x${screenHeight}</span>
    </div>
    <div class="stat-item">
      <span class="stat-label">设置:</span>
      <span class="stat-value">${settingResolutionDisplay}</span>
    </div>
    <div class="stat-item">
      <span class="stat-label">━━━━━━━━━━</span>
      <span class="stat-value"></span>
    </div>
    <div class="stat-item">
      <span class="stat-label">当前帧率:</span>
      <span class="stat-value">${currentFps} FPS</span>
    </div>
    <div class="stat-item">
      <span class="stat-label">设置帧率:</span>
      <span class="stat-value">${settingFps} FPS</span>
    </div>
    <div class="stat-item">
      <span class="stat-label">平均帧率:</span>
      <span class="stat-value">${avgFps.toFixed(1)} FPS</span>
    </div>
    <div class="stat-item">
      <span class="stat-label">━━━━━━━━━━</span>
      <span class="stat-value"></span>
    </div>
    <div class="stat-item">
      <span class="stat-label">当前码率:</span>
      <span class="stat-value">${(currentBitrate / 1000000).toFixed(2)} Mbps</span>
    </div>
    <div class="stat-item">
      <span class="stat-label">设置码率:</span>
      <span class="stat-value">${settingBitrateDisplay}</span>
    </div>
    <div class="stat-item">
      <span class="stat-label">平均码率:</span>
      <span class="stat-value">${(avgBitrate / 1000000).toFixed(2)} Mbps</span>
    </div>
    <div class="stat-item">
      <span class="stat-label">━━━━━━━━━━</span>
      <span class="stat-value"></span>
    </div>
    <div class="stat-item">
      <span class="stat-label">总帧数:</span>
      <span class="stat-value">${totalFrames}</span>
    </div>
    <div class="stat-item">
      <span class="stat-label">总流量:</span>
      <span class="stat-value">${(totalBytesReceived / 1024 / 1024).toFixed(1)} MB</span>
    </div>
    <div class="stat-item">
      <span class="stat-label">运行时间:</span>
      <span class="stat-value">${Math.floor(uptime / 60)}:${String(uptime % 60).padStart(2, '0')}</span>
    </div>
  `;

  // 只有在 statsVisible 为 true 时才显示
  if (statsVisible) {
    statsEl.style.display = 'block';
  }
}

// 初始化
checkLoginStatus(); // 先检查登录状态
loadSettings();
if (isLoggedIn) {
  fetchDevices();
}

// 定期更新统计（每秒）
setInterval(() => {
  if (isConnected) {
    updateStats();
  }
}, 1000);
