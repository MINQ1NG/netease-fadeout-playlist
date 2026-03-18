class CookieManager {
  constructor(logger) {
    this.logger = logger || new Logger('CookieManager');
    this.cookieRefreshInterval = 7 * 24 * 60 * 60 * 1000; // 7天
  }

  async getNeteaseCookies() {
    try {
      this.logger.debug('正在获取网易云Cookie');
      
      const cookies = await new Promise((resolve) => {
        chrome.cookies.getAll({
          url: "https://music.163.com"
        }, (cookies) => {
          if (chrome.runtime.lastError) {
            this.logger.error('获取Cookie失败', chrome.runtime.lastError);
            resolve([]);
          } else {
            resolve(cookies || []);
          }
        });
      });

      if (!cookies || cookies.length === 0) {
        this.logger.logCookieIssue('未找到网易云Cookie，请确保已登录网易云音乐网页版');
        return null;
      }

      // 提取关键Cookie信息
      const cookieString = cookies
        .map(c => `${c.name}=${c.value}`)
        .join('; ');

      const userCookie = {
        raw: cookieString,
        MUSIC_U: this.extractCookieValue(cookies, 'MUSIC_U'),
        __csrf: this.extractCookieValue(cookies, '__csrf'),
        expires: this.getCookieExpiry(cookies),
        lastUpdated: Date.now()
      };

      // 验证Cookie是否有效
      if (!await this.validateCookie(userCookie)) {
        this.logger.logCookieIssue('Cookie已过期或无效');
        return null;
      }

      this.logger.info('Cookie获取成功', {
        hasMusicU: !!userCookie.MUSIC_U,
        hasCsrf: !!userCookie.__csrf,
        expires: new Date(userCookie.expires).toLocaleString()
      });

      return userCookie;

    } catch (error) {
      this.logger.logCookieIssue('获取Cookie时发生异常', error);
      return null;
    }
  }

  extractCookieValue(cookies, name) {
    const cookie = cookies.find(c => c.name === name);
    return cookie ? cookie.value : null;
  }

  getCookieExpiry(cookies) {
    const expiryDates = cookies
      .filter(c => c.expirationDate)
      .map(c => c.expirationDate * 1000);
    return expiryDates.length > 0 ? Math.min(...expiryDates) : null;
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
      // 通过一个简单API验证
      const response = await fetch('https://music.163.com/api/nav/account/get', {
        headers: { 'Cookie': cookie.raw }
      });

      if (!response.ok) {
        this.logger.logCookieIssue('Cookie验证失败，API返回错误', {
          status: response.status,
          statusText: response.statusText
        });
        return false;
      }

      const data = await response.json();
      if (!data.account) {
        this.logger.logCookieIssue('Cookie验证失败，未获取到用户信息');
        return false;
      }

      this.logger.info('Cookie验证成功', { userId: data.account.id });
      return true;

    } catch (error) {
      this.logger.logCookieIssue('Cookie验证请求失败', error);
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
}
