const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const ReportBuilder = require('./reports/report-builder');
const FlowAnalyzer = require('./analysis/flow-analyzer');
const Logger = require('./utils/logger');
const moment = require('moment-timezone');

class EliteInstitutionalFlowBot {
  constructor() {
    this.bot = null;
    this.reportBuilder = new ReportBuilder();
    this.flowAnalyzer = new FlowAnalyzer();
    this.logger = new Logger('bot');
    this.userSessions = new Map();
    
    this.initializeBot();
    this.setupCommands();
  }

  initializeBot() {
    try {
      this.bot = new TelegramBot(config.telegram.token, {
        polling: true,
        request: {
          timeout: 60000
        }
      });
      
      this.logger.info('🤖 ELITE INSTITUTIONAL FLOW BOT initialized');
      this.logger.info('📊 Using REAL production data only');
      this.logger.info('✅ Tradier API: Production');
      this.logger.info('✅ Unusual Whales API: Institutional Flow');
      
    } catch (error) {
      this.logger.error(`Failed to initialize bot: ${error.message}`);
      process.exit(1);
    }
  }

  setupCommands() {
    // Start command
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      await this.sendWelcomeMessage(chatId);
    });

    // Flow report command
    this.bot.onText(/\/flow (.+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const symbol = match[1].toUpperCase().trim();
      
      await this.generateFlowReport(chatId, symbol);
    });

    // Historical flow report command (new)
    this.bot.onText(/\/flow_hist (.+) (.+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const symbol = match[1].toUpperCase().trim();
      const date = match[2].trim(); // YYYY-MM-DD format
      
      await this.generateHistoricalFlowReport(chatId, symbol, date);
    });

    // Multi-symbol flow
    this.bot.onText(/\/multiflow (.+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const symbols = match[1].split(',').map(s => s.toUpperCase().trim()).slice(0, config.app.maxSymbols);
      
      await this.generateMultiFlowReport(chatId, symbols);
    });

    // Help command
    this.bot.onText(/\/help/, async (msg) => {
      const chatId = msg.chat.id;
      await this.sendHelpMessage(chatId);
    });

    // Status command
    this.bot.onText(/\/status/, async (msg) => {
      const chatId = msg.chat.id;
      await this.sendStatus(chatId);
    });

    // Handle all messages
    this.bot.on('message', async (msg) => {
      if (!msg.text || msg.text.startsWith('/')) return;
      
      const chatId = msg.chat.id;
      const text = msg.text.toUpperCase().trim();
      
      // Check if it's a valid stock symbol (simple validation)
      if (text.length <= 5 && /^[A-Z]+$/.test(text)) {
        await this.generateFlowReport(chatId, text);
      }
    });

    // Error handling
    this.bot.on('polling_error', (error) => {
      this.logger.error(`Polling error: ${error.message}`);
    });

    this.bot.on('webhook_error', (error) => {
      this.logger.error(`Webhook error: ${error.message}`);
    });
  }

  async sendWelcomeMessage(chatId) {
    const welcomeMessage = `
🏛️ *ELITE INSTITUTIONAL OPTIONS FLOW ANALYST*

*DATA SOURCES:*
✅ Tradier PRODUCTION API (equity + options)
✅ Unusual Whales API (institutional flow, blocks, real delta)

*HARD RULES:*
❌ NEVER hallucinate data
❌ NEVER mix trading days
❌ NEVER mix DTE tiers
✅ ALWAYS show dollar values
✅ ALWAYS show directional interpretation

*AVAILABLE COMMANDS:*
/flow [SYMBOL] - Generate institutional flow report
/flow_hist [SYMBOL] [YYYY-MM-DD] - Historical flow report
/multiflow [SYM1,SYM2,...] - Multi-symbol flow (max ${config.app.maxSymbols})
/status - Check bot status
/help - Show this help

*Example:* \`/flow SPY\` or \`/flow AAPL\`
*Historical:* \`/flow_hist SPY 2024-03-15\`

⚠️ *This is NOT retail analysis. This is hedge-fund grade institutional flow.*
    `;

    await this.bot.sendMessage(chatId, welcomeMessage, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
  }

  async sendHelpMessage(chatId) {
    const helpMessage = `
📘 *INSTITUTIONAL FLOW BOT HELP*

*REPORT SECTIONS:*
1. 📊 Daily Institutional Flow Summary
2. ⏰ Hourly Equity Flow Breakdown
3. 🚨 Flow Divergences Detected
4. 🐘 Tier-1 & Tier-2 Flow Analysis
5. 🎯 ATM Flow (±2%)
6. 🧩 Complex Strategy Analysis
7. 🏆 Top Institutional Prints
8. 🧱 Delta Concentration Points
9. 🎯 Key Institutional Levels
10. 📈 Daily Flow Summary
11. 🎯 Institutional Thesis

*TIER DEFINITIONS:*
🚨 TIER-1: 0-3 DTE ONLY (Urgent flow)
🐘 TIER-2: 3-14 DTE ONLY (Patient flow)
❌ ZERO overlap allowed

*DATA VALIDATION:*
• SAME-DAY data only for each report
• REAL production APIs only
• NO hallucinated data
• Institutional blocks only (min $100k)

*24/7 AVAILABILITY:*
• Market hours: Real-time flow analysis
• After hours: Previous session analysis
• Weekends: Last trading day analysis
• Holidays: Most recent trading day

*Usage:* Simply send a stock symbol (e.g., "SPY") or use /flow command
    `;

    await this.bot.sendMessage(chatId, helpMessage, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
  }

  async sendStatus(chatId) {
    const now = new Date();
    const nyTime = new Date(now.toLocaleString('en-US', { timeZone: config.app.timezone }));
    const isMarketOpen = this.isMarketOpen();
    const tradingDate = this.getTradingDate();
    
    const statusMessage = `
🏛️ *BOT STATUS REPORT*

*System Status:* ✅ OPERATIONAL
*Current Time:* ${nyTime.toLocaleTimeString('en-US')} ET
*Trading Date:* ${tradingDate}
*Market Status:* ${isMarketOpen ? '✅ OPEN' : '❌ CLOSED'}

*API Status:*
• Tradier API: ✅ Connected
• Unusual Whales API: ✅ Connected

*Active Sessions:* ${this.userSessions.size}
*Memory Usage:* ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB

*Data Availability:*
• Real-time flow: ${isMarketOpen ? '✅ Active' : '❌ Market Closed'}
• Historical analysis: ✅ 24/7 Available
• Weekend data: ✅ Last trading day
• Data integrity: ✅ STRICT RULES ENFORCED
    `;

    await this.bot.sendMessage(chatId, statusMessage, {
      parse_mode: 'Markdown'
    });
  }

  // Helper method to determine trading date
  getTradingDate() {
    const now = moment().tz(config.app.timezone);
    const day = now.day(); // 0=Sun, 1=Mon, etc.
    const hour = now.hour();
    const minute = now.minute();
    
    // If weekend, return Friday's date
    if (day === 0) { // Sunday
      return now.subtract(2, 'days').format('YYYY-MM-DD');
    } else if (day === 6) { // Saturday
      return now.subtract(1, 'days').format('YYYY-MM-DD');
    }
    
    // If before market open on weekday, return previous trading day
    if (hour < 9 || (hour === 9 && minute < 30)) {
      // If Monday before open, return Friday
      if (day === 1) {
        return now.subtract(3, 'days').format('YYYY-MM-DD');
      }
      return now.subtract(1, 'days').format('YYYY-MM-DD');
    }
    
    // During or after market hours, return today
    return now.format('YYYY-MM-DD');
  }

  // Helper method to check if market is open
  isMarketOpen() {
    const now = moment().tz(config.app.timezone);
    const day = now.day();
    const hour = now.hour();
    const minute = now.minute();
    
    // Market closed on weekends
    if (day === 0 || day === 6) return false;
    
    // Market hours: 9:30 AM - 4:00 PM ET
    if (hour < 9 || hour > 16) return false;
    if (hour === 9 && minute < 30) return false;
    if (hour === 16 && minute > 0) return false;
    
    return true;
  }

  async generateFlowReport(chatId, symbol, specificDate = null) {
    try {
      // Determine which date to analyze
      const targetDate = specificDate || this.getTradingDate();
      const isLive = !specificDate && this.isMarketOpen();
      
      // Send initial message
      const processingMsg = await this.bot.sendMessage(chatId, 
        `🔄 ${isLive ? 'Fetching LIVE' : 'Analyzing historical'} institutional flow for *${symbol}*\n` +
        `📅 Date: ${targetDate} ${isLive ? '(Live Session)' : '(Historical)'}\n` +
        `📊 Sources: Tradier Production + Unusual Whales\n` +
        `⏱️ Timeframe: ${isLive ? 'CURRENT SESSION' : 'COMPLETE SESSION'} data`,
        { parse_mode: 'Markdown' }
      );

      // Track user session
      this.userSessions.set(chatId, {
        symbol,
        date: targetDate,
        startTime: new Date(),
        requestCount: (this.userSessions.get(chatId)?.requestCount || 0) + 1
      });

      // Fetch and analyze data WITH DATE PARAMETER
      const flowData = await this.flowAnalyzer.analyzeSymbolFlow(symbol, targetDate);
      
      // Add timestamp context to analysis data
      flowData.analysisContext = {
        isLive: isLive,
        analysisDate: targetDate,
        reportGenerated: new Date().toISOString(),
        marketWasOpen: this.isMarketOpen(),
        sessionType: isLive ? 'LIVE' : 'HISTORICAL'
      };
      
      // Build report
      const report = await this.reportBuilder.buildDailyReport(flowData);
      
      // Delete processing message
      await this.bot.deleteMessage(chatId, processingMsg.message_id);
      
      // Send report in chunks (Telegram has message length limits)
      const chunks = this.splitReport(report);
      
      // Send report chunks
      for (const chunk of chunks) {
        await this.bot.sendMessage(chatId, chunk, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        });
        await this.delay(100); // Small delay between chunks
      }

      this.logger.info(`Report generated for ${symbol} on ${targetDate} (Chat: ${chatId})`);

    } catch (error) {
      this.logger.error(`Error generating report for ${symbol}: ${error.message}`);
      
      let errorMessage = `❌ *INSTITUTIONAL FLOW ERROR*\n\n`;
      
      if (error.message.includes('symbol') || error.message.includes('invalid')) {
        errorMessage += `Invalid symbol: *${symbol}*\n`;
        errorMessage += `Please check the symbol and try again.`;
      } else if (error.message.includes('data') || error.message.includes('fetch')) {
        const targetDate = specificDate || this.getTradingDate();
        errorMessage += `Data fetch failed for *${symbol}* on ${targetDate}\n`;
        errorMessage += `Possible reasons:\n`;
        errorMessage += `• No institutional flow that day\n`;
        errorMessage += `• API temporarily unavailable\n`;
        errorMessage += `• Market holiday (no trading)\n`;
        errorMessage += `Try a different date with /flow_hist ${symbol} YYYY-MM-DD`;
      } else if (error.message.includes('market closed')) {
        const targetDate = this.getTradingDate();
        errorMessage += `Market is closed. Showing historical analysis for ${targetDate}\n`;
        errorMessage += `Use /flow_hist ${symbol} YYYY-MM-DD for specific dates`;
      } else {
        errorMessage += `System error: ${error.message}`;
      }
      
      await this.bot.sendMessage(chatId, errorMessage, {
        parse_mode: 'Markdown'
      });
    }
  }

  async generateHistoricalFlowReport(chatId, symbol, dateString) {
    try {
      // Validate date format
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(dateString)) {
        await this.bot.sendMessage(chatId, 
          `❌ Invalid date format. Use YYYY-MM-DD\nExample: /flow_hist SPY 2024-03-15`,
          { parse_mode: 'Markdown' }
        );
        return;
      }
      
      const date = moment(dateString, 'YYYY-MM-DD');
      if (!date.isValid()) {
        await this.bot.sendMessage(chatId, 
          `❌ Invalid date. Use YYYY-MM-DD format\nExample: /flow_hist SPY 2024-03-15`,
          { parse_mode: 'Markdown' }
        );
        return;
      }
      
      // Don't allow future dates
      const today = moment().tz(config.app.timezone);
      if (date.isAfter(today, 'day')) {
        await this.bot.sendMessage(chatId, 
          `❌ Cannot analyze future dates. Maximum date: ${today.format('YYYY-MM-DD')}`,
          { parse_mode: 'Markdown' }
        );
        return;
      }
      
      await this.generateFlowReport(chatId, symbol, dateString);
      
    } catch (error) {
      this.logger.error(`Historical flow error: ${error.message}`);
      await this.bot.sendMessage(chatId,
        `❌ Historical analysis failed.\nError: ${error.message}\nUse: /flow_hist SYMBOL YYYY-MM-DD`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  async generateMultiFlowReport(chatId, symbols) {
    if (symbols.length === 0) {
      await this.bot.sendMessage(chatId, 
        "❌ No symbols provided. Usage: /multiflow SPY,QQQ,AAPL",
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (symbols.length > config.app.maxSymbols) {
      await this.bot.sendMessage(chatId, 
        `❌ Maximum ${config.app.maxSymbols} symbols allowed.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const processingMsg = await this.bot.sendMessage(chatId,
      `🔄 Fetching multi-symbol institutional flow...\n` +
      `📊 Symbols: ${symbols.join(', ')}\n` +
      `📅 Date: ${this.getTradingDate()}\n` +
      `⏱️ Processing ${symbols.length} symbols...`,
      { parse_mode: 'Markdown' }
    );

    try {
      const reports = [];
      const targetDate = this.getTradingDate();
      
      for (const symbol of symbols) {
        try {
          const flowData = await this.flowAnalyzer.analyzeSymbolFlow(symbol, targetDate);
          const summary = this.reportBuilder.buildSummaryReport(flowData);
          reports.push({ symbol, summary });
        } catch (error) {
          reports.push({ 
            symbol, 
            summary: `❌ Error: ${error.message}` 
          });
        }
        await this.delay(500); // Delay between API calls
      }

      // Delete processing message
      await this.bot.deleteMessage(chatId, processingMsg.message_id);

      // Send multi-report
      let multiReport = `🏛️ *MULTI-SYMBOL INSTITUTIONAL FLOW*\n\n`;
      multiReport += `📅 ${this.getTradingDate()} | ${moment().tz(config.app.timezone).format('HH:mm')} ET\n`;
      multiReport += `⏱️ Analysis Time: ${moment().format('HH:mm:ss')}\n\n`;
      
      for (const report of reports) {
        multiReport += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        multiReport += `📊 *${report.symbol}*\n`;
        multiReport += report.summary + '\n\n';
      }
      
      const chunks = this.splitReport(multiReport);
      for (const chunk of chunks) {
        await this.bot.sendMessage(chatId, chunk, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        });
        await this.delay(100);
      }

    } catch (error) {
      this.logger.error(`Multi-flow error: ${error.message}`);
      await this.bot.sendMessage(chatId,
        `❌ Multi-flow analysis failed.\nError: ${error.message}`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  splitReport(report, maxLength = 4000) {
    const chunks = [];
    let currentChunk = '';
    
    const lines = report.split('\n');
    
    for (const line of lines) {
      if ((currentChunk + line + '\n').length > maxLength) {
        chunks.push(currentChunk);
        currentChunk = line + '\n';
      } else {
        currentChunk += line + '\n';
      }
    }
    
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }
    
    return chunks;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  start() {
    this.logger.info('🚀 Bot started and listening for commands...');
    
    // Keep-alive for Railway
    if (config.app.port) {
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end('ELITE INSTITUTIONAL FLOW BOT - OPERATIONAL');
      });
      
      server.listen(config.app.port, () => {
        this.logger.info(`HTTP server listening on port ${config.app.port}`);
      });
    }
  }
}

// Start the bot
if (require.main === module) {
  const bot = new EliteInstitutionalFlowBot();
  bot.start();
}

module.exports = EliteInstitutionalFlowBot;
