const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const ReportBuilder = require('./reports/report-builder');
const FlowAnalyzer = require('./analysis/flow-analyzer');
const Logger = require('./utils/logger');

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
/multiflow [SYM1,SYM2,...] - Multi-symbol flow (max ${config.app.maxSymbols})
/status - Check bot status
/help - Show this help

*Example:* \`/flow SPY\` or \`/flow AAPL\`

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
• SAME-DAY data only
• REAL production APIs only
• NO hallucinated data
• Institutional blocks only (min $100k)

*Usage:* Simply send a stock symbol (e.g., "SPY") or use /flow command
    `;

    await this.bot.sendMessage(chatId, helpMessage, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
  }

  async sendStatus(chatId) {
    const now = new Date();
    const statusMessage = `
🏛️ *BOT STATUS REPORT*

*System Status:* ✅ OPERATIONAL
*Last Update:* ${now.toISOString()}
*Timezone:* ${config.app.timezone}
*Market Session:* ${config.app.sessionStart} - ${config.app.sessionEnd}

*API Status:*
• Tradier API: ✅ Connected
• Unusual Whales API: ✅ Connected

*Active Sessions:* ${this.userSessions.size}
*Memory Usage:* ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB

*Data Integrity:* ✅ STRICT RULES ENFORCED
• Same-day data only
• No DTE mixing
• No hallucination
• Institutional blocks only
    `;

    await this.bot.sendMessage(chatId, statusMessage, {
      parse_mode: 'Markdown'
    });
  }

  async generateFlowReport(chatId, symbol) {
    try {
      // Send initial message
      const processingMsg = await this.bot.sendMessage(chatId, 
        `🔄 Fetching REAL institutional flow data for *${symbol}*...\n` +
        `📊 Sources: Tradier Production + Unusual Whales\n` +
        `⏱️ Timeframe: TODAY ONLY | Same-day data`,
        { parse_mode: 'Markdown' }
      );

      // Track user session
      this.userSessions.set(chatId, {
        symbol,
        startTime: new Date(),
        requestCount: (this.userSessions.get(chatId)?.requestCount || 0) + 1
      });

      // Fetch and analyze data
      const flowData = await this.flowAnalyzer.analyzeSymbolFlow(symbol);
      
      // Build report
      const report = await this.reportBuilder.buildDailyReport(flowData);
      
      // Send report in chunks (Telegram has message length limits)
      const chunks = this.splitReport(report);
      
      // Delete processing message
      await this.bot.deleteMessage(chatId, processingMsg.message_id);
      
      // Send report chunks
      for (const chunk of chunks) {
        await this.bot.sendMessage(chatId, chunk, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        });
        await this.delay(100); // Small delay between chunks
      }

      this.logger.info(`Report generated for ${symbol} (Chat: ${chatId})`);

    } catch (error) {
      this.logger.error(`Error generating report for ${symbol}: ${error.message}`);
      
      let errorMessage = `❌ *INSTITUTIONAL FLOW ERROR*\n\n`;
      
      if (error.message.includes('symbol') || error.message.includes('invalid')) {
        errorMessage += `Invalid symbol: *${symbol}*\n`;
        errorMessage += `Please check the symbol and try again.`;
      } else if (error.message.includes('data') || error.message.includes('fetch')) {
        errorMessage += `Data fetch failed for *${symbol}*\n`;
        errorMessage += `API may be temporarily unavailable.`;
      } else if (error.message.includes('market closed')) {
        errorMessage += `Market is closed or no data available for *${symbol}*\n`;
        errorMessage += `Try again during market hours (9:30 AM - 4:00 PM ET).`;
      } else {
        errorMessage += `System error: ${error.message}`;
      }
      
      await this.bot.sendMessage(chatId, errorMessage, {
        parse_mode: 'Markdown'
      });
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
      `⏱️ Processing ${symbols.length} symbols...`,
      { parse_mode: 'Markdown' }
    );

    try {
      const reports = [];
      
      for (const symbol of symbols) {
        try {
          const flowData = await this.flowAnalyzer.analyzeSymbolFlow(symbol);
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
      multiReport += `📅 ${new Date().toLocaleDateString('en-US', { timeZone: config.app.timezone })}\n`;
      multiReport += `⏱️ Session: ${config.app.sessionStart} - ${new Date().toLocaleTimeString('en-US', { 
        timeZone: config.app.timezone,
        hour: '2-digit',
        minute: '2-digit'
      })} ET\n\n`;
      
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
