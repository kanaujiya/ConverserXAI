/**
 * Centralized logging utility for debugging and monitoring.
 * Tracks performance metrics, errors, and state transitions.
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

interface LogEntry {
  timestamp: number;
  level: LogLevel;
  category: string;
  message: string;
  data?: any;
}

class Logger {
  private logs: LogEntry[] = [];
  private readonly MAX_LOGS = 500;
  private enableConsole = true;

  log(
    category: string,
    message: string,
    level: LogLevel = LogLevel.INFO,
    data?: any
  ) {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      category,
      message,
      data,
    };

    this.logs.push(entry);
    if (this.logs.length > this.MAX_LOGS) {
      this.logs.shift();
    }

    if (this.enableConsole) {
      const prefix = `[${category}]`;
      const logFn = {
        [LogLevel.DEBUG]: console.debug,
        [LogLevel.INFO]: console.log,
        [LogLevel.WARN]: console.warn,
        [LogLevel.ERROR]: console.error,
      }[level];

      if (data) {
        logFn(`${prefix} ${message}`, data);
      } else {
        logFn(`${prefix} ${message}`);
      }
    }

    return entry;
  }

  debug(category: string, message: string, data?: any) {
    return this.log(category, message, LogLevel.DEBUG, data);
  }

  info(category: string, message: string, data?: any) {
    return this.log(category, message, LogLevel.INFO, data);
  }

  warn(category: string, message: string, data?: any) {
    return this.log(category, message, LogLevel.WARN, data);
  }

  error(category: string, message: string, data?: any) {
    return this.log(category, message, LogLevel.ERROR, data);
  }

  /**
   * Export logs for debugging (send to server, download, etc.)
   */
  exportLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * Get logs by category
   */
  getLogsByCategory(category: string): LogEntry[] {
    return this.logs.filter(log => log.category.includes(category));
  }

  /**
   * Get recent errors for display
   */
  getRecentErrors(count: number = 10): LogEntry[] {
    return this.logs
      .filter(log => log.level === LogLevel.ERROR)
      .slice(-count);
  }

  /**
   * Clear all logs
   */
  clear() {
    this.logs = [];
  }

  /**
   * Toggle console output
   */
  setConsoleEnabled(enabled: boolean) {
    this.enableConsole = enabled;
  }
}

export const logger = new Logger();
