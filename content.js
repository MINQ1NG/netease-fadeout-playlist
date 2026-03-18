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
      lastClickTime: null
    };
    
    this.config = {
      fadeOutPlaylistId: null,
      fadeOutPlaylistName: null
    };

    this.init();
  }

  init() {
    this.logger.info('内容脚本启动');
    
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

    // 观察歌曲标题元素
    const songTitle = document.querySelector('.song-name, .fc1');
    if (songTitle) {
      observer.observe(songTitle, {
        childList: true,
        characterData: true,
        subtree: true
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
    // 监听下一曲按钮点击
    document.addEventListener('click', (e) => {
      const nextButton = e.target.closest('.nxt, .next-btn, [data-action="next"]');
      if (nextButton) {
        this.currentSong.isManualSkip = true;
        this.currentSong.lastClickTime = Date.now();
        this.logger.debug('检测到手动点击下一曲');
      }
    });

    // 监听键盘事件
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
    }
  }

  getPlayProgress() {
    // 尝试多种方式获取播放进度
    try {
      // 方法1：从进度条获取
      const progressBar = document.querySelector('.j-flag, .playbar-progress');
      if (progressBar && progressBar.style.width) {
        const percent = parseFloat(progressBar.style.width) || 0;
        return {
          currentTime: null,
          duration: null,
          percent
        };
      }

      // 方法2：从音频元素获取
      const audio = document.querySelector('audio');
      if (audio && audio.duration) {
        return {
          currentTime: audio.currentTime,
          duration: audio.duration,
          percent: (audio.currentTime / audio.duration) * 100
        };
      }

      // 方法3：从时间显示获取
      const timeCurrent = document.querySelector('.time-current, .play-time');
      const timeTotal = document.querySelector('.time-total, .total-time');
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

      return null;
    } catch (error) {
      this.logger.debug('获取播放进度失败', error);
      return null;
    }
  }

  parseTime(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':').map(Number);
    if (parts.length
