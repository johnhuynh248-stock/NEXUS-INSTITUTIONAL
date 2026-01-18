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

      // ✅ CRITICAL: Add date parameter if provided
      if (date) {
        params.date = date;
        this.logger.info(`Fetching historical institutional flow for ${symbol} on ${date}`);
      } else {
        this.logger.info(`Fetching current institutional flow for ${symbol}`);
      }

      const response = await axios.get(`${this.baseUrl}/api/flow/institutional`, {
        headers: this.headers,
        params: params,
        timeout: 30000 // 30 second timeout
      });

      // ✅ FIXED: Pass the target date to filter function
      return this.filterAndValidateFlow(response.data, date);
      
    } catch (error) {
      this.logger.error(`Unusual Whales flow error for ${symbol}${date ? ' on ' + date : ''}: ${error.message}`);
      // Return empty array instead of throwing to allow graceful degradation
      return [];
    }
  }

  async getBlocks(symbol, minSize = 100, date = null) {
    try {
      const params = {
        ticker: symbol,
        min_contracts: minSize
      };

      // Add date parameter if provided
      if (date) {
        params.date = date;
      }

      const response = await axios.get(`${this.baseUrl}/api/blocks`, {
        headers: this.headers,
        params: params
      });

      return response.data.blocks || [];
      
    } catch (error) {
      this.logger.error(`Unusual Whales blocks error for ${symbol}: ${error.message}`);
      return [];
    }
  }

  async getRealDelta(symbol, strike, expiration, optionType, date = null) {
    try {
      const params = {
        ticker: symbol,
        strike: strike,
        expiration: expiration,
        type: optionType
      };

      // Add date parameter if provided
      if (date) {
        params.date = date;
      }

      const response = await axios.get(`${this.baseUrl}/api/real-delta`, {
        headers: this.headers,
        params: params
      });

      return response.data.delta || 0;
      
    } catch (error) {
      this.logger.error(`Unusual Whales real delta error: ${error.message}`);
      return 0;
    }
  }

  async getComplexTrades(symbol, date = null) {
    try {
      const params = {
        ticker: symbol,
        min_notional: config.rules.minNotional
      };

      // Add date parameter if provided
      if (date) {
        params.date = date;
      }

      const response = await axios.get(`${this.baseUrl}/api/complex-trades`, {
        headers: this.headers,
        params: params
      });

      return response.data.trades || [];
      
    } catch (error) {
      this.logger.error(`Unusual Whales complex trades error for ${symbol}: ${error.message}`);
      return [];
    }
  }

  async getDeltaConcentration(symbol, date = null) {
    try {
      const params = {
        ticker: symbol,
        // Use provided date or default to today
        date: date || new Date().toISOString().split('T')[0]
      };

      const response = await axios.get(`${this.baseUrl}/api/delta-concentration`, {
        headers: this.headers,
        params: params
      });

      return response.data.concentration || [];
      
    } catch (error) {
      this.logger.error(`Unusual Whales delta concentration error for ${symbol}: ${error.message}`);
      return [];
    }
  }

  // ✅ FIXED: Now accepts targetDate parameter
  filterAndValidateFlow(data, targetDate = null) {
    if (!data || !data.flow) return [];
    
    // Use targetDate if provided, otherwise use today
    const referenceDate = targetDate || new Date().toISOString().split('T')[0];
    
    this.logger.debug(`Filtering flow data for date: ${referenceDate}`);
    
    // Filter for target date only
    const filtered = data.flow.filter(flow => {
      if (!flow.timestamp) return false;
      
      try {
        const flowDate = new Date(flow.timestamp).toISOString().split('T')[0];
        const matchesDate = flowDate === referenceDate;
        
        // Additional validation
        const isValid = flow.option_type && 
                       flow.strike && 
                       flow.notional && 
                       flow.notional >= config.rules.minNotional;
        
        return matchesDate && isValid;
        
      } catch (error) {
        this.logger.warn(`Error parsing flow timestamp: ${error.message}`);
        return false;
      }
    });
    
    this.logger.info(`Filtered ${filtered.length} institutional flows for ${referenceDate}`);
    
    // Calculate DTE for each flow
    return filtered.map(flow => {
      try {
        const expiration = flow.expiration ? new Date(flow.expiration) : null;
        const flowTimestamp = new Date(flow.timestamp);
        const dte = expiration ? Math.ceil((expiration - flowTimestamp) / (1000 * 60 * 60 * 24)) : 0;
        
        return {
          ...flow,
          dte: Math.max(0, dte),
          timestamp: flowTimestamp
        };
      } catch (error) {
        this.logger.warn(`Error processing flow: ${error.message}`);
        return {
          ...flow,
          dte: 0,
          timestamp: new Date(flow.timestamp || referenceDate)
        };
      }
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
