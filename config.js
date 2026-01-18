const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  // Telegram
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID,
    polling: true
  },

  // APIs
  apis: {
    tradier: {
      key: process.env.TRADIER_API_KEY,
      baseUrl: process.env.TRADIER_BASE_URL,
      headers: {
        'Authorization': `Bearer ${process.env.TRADIER_API_KEY}`,
        'Accept': 'application/json'
      }
    },
    unusualWhales: {
      key: process.env.UNUSUAL_WHALES_API_KEY,
      baseUrl: process.env.UNUSUAL_WHALES_BASE_URL,
      headers: {
        'Authorization': `Bearer ${process.env.UNUSUAL_WHALES_API_KEY}`,
        'Accept': 'application/json'
      }
    }
  },

  // App
  app: {
    port: process.env.PORT || 3000,
    timezone: process.env.TIMEZONE || 'America/New_York',
    maxSymbols: parseInt(process.env.MAX_SYMBOLS_PER_REQUEST) || 5,
    sessionStart: '09:30',
    sessionEnd: '16:00'
  },

  // Redis
  redis: {
    url: process.env.REDIS_URL,
    ttl: 3600 // 1 hour cache
  },

  // Validation Rules
  rules: {
    dteTiers: {
      tier1: { min: 0, max: 3 },    // 0-3 DTE (Urgent)
      tier2: { min: 3, max: 14 }    // 3-14 DTE (Patient)
    },
    atmRange: 0.02, // ±2% for ATM
    minNotional: 100000, // $100k minimum for institutional flow
    timeFilters: {
      sameDayOnly: true,
      marketHoursOnly: true
    }
  }
};
