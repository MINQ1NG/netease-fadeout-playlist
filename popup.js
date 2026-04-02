class PopupManager {
  constructor() {
    this.logs = [];
    this.blacklist = [];
    this.config = { triggerSecondSkip: true };
    this.init();
  }

  async init() {
    this.loadConfig();
    this.loadBlacklist();
    this.loadLogs();
    this.setupEventListeners();
    // 定期刷新状态
    this.startAutoRefresh();
  }

  async loadConfig() {
    try {
      const config = await this.sendMessage('GET_CONFIG');
      if (config) {
        this.updateStatusUI(config);
      }
      if (config.triggerSecondSkip) {
        this.config.triggerSecondSkip = config.triggerSecondSkip;
        // 只在初始化时设置开关状态
        const toggle = document.getElementById('triggerSecondSkip');
        if (toggle) {
          toggle.checked = this.config.triggerSecondSkip === true;
        }
      }
    } catch (error) {
      console.error('加载配置失败:', error);
    }
  }

  async loadBlacklist() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['blackArtists'], (result) => {
        this.blacklist = result.blackArtists || [];
        this.renderBlacklist();
        document.getElementById('blacklistCount').textContent = this.blacklist.length;
        resolve();
      });
    });
  }

  async saveBlacklist() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ blackArtists: this.blacklist }, () => {
        this.renderBlacklist();
        document.getElementById('blacklistCount').textContent = this.blacklist.length;
        
        // 通知 background 更新黑名单
        this.sendMessage('UPDATE_BLACKLIST', { blacklist: this.blacklist });
        resolve();
      });
    });
  }

  renderBlacklist() {
    const container = document.getElementById('blacklistContainer');
    
    if (!this.blacklist || this.blacklist.length === 0) {
      container.innerHTML = '<div class="empty-tip">暂无黑名单歌手，添加后会自动跳过这些歌手的歌曲</div>';
      return;
    }
    
    container.innerHTML = this.blacklist.map(artist => `
      <div class="blacklist-item" data-artist="${this.escapeHtml(artist)}">
        <span class="artist-name">${this.escapeHtml(artist)}</span>
        <button class="delete-btn" data-artist="${this.escapeHtml(artist)}">✕</button>
      </div>
    `).join('');
    
    // 绑定删除事件
    container.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const artist = btn.getAttribute('data-artist');
        this.removeArtist(artist);
      });
    });
  }

  addArtist(artist) {
    if (!artist || !artist.trim()) {
      this.addLog('请输入歌手名称', 'warning');
      return;
    }
    
    const trimmed = artist.trim();
    if (this.blacklist.includes(trimmed)) {
      this.addLog(`"${trimmed}" 已在黑名单中`, 'warning');
      return;
    }
    
    this.blacklist.push(trimmed);
    this.saveBlacklist();
    this.addLog(`已添加黑名单: ${trimmed}`, 'success');
  }

  removeArtist(artist) {
    const index = this.blacklist.indexOf(artist);
    if (index !== -1) {
      this.blacklist.splice(index, 1);
      this.saveBlacklist();
      this.addLog(`已移除黑名单: ${artist}`, 'info');
    }
  }

  clearBlacklist() {
    if (this.blacklist.length === 0) return;
    
    if (confirm('确定要清空所有黑名单吗？')) {
      this.blacklist = [];
      this.saveBlacklist();
      this.addLog('已清空所有黑名单', 'warning');
    }
  }

  updateStatusUI(config) {
    // Cookie状态
    const cookieEl = document.getElementById('cookieStatus');
    if (config.lastCookieRefresh) {
      const daysAgo = Math.floor((Date.now() - config.lastCookieRefresh) / (24*60*60*1000));
      if (daysAgo < 7) {
        cookieEl.textContent = `✅ 有效`;
        cookieEl.className = 'status-value success';
      } else {
        cookieEl.textContent = `⚠️ 即将过期 (${daysAgo}天前)`;
        cookieEl.className = 'status-value warning';
      }
    } else {
      cookieEl.textContent = '❌ 未获取';
      cookieEl.className = 'status-value error';
    }

    // 歌单状态
    const playlistEl = document.getElementById('playlistStatus');
    if (config.fadeOutPlaylistId) {
      playlistEl.textContent = `✅ ${config.fadeOutPlaylistName || '淡出歌单'}`;
      playlistEl.className = 'status-value success';
    } else {
      playlistEl.textContent = '❌ 未找到';
      playlistEl.className = 'status-value error';
    }

    // 喜欢列表缓存状态
    this.loadFavoriteStatus();
  }

  async loadFavoriteStatus() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['favoriteSongIds','favoriteSongIdsUpdateTime'], (result) => {
        const cache = result.favoriteSongIds;
        const UpdateTime = result.favoriteSongIdsUpdateTime;
        const favEl = document.getElementById('favoriteStatus');
        
        if (cache && UpdateTime) {
          const hoursAgo = Math.floor((Date.now() - UpdateTime) / (60*60*1000));
          favEl.textContent = `✅ ${cache?.length || 0} 首`;
          favEl.className = 'status-value success';
        } else {
          favEl.textContent = '⚠️ 未缓存';
          favEl.className = 'status-value warning';
        }
        resolve();
      });
    });
  }

  setupEventListeners() {
    // 标签页切换
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabId = tab.getAttribute('data-tab');
        this.switchTab(tabId);
      });
    });

    // 开关变化监听
    const toggle = document.getElementById('triggerSecondSkip');
    if (toggle) {
      toggle.addEventListener('change', async (e) => {
        const newValue = e.target.checked;
        const result = await this.sendMessage('UPDATE_CONFIG', {
          key: 'triggerSecondSkip',
          value: newValue
        });
        
        if (result && result.success) {
          console.log('开关状态已更新:', newValue);
          this.config.triggerSecondSkip = newValue;
        } else {
          // 更新失败，恢复开关状态
          e.target.checked = !newValue;
          console.error('更新开关状态失败');
        }
      });
    }

    // 添加黑名单
    document.getElementById('addArtistBtn').addEventListener('click', () => {
      const input = document.getElementById('artistInput');
      this.addArtist(input.value);
      input.value = '';
    });

    // 回车添加
    document.getElementById('artistInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('addArtistBtn').click();
      }
    });

    // 清空黑名单
    document.getElementById('clearBlacklistBtn').addEventListener('click', () => {
      this.clearBlacklist();
    });

    // 刷新状态
    document.getElementById('refreshStatusBtn').addEventListener('click', () => {
      this.sendMessage('REFRESH_COOKIES');
      this.sendMessage('REFRESH_PLAYLIST');
      this.sendMessage('REFRESH_FAVORITESONGS');
      this.addLog('已发送刷新请求', 'info');
      setTimeout(() => this.loadConfig(), 1000);
    });

    // 打开网易云
    document.getElementById('openNeteaseBtn').addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://music.163.com' });
    });

    // 清除日志
    document.getElementById('clearLogsBtn').addEventListener('click', () => {
      this.logs = [];
      this.saveLogs();
      this.renderLogs();
    });
  }

  switchTab(tabId) {
    // 更新标签样式
    document.querySelectorAll('.tab').forEach(tab => {
      tab.classList.remove('active');
      if (tab.getAttribute('data-tab') === tabId) {
        tab.classList.add('active');
      }
    });
    
    // 更新内容
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.remove('active');
    });
    document.getElementById(`tab-${tabId}`).classList.add('active');
    
    // 切换时刷新相应数据
    if (tabId === 'status') {
      this.loadConfig();
      this.loadFavoriteStatus();
    }
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
    if (this.logs.length > 50) {
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
        ${this.escapeHtml(log.message)}
      </div>
    `).join('');
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  startAutoRefresh() {
    setInterval(() => {
      const config = this.sendMessage('GET_CONFIG');
      this.updateStatusUI(config);
    }, 5 * 60 * 1000);
  }
}

// 监听来自background的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'LOG_WARNING' || message.type === 'LOG_ERROR') {
    // 可以在popup中显示警告
    console.log('收到消息:', message);
  }
});

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});