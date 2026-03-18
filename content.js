class ContentScript {
  constructor() {
    console.log('[ContentScript] 构造函数开始执行');
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
    this.logger.info('[init]内容脚本启动');
    
    // 监听DOM变化
    console.log('[init] 监听DOM变化');
    this.observePlayer();
    
    // 监听点击事件
    console.log('[init] 监听点击事件');
    this.trackUserClicks();
    
    // 跟踪播放进度
    console.log('[init] 跟踪播放进度');
    this.trackPlayProgress();
    
    // 监听来自background的消息
    this.setupMessageListener();
    
    // 定期同步状态
    setInterval(() => this.syncSongState(), 1000);
    
    // 初始化获取一次歌曲信息
    setTimeout(() => this.updateSongInfo(), 2000);
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
      this.logger.info('捕获到点击事件', {
        tag: target.tagName,
        id: target.id,
        classes: target.className,
        text: target.innerText?.substring(0, 30),
        path: e.composedPath?.().map(el => el.tagName).join(' > ') // 事件路径
      });
  
      // 检测下一曲按钮（覆盖更多选择器）
      const nextButtonSelectors = [
        // '下一曲', '下一首', 'next', 'skip', '跳过',
        // 'icon-next', 'btn-next', 'skip-btn', 'forward',
        // 'control-next', 'skip-forward', 'step-forward',
        // '播放下一首', '播放下一曲', '下一首歌',
        // 'next-song', 'next-track', 'skip-track',
        // 'forward-step', 'fast-forward', 'go-forward',
        // '跳过歌曲', '跳过当前', '切换歌曲', '下一首歌曲',
        '.nxt', '.next-btn', '[data-action="next"]', '.icon-next',
        '.playbar__next', 'button[title="下一曲"]', 'button[aria-label="下一曲"]'
        // 根据实际日志添加更多选择器
      ];
  
      const isNext = nextButtonSelectors.some(selector => 
        target.matches(selector) || target.closest(selector)
      );
  
      if (isNext) {
        this.logger.info('检测到下一曲点击');
        e.preventDefault(); // 可选，但建议保留
        this.currentSong.isManualSkip = true;
        this.currentSong.lastClickTime = Date.now();
        // this.handleNextButtonClick(e);
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
        this.logger.info('检测到进度条点击');
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

    // // 监听播放状态变化
    // const audio = document.querySelector('audio');
    // if (audio) {
    //   audio.addEventListener('pause', () => {
    //     this.logger.debug('播放暂停');
    //   });

    //   audio.addEventListener('play', () => {
    //     this.logger.debug('继续播放');
    //   });

    //   audio.addEventListener('ended', () => {
    //     this.logger.debug('歌曲自然结束');
    //     this.currentSong.isManualSkip = false; // 自然结束不是跳过
    //   });
    // }
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
      // 方法1：从音频元素获取（最准确）
      const audio = document.querySelector('audio');
      if (audio && audio.duration && !isNaN(audio.duration)) {
        const currentTime = audio.currentTime || 0;
        const duration = audio.duration || 0;
        return {
          currentTime: currentTime,
          duration: duration,
          percent: duration > 0 ? (currentTime / duration) * 100 : 0
        };
      }

      // 方法2：从进度条样式获取
      const progressBar = document.querySelector('.j-flag, .playbar-progress, .m-pbar .cur');
      if (progressBar && progressBar.style.width) {
        const percent = parseFloat(progressBar.style.width) || 0;
        // 尝试获取总时长来计算具体时间
        const duration = this.getDurationFromDOM();
        if (duration > 0) {
          return {
            currentTime: (percent / 100) * duration,
            duration: duration,
            percent: percent
          };
        }
        return {
          currentTime: null,
          duration: null,
          percent: percent
        };
      }

      // 方法3：从时间显示获取（网易云经典界面）
      const timeCurrent = document.querySelector('.time-current, .play-time, .current-time');
      const timeTotal = document.querySelector('.time-total, .total-time, .duration');
      
      if (timeCurrent && timeTotal) {
        const current = this.parseTime(timeCurrent.textContent);
        const total = this.parseTime(timeTotal.textContent);
        
        if (total > 0) {
          return {
            currentTime: current,
            duration: total,
            percent: (current / total) * 100
          };
        }
      }

      // 方法4：从播放器状态获取（新版界面）
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
    try {
      // 方法1：从播放器数据属性获取
      const player = document.querySelector('.m-player, .play-bar');
      if (player && player.dataset && player.dataset.songid) {
        return player.dataset.songid;
      }

      // 方法2：从音频元素获取
      const audio = document.querySelector('audio');
      if (audio && audio.src) {
        const match = audio.src.match(/song\/(\d+)/);
        if (match) {
          return match[1];
        }
      }

      // 方法3：从DOM中的data-id属性获取
      const songElement = document.querySelector('[data-song-id], .song-id');
      if (songElement && songElement.dataset && songElement.dataset.songId) {
        return songElement.dataset.songId;
      }

      // 方法4：从URL参数获取
      const urlParams = new URLSearchParams(window.location.search);
      const id = urlParams.get('id');
      if (id && /^\d+$/.test(id)) {
        return id;
      }

      return null;
    } catch (error) {
      this.logger.debug('获取歌曲ID失败', error);
      return null;
    }
  }

  /**
   * 获取当前歌曲名称
   * @returns {string|null} 歌曲名称
   */
  getSongName() {
    try {
      const selectors = [
        '.song-name',
        '.fc1',
        '.tit',
        '.f-thide',
        '.song-title',
        '.song_info .name'
      ];
      
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent) {
          return element.textContent.trim();
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
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
          artists.push(el.textContent.trim());
        }
      });
      
      return artists;
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
  handleSongChange() {
    this.logger.info('检测到歌曲切换');
    
    // 保存当前歌曲信息
    this.updateSongInfo();
    
    // 重置手动跳过标记（新歌）
    this.currentSong.isManualSkip = false;
    
    // 同步状态到background
    this.syncSongState();
  }

  /**
   * 更新歌曲信息
   */
  updateSongInfo() {
    const songId = this.getSongId();
    if (songId) {
      this.currentSong.id = songId;
      this.currentSong.name = this.getSongName();
      this.currentSong.artists = this.getArtists();
      
      this.logger.debug('更新歌曲信息', {
        id: this.currentSong.id,
        name: this.currentSong.name,
        artists: this.currentSong.artists
      });
    }
  }

  /**
   * 同步歌曲状态到background
   */
  // syncSongState() {
  //   chrome.runtime.sendMessage({
  //     type: 'SONG_STATE_UPDATE',
  //     data: this.currentSong
  //   }).catch(() => {
  //     // background可能还没准备好，忽略错误
  //   });
  // }
  syncSongState() {
    chrome.runtime.sendMessage({
        type: 'SONG_STATE_UPDATE',
        data: this.currentSong
      }).catch(() => {
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

        case 'SONG_ADDED':
          // 歌曲添加成功提示
          if (data && data.songName) {
            toast.showSongAdded(data.songName);
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
            toast.showAddFailed(data.songName);
          }
          sendResponse({ success: true });
          break;

        case 'EXTRACT_COOKIES':
          // 从页面提取Cookie
          sendResponse({ cookies: document.cookie });
          break;

        default:
          this.logger.debug('未知消息类型', { type, data });
          sendResponse({ error: 'unknown_type' });
      }

      return true; // 保持消息通道开放
    });
  }

  /**
   * 获取歌曲详细信息（扩展方法）
   */
  getDetailedSongInfo() {
    return {
      ...this.currentSong,
      album: this.getAlbum(),
      cover: this.getCoverUrl(),
      quality: this.getAudioQuality(),
      url: window.location.href
    };
  }

  /**
   * 获取专辑信息
   */
  getAlbum() {
    try {
      const albumElement = document.querySelector('.album, .song-album');
      return albumElement ? albumElement.textContent.trim() : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 获取封面URL
   */
  getCoverUrl() {
    try {
      const coverElement = document.querySelector('.cover img, .pic img, .j-img');
      return coverElement ? coverElement.src : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 获取音频质量
   */
  getAudioQuality() {
    try {
      const qualityElement = document.querySelector('.quality, .bitrate');
      return qualityElement ? qualityElement.textContent.trim() : 'standard';
    } catch (error) {
      return 'standard';
    }
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