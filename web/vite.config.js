export default {
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        configure(proxy) {
          // The browser talks to Vite on its page origin; keep the bot API private on loopback.
          proxy.on('proxyReq', (proxyRequest) => proxyRequest.removeHeader('origin'));
        },
      },
    },
  },
};
