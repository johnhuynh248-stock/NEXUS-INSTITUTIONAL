const config = require('../config');
const Logger = require('../utils/logger');

class UnusualWhalesWebhook {
  constructor() {
    this.logger = new Logger('unusual-whales');
    this.storedData = new Map(); // symbol -> { blocks: [], flow: [], timestamp }
    this.simulationCache = new Map();
    this.webhookHistory = [];
    
    // Clean up old data periodically
    setInterval(() => this.cleanupOldData(), 3600000); // Every hour
  }

  // Main method to get institutional flow (compatible with existing code)
  async getInstitutionalFlow(symbol, date = null) {
    try {
      const targetDate = date || this.getTodayDate();
      
      // Check if we have stored webhook data
      const stored = this.getStoredDataForDate(symbol, targetDate);
      if (stored.flow.length > 0) {
        this.logger.info(`Using stored webhook data for ${symbol} on ${targetDate}: ${stored.flow.length} flows`);
        return this.filterAndValidateFlow(stored.flow, targetDate);
      }
      
      // Fallback to simulation for development
      this.logger.info(`Simulating institutional flow for ${symbol} on ${targetDate}`);
      const simulated = await this.simulateInstitutionalFlow(symbol, targetDate);
      return this.filterAndValidateFlow(simulated, targetDate);
      
    } catch (error) {
      this.logger.error(`Unusual Whales flow error for ${symbol}${date ? ' on ' + date : ''}: ${error.message}`);
      return [];
    }
  }

  async getBlocks(symbol, minSize = 100, date = null) {
    try {
      const targetDate = date || this.getTodayDate();
      
      // Check stored data
      const stored = this.getStoredDataForDate(symbol, targetDate);
      if (stored.blocks.length > 0) {
        const filtered = stored.blocks.filter(block => 
          block.contracts >= minSize
        );
        if (filtered.length > 0) {
          return filtered;
        }
      }
      
      // Simulate blocks
      return await this.simulateBlocks(symbol, minSize, targetDate);
      
    } catch (error) {
      this.logger.error(`Unusual Whales blocks error for ${symbol}: ${error.message}`);
      return [];
    }
  }

  async getRealDelta(symbol, strike, expiration, optionType, date = null) {
    try {
      const targetDate = date || this.getTodayDate();
      
      // In a real webhook system, delta might come from different data
      // For now, simulate
      return await this.simulateRealDelta(symbol, strike, optionType, targetDate);
      
    } catch (error) {
      this.logger.error(`Unusual Whales real delta error: ${error.message}`);
      return 0;
    }
  }

  async getComplexTrades(symbol, date = null) {
    try {
      const targetDate = date || this.getTodayDate();
      
      // Check stored data
      const stored = this.getStoredDataForDate(symbol, targetDate);
      if (stored.complexTrades && stored.complexTrades.length > 0) {
        return stored.complexTrades;
      }
      
      // Simulate complex trades
      return await this.simulateComplexTrades(symbol, targetDate);
      
    } catch (error) {
      this.logger.error(`Unusual Whales complex trades error for ${symbol}: ${error.message}`);
      return [];
    }
  }

  async getDeltaConcentration(symbol, date = null) {
    try {
      const targetDate = date || this.getTodayDate();
      
      // Check stored data
      const stored = this.getStoredDataForDate(symbol, targetDate);
      if (stored.deltaConcentration && stored.deltaConcentration.length > 0) {
        return stored.deltaConcentration;
      }
      
      // Simulate delta concentration
      return await this.simulateDeltaConcentration(symbol, targetDate);
      
    } catch (error) {
      this.logger.error(`Unusual Whales delta concentration error for ${symbol}: ${error.message}`);
      return [];
    }
  }

