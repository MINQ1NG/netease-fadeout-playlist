class Toast {
  constructor() {
    this.container = null;
  }

  // 确保容器存在
  ensureContainer() {
    if (this.container) return;
    
    if (!document.body) {
      // body 尚不存在，监听 DOMContentLoaded
      document.addEventListener('DOMContentLoaded', () => this.createContainer());
      return;
    }
    this.createContainer();
  }

  createContainer() {
    this.container = document.createElement('div');
    this.container.id = 'netease-toast-container';
    this.container.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
    `;
    document.body.appendChild(this.container);
  }

  show(message, type = 'info', duration = 3000, songName = null, songArtists = null,) {
    this.ensureContainer(); // 确保容器已存在
    const toast = document.createElement('div');
    toast.className = `netease-toast netease-toast-${type}`;
    
    // 添加图标
    const icon = this.getIcon(type);

    // 如果有歌曲信息，显示歌曲名称（加粗）和歌手（浅灰色）
    let contentHtml = '';
    if (songName) {
      let artists = '';
 
      artists = `<span class="toast-artists"> - ${this.escapeHtml(songArtists)}</span>`;
      
      contentHtml = `
        <div class="toast-song-info">
          <strong class="toast-songname">${this.escapeHtml(songName)}</strong>
          ${artists}
        </div>
      `;
    }
    if (message) {
      contentHtml += `<div class="toast-message">${this.escapeHtml(message)}</div>`;
    }
    
    
    toast.innerHTML = `
      <div class="toast-icon">${icon}</div>
      <div class="toast-content">${contentHtml}</div>
      <div class="toast-progress"></div>
    `;

    this.container.appendChild(toast);

    // 动画进入
    setTimeout(() => toast.classList.add('show'), 10);

    // 自动消失
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  getIcon(type) {
    switch (type) {
      case 'success':
        return '✓';
      case 'error':
        return '✗';
      case 'warning':
        return '⚠';
      case 'info':
      default:
        return 'ℹ';
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 特定场景的提示
  showSongAdded(songName, songArtists) {
    this.show(`已加入淡出歌单`, 'success', 4000, songName, songArtists);
  }

  showSongRemove(songName, songArtists) {
    this.show(`已从喜欢歌单移除`, 'success', 4000, songName, songArtists);
  }

  showCookieIssue() {
    this.show('Cookie需要更新，请重新登录网易云音乐', 'warning', 5000);
  }

  showPlaylistNotFound() {
    this.show('未找到淡出歌单，请先创建一个包含"淡出"名称的歌单', 'error', 6000);
  }

  showAddFailed(songName, songArtists) {
    this.show(`加入歌单失败，请检查网络`, 'error', 4000, songName, songArtists);
  }

  showStatusError(errorMsg) {
    this.show(`状态异常: ${errorMsg}`, 'error', 5000);
  }
}

// 创建全局toast实例
const toast = new Toast();
