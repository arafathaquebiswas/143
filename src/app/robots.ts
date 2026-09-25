import type { MetadataRoute } from 'next';

/** This album is for two people. Nothing here should ever be crawled. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: '/' },
  };
}
