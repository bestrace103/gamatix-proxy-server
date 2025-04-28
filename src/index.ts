import express, { Request, Response } from 'express';
import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { URL } from 'url';
import dotenv from 'dotenv';
import path from 'path';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { createProxyMiddleware } from 'http-proxy-middleware';

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
  console.error('Missing required environment variable: PROXY');
  console.error('Format should be: username:password@host:port');
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
    console.error('Error normalizing URL:', error);
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
    console.log(`Proxying ${req.method} request to: ${normalizedUrl}`);

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
      data: req.body,
      params: req.query
    };

    const response = await axios(config);

    // Handle Redirect (HTTP 30x)
    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      const location = response.headers.location;
      const newTarget = location.startsWith('http') ? location : new URL(location, normalizedUrl).toString();
      const proxiedLocation = `/proxy?url=${encodeURIComponent(newTarget)}`;
      console.log(`Redirect detected. Rewriting to: ${proxiedLocation}`);
      res.redirect(proxiedLocation);
      return;
    }

    // Set response status
    res.status(response.status);

    // Set response headers
    const contentType = response.headers['content-type'] || 'application/octet-stream';
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
        res.set(header, response.headers[header]);
      }
    });

    // Handle different content types
    if (contentType.includes('text/html')) {
      const body = response.data.toString('utf8');
      
      // Rewrite URLs in HTML content
      const rewrittenBody = body.replace(/(href|src|action)=["'](.*?)["']/gi, (match: string, attr: string, link: string) => {
        try {
          if (link.startsWith('http') || link.startsWith('//')) {
            return `${attr}="/proxy?url=${encodeURIComponent(normalizeUrl(link, normalizedUrl))}"`;
          } else {
            const parsedUrl = new URL(normalizedUrl);
            const absoluteUrl = new URL(link, parsedUrl.origin).toString();
            return `${attr}="/proxy?url=${encodeURIComponent(absoluteUrl)}"`;
          }
        } catch (error) {
          console.error('Error rewriting URL:', error);
          return match;
        }
      });

      res.send(rewrittenBody);
    } else if (contentType.includes('application/json')) {
      // Handle JSON responses
      try {
        const jsonData = JSON.parse(response.data.toString('utf8'));
        res.json(jsonData);
      } catch (error) {
        console.error('Error parsing JSON:', error);
        res.send(response.data);
      }
    } else if (contentType.includes('text/') || contentType.includes('application/javascript') || contentType.includes('application/x-javascript')) {
      // Handle text-based responses
      res.send(response.data.toString('utf8'));
    } else {
      // For binary data or other content types, send as is
      res.send(response.data);
    }
  } catch (error) {
    console.error('Proxy error:', error instanceof Error ? error.message : 'Unknown error');
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
    ws.close(1008, 'Missing target URL');
    return;
  }

  try {
    const normalizedUrl = normalizeUrl(targetUrl);
    console.log(`Proxying WebSocket connection to: ${normalizedUrl}`);

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
      if (ws.readyState === WebSocket.OPEN) ws.close();
      if (targetWs.readyState === WebSocket.OPEN) targetWs.close();
    };

    ws.on('close', handleClose);
    targetWs.on('close', handleClose);

    // Handle errors
    const handleError = (error: Error) => {
      console.error('WebSocket error:', error);
      handleClose();
    };

    ws.on('error', handleError);
    targetWs.on('error', handleError);

  } catch (error) {
    console.error('WebSocket proxy error:', error);
    ws.close(1011, 'Internal Server Error');
  }
});

// Server start
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
server.listen(PORT, () => {
  console.log(`Proxy server running at http://localhost:${PORT}`);
}); 