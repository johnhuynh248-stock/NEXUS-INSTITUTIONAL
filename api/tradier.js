const axios = require('axios');
const config = require('../config');
const Logger = require('../utils/logger');

class TradierAPI {
  constructor() {
    this.baseUrl = config.apis.tradier.baseUrl;
    this.headers = config.apis.tradier.headers;
    this.logger = new Logger('tradier');
    this.cache = new Map();
  }

  async getQuote(symbol) {
    const cacheKey = `quote_${symbol}`;
    
    try {
      const response = await axios.get(`${this.baseUrl}/markets/quotes`, {
        headers: this.headers,
        params: {
          symbols: symbol,
          greeks: false
        }
      });

      if (response.data.quotes && response.data.quotes.quote) {
        const quote = response.data.quotes.quote;
        return {
          symbol: quote.symbol,
          price: quote.last,
          bid: quote.bid,
          ask: quote.ask,
          volume: quote.volume,
          timestamp: new Date(quote.trade_date + 'T' + quote.trade_time)
        };
      }
      
      throw new Error(`No quote data for ${symbol}`);
      
    } catch (error) {
      this.logger.error(`Tradier quote error for ${symbol}: ${error.message}`);
      throw error;
    }
  }

  async getOptionsChain(symbol, expiration = null) {
    try {
      const params = {
        symbol: symbol,
        greeks: true
      };

      if (expiration) {
        params.expiration = expiration;
      }

      const response = await axios.get(`${this.baseUrl}/markets/options/chains`, {
        headers: this.headers,
        params: params
      });

      return response.data.options || null;
      
    } catch (error) {
      this.logger.error(`Tradier options chain error for ${symbol}: ${error.message}`);
      throw error;
    }
  }

  async getHistoricalQuotes(symbol, interval = 'daily', start = null, end = null) {
    try {
      const params = {
        symbol: symbol,
        interval: interval
      };

      if (start) params.start = start;
      if (end) params.end = end;

      const response = await axios.get(`${this.baseUrl}/markets/history`, {
        headers: this.headers,
        params: params
      });

      return response.data.history || null;
      
    } catch (error) {
      this.logger.error(`Tradier historical error for ${symbol}: ${error.message}`);
      throw error;
    }
  }

  async getOptionStrikes(symbol, expiration) {
    try {
      const response = await axios.get(`${this.baseUrl}/markets/options/strikes`, {
        headers: this.headers,
        params: {
          symbol: symbol,
          expiration: expiration
        }
      });

      return response.data.strikes.strike || [];
      
    } catch (error) {
      this.logger.error(`Tradier strikes error for ${symbol}: ${error.message}`);
      throw error;
    }
  }

  async getExpirations(symbol) {
    try {
      const response = await axios.get(`${this.baseUrl}/markets/options/expirations`, {
        headers: this.headers,
        params: {
          symbol: symbol,
          includeAllRoots: true
        }
      });

      return response.data.expirations.date || [];
      
    } catch (error) {
      this.logger.error(`Tradier expirations error for ${symbol}: ${error.message}`);
      throw error;
    }
  }

  // Validate market hours
  isMarketOpen() {
    const now = new Date();
    const nyTime = new Date(now.toLocaleString('en-US', { timeZone: config.app.timezone }));
    const hours = nyTime.getHours();
    const minutes = nyTime.getMinutes();
    const currentTime = hours * 60 + minutes;
    
    const [startHour, startMinute] = config.app.sessionStart.split(':').map(Number);
    const [endHour, endMinute] = config.app.sessionEnd.split(':').map(Number);
    
    const startTime = startHour * 60 + startMinute;
    const endTime = endHour * 60 + endMinute;
    
    return currentTime >= startTime && currentTime <= endTime;
  }
}

module.exports = TradierAPI;
