import express, { Request, Response } from 'express';
import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { URL } from 'url';
import dotenv from 'dotenv';
import path from 'path';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import chalk from 'chalk';

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);

// Enable CORS for all routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '../public')));

// Parse proxy configuration from single PROXY environment variable
const proxyUrl = process.env.PROXY;
if (!proxyUrl) {
  console.error(chalk.red('❌ Missing required environment variable: PROXY'));
  console.error(chalk.yellow('Format should be: username:password@host:port'));
  process.exit(1);
}

const proxyAgent = new HttpsProxyAgent(`http://${proxyUrl}`);

// Helper function to normalize URLs
function normalizeUrl(urlString: string, baseUrl?: string): string {
  try {
    // Handle protocol-relative URLs (starting with //)
    if (urlString.startsWith('//')) {
      return `https:${urlString}`;
    }

    // Handle relative URLs
    if (baseUrl && !urlString.startsWith('http')) {
      const base = new URL(baseUrl);
      return new URL(urlString, base.origin).toString();
    }

    // Validate URL
    new URL(urlString);
    return urlString;
  } catch (error) {
    console.error(chalk.red('❌ Error normalizing URL:'), error);
    throw new Error('Invalid URL format');
  }
}

// Generic proxy handler for all HTTP methods
async function handleProxyRequest(req: Request, res: Response): Promise<void> {
  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    res.status(400).send('Missing target URL');
    return;
  }

  try {
    // Normalize the target URL
    const normalizedUrl = normalizeUrl(targetUrl);
    console.log(chalk.cyan('🔄 Proxying'), chalk.yellow(req.method), chalk.cyan('request to:'), chalk.green(normalizedUrl));

    const config: AxiosRequestConfig = {
      method: req.method,
      url: normalizedUrl,
      responseType: 'arraybuffer',
      validateStatus: () => true,
      httpsAgent: proxyAgent,
      maxRedirects: 5,
      timeout: 30000,
      headers: {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        ...Object.fromEntries(
          Object.entries(req.headers)
            .filter(([key, value]) =>
              typeof value === 'string' &&
              !['host', 'origin', 'referer'].includes(key.toLowerCase())
            )
        )
      },
    };

    if (req.body && Object.keys(req.body).length > 0) {
      console.log(chalk.magenta('📦 Request body:'), chalk.gray(JSON.stringify(req.body, null, 2)));
      config.data = req.body;
    }

    delete req.query["url"];
    if (req.query && Object.keys(req.query).length > 0) {
      console.log(chalk.magenta('🔍 Query parameters:'), chalk.gray(JSON.stringify(req.query, null, 2)));
      config.params = req.query;
    }

    const response = await axios(config);
    console.log(chalk.blue('📡 Response status:'), chalk.yellow(response.status));

    // Handle Redirect (HTTP 30x)
    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      const location = response.headers.location;
      const newTarget = location.startsWith('http') ? location : new URL(location, normalizedUrl).toString();
      const proxiedLocation = `/proxy?url=${encodeURIComponent(newTarget)}`;
      console.log(chalk.yellow('↪️ Redirect detected. Rewriting to:'), chalk.green(proxiedLocation));
      res.redirect(proxiedLocation);
      return;
    }

    // Set response status
    res.status(response.status);

    // Set response headers
    const contentType = response.headers['content-type'] || 'application/octet-stream';
    console.log(chalk.blue('📦 Content-Type:'), chalk.yellow(contentType));
    res.set('Content-Type', contentType);

    // Copy relevant headers from the proxied response
    const headersToCopy = [
      'content-type',
      'content-length',
      'content-encoding',
      'content-language',
      'cache-control',
      'expires',
      'last-modified',
      'etag'
    ];

    headersToCopy.forEach(header => {
      if (response.headers[header]) {
        console.log(chalk.blue(`📦 Copying header: ${header}`), chalk.yellow(response.headers[header]));
        res.set(header, response.headers[header]);
      }
    });

    // Handle different content types
    if (contentType.includes('text/html')) {
      const body = response.data.toString('utf8');
      console.log(chalk.blue('📄 Processing HTML content'));

      // Add base href tag if not present
      let modifiedBody = body;
      if (!/<base[^>]*>/i.test(body)) {
        const parsedUrl = new URL(normalizedUrl);
        const baseHref = parsedUrl.origin /* + parsedUrl.pathname */;
        modifiedBody = body.replace(/<head[^>]*>/i, `$&<base href="${baseHref}">`);
      }

      // Rewrite URLs in HTML content
      const rewrittenBody = modifiedBody.replace(/(href|src|action)=["'](.*?)["']/gi, (match: string, attr: string, link: string) => {
        try {
          if (link.startsWith('http') || link.startsWith('//')) {
            return `${attr}="/proxy?url=${encodeURIComponent(normalizeUrl(link, normalizedUrl))}"`;
          } else {
            const parsedUrl = new URL(normalizedUrl);
            const absoluteUrl = new URL(link, parsedUrl.origin).toString();
            return `${attr}="/proxy?url=${encodeURIComponent(absoluteUrl)}"`;
          }
        } catch (error) {
          console.error(chalk.red('❌ Error rewriting URL:'), error);
          return match;
        }
      });

      console.log(rewrittenBody);
      await res.send(rewrittenBody);
      console.log(chalk.blue('📄 HTML content sent successfully'));
    } else if (contentType.includes('application/json')) {
      console.log(chalk.blue('📦 Processing JSON response'));
      try {
        const jsonData = JSON.parse(response.data.toString('utf8'));
        res.json(jsonData);
      } catch (error) {
        console.error(chalk.red('❌ Error parsing JSON:'), error);
        res.send(response.data);
      }
    } else if (contentType.includes('text/') || contentType.includes('application/javascript') || contentType.includes('application/x-javascript')) {
      console.log(chalk.blue('📝 Processing text response'));
      res.send(response.data.toString('utf8'));
    } else {
      console.log(chalk.blue('📦 Sending binary data'));
      res.send(response.data);
    }
  } catch (error) {
    console.error(chalk.red('❌ Proxy error:'), error instanceof Error ? error.message : 'Unknown error');
    if (error instanceof Error && error.message === 'Invalid URL format') {
      res.status(400).send('Invalid URL format');
    } else {
      res.status(500).send('Proxy Error');
    }
  }
}

