// 日志级别
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

class Logger {
  constructor(moduleName) {
    this.moduleName = moduleName;
    this.logLevel = LOG_LEVELS.INFO;
  }

  formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const dataStr = data ? `\n数据: ${JSON.stringify(data, null, 2)}` : '';
    return `[${timestamp}] [${level}] [${this.moduleName}] ${message}${dataStr}`;
  }

  debug(message, data = null) {
    if (this.logLevel <= LOG_LEVELS.DEBUG) {
      console.debug(this.formatMessage('DEBUG', message, data));
    }
  }

  info(message, data = null) {
    if (this.logLevel <= LOG_LEVELS.INFO) {
      console.info(this.formatMessage('INFO', message, data));
    }
  }

  warn(message, data = null) {
    if (this.logLevel <= LOG_LEVELS.WARN) {
      console.warn(this.formatMessage('WARN', message, data));
      // 发送警告到background进行通知
      chrome.runtime.sendMessage({
        type: 'LOG_WARNING',
        data: { message, data, module: this.moduleName }
      });
    }
  }

  error(message, data = null) {
    if (this.logLevel <= LOG_LEVELS.ERROR) {
      console.error(this.formatMessage('ERROR', message, data));
      // 发送错误到background进行通知
      chrome.runtime.sendMessage({
        type: 'LOG_ERROR',
        data: { message, data, module: this.moduleName }
      });
    }
  }

  // 特定场景的日志
  logCookieIssue(message, data = null) {
    this.warn(`🍪 Cookie问题: ${message}`, data);
  }

  logPlaylistIssue(message, data = null) {
    this.warn(`📋 歌单问题: ${message}`, data);
  }

  logApiIssue(message, data = null) {
    this.error(`🌐 API问题: ${message}`, data);
  }
}

// 创建全局logger实例
const logger = new Logger('Global');

