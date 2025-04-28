import express, { Request, Response } from 'express';
import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { URL } from 'url';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();

// Set your residential proxy information from environment variables
const proxyHost: string = process.env.PROXY_HOST || '123.123.123.123';
const proxyPort: string = process.env.PROXY_PORT || '8000';
const proxyUsername: string = process.env.PROXY_USERNAME || 'yourUsername';
const proxyPassword: string = process.env.PROXY_PASSWORD || 'yourPassword';

// Validate required environment variables
const requiredEnvVars = ['PROXY_HOST', 'PROXY_PORT', 'PROXY_USERNAME', 'PROXY_PASSWORD'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars.join(', '));
  console.error('Please check your .env file');
  process.exit(1);
}

const proxyAgent = new HttpsProxyAgent(`http://${proxyUsername}:${proxyPassword}@${proxyHost}:${proxyPort}`);

// Proxy route
app.get('/proxy', async (req: Request, res: Response): Promise<void> => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    res.status(400).send('Missing target URL');
    return;
  }

  try {
    console.log(`Proxying: ${targetUrl}`);

    const config: AxiosRequestConfig = {
      responseType: 'arraybuffer',
      validateStatus: () => true, // Accept all status codes
      httpsAgent: proxyAgent,
      maxRedirects: 0,
      headers: {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        'Accept-Language': req.headers['accept-language'] || 'en-US',
      },
    };

    const response = await axios.get(targetUrl, config);

    // Handle Redirect (HTTP 30x)
    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      const location = response.headers.location;

      let newTarget: string;
      if (location.startsWith('http')) {
        newTarget = location;
      } else {
        const parsedUrl = new URL(targetUrl);
        newTarget = new URL(location, parsedUrl.origin).toString();
      }

      const proxiedLocation = `/proxy?url=${encodeURIComponent(newTarget)}`;

      console.log(`Redirect detected. Rewriting to: ${proxiedLocation}`);

      res.redirect(proxiedLocation);
      return;
    }

    // Serve content
    const contentType = response.headers['content-type'] || 'application/octet-stream';
    res.set('Content-Type', contentType);

    // --- [OPTIONAL] Rewriting HTML links inside page ---
    if (contentType.includes('text/html')) {
      const body = response.data.toString('utf8');

      // Very basic rewriting for src/href/action
      const rewrittenBody = body.replace(/(href|src|action)=["'](.*?)["']/gi, (match: string, attr: string, link: string) => {
        if (link.startsWith('http') || link.startsWith('//')) {
          return `${attr}="/proxy?url=${encodeURIComponent(link)}"`;
        } else {
          const parsedUrl = new URL(targetUrl);
          const absoluteUrl = new URL(link, parsedUrl.origin).toString();
          return `${attr}="/proxy?url=${encodeURIComponent(absoluteUrl)}"`;
        }
      });

      res.send(rewrittenBody);
    } else {
      res.send(response.data);
    }
  } catch (error) {
    console.error('Proxy error:', error instanceof Error ? error.message : 'Unknown error');
    res.status(500).send('Proxy Error');
  }
});

// Server start
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
app.listen(PORT, () => {
  console.log(`Proxy server running at http://localhost:${PORT}`);
}); 