class PlaylistManager {
  constructor(cookieManager, logger) {
    this.cookieManager = cookieManager;
    this.logger = logger || new Logger('PlaylistManager');
    this.retryCount = 3;
    this.retryDelay = 2000;
  }

  async findFadeOutPlaylist(cookieString) {
    try {
      this.logger.debug('开始查找淡出歌单');

      // 1. 获取用户信息
      const userInfo = await this.getUserInfo(cookieString);
      if (!userInfo) {
        this.logger.logPlaylistIssue('无法获取用户信息');
        return null;
      }

      // 2. 获取用户所有歌单
      const playlists = await this.getUserPlaylists(userInfo.userId, cookieString);
      if (!playlists || playlists.length === 0) {
        this.logger.logPlaylistIssue('获取歌单列表为空');
        return null;
      }

      // 3. 查找"淡出"歌单
      const fadeOutPlaylist = playlists.find(p => 
        p.name.includes('淡出') || 
        p.name.includes('Fade Out') ||
        p.name.includes('跳过')
      );

      if (!fadeOutPlaylist) {
        this.logger.logPlaylistIssue('未找到淡出歌单', {
          availablePlaylists: playlists.map(p => p.name).slice(0, 5)
        });
        return null;
      }

      this.logger.info('找到淡出歌单', {
        id: fadeOutPlaylist.id,
        name: fadeOutPlaylist.name,
        trackCount: fadeOutPlaylist.trackCount
      });

      return fadeOutPlaylist;

    } catch (error) {
      this.logger.logPlaylistIssue('查找歌单时发生异常', error);
      return null;
    }
  }

  async getUserInfo(cookieString) {
    try {
      const response = await fetch('https://music.163.com/api/nav/account/get', {
        headers: { 'Cookie': cookieString }
      });

      if (!response.ok) {
        this.logger.logApiIssue('获取用户信息失败', {
          status: response.status
        });
        return null;
      }

      const data = await response.json();
      return data.account ? { userId: data.account.id } : null;

    } catch (error) {
      this.logger.logApiIssue('获取用户信息请求失败', error);
      return null;
    }
  }

  async getUserPlaylists(userId, cookieString, offset = 0, allPlaylists = []) {
    try {
      const response = await fetch(
        `https://music.163.com/api/user/playlist/?uid=${userId}&limit=100&offset=${offset}`,
        { headers: { 'Cookie': cookieString } }
      );

      if (!response.ok) {
        this.logger.logApiIssue('获取歌单列表失败', {
          status: response.status,
          offset
        });
        return allPlaylists;
      }

      const data = await response.json();
      const playlists = data.playlist || [];
      
      allPlaylists = allPlaylists.concat(playlists);

      // 如果还有更多歌单，继续获取
      if (playlists.length === 100) {
        this.logger.debug('继续获取下一页歌单', { offset: offset + 100 });
        return this.getUserPlaylists(userId, cookieString, offset + 100, allPlaylists);
      }

      return allPlaylists;

    } catch (error) {
      this.logger.logApiIssue('获取歌单列表请求失败', error);
      return allPlaylists;
    }
  }

  async addToPlaylist(songId, playlistId, cookieString, retryCount = 0) {
    try {
      this.logger.debug('尝试添加歌曲到歌单', { songId, playlistId });

      const response = await fetch('https://music.163.com/api/playlist/manipulate/tracks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': cookieString
        },
        body: new URLSearchParams({
          op: 'add',
          pid: playlistId,
          trackIds: `[${songId}]`
        })
      });

      const data = await response.json();

      if (data.code === 200) {
        this.logger.info('歌曲添加成功', { songId, playlistId });
        return { success: true, data };
      } else {
        // 处理特定错误码
        switch (data.code) {
          case 401:
            this.logger.logCookieIssue('添加失败：Cookie无效或过期', { code: data.code });
            return { success: false, needRefreshCookie: true };
          case 404:
            this.logger.logPlaylistIssue('添加失败：歌单不存在', { playlistId });
            return { success: false, needRefreshPlaylist: true };
          case 502:
            if (retryCount < this.retryCount) {
              this.logger.warn(`添加失败，${this.retryDelay/1000}秒后重试`, { retryCount });
              await new Promise(r => setTimeout(r, this.retryDelay));
              return this.addToPlaylist(songId, playlistId, cookieString, retryCount + 1);
            }
          default:
            this.logger.logApiIssue('添加失败：未知错误', { code: data.code, message: data.message });
        }
        return { success: false, error: data };
      }

    } catch (error) {
      this.logger.logApiIssue('添加歌曲请求失败', error);
      
      // 网络错误重试
      if (retryCount < this.retryCount) {
        this.logger.warn(`网络错误，${this.retryDelay/1000}秒后重试`, { retryCount });
        await new Promise(r => setTimeout(r, this.retryDelay));
        return this.addToPlaylist(songId, playlistId, cookieString, retryCount + 1);
      }
      
      return { success: false, error };
    }
  }

  async checkSongInPlaylist(songId, playlistId, cookieString) {
    try {
      // 获取歌单详情
      const response = await fetch(
        `https://music.163.com/api/playlist/detail?id=${playlistId}`,
        { headers: { 'Cookie': cookieString } }
      );

      const data = await response.json();
      
      if (data.code === 200 && data.result && data.result.trackIds) {
        const exists = data.result.trackIds.some(t => t.id === parseInt(songId));
        this.logger.debug('检查歌曲是否已在歌单', { songId, exists });
        return exists;
      }

      return false;

    } catch (error) {
      this.logger.logApiIssue('检查歌曲是否在歌单时失败', error);
      return false;
    }
  }
}