  // NEW: Webhook processing methods
  async processIncomingWebhook(payload) {
    try {
      this.logger.info('Processing incoming webhook');
      
      const parsed = this.parseWebhookPayload(payload);
      if (!parsed.symbol) {
        throw new Error('No symbol in webhook payload');
      }
      
      // Store the data
      this.storeWebhookData(parsed);
      
      // Add to history
      this.webhookHistory.push({
        symbol: parsed.symbol,
        timestamp: new Date(),
        blockCount: parsed.blocks?.length || 0,
        flowCount: parsed.flow?.length || 0
      });
      
      // Keep history manageable
      if (this.webhookHistory.length > 1000) {
        this.webhookHistory = this.webhookHistory.slice(-500);
      }
      
      this.logger.info(`Webhook processed for ${parsed.symbol}: ${parsed.blocks?.length || 0} blocks, ${parsed.flow?.length || 0} flows`);
      
      return {
        success: true,
        symbol: parsed.symbol,
        blockCount: parsed.blocks?.length || 0,
        flowCount: parsed.flow?.length || 0
      };
      
    } catch (error) {
      this.logger.error(`Webhook processing error: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // NEW: Get live blocks (for real-time analysis)
  async getLiveBlocks(symbol, minutesBack = 5) {
    try {
      const cutoff = new Date(Date.now() - minutesBack * 60 * 1000);
      const allBlocks = this.getAllBlocks(symbol);
      
      const recentBlocks = allBlocks.filter(block => 
        new Date(block.timestamp) > cutoff
      );
      
      if (recentBlocks.length > 0) {
        return recentBlocks;
      }
      
      // If no recent blocks, simulate some
      return await this.simulateLiveBlocks(symbol, minutesBack);
      
    } catch (error) {
      this.logger.error(`Live blocks error for ${symbol}: ${error.message}`);
      return [];
    }
  }

  // NEW: Get webhook stats
  getWebhookStats() {
    const stats = {
      totalWebhooks: this.webhookHistory.length,
      symbols: new Set(),
      last24h: 0,
      recentActivity: []
    };
    
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    this.webhookHistory.forEach(entry => {
      stats.symbols.add(entry.symbol);
      if (new Date(entry.timestamp) > cutoff24h) {
        stats.last24h++;
      }
    });
    
    // Get recent activity (last 10 webhooks)
    stats.recentActivity = this.webhookHistory.slice(-10).map(entry => ({
      symbol: entry.symbol,
      time: new Date(entry.timestamp).toLocaleTimeString(),
      blocks: entry.blockCount,
      flows: entry.flowCount
    }));
    
    stats.symbols = Array.from(stats.symbols);
    
    return stats;
  }

  // Data storage and retrieval
  storeWebhookData(data) {
    const { symbol, blocks = [], flow = [], complexTrades = [], deltaConcentration = [], timestamp } = data;
    
    if (!this.storedData.has(symbol)) {
      this.storedData.set(symbol, {
        blocks: [],
        flow: [],
        complexTrades: [],
        deltaConcentration: [],
        lastUpdated: new Date()
      });
    }
    
    const symbolData = this.storedData.get(symbol);
    
    // Add new data
    if (blocks.length > 0) {
      symbolData.blocks.push(...blocks.map(block => ({
        ...block,
        symbol,
        timestamp: timestamp || new Date()
      })));
    }
    
    if (flow.length > 0) {
      symbolData.flow.push(...flow.map(f => ({
        ...f,
        symbol,
        timestamp: timestamp || new Date()
      })));
    }
    
    if (complexTrades.length > 0) {
      symbolData.complexTrades.push(...complexTrades);
    }
    
    if (deltaConcentration.length > 0) {
      symbolData.deltaConcentration.push(...deltaConcentration);
    }
    
    symbolData.lastUpdated = new Date();
    
    // Keep data manageable
    this.trimStoredData(symbol);
  }

  getStoredDataForDate(symbol, date) {
    const defaultData = { blocks: [], flow: [], complexTrades: [], deltaConcentration: [] };
    
    if (!this.storedData.has(symbol)) {
      return defaultData;
    }
    
    const symbolData = this.storedData.get(symbol);
    const targetDate = new Date(date).toISOString().split('T')[0];
    
    const filterByDate = (items) => items.filter(item => {
      if (!item.timestamp) return false;
      const itemDate = new Date(item.timestamp).toISOString().split('T')[0];
      return itemDate === targetDate;
    });
    
    return {
      blocks: filterByDate(symbolData.blocks),
      flow: filterByDate(symbolData.flow),
      complexTrades: symbolData.complexTrades,
      deltaConcentration: symbolData.deltaConcentration
    };
  }

  getAllBlocks(symbol) {
    if (!this.storedData.has(symbol)) {
      return [];
    }
    return this.storedData.get(symbol).blocks;
  }

  // Simulation methods (for development/testing)
  async simulateInstitutionalFlow(symbol, date) {
    const cacheKey = `flow_${symbol}_${date}`;
    
    if (this.simulationCache.has(cacheKey)) {
      return this.simulationCache.get(cacheKey);
    }
    
    const flow = this.generateSimulatedFlow(symbol, date);
    this.simulationCache.set(cacheKey, flow);
    
    // Clean cache if too large
    if (this.simulationCache.size > 100) {
      const keys = Array.from(this.simulationCache.keys()).slice(0, 50);
      keys.forEach(key => this.simulationCache.delete(key));
    }
    
    return flow;
  }

  async simulateBlocks(symbol, minSize, date) {
    const flow = await this.simulateInstitutionalFlow(symbol, date);
    return flow.filter(block => block.contracts >= minSize);
  }

  async simulateRealDelta(symbol, strike, optionType, date) {
    // Simple delta simulation based on strike and option type
    const baseDelta = optionType === 'CALL' ? 0.5 : -0.5;
    const randomVariation = (Math.random() - 0.5) * 0.3;
    return baseDelta + randomVariation;
  }

  async simulateComplexTrades(symbol, date) {
    const strategies = ['CALL_SPREAD', 'PUT_SPREAD', 'STRADDLE', 'STRANGLE', 'PROTECTIVE_PUT', 'COVERED_CALL', 'COLLAR'];
    const trades = [];
    
    for (let i = 0; i < 3 + Math.floor(Math.random() * 4); i++) {
      trades.push({
        symbol,
        strategy_type: strategies[Math.floor(Math.random() * strategies.length)],
        notional: Math.random() * 2000000 + 1000000,
        timestamp: new Date(date).toISOString(),
        legs: Math.floor(Math.random() * 4) + 2,
        intent: Math.random() > 0.5 ? 'bullish' : 'bearish'
      });
    }
    
    return trades;
  }

  async simulateDeltaConcentration(symbol, date) {
    const basePrice = 100 + Math.random() * 50;
    const concentrations = [];
    
    for (let i = -5; i <= 5; i++) {
      const strike = Math.round(basePrice + i * 2);
      concentrations.push({
        strike,
        option_type: i >= 0 ? 'CALL' : 'PUT',
        real_delta: i >= 0 ? 0.3 + Math.random() * 0.4 : -0.3 - Math.random() * 0.4,
        notional: Math.random() * 1500000 + 500000,
        timestamp: new Date(date).toISOString(),
        callPrints: i >= 0 ? Math.floor(Math.random() * 5) + 1 : 0,
        putPrints: i < 0 ? Math.floor(Math.random() * 5) + 1 : 0
      });
    }
    
    return concentrations;
  }

  async simulateLiveBlocks(symbol, minutesBack) {
    const blocks = [];
    const now = new Date();
    const basePrice = 100 + Math.random() * 50;
    
    for (let i = 0; i < 2 + Math.floor(Math.random() * 4); i++) {
      const minutesAgo = Math.random() * minutesBack;
      const timestamp = new Date(now.getTime() - minutesAgo * 60 * 1000);
      const isCall = Math.random() > 0.5;
      const strike = Math.round(basePrice * (0.97 + Math.random() * 0.06));
      
      blocks.push({
        symbol,
        timestamp: timestamp.toISOString(),
        option_type: isCall ? 'CALL' : 'PUT',
        strike,
        expiration: this.getRandomExpiration(timestamp),
        contracts: Math.floor(Math.random() * 3000) + 500,
        price: parseFloat((0.5 + Math.random() * 5).toFixed(2)),
        notional: Math.random() * 2000000 + 500000,
        side: Math.random() > 0.3 ? 'BUY' : 'SELL',
        real_delta: isCall ? 0.4 + Math.random() * 0.4 : -0.4 - Math.random() * 0.4,
        dte: Math.floor(Math.random() * 5),
        complex_type: Math.random() > 0.85 ? (isCall ? 'CALL_SPREAD' : 'PUT_SPREAD') : null
      });
    }
    
    return blocks.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  // Helper methods
  generateSimulatedFlow(symbol, date) {
    const baseDate = new Date(date);
    const basePrice = 100 + Math.random() * 50;
    const flow = [];
    
    for (let i = 0; i < 20 + Math.floor(Math.random() * 30); i++) {
      const hour = 9 + Math.floor(Math.random() * 7);
      const minute = Math.floor(Math.random() * 60);
      const timestamp = new Date(baseDate);
      timestamp.setHours(hour, minute, 0, 0);
      
      const isCall = Math.random() > 0.5;
      const strike = Math.round(basePrice * (0.95 + Math.random() * 0.1));
      const contracts = Math.floor(Math.random() * 5000) + 100;
      const pricePerContract = (0.5 + Math.random() * 5).toFixed(2);
      const notional = contracts * pricePerContract * 100;
      
      flow.push({
        symbol,
        timestamp: timestamp.toISOString(),
        option_type: isCall ? 'CALL' : 'PUT',
        strike,
        expiration: this.getRandomExpiration(timestamp),
        contracts,
        price: parseFloat(pricePerContract),
        notional,
        side: Math.random() > 0.3 ? 'BUY' : 'SELL',
        real_delta: isCall ? 0.5 + Math.random() * 0.3 : -0.5 - Math.random() * 0.3,
        dte: Math.floor(Math.random() * 14),
        complex_type: Math.random() > 0.8 ? (isCall ? 'CALL_SPREAD' : 'PUT_SPREAD') : null,
        underlying_price: basePrice * (0.98 + Math.random() * 0.04),
        stock_price: basePrice * (0.99 + Math.random() * 0.02),
        stock_option_combo: Math.random() > 0.7
      });
    }
    
    return flow.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  parseWebhookPayload(payload) {
    // This is a placeholder - you'll need to adjust based on actual Unusual Whales webhook format
    // For now, assume payload is already in the right format or simulate
    
    if (payload && payload.symbol) {
      // Real webhook format
      return {
        symbol: payload.symbol,
        blocks: payload.blocks || payload.large_prints || [],
        flow: payload.flow || payload.institutional_flow || [],
        complexTrades: payload.complex_trades || payload.strategies || [],
        deltaConcentration: payload.delta_concentration || [],
        timestamp: new Date(payload.timestamp || Date.now())
      };
    }
    
    // Simulate a webhook if no real data
    return this.simulateWebhookPayload();
  }

  simulateWebhookPayload() {
    const symbols = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'TSLA', 'NVDA'];
    const symbol = symbols[Math.floor(Math.random() * symbols.length)];
    const date = this.getTodayDate();
    
    return {
      symbol,
      blocks: this.generateSimulatedFlow(symbol, date).slice(0, 5),
      flow: this.generateSimulatedFlow(symbol, date),
      timestamp: new Date()
    };
  }

  // ✅ FIXED: Now accepts targetDate parameter (kept from original)
  filterAndValidateFlow(data, targetDate = null) {
    if (!data || data.length === 0) return [];
    
    const referenceDate = targetDate || this.getTodayDate();
    
    this.logger.debug(`Filtering flow data for date: ${referenceDate}`);
    
    const filtered = data.filter(flow => {
      if (!flow.timestamp) return false;
      
      try {
        const flowDate = new Date(flow.timestamp).toISOString().split('T')[0];
        const matchesDate = flowDate === referenceDate;
        
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

  // Utility methods
  getRandomExpiration(baseDate) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + Math.floor(Math.random() * 45) + 1);
    return date.toISOString().split('T')[0];
  }

  getTodayDate() {
    return new Date().toISOString().split('T')[0];
  }

  trimStoredData(symbol) {
    if (!this.storedData.has(symbol)) return;
    
    const symbolData = this.storedData.get(symbol);
    
    // Keep only last 1000 items of each type
    ['blocks', 'flow'].forEach(type => {
      if (symbolData[type].length > 1000) {
        symbolData[type] = symbolData[type].slice(-1000);
      }
    });
    
    // Keep only last 100 complex trades and delta concentrations
    ['complexTrades', 'deltaConcentration'].forEach(type => {
      if (symbolData[type].length > 100) {
        symbolData[type] = symbolData[type].slice(-100);
      }
    });
  }

  cleanupOldData(daysToKeep = 7) {
    const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
    
    for (const [symbol, data] of this.storedData.entries()) {
      if (data.lastUpdated < cutoff) {
        this.storedData.delete(symbol);
        this.logger.info(`Cleaned up old data for ${symbol}`);
      } else {
        // Clean old items within the data
        ['blocks', 'flow'].forEach(type => {
          data[type] = data[type].filter(item => 
            new Date(item.timestamp) > cutoff
          );
        });
      }
    }
  }

  classifyFlowType(flow) {
    const notional = flow.notional;
    
    if (notional >= 10000000) return 'ELITE_INSTITUTIONAL';
    if (notional >= 1000000) return 'LARGE_BLOCK';
    if (notional >= 500000) return 'INSTITUTIONAL';
    if (notional >= 100000) return 'SIZEABLE';
    
    return 'STANDARD';
  }
}

module.exports = UnusualWhalesWebhook;
