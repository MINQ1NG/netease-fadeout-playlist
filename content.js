class ContentScript {
  constructor() {
    this.logger = new Logger('Content');
    this.currentSong = {
      id: null,
      name: null,
      artists: [],
      progress: 0,
      duration: 0,
      playPercent: 0,
      isManualSkip: false,
      lastClickTime: null,
      album: null,
      cover: null
    };
    
    this.config = {
      fadeOutPlaylistId: null,
      fadeOutPlaylistName: null
    };

    this.init();
  }

  init() {
    this.logger.debug('[init]内容脚本启动');
    
    // 监听DOM变化
    this.observePlayer();
    
    // 监听点击事件
    this.trackUserClicks();
    
    // 跟踪播放进度
    this.trackPlayProgress();
    
    // 监听来自background的消息
    this.setupMessageListener();
    
    // 定期同步状态
    setInterval(() => this.syncSongState(), 1000);
    
    // 初始化获取一次歌曲信息
    setTimeout(() => {
      this.updateSongInfo();
      this.updatePlayProgress();
    }, 500); // 延迟半秒确保DOM已渲染
  }

  observePlayer() {
    // 监听歌曲信息变化
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (this.isSongInfoChanged(mutation)) {
          this.handleSongChange();
        }
      });
    });

    // 观察歌曲标题元素（多种选择器兼容不同版本的网易云）
    const songTitle = document.querySelector('.song-name, .fc1, .tit, .f-thide');
    if (songTitle) {
      observer.observe(songTitle, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }

    // 观察播放器区域
    const player = document.querySelector('.m-player, .g-bd, .play-bar');
    if (player) {
      observer.observe(player, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style']
      });
    }

    // 备用：定时检查歌曲变化
    let lastSongId = this.getSongId();
    setInterval(() => {
      const currentSongId = this.getSongId();
      if (currentSongId && currentSongId !== lastSongId) {
        this.handleSongChange();
        lastSongId = currentSongId;
      }
    }, 1000);
  }

  trackUserClicks() {

    // 使用捕获阶段确保监听器最先执行
    document.addEventListener('click', (e) => {
      // 记录点击元素信息，方便调试
      const target = e.target;
  
      // 检测下一曲按钮（覆盖更多选择器）
      const nextButtonSelectors = [
        '.nxt', '.next-btn', '[data-action="next"]', '.icon-next',
        '.playbar__next', 'button[title="下一曲"]', 'button[aria-label="下一曲"]'
        // 根据实际日志添加更多选择器
      ];
  
      const isNext = nextButtonSelectors.some(selector => 
        target.matches(selector) || target.closest(selector)
      );
  
      if (isNext) {
        this.logger.debug('检测到下一曲点击');
        e.preventDefault(); // 可选，但建议保留

        this.updatePlayProgress();
        this.currentSong.isManualSkip = true;
        this.currentSong.lastClickTime = Date.now();


        // 4. 立即同步一次状态到 background（减少延迟）
        this.syncSongChange();
        return;
      }

      // 检测进度条点击
      const progressSelectors = [
        '.j-flag', '.play-bar', '.m-pbar', '.playbar__progress',
        '.prg', '.slider', '.ant-slider', 'div[role="slider"]'
      ];
      const isProgress = progressSelectors.some(selector =>
        target.matches(selector) || target.closest(selector)
      );
      if (isProgress) {
        this.logger.debug('检测到进度条点击');
        return;
      }

      // ... 其他检测（上一曲、播放按钮等）
    }, true); // 捕获阶段

    // 键盘事件也需要监听，但键盘无法用捕获解决，保持原样
    document.addEventListener('keydown', (e) => {
      // Ctrl + → 或 播放器快捷键
      if ((e.ctrlKey && e.key === 'ArrowRight') || e.key === 'MediaTrackNext') {
        this.currentSong.isManualSkip = true;
        this.currentSong.lastClickTime = Date.now();
        this.logger.debug('检测到快捷键下一曲');
      }
    });

  }

  trackPlayProgress() {
    setInterval(() => {
      this.updatePlayProgress();
    }, 1000);
  }

  updatePlayProgress() {
    const progress = this.getPlayProgress();
    if (progress !== null) {
      this.currentSong.progress = progress.currentTime;
      this.currentSong.duration = progress.duration;
      this.currentSong.playPercent = progress.percent;
      
      // 每10秒同步一次状态
      if (Math.floor(Date.now() / 1000) % 10 === 0) {
        this.syncSongState();
      }
    }
  }

  /**
   * 获取播放进度
   * @returns {Object|null} 包含 currentTime, duration, percent 的对象
   */
  getPlayProgress() {
    try {
      // 从播放器状态获取（新版界面）
      const timeInfo = document.querySelector('.time_info, .time');
      if (timeInfo) {
        const times = timeInfo.textContent.split('/');
        if (times.length === 2) {
          const current = this.parseTime(times[0].trim());
          const total = this.parseTime(times[1].trim());
          if (total > 0) {
            return {
              currentTime: current,
              duration: total,
              percent: (current / total) * 100
            };
          }
        }
      }

      return null;
    } catch (error) {
      this.logger.debug('获取播放进度失败', error);
      return null;
    }
  }

  /**
   * 从DOM获取歌曲总时长
   * @returns {number} 时长（秒）
   */
  getDurationFromDOM() {
    try {
      const timeTotal = document.querySelector('.time-total, .total-time, .duration');
      if (timeTotal) {
        return this.parseTime(timeTotal.textContent);
      }
      
      const timeInfo = document.querySelector('.time_info, .time');
      if (timeInfo) {
        const times = timeInfo.textContent.split('/');
        if (times.length === 2) {
          return this.parseTime(times[1].trim());
        }
      }
      
      return 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * 解析时间字符串为秒数
   * 支持格式: "03:45", "3:45", "01:23:45", "1:23:45"
   * @param {string} timeStr - 时间字符串
   * @returns {number} 秒数
   */
  parseTime(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') {
      return 0;
    }

    // 清理字符串：去除空格、换行等
    timeStr = timeStr.trim().replace(/\s+/g, '');
    
    // 如果为空字符串，返回0
    if (timeStr === '') {
      return 0;
    }

    // 处理 "03:45" 或 "3:45" 格式
    if (timeStr.includes(':')) {
      const parts = timeStr.split(':').map(part => {
        // 转换为数字，处理可能的非数字字符
        const num = parseInt(part, 10);
        return isNaN(num) ? 0 : num;
      });

      if (parts.length === 2) {
        // MM:SS 格式
        const minutes = parts[0];
        const seconds = parts[1];
        return (minutes * 60) + seconds;
      } else if (parts.length === 3) {
        // HH:MM:SS 格式
        const hours = parts[0];
        const minutes = parts[1];
        const seconds = parts[2];
        return (hours * 3600) + (minutes * 60) + seconds;
      }
    }

    // 处理纯数字（可能是秒数）
    const seconds = parseInt(timeStr, 10);
    if (!isNaN(seconds)) {
      return seconds;
    }

    // 处理 "03分45秒" 等中文格式
    const chineseMatch = timeStr.match(/(\d+)\s*分\s*(\d+)\s*秒/);
    if (chineseMatch) {
      const minutes = parseInt(chineseMatch[1], 10);
      const seconds = parseInt(chineseMatch[2], 10);
      return (minutes * 60) + seconds;
    }

    // 处理 "3'45" 格式
    const quoteMatch = timeStr.match(/(\d+)'(\d+)/);
    if (quoteMatch) {
      const minutes = parseInt(quoteMatch[1], 10);
      const seconds = parseInt(quoteMatch[2], 10);
      return (minutes * 60) + seconds;
    }

    this.logger.debug('无法解析的时间格式', { timeStr });
    return 0;
  }

  /**
   * 获取当前歌曲ID
   * @returns {string|null} 歌曲ID
   */
  getSongId() {
    // 方法1：从头部区域获取（最稳定）
    const headLink = document.querySelector('.head.j-flag a[href*="/song?id="]');
    if (headLink) {
      const href = headLink.getAttribute('href');
      const match = href.match(/id=(\d+)/);
      if (match) {
        this.logger.debug('从头部链接获取到歌曲ID', match[1]);
        return match[1];
      }
    }
  
    // 方法2：从音频元素解析（最后备选）
    const audio = document.querySelector('audio');
    if (audio && audio.src) {
      const match = audio.src.match(/id=(\d+)/);
      if (match) {
        this.logger.debug('从音频src获取到歌曲ID', match[1]);
        return match[1];
      }
    }
  
    this.logger.warn('无法获取歌曲ID');
    return null;
  }

  /**
   * 通过静态页面获取歌单所有歌曲 ID（滚动加载方式）
   * @param {string} playlistId - 歌单 ID
   * @param {number} maxScrollAttempts - 最大滚动次数（防止死循环）
   * @returns {Promise<Array>} 歌曲 ID 数组
   */
  async getAllSongsFromStaticPage(playlistId, maxScrollAttempts = 50) {
    return new Promise((resolve, reject) => {
      // 创建隐藏的 iframe 加载歌单页面
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = `https://music.163.com/playlist?id=${playlistId}`;
      document.body.appendChild(iframe);

      let songIds = new Set();      // 使用 Set 自动去重
      let lastSongCount = 0;
      let scrollAttempts = 0;
      let noNewSongsCount = 0;
      let checkInterval = null;

      iframe.onload = () => {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        this.logger.debug(`iframe 加载完成，开始解析歌曲`);
        //this.logger.info(`获取到 ${songIds.length} 首喜欢的歌曲`);

        // 模拟滚动到底部，触发加载更多
        const scrollToBottom = () => {
          const win = iframe.contentWindow;
          const scrollHeight = doc.documentElement.scrollHeight;
          const clientHeight = doc.documentElement.clientHeight;
          win.scrollTo(0, scrollHeight);
        };

        // 获取当前页面的歌曲 ID
        const extractSongIds = () => {
          const doc = iframe.contentDocument || iframe.contentWindow.document;
          // 网易云歌单页面的歌曲项选择器（可能需要根据实际页面调整）
          const songItems = doc.querySelectorAll('.song-item, .j-flag, .f-cb, [data-id]');
          
          const newIds = [];
          songItems.forEach(item => {
            // 尝试多种方式获取歌曲 ID
            let id = item.getAttribute('data-id');
            if (!id) {
              const href = item.querySelector('a')?.getAttribute('href');
              if (href) {
                const match = href.match(/song\?id=(\d+)/);
                if (match) id = match[1];
              }
            }
            if (id && !songIds.has(id)) {
              songIds.add(id);
              newIds.push(id);
            }
          });
          
          return newIds;
        };

        // 检查是否还有新歌曲加载
        const checkNewSongs = () => {
          const beforeCount = songIds.size;
          const newIds = extractSongIds();
          const afterCount = songIds.size;
          
          this.logger.debug(`滚动 ${scrollAttempts + 1}: 已有 ${afterCount} 首歌曲，新增 ${afterCount - beforeCount} 首`);
          
          // 如果没有新歌曲，计数增加
          if (afterCount === beforeCount) {
            noNewSongsCount++;
          } else {
            noNewSongsCount = 0;
          }
          
          // 如果连续 3 次没有新歌曲，或者达到最大滚动次数，结束
          if (noNewSongsCount >= 3 || scrollAttempts >= maxScrollAttempts) {
            clearInterval(checkInterval);
            this.logger.debug(`歌曲提取完成，共 ${songIds.size} 首歌曲`);
            
            // 清理 iframe
            setTimeout(() => {
              iframe.remove();
            }, 1000);
            
            resolve(Array.from(songIds));
            return;
          }
          
          // 滚动到底部，加载更多
          scrollToBottom();
          scrollAttempts++;
        };

        // 等待页面初始加载后开始提取
        setTimeout(() => {
          // 先提取当前可见的歌曲
          extractSongIds();
          
          // 开始滚动检测（每 2 秒检查一次）
          checkInterval = setInterval(checkNewSongs, 2000);
          
          // 手动触发第一次滚动
          scrollToBottom();
        }, 3000);
      };

      iframe.onerror = () => {
        this.logger.error('iframe 加载失败');
        iframe.remove();
        reject(new Error('无法加载歌单页面'));
      };
    });
  }

  async syncFavoritePlaylist(favoriteId) {
    // 调用静态页面解析方法
    const songIds = await this.getAllSongsFromStaticPage(favoriteId);
    
    this.logger.info(`获取到 ${songIds.length} 首喜欢的歌曲`);
    
    // 保存到 storage 或缓存
    chrome.storage.local.set({
      favoriteSongIds: songIds,
      favoriteSongIdsUpdateTime: Date.now()
    });
  }

  /**
   * 获取当前歌曲名称
   * @returns {string|null} 歌曲名称
   */
  getSongName() {
    // 方法1：从歌词区域的名称链接获取
    const nameLink = document.querySelector('.play .j-flag.words a.name');
    if (nameLink && nameLink.textContent.trim()) {
      const name = nameLink.textContent.trim();
      this.logger.debug('从歌词区域获取到歌曲名', name);
      return name;
    }
  
    // 方法2：从其他常见位置获取（降级）
    const fallbackSelectors = [
      '.song-name', '.fc1', '.tit', '.f-thide', '.song-title'
    ];
    for (const selector of fallbackSelectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        this.logger.info(`使用选择器 ${selector} 获取到歌曲名`, el.textContent.trim());
        return el.textContent.trim();
      }
    }
  
    this.logger.warn('无法获取歌曲名称');
    return null;
  }

  /**
   * 获取歌手信息
   * @returns {Array} 歌手列表
   */
  getArtists() {
    try {
      const artistElements = document.querySelectorAll('.artist, .singer, .by, .author');
      const artists = [];
      
      artistElements.forEach(el => {
        if (el.textContent && el.textContent.trim()) {
          artists.push(el.textContent.trim().split('/'));
        }
      });
      
      return artists[0];
    } catch (error) {
      return [];
    }
  }

  /**
   * 判断歌曲信息是否发生变化
   */
  isSongInfoChanged(mutation) {
    // 检查是否有文本变化
    if (mutation.type === 'characterData' && mutation.target) {
      return true;
    }
    
    // 检查子节点变化
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      return true;
    }
    
    return false;
  }

  /**
   * 处理歌曲切换
   */
  async handleSongChange() {
    this.logger.debug('检测到歌曲切换');
    
    // 保存当前歌曲信息
    this.updateSongInfo();
    this.updatePlayProgress();

    //TODO: 跳过拉黑的歌手
    const maxSkips = 10;  // 最大跳过次数
    let skipCount = 0;
    // 只要当前歌曲作者在黑名单中，就继续跳过
    while (skipCount < maxSkips && await this.isArtistBlacklisted()) {
      this.logger.info(`跳过黑名单作者: ${this.currentSong.artists}`);
      await this.nextSongRequest();       // 模拟点击下一曲
      await this.delay(5000);              // 等待页面更新
      // 更新为新歌曲信息
      this.updateSongInfo();    
      this.updatePlayProgress();
      skipCount++;
    }

    if (skipCount >= maxSkips) {
      this.logger.warn('跳过次数过多，可能全是黑名单作者');
    }
    
    // 重置手动跳过标记（新歌）
    this.currentSong.isManualSkip = false;
    
    // 同步状态到background
    this.syncSongState();
  }

  async isArtistBlacklisted() {
    const result = await new Promise((resolve) => {
      chrome.storage.local.get(['blackArtists'], resolve);
    });
    const blacklist = result.blackArtists || [];
    const artists = this.currentSong.artists || [];
    
    // 检查是否匹配
    return artists.some(artist => 
      blacklist.some(blocked => 
        artist.includes(blocked) || blocked.includes(artist)
      )
    );
  }

  /**
   * 模拟点击下一曲按钮，并等待切换完成
   */
  async nextSongRequest() {
    return new Promise((resolve) => {
      const nextButton = document.querySelector('.nxt, .next-btn, [data-action="next"]');
      if (nextButton) {
        nextButton.click();
        this.logger.debug('已模拟点击下一曲按钮');
        // 等待下一曲生效（足够 DOM 更新）
        setTimeout(resolve, 300);
      } else {
        this.logger.warn('未找到下一曲按钮');
        resolve();
      }
    });
  }

  /**
   * 延迟辅助函数
   */
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 更新歌曲信息
   */
  updateSongInfo() {
    const newId = this.getSongId();
    const newName = this.getSongName();
  
    if (newId) this.currentSong.id = newId;
    if (newName) this.currentSong.name = newName;
  
    this.currentSong.artists = this.getArtists();   // 可沿用之前的方法
    //this.currentSong.album = this.getAlbum();       // 可选
  
    this.logger.debug('更新后的歌曲信息', {
      id: this.currentSong.id,
      name: this.currentSong.name,
      artists: this.currentSong.artists
    });
  }

  syncSongChange() {
    chrome.runtime.sendMessage({
      type: 'SONG_CHANGE_UPDATE',
      data: this.currentSong
    }).catch((err) => {
      this.logger.warn('发送消息失败，使用storage降级', err);
      chrome.storage.local.get(['pendingStates'], (res) => {
        const states = res.pendingStates || [];
        states.push(this.currentSong);
        chrome.storage.local.set({ pendingStates: states });
      });
    });
  }

  syncSongState() {
    chrome.runtime.sendMessage({
      type: 'SONG_STATE_UPDATE',
      data: this.currentSong
    }).catch((err) => {
      this.logger.warn('发送消息失败，使用storage降级', err);
      chrome.storage.local.get(['pendingStates'], (res) => {
        const states = res.pendingStates || [];
        states.push(this.currentSong);
        chrome.storage.local.set({ pendingStates: states });
      });
    });
  }

  /**
   * 设置消息监听
   */
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const { type, data } = message;

      switch (type) {
        case 'GET_CURRENT_SONG':
          // 返回当前歌曲信息
          sendResponse(this.currentSong);
          break;

        case 'CONFIG_UPDATE':
          // 更新配置
          this.config = { ...this.config, ...data };
          this.logger.debug('配置已更新', this.config);
          sendResponse({ success: true });
          break;

        case 'REMOVE':
          // 歌曲从喜欢列表移除
          if (data && data.songName) {
            toast.showSongRemove(data.songName, data.artists.join('/'));
          }
          sendResponse({ success: true });
          break;

        case 'SECOND_SKIP_DISABLED':
          if (data && data.songName) {
            toast.showSongAlreadyAdded(data.songName, data.artists.join('/'));
          }
          sendResponse({ success: true });
          break;

        case 'SONG_ADDED':
          // 歌曲添加成功提示
          if (data && data.songName) {
            toast.showSongAdded(data.songName, data.artists.join('/'));
          }
          sendResponse({ success: true });
          break;

        case 'COOKIE_ISSUE':
          this.logger.logCookieIssue('收到Cookie问题通知', data);
          toast.showCookieIssue();
          sendResponse({ success: true });
          break;

        case 'PLAYLIST_NOT_FOUND':
          this.logger.logPlaylistIssue('收到歌单问题通知', data);
          toast.showPlaylistNotFound();
          sendResponse({ success: true });
          break;

        case 'ADD_FAILED':
          if (data && data.songName) {
            toast.showAddFailed(data.songName, data.artists.join('/'));
          }
          sendResponse({ success: true });
          break;

        case 'EXTRACT_COOKIES':
          // 从页面提取Cookie
          sendResponse({ cookies: document.cookie });
          break;

        case 'FETCH_FAVORITE_SONGS':
          let playlistId = data.playlistId;
          this.syncFavoritePlaylist(playlistId);
          sendResponse({ success: true});
          break;

        default:
          this.logger.debug('未知消息类型', { type, data });
          sendResponse({ error: 'unknown_type' });
      }

      return true; // 保持消息通道开放
    });
  }
}

// 初始化content script
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.contentScript = new ContentScript();
  });
} else {
  window.contentScript = new ContentScript();
}