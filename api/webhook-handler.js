// webhook-handler.js
const Logger = require('./utils/logger');

class WebhookHandler {
  constructor() {
    this.logger = new Logger('webhook-handler');
    this.pendingBlocks = new Map(); // symbol -> array of blocks
    this.lastUpdate = new Map(); // symbol -> timestamp
  }

  // Simulate receiving webhook data (replace with actual webhook handler)
  async simulateWebhookData(symbol, targetDate) {
    this.logger.info(`Simulating webhook data for ${symbol} on ${targetDate}`);
    
    // Simulated data - replace with actual webhook parsing
    const simulatedBlocks = this.generateSimulatedBlocks(symbol, targetDate);
    const simulatedFlow = this.generateSimulatedFlow(symbol, targetDate);
    
    return {
      blocks: simulatedBlocks,
      flow: simulatedFlow,
      deltaConcentration: this.generateSimulatedDelta(symbol),
      complexTrades: this.generateSimulatedComplexTrades(symbol)
    };
  }

  generateSimulatedBlocks(symbol, date) {
    // Generate realistic simulated blocks
    const blocks = [];
    const basePrice = 100 + Math.random() * 100;
    const today = new Date(date);
    
    for (let i = 0; i < 15; i++) {
      const hour = 9 + Math.floor(Math.random() * 7); // 9 AM - 4 PM
      const minute = Math.floor(Math.random() * 60);
      const timestamp = new Date(today);
      timestamp.setHours(hour, minute, 0, 0);
      
      const isCall = Math.random() > 0.5;
      const strike = Math.round(basePrice * (0.95 + Math.random() * 0.1));
      const contracts = Math.floor(Math.random() * 5000) + 100;
      const pricePerContract = (0.5 + Math.random() * 5).toFixed(2);
      const notional = contracts * pricePerContract * 100;
      
      blocks.push({
        symbol,
        timestamp: timestamp.toISOString(),
        option_type: isCall ? 'CALL' : 'PUT',
        strike,
        expiration: this.getRandomExpiration(today),
        contracts,
        price: parseFloat(pricePerContract),
        notional,
        side: Math.random() > 0.3 ? 'BUY' : 'SELL',
        real_delta: isCall ? 0.5 + Math.random() * 0.3 : -0.5 - Math.random() * 0.3,
        dte: Math.floor(Math.random() * 14),
        complex_type: Math.random() > 0.8 ? 'CALL_SPREAD' : null
      });
    }
    
    // Sort by timestamp
    return blocks.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  generateSimulatedFlow(symbol, date) {
    // Generate institutional flow data
    const blocks = this.generateSimulatedBlocks(symbol, date);
    return blocks.map(block => ({
      ...block,
      underlying_price: block.strike * (0.95 + Math.random() * 0.1),
      stock_price: block.strike * (0.98 + Math.random() * 0.04),
      stock_option_combo: Math.random() > 0.7,
      complex_type: Math.random() > 0.8 ? (block.option_type === 'CALL' ? 'CALL_SPREAD' : 'PUT_SPREAD') : null
    }));
  }

  generateSimulatedDelta(symbol) {
    const deltaLevels = [];
    const basePrice = 100;
    
    for (let i = -5; i <= 5; i++) {
      const strike = basePrice + i;
      deltaLevels.push({
        strike,
        option_type: i > 0 ? 'CALL' : 'PUT',
        real_delta: i > 0 ? 0.3 + Math.random() * 0.4 : -0.3 - Math.random() * 0.4,
        notional: Math.random() * 1000000 + 500000,
        timestamp: new Date().toISOString()
      });
    }
    
    return deltaLevels;
  }

  generateSimulatedComplexTrades(symbol) {
    const strategies = ['CALL_SPREAD', 'PUT_SPREAD', 'STRADDLE', 'STRANGLE', 'PROTECTIVE_PUT', 'COVERED_CALL', 'COLLAR'];
    const trades = [];
    
    for (let i = 0; i < 5; i++) {
      trades.push({
        symbol,
        strategy_type: strategies[Math.floor(Math.random() * strategies.length)],
        notional: Math.random() * 2000000 + 1000000,
        timestamp: new Date().toISOString(),
        legs: Math.floor(Math.random() * 4) + 2
      });
    }
    
    return trades;
  }

  getRandomExpiration(baseDate) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + Math.floor(Math.random() * 45) + 1);
    return date.toISOString().split('T')[0];
  }

  // For actual webhook integration
  async handleWebhook(payload) {
    try {
      // Parse webhook payload from Unusual Whales
      // This would be customized based on actual webhook format
      const { symbol, blocks, flow, timestamp } = this.parseWebhookPayload(payload);
      
      // Store the data
      if (!this.pendingBlocks.has(symbol)) {
        this.pendingBlocks.set(symbol, []);
      }
      this.pendingBlocks.get(symbol).push(...blocks);
      this.lastUpdate.set(symbol, new Date());
      
      this.logger.info(`Webhook processed for ${symbol}: ${blocks.length} blocks`);
      
      return { success: true, symbol, count: blocks.length };
      
    } catch (error) {
      this.logger.error(`Webhook handling error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  parseWebhookPayload(payload) {
    // This would parse actual Unusual Whales webhook format
    // For now, return simulated data
    return {
      symbol: payload.symbol || 'SPY',
      blocks: payload.blocks || [],
      flow: payload.flow || [],
      timestamp: new Date()
    };
  }

  // Get stored data for a symbol
  getStoredData(symbol, hoursBack = 24) {
    const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    const blocks = this.pendingBlocks.get(symbol) || [];
    
    return {
      blocks: blocks.filter(b => new Date(b.timestamp) > cutoff),
      lastUpdate: this.lastUpdate.get(symbol)
    };
  }

  // Clear old data
  cleanupOldData(hoursToKeep = 24) {
    const cutoff = new Date(Date.now() - hoursToKeep * 60 * 60 * 1000);
    
    for (const [symbol, blocks] of this.pendingBlocks.entries()) {
      this.pendingBlocks.set(symbol, blocks.filter(b => new Date(b.timestamp) > cutoff));
    }
  }
}

module.exports = WebhookHandler;
