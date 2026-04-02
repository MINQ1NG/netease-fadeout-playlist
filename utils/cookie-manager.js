class CookieManager {
  constructor(logger) {
    this.logger = logger || new Logger('CookieManager');
    this.cookieRefreshInterval = 7 * 24 * 60 * 60 * 1000; // 7天
  }

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
      // 使用用户收藏接口验证
      return await this.validateViaFavoriteAPI(cookie);

    } catch (error) {
      this.logger.logCookieIssue('Cookie验证请求失败', error);
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