// Handle all HTTP methods
app.all('/proxy', handleProxyRequest);

// WebSocket proxy setup
const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket, req: Request) => {
  const targetUrl = new URL(req.url!, `http://${req.headers.host}`).searchParams.get('url');

  if (!targetUrl) {
    console.error(chalk.red('❌ WebSocket connection rejected: Missing target URL'));
    ws.close(1008, 'Missing target URL');
    return;
  }

  try {
    const normalizedUrl = normalizeUrl(targetUrl);
    console.log(chalk.cyan('🔌 Proxying WebSocket connection to:'), chalk.green(normalizedUrl));

    // Create WebSocket connection to target
    const targetWs = new WebSocket(normalizedUrl, {
      agent: proxyAgent,
      headers: {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        ...req.headers
      }
    });

    // Forward messages from client to target
    ws.on('message', (data: Buffer) => {
      if (targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(data);
      }
    });

    // Forward messages from target to client
    targetWs.on('message', (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Handle connection close
    const handleClose = () => {
      console.log(chalk.yellow('🔒 WebSocket connection closed'));
      if (ws.readyState === WebSocket.OPEN) ws.close();
      if (targetWs.readyState === WebSocket.OPEN) targetWs.close();
    };

    ws.on('close', handleClose);
    targetWs.on('close', handleClose);

    // Handle errors
    const handleError = (error: Error) => {
      console.error(chalk.red('❌ WebSocket error:'), error);
      handleClose();
    };

    ws.on('error', handleError);
    targetWs.on('error', handleError);

  } catch (error) {
    console.error(chalk.red('❌ WebSocket proxy error:'), error);
    ws.close(1011, 'Internal Server Error');
  }
});

// Server start
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
server.listen(PORT, () => {
  console.log(chalk.green('🚀 Proxy server running at'), chalk.blue(`http://localhost:${PORT}`));
  console.log(chalk.yellow('📝 Logging enabled with beautiful console output'));
}); 