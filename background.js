importScripts(
  'utils/logger.js',
  'utils/cookie-manager.js',
  'utils/playlist-manager.js'
);

class BackgroundService {
  constructor() {
    this.processedSongIds = new Set();
    this.logger = new Logger('Background');
    this.cookieManager = new CookieManager(this.logger);
    this.playlistManager = null;
    this.config = {
      fadeOutPlaylistId: null,
      fadeOutPlaylistName: null,
      lastCookieRefresh: null
    };

    this.pendingInterval = null;
    this.init();
  }

  async init() {
    this.logger.info('后台服务启动');
    
    // 加载配置
    await this.loadConfig();
    
    // 初始化Cookie
    await this.initializeCookies();
    
    // 初始化歌单
    await this.initializePlaylist();
    
    // 设置监听器
    this.setupListeners();
    this.logger.info();('监听中...');
    
    // 定时任务
    this.setupScheduledTasks();
    this.startCleanupTimer();
    this.startPendingProcessor();
  }

  async loadConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get([
        'fadeOutPlaylistId',
        'fadeOutPlaylistName',
        'lastCookieRefresh'
      ], (result) => {
        this.config = { ...this.config, ...result };
        this.logger.debug('配置加载完成', this.config);
        resolve();
      });
    });
  }

  async initializeCookies() {
    try {
      const cookies = await this.cookieManager.refreshIfNeeded();
      
      if (!cookies) {
        this.logger.logCookieIssue('初始化Cookie失败');
        this.notifyContentScript('COOKIE_ISSUE', {
          message: '请确保已登录网易云音乐网页版'
        });
        return;
      }

      this.config.lastCookieRefresh = Date.now();
      await this.saveConfig();
      
      this.logger.info('Cookie初始化成功');
      
    } catch (error) {
      this.logger.logCookieIssue('初始化Cookie异常', error);
    }
  }

  async initializePlaylist() {
    try {
      if (this.config.fadeOutPlaylistId) {
        this.logger.info('使用已保存的歌单', {
          id: this.config.fadeOutPlaylistId,
          name: this.config.fadeOutPlaylistName
        });
        this.playlistManager = new PlaylistManager(this.cookieManager, this.logger);
        return;
      }

      const cookies = await this.cookieManager.getNeteaseCookies();
      if (!cookies) {
        this.logger.logCookieIssue('无法获取Cookie，跳过歌单初始化');
        return;
      }

      this.playlistManager = new PlaylistManager(this.cookieManager, this.logger);
      
      const playlist = await this.playlistManager.findFadeOutPlaylist(cookies.raw);
      
      if (playlist) {
        this.config.fadeOutPlaylistId = playlist.id;
        this.config.fadeOutPlaylistName = playlist.name;
        await this.saveConfig();
        
        this.logger.info('歌单初始化成功', {
          id: playlist.id,
          name: playlist.name
        });
      } else {
        this.logger.logPlaylistIssue('初始化歌单失败：未找到淡出歌单');
        this.notifyContentScript('PLAYLIST_NOT_FOUND', {});
      }

    } catch (error) {
      this.logger.logPlaylistIssue('初始化歌单异常', error);
    }
  }

  setupListeners() {
    // 监听来自content script的消息
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));

    // 监听标签页更新
    chrome.tabs.onUpdated.addListener(this.handleTabUpdate.bind(this));
  }
  
  async shouldAddToPlaylist(song) {
    // 基本条件检查
    if (!song || !song.id) {
      return false;
    }

    // 检查进度
    if (song.playPercent >= 50) {
      this.logger.info('歌曲播放超过50%，不加入歌单', {
        name: song.name,
        artists: song.artists,
        progress: song.playPercent
      });
      return false;
    }

    // 检查是否为手动跳过
    if (!song.isManualSkip) {
      this.logger.info('非手动跳过，不加入歌单', {
        name: song.name,
        artists: song.artists,
      });
      return false;
    }

    // 检查歌曲时长
    if (song.progress < 30) {
      this.logger.info('歌曲时长过短，不加入歌单', {
        name: song.name,
        artists: song.artists,
        progress: song.progress
      });
      return false;
    }

    // 检查歌单配置
    if (!this.config.fadeOutPlaylistId) {
      this.logger.logPlaylistIssue('歌单未配置，无法添加歌曲');
      this.notifyContentScript('PLAYLIST_NOT_FOUND', {});
      return false;
    }

    // 检查Cookie
    const cookies = await this.cookieManager.refreshIfNeeded();
    if (!cookies) {
      this.logger.logCookieIssue('Cookie无效，无法添加歌曲');
      this.notifyContentScript('COOKIE_ISSUE', {
        message: 'Cookie需要更新'
      });
      return false;
    }

    return true;
  }

  async addSongToPlaylist(song) {
    try {
      const cookies = await this.cookieManager.getNeteaseCookies();
      if (!cookies) {
        throw new Error('无法获取Cookie');
      }

      // 检查歌曲是否已在歌单中 存在问题 待修复
      // const exists = await this.playlistManager.checkSongInPlaylist(
      //   song.id,
      //   this.config.fadeOutPlaylistId,
      //   cookies.raw
      // );

      // if (exists) {
      //   this.logger.info('歌曲已在歌单中', { name: song.name, artists: song.artists });
      //   return;
      // }

      // 添加到歌单
      const result = await this.playlistManager.addToPlaylist(
        song.id,
        this.config.fadeOutPlaylistId,
        cookies.raw
      );

      if (result.success) {
        if (result.data.code == 502) {
          this.logger.debug('歌曲已在淡出歌单中', { name: song.name, artists: song.artists, id: song.id });

          // 通知content script显示成功提示
          this.notifyContentScript('ALREADY_ADDED', {
            songName: song.name,
            artists: song.artists,
            playlistName: this.config.fadeOutPlaylistName
          });
        } else{
          this.logger.debug('歌曲加入歌单成功', { name: song.name, artists: song.artists, id: song.id });

          // 通知content script显示成功提示
          this.notifyContentScript('SONG_ADDED', {
            songName: song.name,
            songArtists: song.artists,
            playlistName: this.config.fadeOutPlaylistName
          });
        }
        

      } else {
        // 处理特定错误
        if (result.needRefreshCookie) {
          this.logger.logCookieIssue('添加失败，需要刷新Cookie');
          this.notifyContentScript('COOKIE_ISSUE', {
            message: 'Cookie已过期，请重新登录'
          });
        } else if (result.needRefreshPlaylist) {
          this.logger.logPlaylistIssue('添加失败，歌单不存在');
          this.notifyContentScript('PLAYLIST_NOT_FOUND', {});
        } else {
          this.logger.logApiIssue('添加失败', result.error);
          this.notifyContentScript('ADD_FAILED', {
            songName: song.name,
            songArtists: song.artists,
          });
        }
      }

    } catch (error) {
      this.logger.error('添加歌曲到歌单失败', error);
      this.notifyContentScript('ADD_FAILED', {
        songName: song.name,
        songArtists: song.artists
      });
    }
  }

  async getCurrentSongFromTab(tabId) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, {
        type: 'GET_CURRENT_SONG'
      }, (response) => {
        if (chrome.runtime.lastError) {
          this.logger.debug('获取歌曲信息失败', chrome.runtime.lastError);
          resolve(null);
        } else {
          resolve(response);
        }
      });
    });
  }

  startPendingProcessor() {
    this.pendingInterval = setInterval(() => {
      this.processPendingStates();
    }, 5000);
  }

  processPendingStates() {
    chrome.storage.local.get(['pendingStates'], (res) => {
      // 处理逻辑...
      const states = res.pendingStates || [];
      if (states.length > 0) {
        this.logger.debug(`处理 ${states.length} 条待处理状态`);
        // 取最新一条（或全部）进行处理，具体逻辑根据你的业务决定
        const latest = states[states.length - 1];
        // 合并到当前状态
        if (latest) {
          this.currentSong = latest;
        }
        // 清空或移除已处理的
        chrome.storage.local.set({ pendingStates: [] });
      }
    });
  }

  onDisable() {
    if (this.pendingInterval) {
      clearInterval(this.pendingInterval);
    }
  }

  startCleanupTimer() {
    setInterval(() => {
      // 可以按时间清理，但简单起见可让 Set 自然增长，或根据业务选择清理
      // 如果担心内存，可以只保留最近 N 条
      if (this.processedSongIds.size > 100) {
        // 简单清除所有，更精细可基于时间戳
        this.processedSongIds.clear();
      }
    }, 3600000); // 每小时清理一次
  }

  async handleMessage(message, sender, sendResponse) {
    const { type, data } = message;

    switch (type) {
      case 'LOG_WARNING':
        this.logger.warn(`来自${data.module}的警告`, data.message);
        break;

      case 'LOG_ERROR':
        this.logger.error(`来自${data.module}的错误`, data.message);
        // 检查是否需要显示给用户
        if (data.message.includes('Cookie')) {
          this.notifyContentScript('COOKIE_ISSUE', {
            message: 'Cookie出现异常'
          });
        }
        break;

      case 'GET_CONFIG':
        sendResponse(this.config);
        break;

      case 'SONG_CHANGE_UPDATE':
        // 保存当前歌曲状态
        const song = data;
        this.logger.debug('收到歌曲变更', song);
        // 去重检查（必须放在最前面）
        if (this.processedSongIds.has(song.id)) {
          this.logger.debug('歌曲已处理过，跳过');
          sendResponse({ status: 'skipped' });
          break;
        }
        // 先加入去重集合，防止重复处理（即使后续判断失败也标记，避免反复尝试）
        this.processedSongIds.add(song.id);
        setTimeout(() => {this.processedSongIds.delete(song.id);}, 7200000);
        
        const shouldAdd = await this.shouldAddToPlaylist(song);
        if (shouldAdd) {
          await this.addSongToPlaylist(song);
        } else {
          this.logger.debug('不满足添加条件，跳过', { songId: song.id, reason: 'shouldAddToPlaylist returned false' });
        }

        
        sendResponse({ status: 'ok' });
        break;

      case 'SONG_STATE_UPDATE':
        // 保存当前歌曲状态
        this.currentSong = data;
        sendResponse({ status: 'ok' });
        break;

      case 'REFRESH_COOKIES':
        this.initializeCookies().then(() => sendResponse({ success: true }));
        return true;

      case 'REFRESH_PLAYLIST':
        this.initializePlaylist().then(() => sendResponse({ success: true }));
        return true;
    }
    return true;
  }

  notifyContentScript(type, data) {
    chrome.tabs.query({ url: ["*://music.163.com/*"] }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type, data });
      });
    });
  }

  handleTabUpdate(tabId, changeInfo, tab) {
    if (changeInfo.status === 'complete' && tab.url.includes('music.163.com')) {
      this.logger.debug('网易云页面加载完成', { tabId });
      
      // 发送当前配置到content script
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, {
          type: 'CONFIG_UPDATE',
          data: this.config
        });
      }, 2000);
    }
  }

  setupScheduledTasks() {
    // 每天检查一次Cookie
    setInterval(() => {
      this.logger.info('执行定时Cookie检查');
      this.initializeCookies();
    }, 24 * 60 * 60 * 1000);

    // 每周检查一次歌单
    setInterval(() => {
      this.logger.info('执行定时歌单检查');
      this.initializePlaylist();
    }, 7 * 24 * 60 * 60 * 1000);
  }

  async saveConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.set(this.config, resolve);
    });
  }
}

// 启动后台服务
new BackgroundService();
