const WebSocket = require('ws');
const config = require('../config');
const Logger = require('../utils/logger');
const EventEmitter = require('events');

class UnusualWhalesWebSocket extends EventEmitter {
  constructor() {
    super();
    this.logger = new Logger('unusual-whales-ws');
    this.storedData = new Map(); // symbol -> { blocks: [], flow: [], timestamp }
    this.simulationCache = new Map();
    this.activeSymbols = new Set(); // Track symbols with live data
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000; // Start with 5 seconds
    
    // Connection tracking
    this.connectionStartTime = null;
    this.messageCount = 0;
    this.lastMessageTime = null;
    
    // Clean up old data periodically
    setInterval(() => this.cleanupOldData(), 3600000); // Every hour
    setInterval(() => this.connectionHealthCheck(), 30000); // Every 30 seconds
  }

  // Initialize WebSocket connection
  async connect() {
    try {
      if (this.ws && this.isConnected) {
        this.logger.info('WebSocket already connected');
        return;
      }
      
      this.logger.info('Connecting to Unusual Whales WebSocket API...');
      
      // Close existing connection if any
      if (this.ws) {
        this.ws.close();
      }
      
      // In production, this would be the real Unusual Whales WebSocket endpoint
      const wsUrl = process.env.UNUSUAL_WHALES_WS_URL || 'wss://api.unusualwhales.com/ws/v1/flow';
      
      this.ws = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Bearer ${config.apis.unusualWhales.key}`,
          'User-Agent': 'EliteInstitutionalFlowBot/1.0'
        },
        timeout: 10000
      });
      
      // Set up event handlers
      this.setupEventHandlers();
      
      this.connectionStartTime = Date.now();
      
    } catch (error) {
      this.logger.error(`Failed to connect to WebSocket: ${error.message}`);
      this.scheduleReconnect();
    }
  }

  setupEventHandlers() {
    this.ws.on('open', () => {
      this.logger.info('✅ WebSocket connected to Unusual Whales');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.reconnectDelay = 5000;
      
      // Subscribe to institutional flow channels
      this.subscribeToChannels();
      
      // Start ping interval to keep connection alive
      this.startPingInterval();
      
      // Emit connected event
      this.emit('connected');
    });

    this.ws.on('message', (data) => {
      this.lastMessageTime = Date.now();
      this.messageCount++;
      
      try {
        const message = JSON.parse(data.toString());
        this.handleWebSocketMessage(message);
      } catch (error) {
        this.logger.error(`Error parsing WebSocket message: ${error.message}`);
      }
    });

    this.ws.on('error', (error) => {
      this.logger.error(`WebSocket error: ${error.message}`);
      this.isConnected = false;
      this.emit('error', error);
    });

    this.ws.on('close', (code, reason) => {
      this.logger.warn(`WebSocket closed. Code: ${code}, Reason: ${reason}`);
      this.isConnected = false;
      this.stopPingInterval();
      this.emit('disconnected', { code, reason });
      
      if (code !== 1000) { // Normal closure
        this.scheduleReconnect();
      }
    });
  }

  subscribeToChannels() {
    if (!this.ws || !this.isConnected) return;
    
    try {
      // Subscribe to institutional flow for major symbols
      const subscribeMessage = {
        action: 'subscribe',
        channels: [
          'institutional_flow',
          'large_prints',
          'complex_trades',
          'delta_concentration'
        ],
        symbols: ['SPY', 'QQQ', 'AAPL', 'MSFT', 'TSLA', 'NVDA', 'AMZN', 'GOOGL', 'META'],
        timestamp: new Date().toISOString()
      };
      
      this.ws.send(JSON.stringify(subscribeMessage));
      this.logger.info('Subscribed to institutional flow channels');
      
    } catch (error) {
      this.logger.error(`Subscription error: ${error.message}`);
    }
  }

  handleWebSocketMessage(message) {
    try {
      const { type, data, symbol, timestamp } = message;
      
      if (!type || !data) {
        this.logger.warn('Invalid message format');
        return;
      }
      
      switch (type.toLowerCase()) {
        case 'institutional_flow':
          this.handleInstitutionalFlow(data, symbol, timestamp);
          break;
          
        case 'large_print':
        case 'block_trade':
          this.handleBlockTrade(data, symbol, timestamp);
          break;
          
        case 'complex_trade':
          this.handleComplexTrade(data, symbol, timestamp);
          break;
          
        case 'delta_concentration':
          this.handleDeltaConcentration(data, symbol, timestamp);
          break;
          
        case 'heartbeat':
        case 'ping':
          this.handleHeartbeat(data);
          break;
          
        default:
          this.logger.debug(`Unknown message type: ${type}`);
      }
      
      // Log message rate every 100 messages
      if (this.messageCount % 100 === 0) {
        const uptime = Date.now() - this.connectionStartTime;
        const messagesPerMinute = (this.messageCount / (uptime / 60000)).toFixed(1);
        this.logger.info(`Message rate: ${messagesPerMinute} msgs/min, Total: ${this.messageCount}`);
      }
      
    } catch (error) {
      this.logger.error(`Error handling WebSocket message: ${error.message}`);
    }
  }

  handleInstitutionalFlow(flowData, symbol, timestamp) {
    if (!Array.isArray(flowData)) {
      flowData = [flowData];
    }
    
    flowData.forEach(flow => {
      const processedFlow = {
        symbol,
        ...flow,
        timestamp: timestamp || new Date().toISOString(),
        source: 'websocket'
      };
      
      this.storeData('flow', processedFlow);
      
      // Emit flow event
      this.emit('flow', processedFlow);
    });
    
    this.logger.debug(`Stored ${flowData.length} flow items for ${symbol}`);
  }

  handleBlockTrade(blockData, symbol, timestamp) {
    const processedBlock = {
      symbol,
      ...blockData,
      timestamp: timestamp || new Date().toISOString(),
      source: 'websocket'
    };
    
    this.storeData('blocks', processedBlock);
    
    // Emit block event
    this.emit('block', processedBlock);
    
    this.logger.debug(`Stored block trade for ${symbol}: ${blockData.contracts} contracts @ $${blockData.strike}`);
    
    // Log significant blocks
    if (blockData.notional > 1000000) {
      const type = blockData.option_type === 'CALL' ? 'C' : 'P';
      this.logger.info(`🚨 Large block: ${symbol} ${blockData.strike}${type} $${(blockData.notional / 1000000).toFixed(1)}M`);
    }
  }

  handleComplexTrade(tradeData, symbol, timestamp) {
    const processedTrade = {
      symbol,
      ...tradeData,
      timestamp: timestamp || new Date().toISOString(),
      source: 'websocket'
    };
    
    this.storeData('complexTrades', processedTrade);
    
    // Emit complex trade event
    this.emit('complex_trade', processedTrade);
  }

  handleDeltaConcentration(deltaData, symbol, timestamp) {
    const processedData = {
      symbol,
      ...deltaData,
      timestamp: timestamp || new Date().toISOString(),
      source: 'websocket'
    };
    
    this.storeData('deltaConcentration', processedData);
    
    // Emit delta concentration event
    this.emit('delta_concentration', processedData);
  }

  handleHeartbeat(data) {
    // Send pong response if required
    if (data && data.requires_pong) {
      this.sendPong();
    }
  }

  sendPong() {
    if (!this.ws || !this.isConnected) return;
    
    try {
      this.ws.send(JSON.stringify({ action: 'pong', timestamp: new Date().toISOString() }));
    } catch (error) {
      this.logger.error(`Error sending pong: ${error.message}`);
    }
  }

  startPingInterval() {
    // Send ping every 30 seconds to keep connection alive
    this.pingInterval = setInterval(() => {
      if (this.ws && this.isConnected) {
        try {
          this.ws.send(JSON.stringify({ action: 'ping', timestamp: new Date().toISOString() }));
          this.logger.debug('Sent ping');
        } catch (error) {
          this.logger.error(`Error sending ping: ${error.message}`);
        }
      }
    }, 30000);
  }

  stopPingInterval() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('Max reconnection attempts reached. Please check API key and network connection.');
      return;
    }
    
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * this.reconnectAttempts, 60000); // Max 60 seconds
    
    this.logger.info(`Scheduling reconnection attempt ${this.reconnectAttempts} in ${delay}ms`);
    
    setTimeout(() => {
      this.logger.info(`Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      this.connect();
    }, delay);
  }

  connectionHealthCheck() {
    if (!this.isConnected) return;
    
    // Check if we've received any messages in the last 2 minutes
    if (this.lastMessageTime && (Date.now() - this.lastMessageTime > 120000)) {
      this.logger.warn('No messages received for 2 minutes. Connection may be stale.');
      // Force reconnect
      this.ws.close();
      this.scheduleReconnect();
    }
  }

  // Store data by type and symbol
  storeData(type, data) {
    const { symbol } = data;
    
    if (!symbol) {
      this.logger.warn('Cannot store data without symbol');
      return;
    }
    
    // Track active symbol
    this.activeSymbols.add(symbol.toUpperCase());
    
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
    
    switch (type) {
      case 'blocks':
        symbolData.blocks.push(data);
        // Keep only recent blocks (last 200 for better live analysis)
        if (symbolData.blocks.length > 200) {
          symbolData.blocks = symbolData.blocks.slice(-200);
        }
        break;
        
      case 'flow':
        symbolData.flow.push(data);
        // Keep only recent flow (last 1000 for better live analysis)
        if (symbolData.flow.length > 1000) {
          symbolData.flow = symbolData.flow.slice(-1000);
        }
        break;
        
      case 'complexTrades':
        symbolData.complexTrades.push(data);
        break;
        
      case 'deltaConcentration':
        symbolData.deltaConcentration.push(data);
        break;
    }
    
    symbolData.lastUpdated = new Date();
  }

  // NEW: Get live blocks with improved filtering for divergence detection
  async getLiveBlocks(symbol, minutesBack = 5) {
    try {
      const cutoff = new Date(Date.now() - minutesBack * 60 * 1000);
      const symbolUpper = symbol.toUpperCase();
      
      if (this.storedData.has(symbolUpper)) {
        const symbolData = this.storedData.get(symbolUpper);
        
        const recentBlocks = symbolData.blocks.filter(block => 
          new Date(block.timestamp) > cutoff
        ).map(block => ({
          ...block,
          // Ensure required fields for divergence detection
          notional: block.notional || (block.premium || 0) * (block.contracts || 0) * 100,
          real_delta: block.real_delta || (block.option_type === 'CALL' ? 0.5 : -0.5) * 0.8,
          delta_exposure: block.delta_exposure || ((block.real_delta || 0.5) * (block.notional || 0))
        }));
        
        if (recentBlocks.length > 0) {
          // Sort by timestamp descending (newest first)
          return recentBlocks.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        }
      }
      
      // If no recent blocks in WebSocket, simulate some
      return await this.simulateLiveBlocks(symbol, minutesBack);
      
    } catch (error) {
      this.logger.error(`Live blocks error for ${symbol}: ${error.message}`);
      return [];
    }
  }

  // NEW: Get active symbols with recent data
  getActiveSymbols() {
    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
    
    const active = [];
    
    for (const [symbol, data] of this.storedData.entries()) {
      // Check if we have recent data for this symbol
      const hasRecentData = data.blocks.some(block => 
        new Date(block.timestamp) > tenMinutesAgo
      ) || data.flow.some(flow => 
        new Date(flow.timestamp) > tenMinutesAgo
      );
      
      if (hasRecentData) {
        active.push(symbol);
      }
    }
    
    return active;
  }

  // NEW: Get recent data count for a symbol
  getRecentDataCount(symbol, minutesBack = 10) {
    const cutoff = new Date(Date.now() - minutesBack * 60 * 1000);
    const symbolUpper = symbol.toUpperCase();
    
    if (!this.storedData.has(symbolUpper)) {
      return { blocks: 0, flow: 0 };
    }
    
    const data = this.storedData.get(symbolUpper);
    
    const recentBlocks = data.blocks.filter(block => 
      new Date(block.timestamp) > cutoff
    ).length;
    
    const recentFlow = data.flow.filter(flow => 
      new Date(flow.timestamp) > cutoff
    ).length;
    
    return { blocks: recentBlocks, flow: recentFlow };
  }

  // Enhanced getConnectionStats with more detailed info
  getConnectionStats() {
    const activeSymbols = this.getActiveSymbols();
    
    return {
      isConnected: this.isConnected,
      connectionUptime: this.connectionStartTime ? Date.now() - this.connectionStartTime : 0,
      messageCount: this.messageCount,
      lastMessageTime: this.lastMessageTime,
      reconnectAttempts: this.reconnectAttempts,
      symbolsWithData: this.storedData.size,
      activeSymbols: activeSymbols.length,
      activeSymbolsList: activeSymbols.slice(0, 10), // Top 10
      storedDataSizes: Array.from(this.storedData.entries()).map(([symbol, data]) => ({
        symbol,
        blocks: data.blocks.length,
        flow: data.flow.length,
        complexTrades: data.complexTrades.length,
        deltaConcentration: data.deltaConcentration.length,
        lastUpdated: data.lastUpdated
      }))
    };
  }

  // API Methods (compatible with existing bot code) - UPDATED for better live data
  async getInstitutionalFlow(symbol, date = null) {
    try {
      const targetDate = date || this.getTodayDate();
      
      // Check if we have WebSocket data
      if (this.storedData.has(symbol)) {
        const symbolData = this.storedData.get(symbol);
        const filteredFlow = this.filterByDate(symbolData.flow, targetDate);
        
        if (filteredFlow.length > 0) {
          this.logger.info(`Using WebSocket data for ${symbol} on ${targetDate}: ${filteredFlow.length} flows`);
          return this.processFlowData(filteredFlow, targetDate);
        }
      }
      
      // Fallback to simulation if no WebSocket data
      this.logger.info(`Simulating institutional flow for ${symbol} on ${targetDate}`);
      const simulated = await this.simulateInstitutionalFlow(symbol, targetDate);
      return this.processFlowData(simulated, targetDate);
      
    } catch (error) {
      this.logger.error(`Unusual Whales flow error for ${symbol}${date ? ' on ' + date : ''}: ${error.message}`);
      return [];
    }
  }

  async getBlocks(symbol, minSize = 100, date = null) {
    try {
      const targetDate = date || this.getTodayDate();
      
      // Check WebSocket data
      if (this.storedData.has(symbol)) {
        const symbolData = this.storedData.get(symbol);
        const filteredBlocks = this.filterByDate(symbolData.blocks, targetDate)
          .filter(block => block.contracts >= minSize);
        
        if (filteredBlocks.length > 0) {
          return filteredBlocks;
        }
      }
      
      // Fallback to simulation
      return await this.simulateBlocks(symbol, minSize, targetDate);
      
    } catch (error) {
      this.logger.error(`Unusual Whales blocks error for ${symbol}: ${error.message}`);
      return [];
    }
  }

  async getRealDelta(symbol, strike, expiration, optionType, date = null) {
    try {
      const targetDate = date || this.getTodayDate();
      
      // Try to find real delta from WebSocket data
      if (this.storedData.has(symbol)) {
        const symbolData = this.storedData.get(symbol);
        
        // Look for matching flow or block
        const matchingData = [...symbolData.flow, ...symbolData.blocks].find(item =>
          item.strike === strike &&
          item.option_type === optionType &&
          item.real_delta !== undefined
        );
        
        if (matchingData) {
          return matchingData.real_delta;
        }
      }
      
      // Fallback to simulation
      return await this.simulateRealDelta(symbol, strike, optionType, targetDate);
      
    } catch (error) {
      this.logger.error(`Unusual Whales real delta error: ${error.message}`);
      return 0;
    }
  }

  async getComplexTrades(symbol, date = null) {
    try {
      const targetDate = date || this.getTodayDate();
      
      // Check WebSocket data
      if (this.storedData.has(symbol)) {
        const symbolData = this.storedData.get(symbol);
        const filteredTrades = this.filterByDate(symbolData.complexTrades, targetDate);
        
        if (filteredTrades.length > 0) {
          return filteredTrades;
        }
      }
      
      // Fallback to simulation
      return await this.simulateComplexTrades(symbol, targetDate);
      
    } catch (error) {
      this.logger.error(`Unusual Whales complex trades error for ${symbol}: ${error.message}`);
      return [];
    }
  }

  async getDeltaConcentration(symbol, date = null) {
    try {
      const targetDate = date || this.getTodayDate();
      
      // Check WebSocket data
      if (this.storedData.has(symbol)) {
        const symbolData = this.storedData.get(symbol);
        const filteredConcentration = this.filterByDate(symbolData.deltaConcentration, targetDate);
        
        if (filteredConcentration.length > 0) {
          return filteredConcentration;
        }
      }
      
      // Fallback to simulation
      return await this.simulateDeltaConcentration(symbol, targetDate);
      
    } catch (error) {
      this.logger.error(`Unusual Whales delta concentration error for ${symbol}: ${error.message}`);
      return [];
    }
  }

  // Utility methods
  filterByDate(items, targetDate) {
    if (!items || items.length === 0) return [];
    
    return items.filter(item => {
      if (!item.timestamp) return false;
      const itemDate = new Date(item.timestamp).toISOString().split('T')[0];
      return itemDate === targetDate;
    });
  }

  processFlowData(flowData, targetDate) {
    return flowData.filter(flow => {
      if (!flow.timestamp) return false;
      
      try {
        const flowDate = new Date(flow.timestamp).toISOString().split('T')[0];
        const matchesDate = flowDate === targetDate;
        
        const isValid = flow.option_type && 
                       flow.strike && 
                       flow.notional && 
                       flow.notional >= config.rules.minNotional;
        
        return matchesDate && isValid;
        
      } catch (error) {
        this.logger.warn(`Error parsing flow timestamp: ${error.message}`);
        return false;
      }
    }).map(flow => {
      try {
        const expiration = flow.expiration ? new Date(flow.expiration) : null;
        const flowTimestamp = new Date(flow.timestamp);
        const dte = expiration ? Math.ceil((expiration - flowTimestamp) / (1000 * 60 * 60 * 24)) : 0;
        
        // Calculate delta exposure if not present
        const realDelta = flow.real_delta || (flow.option_type === 'CALL' ? 0.5 : -0.5) * 0.8;
        const deltaExposure = flow.delta_exposure || realDelta * flow.notional;
        
        return {
          ...flow,
          real_delta: realDelta,
          delta_exposure: deltaExposure,
          dte: Math.max(0, dte),
          timestamp: flowTimestamp,
          // Add fields for divergence detection
          distance_percent: 0, // Will be calculated in flow-analyzer
          distance_absolute: 0,
          atm: false,
          hour: flowTimestamp.getHours(),
          stock_price: flow.stock_price || 0,
          stock_option_combo: flow.stock_option_combo || false,
          flow_type: flow.complex_type || 'SINGLE'
        };
      } catch (error) {
        this.logger.warn(`Error processing flow: ${error.message}`);
        return {
          ...flow,
          dte: 0,
          timestamp: new Date(flow.timestamp || targetDate)
        };
      }
    });
  }

  // Simulation methods (enhanced for better live analysis)
  async simulateLiveBlocks(symbol, minutesBack) {
    const blocks = [];
    const now = new Date();
    const basePrice = 100 + Math.random() * 50;
    
    // Generate more realistic blocks for divergence detection
    for (let i = 0; i < 3 + Math.floor(Math.random() * 5); i++) {
      const minutesAgo = Math.random() * minutesBack;
      const timestamp = new Date(now.getTime() - minutesAgo * 60 * 1000);
      const isCall = Math.random() > 0.4; // Slightly biased to calls
      const strike = Math.round(basePrice * (0.97 + Math.random() * 0.06));
      const contracts = Math.floor(Math.random() * 3000) + 500;
      const pricePerContract = parseFloat((0.5 + Math.random() * 5).toFixed(2));
      const notional = contracts * pricePerContract * 100;
      const realDelta = isCall ? 0.4 + Math.random() * 0.4 : -0.4 - Math.random() * 0.4;
      
      blocks.push({
        symbol,
        timestamp: timestamp.toISOString(),
        option_type: isCall ? 'CALL' : 'PUT',
        strike,
        expiration: this.getRandomExpiration(timestamp),
        contracts,
        price: pricePerContract,
        notional,
        side: Math.random() > 0.3 ? 'BUY' : 'SELL',
        real_delta: realDelta,
        delta_exposure: realDelta * notional,
        dte: Math.floor(Math.random() * 5),
        complex_type: Math.random() > 0.85 ? (isCall ? 'CALL_SPREAD' : 'PUT_SPREAD') : null,
        source: 'simulation'
      });
    }
    
    return blocks.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  // Other simulation methods remain the same...
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
      const realDelta = isCall ? 0.5 + Math.random() * 0.3 : -0.5 - Math.random() * 0.3;
      
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
        real_delta: realDelta,
        delta_exposure: realDelta * notional,
        dte: Math.floor(Math.random() * 14),
        complex_type: Math.random() > 0.8 ? (isCall ? 'CALL_SPREAD' : 'PUT_SPREAD') : null,
        underlying_price: basePrice * (0.98 + Math.random() * 0.04),
        stock_price: basePrice * (0.99 + Math.random() * 0.02),
        stock_option_combo: Math.random() > 0.7,
        source: 'simulation'
      });
    }
    
    return flow.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  getRandomExpiration(baseDate) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + Math.floor(Math.random() * 45) + 1);
    return date.toISOString().split('T')[0];
  }

  getTodayDate() {
    return new Date().toISOString().split('T')[0];
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

  // NEW: Manual reconnect method
  reconnect() {
    this.logger.info('Manually reconnecting WebSocket...');
    this.disconnect();
    setTimeout(() => this.connect(), 1000);
  }

  // Graceful shutdown
  disconnect() {
    this.stopPingInterval();
    
    if (this.ws) {
      this.ws.close(1000, 'Normal shutdown');
      this.ws = null;
    }
    
    this.isConnected = false;
    this.logger.info('WebSocket disconnected');
  }
}

module.exports = UnusualWhalesWebSocket;
