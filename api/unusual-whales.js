const axios = require('axios');
const config = require('../config');
const Logger = require('../utils/logger');

class UnusualWhalesAPI {
  constructor() {
    this.baseUrl = config.apis.unusualWhales.baseUrl;
    this.headers = config.apis.unusualWhales.headers;
    this.logger = new Logger('unusual-whales');
  }

  async getInstitutionalFlow(symbol, date = null) {
    try {
      const params = {
        ticker: symbol,
        min_notional: config.rules.minNotional
      };

      if (date) {
        params.date = date;
      }

      const response = await axios.get(`${this.baseUrl}/api/flow/institutional`, {
        headers: this.headers,
        params: params
      });

      return this.filterAndValidateFlow(response.data);
      
    } catch (error) {
      this.logger.error(`Unusual Whales flow error for ${symbol}: ${error.message}`);
      throw error;
    }
  }

  async getBlocks(symbol, minSize = 100) {
    try {
      const response = await axios.get(`${this.baseUrl}/api/blocks`, {
        headers: this.headers,
        params: {
          ticker: symbol,
          min_contracts: minSize
        }
      });

      return response.data.blocks || [];
      
    } catch (error) {
      this.logger.error(`Unusual Whales blocks error for ${symbol}: ${error.message}`);
      throw error;
    }
  }

  async getRealDelta(symbol, strike, expiration, optionType) {
    try {
      const response = await axios.get(`${this.baseUrl}/api/real-delta`, {
        headers: this.headers,
        params: {
          ticker: symbol,
          strike: strike,
          expiration: expiration,
          type: optionType
        }
      });

      return response.data.delta || 0;
      
    } catch (error) {
      this.logger.error(`Unusual Whales real delta error: ${error.message}`);
      throw error;
    }
  }

  async getComplexTrades(symbol) {
    try {
      const response = await axios.get(`${this.baseUrl}/api/complex-trades`, {
        headers: this.headers,
        params: {
          ticker: symbol,
          min_notional: config.rules.minNotional
        }
      });

      return response.data.trades || [];
      
    } catch (error) {
      this.logger.error(`Unusual Whales complex trades error for ${symbol}: ${error.message}`);
      throw error;
    }
  }

  async getDeltaConcentration(symbol) {
    try {
      const response = await axios.get(`${this.baseUrl}/api/delta-concentration`, {
        headers: this.headers,
        params: {
          ticker: symbol,
          date: new Date().toISOString().split('T')[0]
        }
      });

      return response.data.concentration || [];
      
    } catch (error) {
      this.logger.error(`Unusual Whales delta concentration error for ${symbol}: ${error.message}`);
      throw error;
    }
  }

  filterAndValidateFlow(data) {
    if (!data || !data.flow) return [];
    
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    
    // Filter for same-day data only
    const filtered = data.flow.filter(flow => {
      const flowDate = new Date(flow.timestamp).toISOString().split('T')[0];
      
      // STRICT RULE: Same-day only
      if (flowDate !== today) return false;
      
      // Institutional minimum
      if (flow.notional < config.rules.minNotional) return false;
      
      // Valid option type
      if (!['CALL', 'PUT'].includes(flow.option_type)) return false;
      
      // Valid strike and expiration
      if (!flow.strike || !flow.expiration) return false;
      
      return true;
    });
    
    // Calculate DTE for each flow
    return filtered.map(flow => {
      const expiration = new Date(flow.expiration);
      const dte = Math.ceil((expiration - now) / (1000 * 60 * 60 * 24));
      
      return {
        ...flow,
        dte: Math.max(0, dte),
        timestamp: new Date(flow.timestamp)
      };
    });
  }

  classifyFlowType(flow) {
    const notional = flow.notional;
    const contracts = flow.contracts;
    
    if (notional >= 10000000) return 'ELITE_INSTITUTIONAL';
    if (notional >= 1000000) return 'LARGE_BLOCK';
    if (notional >= 500000) return 'INSTITUTIONAL';
    if (notional >= 100000) return 'SIZEABLE';
    
    return 'STANDARD';
  }
}

module.exports = UnusualWhalesAPI;
