import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Photos are served from time-limited Supabase signed URLs, so we render them
  // with plain <img> tags. No remote image host configuration is needed.
  reactStrictMode: true,
  async headers() {
    return [
      {
        // The whole app is private. Tell crawlers and embedders to stay out.
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive, noimageindex' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ];
  },
};

export default nextConfig;
