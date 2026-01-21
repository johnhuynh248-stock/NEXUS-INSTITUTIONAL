const dotenv = require('dotenv');
dotenv.config();

// Helper function to parse boolean environment variables
const parseBoolean = (value, defaultValue = false) => {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value === '1';
  }
  return Boolean(value);
};

// Helper function to parse numeric environment variables
const parseNumber = (value, defaultValue = 0) => {
  if (value === undefined || value === null) return defaultValue;
  const num = Number(value);
  return isNaN(num) ? defaultValue : num;
};

module.exports = {
  // Telegram
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID,
    polling: parseBoolean(process.env.TELEGRAM_POLLING, true),
    webhook: {
      enabled: parseBoolean(process.env.TELEGRAM_WEBHOOK_ENABLED, false),
      domain: process.env.TELEGRAM_WEBHOOK_DOMAIN,
      path: process.env.TELEGRAM_WEBHOOK_PATH || '/webhook/telegram',
      port: parseNumber(process.env.TELEGRAM_WEBHOOK_PORT, 8443)
    }
  },

  // APIs
  apis: {
    tradier: {
      key: process.env.TRADIER_API_KEY,
      baseUrl: process.env.TRADIER_BASE_URL || 'https://api.tradier.com/v1',
      headers: {
        'Authorization': `Bearer ${process.env.TRADIER_API_KEY}`,
        'Accept': 'application/json'
      },
      timeout: parseNumber(process.env.TRADIER_TIMEOUT_MS, 30000),
      retries: parseNumber(process.env.TRADIER_RETRIES, 3)
    },
    unusualWhales: {
      key: process.env.UNUSUAL_WHALES_API_KEY,
      baseUrl: process.env.UNUSUAL_WHALES_BASE_URL || 'https://api.unusualwhales.com/api',
      headers: {
        'Authorization': `Bearer ${process.env.UNUSUAL_WHALES_API_KEY}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: parseNumber(process.env.UNUSUAL_WHALES_TIMEOUT_MS, 30000),
      retries: parseNumber(process.env.UNUSUAL_WHALES_RETRIES, 3),
      webhookSecret: process.env.UNUSUAL_WHALES_WEBHOOK_SECRET
    }
  },

  // App
  app: {
    name: process.env.APP_NAME || 'Elite Institutional Flow Bot',
    port: parseNumber(process.env.PORT, 3000),
    environment: process.env.NODE_ENV || 'development',
    timezone: process.env.TIMEZONE || 'America/New_York',
    maxSymbols: parseNumber(process.env.MAX_SYMBOLS_PER_REQUEST, 5),
    sessionStart: process.env.SESSION_START || '09:30',
    sessionEnd: process.env.SESSION_END || '16:00',
    enableLiveBlocks: parseBoolean(process.env.ENABLE_LIVE_BLOCKS, true),
    enableHistorical: parseBoolean(process.env.ENABLE_HISTORICAL, true),
    enableMultiSymbol: parseBoolean(process.env.ENABLE_MULTI_SYMBOL, true),
    rateLimit: {
      requestsPerMinute: parseNumber(process.env.RATE_LIMIT_REQUESTS_PER_MINUTE, 5),
      burstLimit: parseNumber(process.env.RATE_LIMIT_BURST_LIMIT, 10)
    }
  },

  // Redis (for caching and rate limiting)
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseNumber(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD,
    db: parseNumber(process.env.REDIS_DB, 0),
    ttl: parseNumber(process.env.REDIS_TTL, 3600), // 1 hour cache
    enabled: parseBoolean(process.env.REDIS_ENABLED, false)
  },

  // Webhook Configuration
  webhooks: {
    unusualWhales: {
      path: process.env.UNUSUAL_WHALES_WEBHOOK_PATH || '/webhook/unusual-whales',
      enabled: parseBoolean(process.env.UNUSUAL_WHALES_WEBHOOK_ENABLED, true),
      verifySignature: parseBoolean(process.env.VERIFY_WEBHOOK_SIGNATURE, false)
    },
    telegram: {
      path: process.env.TELEGRAM_WEBHOOK_PATH || '/webhook/telegram',
      enabled: parseBoolean(process.env.TELEGRAM_WEBHOOK_ENABLED, false)
    }
  },

  // Validation Rules
  rules: {
    dteTiers: {
      tier1: { min: 0, max: 3 },    // 0-3 DTE (Urgent)
      tier2: { min: 3, max: 14 }    // 3-14 DTE (Patient)
    },
    atmRange: parseNumber(process.env.ATM_RANGE, 0.02), // ±2% for ATM
    minNotional: parseNumber(process.env.MIN_NOTIONAL, 100000), // $100k minimum for institutional flow
    timeFilters: {
      sameDayOnly: parseBoolean(process.env.SAME_DAY_ONLY, true),
      marketHoursOnly: parseBoolean(process.env.MARKET_HOURS_ONLY, true)
    },
    flowSizeThresholds: {
      small: parseNumber(process.env.FLOW_SMALL_THRESHOLD, 100000),
      medium: parseNumber(process.env.FLOW_MEDIUM_THRESHOLD, 500000),
      large: parseNumber(process.env.FLOW_LARGE_THRESHOLD, 1000000),
      block: parseNumber(process.env.FLOW_BLOCK_THRESHOLD, 1000000)
    }
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'institutional-flow-bot.log',
    maxSize: parseNumber(process.env.LOG_MAX_SIZE, 10485760), // 10MB
    maxFiles: parseNumber(process.env.LOG_MAX_FILES, 5),
    enableConsole: parseBoolean(process.env.LOG_ENABLE_CONSOLE, true),
    enableFile: parseBoolean(process.env.LOG_ENABLE_FILE, false)
  },

  // Security
  security: {
    cors: {
      enabled: parseBoolean(process.env.CORS_ENABLED, false),
      origin: process.env.CORS_ORIGIN || '*'
    },
    rateLimit: {
      enabled: parseBoolean(process.env.RATE_LIMIT_ENABLED, true),
      windowMs: parseNumber(process.env.RATE_LIMIT_WINDOW_MS, 60000), // 1 minute
      max: parseNumber(process.env.RATE_LIMIT_MAX_REQUESTS, 100)
    }
  },

  // Performance
  performance: {
    cacheEnabled: parseBoolean(process.env.CACHE_ENABLED, true),
    cacheTTL: parseNumber(process.env.CACHE_TTL, 300), // 5 minutes
    requestTimeout: parseNumber(process.env.REQUEST_TIMEOUT, 30000), // 30 seconds
    concurrentRequests: parseNumber(process.env.CONCURRENT_REQUESTS, 3)
  },

  // Feature Flags
  features: {
    liveBlockDetection: parseBoolean(process.env.FEATURE_LIVE_BLOCK_DETECTION, true),
    gammaAnalysis: parseBoolean(process.env.FEATURE_GAMMA_ANALYSIS, true),
    sentimentAnalysis: parseBoolean(process.env.FEATURE_SENTIMENT_ANALYSIS, true),
    anomalyDetection: parseBoolean(process.env.FEATURE_ANOMALY_DETECTION, true),
    tradeSuggestions: parseBoolean(process.env.FEATURE_TRADE_SUGGESTIONS, true)
  }
};
