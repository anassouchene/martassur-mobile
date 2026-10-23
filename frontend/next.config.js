/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:5050/api/:path*',
      },
      {
        source: '/hubs/:path*',
        destination: 'http://127.0.0.1:5050/hubs/:path*',
      },
      {
        source: '/storage/:path*',
        destination: 'http://127.0.0.1:5050/storage/:path*',
      },
    ];
  },
};

module.exports = nextConfig;

