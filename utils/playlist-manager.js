class PlaylistManager {
  constructor(cookieManager, logger) {
    this.cookieManager = cookieManager;
    this.logger = logger || new Logger('PlaylistManager');
    this.retryCount = 3;
    this.retryDelay = 2000;
  }

  // utils/playlist-manager.js - 修复findFadeOutPlaylist方法

  async findFadeOutPlaylist(cookieString) {
    try {
      this.logger.debug('开始查找淡出歌单');

      // 第一步：先获取当前登录用户的ID
      const userId = await this.getCurrentUserId(cookieString);
      if (!userId) {
        this.logger.logPlaylistIssue('无法获取用户ID，请确认登录状态');
        return null;
      }
      
      this.logger.debug('获取到用户ID', { userId });

      // 第二步：使用用户ID获取该用户的歌单
      // 使用正确的API路径（参考搜索结果中的 /user/playlist [citation:9]）
      const response = await fetch(
        `https://music.163.com/api/user/playlist/?uid=${userId}&limit=100&offset=0`,
        {
          headers: { 
            'Cookie': cookieString,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://music.163.com/',
            'Accept': 'application/json, text/plain, */*'
          },
          credentials: 'include'
        }
      );

      if (!response.ok) {
        this.logger.logPlaylistIssue('获取歌单列表HTTP错误', {
          status: response.status,
          statusText: response.statusText
        });
        return null;
      }

      const data = await response.json();
      
      // 检查返回码
      if (data.code !== 200) {
        this.logger.logPlaylistIssue('获取歌单列表失败', { code: data.code });
        
        // 如果返回301，说明需要登录
        if (data.code === 301) {
          this.logger.logCookieIssue('需要重新登录');
        }
        return null;
      }

      // 检查是否有歌单数据
      if (!data.playlist || !Array.isArray(data.playlist)) {
        this.logger.logPlaylistIssue('返回数据中没有歌单列表', data);
        return null;
      }

      // 从所有歌单中查找"淡出"歌单
      const fadeOutPlaylist = data.playlist.find(p => 
        p.name && (
          p.name.includes('淡出') || 
          p.name.includes('Fade Out') ||
          p.name.includes('跳过')
        )
      );

      if (!fadeOutPlaylist) {
        this.logger.logPlaylistIssue('未找到淡出歌单', {
          availablePlaylists: data.playlist.slice(0, 5).map(p => p.name)
        });
        
        // 可选：返回第一个歌单作为默认
        // return data.playlist[0] || null;
        return null;
      }

      this.logger.info('找到淡出歌单', {
        id: fadeOutPlaylist.id,
        name: fadeOutPlaylist.name,
        trackCount: fadeOutPlaylist.trackCount
      });

      return fadeOutPlaylist;

    } catch (error) {
      this.logger.logPlaylistIssue('查找歌单时发生异常', {
        message: error.message,
        stack: error.stack
      });
      return null;
    }
  }

  /**
   * 获取当前登录用户的ID
   */
  async getCurrentUserId(cookieString) {
    try {
      // 方法1：从用户详情接口获取（参考搜索结果 [citation:3]）
      const response = await fetch('https://music.163.com/api/nav/account/get', {
        headers: { 
          'Cookie': cookieString,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        credentials: 'include'
      });
      
      const data = await response.json();
      
      // 尝试从不同字段获取用户ID
      if (data.account && data.account.id) {
        return data.account.id;
      }
      if (data.profile && data.profile.userId) {
        return data.profile.userId;
      }
      
      // 方法2：从用户主页HTML中提取
      const homeResponse = await fetch('https://music.163.com/', {
        headers: { 'Cookie': cookieString }
      });
      
      const html = await homeResponse.text();
      
      // 多种正则匹配方式
      const patterns = [
        /userId["']?\s*[:=]\s*["']?(\d+)["']?/,
        /uid["']?\s*[:=]\s*["']?(\d+)["']?/,
        /GUser\[(\d+)\]/
      ];
      
      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) {
          return match[1];
        }
      }
      
      // 方法3：从MUSIC_U中解析
      const musicUMatch = cookieString.match(/MUSIC_U=([^;]+)/);
      if (musicUMatch) {
        // 有些MUSIC_U格式包含用户ID
        const uidMatch = musicUMatch[1].match(/(\d+)/);
        if (uidMatch) {
          return uidMatch[1];
        }
      }
      
      this.logger.logPlaylistIssue('无法从任何来源获取用户ID');
      return null;
      
    } catch (error) {
      this.logger.logPlaylistIssue('获取用户ID失败', error);
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
        this.logger.debug('歌曲添加成功', { songId, playlistId });
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
            if (data.message === "歌单内歌曲重复") {
              return { success: true, data };
            }
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


  /**
   * 获取“我喜欢的音乐”歌单 ID
   */
  async getFavoritePlaylistId(cookieString) {
    try {
      // 获取用户所有歌单
      const response = await fetch(
        `https://music.163.com/api/user/playlist/?limit=100&offset=0`,
        { headers: { 'Cookie': cookieString } }
      );

      const data = await response.json();
      
      if (data.code === 200 && data.playlist) {
        // 查找“我喜欢的音乐”歌单（通常有特殊标记）
        const favorite = data.playlist.find(p => 
          p.specialType === 5 ||  // 网易云特殊类型：我喜欢的音乐
          p.name === '我喜欢的音乐' ||
          p.name === '我喜欢的音乐' ||
          p.name.includes('喜欢的音乐')
        );
        
        if (favorite) {
          this.logger.info('找到我喜欢的音乐歌单', { id: favorite.id, name: favorite.name });
          return favorite.id;
        }
      }
      
      this.logger.warn('未找到我喜欢的音乐歌单');
      return null;
    } catch (error) {
      this.logger.error('获取我喜欢的音乐歌单失败', error);
      return null;
    }
  }

  /**
   * 从歌单中移除歌曲
   */
  async removeFromPlaylist(songId, playlistId, cookieString) {
    try {
      this.logger.debug('尝试从歌单移除歌曲', { songId, playlistId });

      const response = await fetch('https://music.163.com/api/playlist/manipulate/tracks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': cookieString
        },
        body: new URLSearchParams({
          op: 'del',              // del 表示删除
          pid: playlistId,
          trackIds: `[${songId}]`
        })
      });

      const data = await response.json();

      if (data.code === 200) {
        this.logger.info('歌曲移除成功', { songId, playlistId });
        return { success: true, data };
      } else {
        this.logger.logApiIssue('移除失败', { code: data.code, message: data.message });
        return { success: false, error: data };
      }

    } catch (error) {
      this.logger.logApiIssue('移除歌曲请求失败', error);
      return { success: false, error };
    }
  }
}