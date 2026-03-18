// popup.js
class PopupManager {
  constructor() {
    this.logs = [];
    this.init();
  }

  async init() {
    this.loadConfig();
    this.setupEventListeners();
    this.loadLogs();
    
    // 定期刷新状态
    setInterval(() => this.loadConfig(), 3000);
  }

  async loadConfig() {
    try {
      // 从background获取配置
      const config = await this.sendMessage('GET_CONFIG');
      
      if (config) {
        this.updateUI(config);
      }
    } catch (error) {
      console.error('加载配置失败:', error);
    }
  }

  updateUI(config) {
    // 更新Cookie状态
    const cookieEl = document.getElementById('cookieStatus');
    if (config.lastCookieRefresh) {
      const daysAgo = Math.floor((Date.now() - config.lastCookieRefresh) / (24*60*60*1000));
      if (daysAgo < 7) {
        cookieEl.textContent = '✅ 有效 (更新于' + daysAgo + '天前)';
        cookieEl.className = 'status-value success';
      } else {
        cookieEl.textContent = '⚠️ 即将过期 (更新于' + daysAgo + '天前)';
        cookieEl.className = 'status-value warning';
      }
    } else {
      cookieEl.textContent = '❌ 未获取';
      cookieEl.className = 'status-value error';
    }

    // 更新歌单状态
    const playlistEl = document.getElementById('playlistStatus');
    if (config.fadeOutPlaylistId) {
      playlistEl.textContent = `✅ ${config.fadeOutPlaylistName || '淡出歌单'}`;
      playlistEl.className = 'status-value success';
    } else {
      playlistEl.textContent = '❌ 未找到';
      playlistEl.className = 'status-value error';
    }
  }

  setupEventListeners() {
    document.getElementById('refreshBtn').addEventListener('click', () => {
      this.sendMessage('REFRESH_COOKIES');
      this.sendMessage('REFRESH_PLAYLIST');
      this.addLog('手动刷新状态', 'info');
    });

    document.getElementById('openNeteaseBtn').addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://music.163.com' });
    });

    document.getElementById('clearLogs').addEventListener('click', () => {
      this.logs = [];
      this.saveLogs();
      this.renderLogs();
    });
  }

  sendMessage(type, data = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, data }, (response) => {
        resolve(response);
      });
    });
  }

  loadLogs() {
    chrome.storage.local.get(['recentLogs'], (result) => {
      this.logs = result.recentLogs || [];
      this.renderLogs();
    });
  }

  addLog(message, type = 'info') {
    const log = {
      time: new Date().toLocaleTimeString(),
      message,
      type
    };
    
    this.logs.unshift(log);
    if (this.logs.length > 20) {
      this.logs.pop();
    }
    
    this.saveLogs();
    this.renderLogs();
  }

  saveLogs() {
    chrome.storage.local.set({ recentLogs: this.logs });
  }

  renderLogs() {
    const logList = document.getElementById('logList');
    
    if (this.logs.length === 0) {
      logList.innerHTML = '<div class="log-item">暂无日志</div>';
      return;
    }

    logList.innerHTML = this.logs.map(log => `
      <div class="log-item ${log.type}">
        <span class="timestamp">[${log.time}]</span>
        ${log.message}
      </div>
    `).join('');
  }
}

// 监听来自background的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'LOG_WARNING' || message.type === 'LOG_ERROR') {
    // 可以在popup中显示警告
    console.log('收到消息:', message);
  }
});

// 初始化popup
document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});
