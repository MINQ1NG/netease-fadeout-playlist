class CookieManager {
  constructor(logger) {
    this.logger = logger || new Logger('CookieManager');
    this.cookieRefreshInterval = 7 * 24 * 60 * 60 * 1000; // 7天
  }
  // utils/cookie-manager.js - 修复validateCookie方法

  async validateCookie(cookie) {
    if (!cookie || !cookie.raw) {
      this.logger.logCookieIssue('Cookie为空，验证失败');
      return false;
    }

    // 检查过期时间
    if (cookie.expires && cookie.expires < Date.now()) {
      this.logger.logCookieIssue('Cookie已过期');
      return false;
    }

    // 检查必要字段
    if (!cookie.MUSIC_U) {
      this.logger.logCookieIssue('缺少MUSIC_U字段，可能未登录');
      return false;
    }

    try {
      // 方法1：使用用户歌单接口验证（更稳定）
      // const isValid = await this.validateViaPlaylistAPI(cookie);
      // if (isValid) {
      //   return true;
      // }
      
      // 方法2：使用用户收藏接口验证
      return await this.validateViaFavoriteAPI(cookie);

    } catch (error) {
      this.logger.logCookieIssue('Cookie验证请求失败', error);
      return false;
    }
  }

  /**
   * 通过用户歌单接口验证Cookie
   * 这个接口需要登录才能访问，返回200说明Cookie有效
   */
  async validateViaPlaylistAPI(cookie) {
    try {
      this.logger.debug('通过歌单接口验证Cookie');
      
      // 先获取用户ID
      const userId = await this.getUserId(cookie);
      if (!userId) {
        return false;
      }
      
      // 尝试获取用户歌单（需要登录的接口）
      const response = await fetch(
        `https://music.163.com/api/user/playlist/?uid=${userId}&limit=1&offset=0`,
        {
          headers: { 
            'Cookie': cookie.raw,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://music.163.com/'
          },
          credentials: 'include'
        }
      );

      if (!response.ok) {
        this.logger.logCookieIssue('歌单接口返回错误', {
          status: response.status,
          statusText: response.statusText
        });
        return false;
      }

      const data = await response.json();
      
      this.logger.debug('歌单接口返回', { 
        code: data.code,
        hasPlaylist: !!data.playlist,
        playlistCount: data.playlist?.length 
      });
      
      // code 200 且返回了歌单数据，说明Cookie有效
      if (data.code === 200) {
        if (data.playlist) {
          this.logger.info('Cookie验证成功 - 通过歌单接口');
          return true;
        } else if (data.code === 200) {
          // 即使没有歌单，返回200也说明登录状态有效
          this.logger.info('Cookie验证成功 - API返回200');
          return true;
        }
      } else if (data.code === 301) {
        this.logger.logCookieIssue('Cookie无效：需要登录', { code: 301 });
        return false;
      }
      
      return false;

    } catch (error) {
      this.logger.logCookieIssue('歌单接口验证失败', error);
      return false;
    }
  }

  /**
   * 通过用户收藏接口验证Cookie
   */
  async validateViaFavoriteAPI(cookie) {
    try {
      this.logger.debug('通过收藏接口验证Cookie');
      
      // 获取用户收藏的歌单（需要登录）
      const response = await fetch(
        'https://music.163.com/api/playlist/list?limit=1&offset=0&total=true&uid=',
        {
          headers: { 
            'Cookie': cookie.raw,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          credentials: 'include'
        }
      );

      const data = await response.json();
      
      if (data.code === 200) {
        this.logger.debug('Cookie验证成功 - 通过收藏接口');
        return true;
      }
      
      return false;
    } catch (error) {
      this.logger.debug('收藏接口验证失败', error);
      return false;
    }
  }

  /**
   * 获取用户ID（多种方式）
   */
  async getUserId(cookie) {
    try {
      // 方法1：从MUSIC_U中解析
      if (cookie.MUSIC_U) {
        // 有些MUSIC_U格式包含用户ID信息
        const match = cookie.MUSIC_U.match(/UID=(\d+)/);
        if (match) {
          return match[1];
        }
      }
      
      // 方法2：通过用户详情页获取
      const response = await fetch('https://music.163.com/', {
        headers: { 'Cookie': cookie.raw }
      });
      
      const html = await response.text();
      
      // 多种正则匹配方式
      const patterns = [
        /userId["']?\s*[:=]\s*["']?(\d+)["']?/,
        /uid["']?\s*[:=]\s*["']?(\d+)["']?/,
        /user\.id\s*=\s*(\d+)/,
        /"userId":(\d+)/
      ];
      
      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) {
          return match[1];
        }
      }
      
      // 方法3：通过API获取（如果上面的接口恢复了）
      try {
        const apiResponse = await fetch('https://music.163.com/api/nav/account/get', {
          headers: { 'Cookie': cookie.raw }
        });
        const data = await apiResponse.json();
        if (data.profile && data.profile.userId) {
          return data.profile.userId;
        }
      } catch (e) {
        // 忽略错误
      }
      
      return null;
    } catch (error) {
      this.logger.debug('获取用户ID失败', error);
      return null;
    }
  }
  // async validateCookie(cookie) {
  //   if (!cookie || !cookie.raw) {
  //     this.logger.logCookieIssue('Cookie为空，验证失败');
  //     return false;
  //   }

  //   // 检查过期时间
  //   if (cookie.expires && cookie.expires < Date.now()) {
  //     this.logger.logCookieIssue('Cookie已过期');
  //     return false;
  //   }

  //   // 检查必要字段
  //   if (!cookie.MUSIC_U) {
  //     this.logger.logCookieIssue('缺少MUSIC_U字段，可能未登录');
  //     return false;
  //   }

  //   try {
  //     // 方法1：使用带凭证的fetch请求
  //     const response = await fetch('https://music.163.com/api/nav/account/get', {
  //       headers: { 
  //         'Cookie': cookie.raw,
  //         'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  //         'Referer': 'https://music.163.com/'
  //       },
  //       credentials: 'include',  // 关键：携带凭证
  //       mode: 'cors'
  //     });

  //     if (!response.ok) {
  //       this.logger.logCookieIssue('Cookie验证失败，API返回错误', {
  //         status: response.status,
  //         statusText: response.statusText
  //       });

  //       // 如果是401，尝试备用验证方法
  //       if (response.status === 401) {
  //         return await this.alternativeValidateCookie(cookie);
  //       }
  //       return false;
  //     }

  //     const data = await response.json();
      
  //     // 检查返回码
  //     if (data.code === 301) {
  //       this.logger.logCookieIssue('Cookie验证失败：需要登录', { code: 301 });
  //       return await this.alternativeValidateCookie(cookie);
  //     }
      
  //     if (!data.account) {
  //       this.logger.logCookieIssue('Cookie验证失败，未获取到用户信息', {
  //         responseData: data
  //       });
        
  //       // 尝试备用验证方法
  //       return await this.alternativeValidateCookie(cookie);
  //     }

  //     this.logger.info('Cookie验证成功', { 
  //       userId: data.account.id,
  //       nickname: data.profile?.nickname 
  //     });
  //     return true;

  //   } catch (error) {
  //     this.logger.logCookieIssue('Cookie验证请求失败', error);

  //     // 网络错误时尝试备用方法
  //     return await this.alternativeValidateCookie(cookie);
  //   }
  // }


  // 新增：备用验证方法 - 通过用户歌单接口验证
  async alternativeValidateCookie(cookie) {
    try {
      this.logger.debug('尝试备用Cookie验证方法');
      
      // 先获取用户ID
      const userId = await this.getUserIdFromCookie(cookie);
      if (!userId) {
        return false;
      }
      
      // 尝试获取用户歌单（需要登录的接口）
      const response = await fetch(
        `https://music.163.com/api/user/playlist/?uid=${userId}&limit=1&offset=0`,
        {
          headers: { 
            'Cookie': cookie.raw,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          credentials: 'include'
        }
      );

      const data = await response.json();
      
      if (data.code === 200 && data.playlist) {
        this.logger.info('备用Cookie验证成功');
        return true;
      } else if (data.code === 301) {
        this.logger.logCookieIssue('备用验证失败：需要登录', { code: 301 });
        return false;
      } else {
        this.logger.logCookieIssue('备用验证失败', { code: data.code });
        return false;
      }

    } catch (error) {
      this.logger.logCookieIssue('备用验证失败', error);
      return false;
    }
  }

  // 新增：从Cookie中提取用户ID
  async getUserIdFromCookie(cookie) {
    try {
      // 方法1：从MUSIC_U中解析（如果包含）
      if (cookie.MUSIC_U) {
        // 有些MUSIC_U格式包含用户ID信息
        const match = cookie.MUSIC_U.match(/UID=(\d+)/);
        if (match) {
          return match[1];
        }
      }
      
      // 方法2：通过首页API获取（不需要登录）
      const response = await fetch('https://music.163.com/api/v1/user/info', {
        headers: { 'Cookie': cookie.raw }
      });
      
      const html = await response.text();
      // 从HTML中提取用户ID（如果有）
      const uidMatch = html.match(/userId["']?\s*:\s*["']?(\d+)["']?/);
      if (uidMatch) {
        return uidMatch[1];
      }

      return null;
    } catch (error) {
      this.logger.debug('从Cookie提取用户ID失败', error);
      return null;
    }
  }

  async refreshIfNeeded() {
    try {
      const stored = await new Promise((resolve) => {
        chrome.storage.local.get(['neteaseCookies'], resolve);
      });

      const cookies = stored.neteaseCookies;
      
      if (!cookies) {
        this.logger.logCookieIssue('存储中没有Cookie，需要重新获取');
        return await this.getNeteaseCookies();
      }

      // 检查是否需要刷新
      const age = Date.now() - (cookies.lastUpdated || 0);
      if (age > this.cookieRefreshInterval) {
        this.logger.info('Cookie需要刷新', {
          age: Math.floor(age / (24 * 60 * 60 * 1000)) + '天'
        });
        return await this.getNeteaseCookies();
      }

      // 验证存储的Cookie是否仍然有效
      if (!await this.validateCookie(cookies)) {
        this.logger.logCookieIssue('存储的Cookie已失效，需要重新获取');
        return await this.getNeteaseCookies();
      }

      this.logger.debug('Cookie仍然有效，无需刷新');
      return cookies;

    } catch (error) {
      this.logger.logCookieIssue('刷新Cookie时发生异常', error);
      return null;
    }
  }

  // 增强getNeteaseCookies方法
  // 增强版getNeteaseCookies方法

  async getNeteaseCookies() {
    try {
      this.logger.debug('正在获取网易云Cookie');
      
      // 方法1：使用chrome.cookies.getAll（需要在manifest中声明权限）
      let cookies = [];
      try {
        cookies = await new Promise((resolve, reject) => {
          chrome.cookies.getAll({
            url: "https://music.163.com"
          }, (cookies) => {
            if (chrome.runtime.lastError) {
              // 捕获Chrome API错误但不立即失败
              this.logger.warn('chrome.cookies.getAll 调用失败', chrome.runtime.lastError);
              reject(chrome.runtime.lastError);
            } else {
              resolve(cookies || []);
            }
          });
        });
      } catch (cookieError) {
        this.logger.warn('通过chrome.cookies获取失败，尝试备用方法', cookieError);
        
        // 方法2：通过content script从页面获取
        cookies = await this.getCookiesFromContentScript();
      }

      if (!cookies || cookies.length === 0) {
        this.logger.logCookieIssue('未找到网易云Cookie，请确保已登录网易云音乐网页版');
        
        // 尝试从storage获取上次保存的Cookie
        const stored = await this.getStoredCookies();
        if (stored) {
          this.logger.info('使用存储的Cookie');
          return stored;
        }
        
        return null;
      }

      // 提取关键Cookie信息
      const MUSIC_U = this.extractCookieValue(cookies, 'MUSIC_U');
      const __csrf = this.extractCookieValue(cookies, '__csrf');
      const MUSIC_R_T = this.extractCookieValue(cookies, 'MUSIC_R_T');
      
      // 如果没有MUSIC_U，可能未登录
      if (!MUSIC_U) {
        this.logger.logCookieIssue('未找到MUSIC_U，用户可能未登录');
        
        // 尝试从storage获取
        const stored = await this.getStoredCookies();
        if (stored && stored.MUSIC_U) {
          this.logger.info('使用存储的MUSIC_U');
          return stored;
        }
        
        return null;
      }

      // 构建完整Cookie字符串 - 确保格式正确
      const cookieParts = [];
      
      // 按重要性排序添加Cookie
      if (MUSIC_U) {
        cookieParts.push(`MUSIC_U=${MUSIC_U}`);
      }
      
      if (__csrf) {
        cookieParts.push(`__csrf=${__csrf}`);
      }
      
      if (MUSIC_R_T) {
        cookieParts.push(`MUSIC_R_T=${MUSIC_R_T}`);
      }
      
      // 添加其他可能需要的Cookie（排除已添加的和过期的）
      const excludeNames = ['MUSIC_U', '__csrf', 'MUSIC_R_T', '__remember_me', '__utma'];
      const otherCookies = cookies.filter(c => 
        !excludeNames.includes(c.name) && 
        c.name && 
        c.value &&
        (!c.expirationDate || c.expirationDate * 1000 > Date.now())
      );
      
      otherCookies.forEach(c => {
        cookieParts.push(`${c.name}=${c.value}`);
      });
      
      const cookieString = cookieParts.join('; ');

      const userCookie = {
        raw: cookieString,
        MUSIC_U: MUSIC_U,
        __csrf: __csrf,
        MUSIC_R_T: MUSIC_R_T,
        expires: this.getCookieExpiry(cookies),
        lastUpdated: Date.now(),
        allCookies: cookies.map(c => ({ 
          name: c.name, 
          domain: c.domain,
          expires: c.expirationDate 
        }))
      };

      // 验证Cookie
      const isValid = await this.validateCookie(userCookie);
      
      if (isValid) {
        // 保存到storage
        await this.saveCookies(userCookie);
        
        this.logger.debug('Cookie获取成功', {
          hasMusicU: !!userCookie.MUSIC_U,
          hasCsrf: !!userCookie.__csrf,
          cookieCount: cookies.length,
          expires: userCookie.expires ? new Date(userCookie.expires).toLocaleString() : '无'
        });
        
        return userCookie;
      } else {
        this.logger.logCookieIssue('Cookie验证失败');
        
        // 尝试使用存储的Cookie
        const stored = await this.getStoredCookies();
        if (stored) {
          const storedValid = await this.validateCookie(stored);
          if (storedValid) {
            this.logger.info('使用存储的有效Cookie');
            return stored;
          }
        }
        
        return null;
      }

    } catch (error) {
      this.logger.logCookieIssue('获取Cookie时发生异常', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      
      // 异常时尝试使用存储的Cookie
      try {
        const stored = await this.getStoredCookies();
        if (stored) {
          this.logger.info('异常情况下使用存储的Cookie');
          return stored;
        }
      } catch (storageError) {
        this.logger.error('读取存储的Cookie失败', storageError);
      }
      
      return null;
    }
  }

  /**
   * 从content script获取Cookie
   */
  async getCookiesFromContentScript() {
    try {
      this.logger.debug('尝试从content script获取Cookie');
      
      // 查找网易云音乐的标签页
      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({ url: ["*://music.163.com/*"] }, (tabs) => {
          resolve(tabs || []);
        });
      });

      if (tabs.length === 0) {
        this.logger.debug('未找到网易云音乐标签页');
        return [];
      }

      // 向第一个标签页发送消息获取Cookie
      const response = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'EXTRACT_COOKIES'
        }, (response) => {
          if (chrome.runtime.lastError) {
            this.logger.debug('发送消息失败', chrome.runtime.lastError);
            resolve(null);
          } else {
            resolve(response);
          }
        });
      });

      if (response && response.cookies) {
        // 解析Cookie字符串为对象数组
        return this.parseCookieString(response.cookies);
      }

      return [];
    } catch (error) {
      this.logger.debug('从content script获取Cookie失败', error);
      return [];
    }
  }

  /**
   * 解析Cookie字符串
   */
  parseCookieString(cookieStr) {
    if (!cookieStr) return [];
    
    const cookies = [];
    const pairs = cookieStr.split(';');
    
    pairs.forEach(pair => {
      const [name, ...valueParts] = pair.trim().split('=');
      const value = valueParts.join('=');
      
      if (name && value) {
        cookies.push({
          name: name.trim(),
          value: value.trim(),
          domain: 'music.163.com'
        });
      }
    });
    
    return cookies;
  }

  /**
   * 保存Cookie到storage
   */
  async saveCookies(cookie) {
    try {
      await new Promise((resolve) => {
        chrome.storage.local.set({ 
          neteaseCookies: cookie,
          lastCookieUpdate: Date.now()
        }, resolve);
      });
      this.logger.debug('Cookie已保存到storage');
    } catch (error) {
      this.logger.error('保存Cookie失败', error);
    }
  }

  /**
   * 从storage获取存储的Cookie
   */
  async getStoredCookies() {
    try {
      const result = await new Promise((resolve) => {
        chrome.storage.local.get(['neteaseCookies', 'lastCookieUpdate'], resolve);
      });
      
      if (result.neteaseCookies) {
        // 检查是否过期（默认30天）
        const maxAge = 30 * 24 * 60 * 60 * 1000; // 30天
        const age = Date.now() - (result.lastCookieUpdate || 0);
        
        if (age < maxAge) {
          this.logger.debug('找到存储的Cookie', {
            age: Math.floor(age / (24 * 60 * 60 * 1000)) + '天'
          });
          return result.neteaseCookies;
        } else {
          this.logger.debug('存储的Cookie已过期');
        }
      }
      
      return null;
    } catch (error) {
      this.logger.error('读取存储的Cookie失败', error);
      return null;
    }
  }

  /**
   * 提取Cookie值（增强版）
   */
  extractCookieValue(cookies, name) {
    if (!cookies || !Array.isArray(cookies)) return null;
    
    // 精确匹配
    const cookie = cookies.find(c => c.name === name);
    if (cookie && cookie.value) {
      return cookie.value;
    }
    
    // 不区分大小写匹配
    const lowerName = name.toLowerCase();
    const caseInsensitive = cookies.find(c => 
      c.name && c.name.toLowerCase() === lowerName
    );
    
    return caseInsensitive ? caseInsensitive.value : null;
  }

  /**
   * 获取Cookie过期时间
   */
  getCookieExpiry(cookies) {
    if (!cookies || !Array.isArray(cookies)) return null;
    
    const expiryDates = cookies
      .filter(c => c.expirationDate && c.expirationDate > 0)
      .map(c => c.expirationDate * 1000);
    
    if (expiryDates.length === 0) {
      // 如果没有过期时间，默认30天后过期
      return Date.now() + 30 * 24 * 60 * 60 * 1000;
    }
    
    // 返回最早的过期时间
    return Math.min(...expiryDates);
  }
}

