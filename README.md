# TypeScript Proxy Server

A lightweight, type-safe proxy server built with TypeScript, Express, and Axios. This server acts as a middleware to proxy requests through a residential proxy service.

## Features

- TypeScript support with type safety
- Residential proxy integration
- HTML link rewriting for proxied content
- Automatic redirect handling
- Environment variable configuration
- Error handling and logging

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)
- A residential proxy service account

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd proxy-server
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with your proxy configuration:
```env
PROXY=username:password@host:port
PORT=3000  # Optional, defaults to 3000
```

## Usage

### Development

Run the server in development mode with hot reloading:
```bash
npm run dev
```

### Production

1. Build the TypeScript code:
```bash
npm run build
```

2. Start the production server:
```bash
npm start
```

## API Endpoints

### GET /proxy

Proxies requests through the configured residential proxy.

**Query Parameters:**
- `url` (required): The target URL to proxy

**Example:**
```
http://localhost:3000/proxy?url=https://example.com
```

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| PROXY | Proxy configuration in format `username:password@host:port` | Yes | - |
| PORT | Server port number | No | 3000 |

## Project Structure

```
.
├── src/
│   └── index.ts      # Main application file
├── dist/             # Compiled JavaScript files
├── .env              # Environment variables
├── .gitignore        # Git ignore file
├── package.json      # Project dependencies and scripts
├── tsconfig.json     # TypeScript configuration
└── README.md         # Project documentation
```

## Scripts

- `npm run dev`: Start development server with hot reloading
- `npm run build`: Build TypeScript code to JavaScript
- `npm start`: Run the production server
- `npm run watch`: Watch for TypeScript changes and rebuild

## Error Handling

The server includes comprehensive error handling:
- Missing environment variables
- Invalid proxy configuration
- Network errors
- Invalid target URLs
- Proxy service errors

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the ISC License. 