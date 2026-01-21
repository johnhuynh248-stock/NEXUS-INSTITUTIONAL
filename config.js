const dotenv = require('dotenv');
dotenv.config();

// Helper functions for Railway deployment
const parseBoolean = (value, defaultValue = false) => {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value === '1';
  }
  return Boolean(value);
};

const parseNumber = (value, defaultValue = 0) => {
  if (value === undefined || value === null) return defaultValue;
  const num = Number(value);
  return isNaN(num) ? defaultValue : num;
};

module.exports = {
  // Telegram Bot Configuration
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID,
    polling: parseBoolean(process.env.TELEGRAM_POLLING, true),
    webhook: {
      enabled: parseBoolean(process.env.TELEGRAM_WEBHOOK_ENABLED, false),
      // Railway provides the domain automatically
      domain: process.env.RAILWAY_PUBLIC_DOMAIN || process.env.TELEGRAM_WEBHOOK_DOMAIN,
      path: process.env.TELEGRAM_WEBHOOK_PATH || '/webhook/telegram',
      port: parseNumber(process.env.PORT, 3000)
    }
  },

  // API Configuration
  apis: {
    tradier: {
      key: process.env.TRADIER_API_KEY,
      baseUrl: process.env.TRADIER_BASE_URL || 'https://api.tradier.com/v1',
      headers: {
        'Authorization': `Bearer ${process.env.TRADIER_API_KEY}`,
        'Accept': 'application/json'
      },
      timeout: parseNumber(process.env.TRADIER_TIMEOUT_MS, 15000),
      retries: parseNumber(process.env.TRADIER_RETRIES, 2)
    },
    unusualWhales: {
      key: process.env.UNUSUAL_WHALES_API_KEY,
      baseUrl: process.env.UNUSUAL_WHALES_BASE_URL || 'https://api.unusualwhales.com/api',
      headers: {
        'Authorization': `Bearer ${process.env.UNUSUAL_WHALES_API_KEY}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: parseNumber(process.env.UNUSUAL_WHALES_TIMEOUT_MS, 15000),
      retries: parseNumber(process.env.UNUSUAL_WHALES_RETRIES, 2)
    }
  },

  // Application Settings
  app: {
    name: 'Elite Institutional Flow Bot (Railway)',
    port: parseNumber(process.env.PORT, 3000),
    environment: process.env.NODE_ENV || 'production',
    timezone: process.env.TIMEZONE || 'America/New_York',
    maxSymbols: parseNumber(process.env.MAX_SYMBOLS_PER_REQUEST, 3),
    sessionStart: process.env.SESSION_START || '09:30',
    sessionEnd: process.env.SESSION_END || '16:00',
    enableLiveBlocks: parseBoolean(process.env.ENABLE_LIVE_BLOCKS, true),
    enableHistorical: parseBoolean(process.env.ENABLE_HISTORICAL, true),
    enableMultiSymbol: parseBoolean(process.env.ENABLE_MULTI_SYMBOL, true),
    
    // Railway-specific optimizations
    railway: {
      deploymentId: process.env.RAILWAY_DEPLOYMENT_ID,
      serviceId: process.env.RAILWAY_SERVICE_ID,
      environmentId: process.env.RAILWAY_ENVIRONMENT_ID,
      publicDomain: process.env.RAILWAY_PUBLIC_DOMAIN
    }
  },

  // Validation Rules
  rules: {
    dteTiers: {
      tier1: { min: 0, max: 3 },
      tier2: { min: 3, max: 14 }
    },
    atmRange: parseNumber(process.env.ATM_RANGE, 0.02),
    minNotional: parseNumber(process.env.MIN_NOTIONAL, 100000),
    timeFilters: {
      sameDayOnly: parseBoolean(process.env.SAME_DAY_ONLY, true),
      marketHoursOnly: parseBoolean(process.env.MARKET_HOURS_ONLY, true)
    },
    flowSizeThresholds: {
      block: parseNumber(process.env.FLOW_BLOCK_THRESHOLD, 1000000)
    }
  },

  // Feature Flags
  features: {
    liveBlockDetection: parseBoolean(process.env.FEATURE_LIVE_BLOCK_DETECTION, true),
    gammaAnalysis: parseBoolean(process.env.FEATURE_GAMMA_ANALYSIS, true),
    sentimentAnalysis: parseBoolean(process.env.FEATURE_SENTIMENT_ANALYSIS, true),
    anomalyDetection: parseBoolean(process.env.FEATURE_ANOMALY_DETECTION, false),
    tradeSuggestions: parseBoolean(process.env.FEATURE_TRADE_SUGGESTIONS, false)
  },

  // Rate Limiting (Important for Railway)
  rateLimit: {
    enabled: parseBoolean(process.env.RATE_LIMIT_ENABLED, true),
    requestsPerMinute: parseNumber(process.env.RATE_LIMIT_REQUESTS_PER_MINUTE, 3),
    burstLimit: parseNumber(process.env.RATE_LIMIT_BURST_LIMIT, 5),
    windowMs: parseNumber(process.env.RATE_LIMIT_WINDOW_MS, 60000)
  },

  // Performance
  performance: {
    cacheEnabled: parseBoolean(process.env.CACHE_ENABLED, false),
    requestTimeout: parseNumber(process.env.REQUEST_TIMEOUT, 20000),
    concurrentRequests: parseNumber(process.env.CONCURRENT_REQUESTS, 2)
  },

  // Logging (Railway-friendly)
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    enableConsole: parseBoolean(process.env.LOG_ENABLE_CONSOLE, true),
    enableFile: parseBoolean(process.env.LOG_ENABLE_FILE, false)
  }
};
