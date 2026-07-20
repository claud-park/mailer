import { describe, expect, it } from 'vitest';
import { isPrefetchableUrl, extractRemoteImageUrls } from './image-cache';

describe('isPrefetchableUrl', () => {
  it('allows a public https URL', () => {
    expect(isPrefetchableUrl('https://example.com/logo.png')).toBe(true);
  });

  it('allows a public http URL', () => {
    expect(isPrefetchableUrl('http://example.com/logo.png')).toBe(true);
  });

  it('rejects non-http(s) schemes', () => {
    expect(isPrefetchableUrl('ftp://example.com/x.png')).toBe(false);
    expect(isPrefetchableUrl('file:///etc/passwd')).toBe(false);
    expect(isPrefetchableUrl('cid:logo@zenmail')).toBe(false);
  });

  it('rejects loopback IP literals', () => {
    expect(isPrefetchableUrl('http://127.0.0.1/x.png')).toBe(false);
    expect(isPrefetchableUrl('http://127.5.5.5/x.png')).toBe(false);
  });

  it('rejects RFC1918 private ranges', () => {
    expect(isPrefetchableUrl('http://10.0.0.5/x.png')).toBe(false);
    expect(isPrefetchableUrl('http://172.16.0.1/x.png')).toBe(false);
    expect(isPrefetchableUrl('http://172.31.255.255/x.png')).toBe(false);
    expect(isPrefetchableUrl('http://192.168.1.1/x.png')).toBe(false);
  });

  it('allows 172.x outside the 16-31 private range', () => {
    expect(isPrefetchableUrl('http://172.32.0.1/x.png')).toBe(true);
    expect(isPrefetchableUrl('http://172.15.255.255/x.png')).toBe(true);
  });

  it('rejects link-local (169.254.0.0/16, incl. cloud metadata 169.254.169.254)', () => {
    expect(isPrefetchableUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isPrefetchableUrl('http://169.254.1.1/x.png')).toBe(false);
  });

  it('rejects IPv6 loopback and unique-local', () => {
    expect(isPrefetchableUrl('http://[::1]/x.png')).toBe(false);
    expect(isPrefetchableUrl('http://[fc00::1]/x.png')).toBe(false);
    expect(isPrefetchableUrl('http://[fe80::1]/x.png')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isPrefetchableUrl('not a url')).toBe(false);
  });
});

describe('extractRemoteImageUrls', () => {
  it('extracts a single https img src', () => {
    expect(extractRemoteImageUrls('<img src="https://example.com/a.png">')).toEqual([
      'https://example.com/a.png',
    ]);
  });

  it('extracts multiple img srcs, ignoring cid: and data:', () => {
    const html = `
      <img src="https://example.com/a.png">
      <img src="cid:logo@zenmail">
      <img src='http://example.com/b.jpg'>
      <img src="data:image/png;base64,abc">
    `;
    expect(extractRemoteImageUrls(html)).toEqual([
      'https://example.com/a.png',
      'http://example.com/b.jpg',
    ]);
  });

  it('returns an empty array when there are no remote images', () => {
    expect(extractRemoteImageUrls('<p>no images here</p>')).toEqual([]);
  });

  it('dedupes repeated URLs', () => {
    const html = '<img src="https://example.com/a.png"><img src="https://example.com/a.png">';
    expect(extractRemoteImageUrls(html)).toEqual(['https://example.com/a.png']);
  });
});
