const winston = require('winston');
const moment = require('moment-timezone');

class Logger {
  constructor(module) {
    this.module = module;
    
    this.logger = winston.createLogger({
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      format: winston.format.combine(
        winston.format.timestamp({
          format: () => moment().tz('America/New_York').format('YYYY-MM-DD HH:mm:ss.SSS')
        }),
        winston.format.printf(({ timestamp, level, message }) => {
          return `${timestamp} [${level.toUpperCase()}] ${module}: ${message}`;
        })
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ 
          filename: `logs/elite-flow-bot-${moment().format('YYYY-MM-DD')}.log` 
        })
      ]
    });
  }

  info(message) {
    this.logger.info(message);
  }

  error(message) {
    this.logger.error(message);
  }

  warn(message) {
    this.logger.warn(message);
  }

  debug(message) {
    this.logger.debug(message);
  }
}

module.exports = Logger;
