// Sites whose pages anyone can write, without editorial control: they carry rumours rather than
// reporting, and they are where an injection aimed at the model is easiest to plant (D-36). A
// finding cannot cite them (D-37). Bare ASCII domains: subdomains are included, a path narrows the
// entry to that part of the site, the same rules as the search tool's filter.
export const BLOCKED_DOMAINS = [
  // Social networks
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "threads.net",
  "threads.com",
  "linkedin.com",
  "pinterest.com",
  "snapchat.com",
  "tumblr.com",
  "bsky.app",
  "vk.com",
  "ok.ru",
  "weibo.com",
  "t.me",
  // Pastebins
  "pastebin.com",
  "paste.ee",
  "justpaste.it",
  "rentry.co",
  "hastebin.com",
  "controlc.com",
  "dpaste.org",
  "privatebin.net",
  // Forums
  "reddit.com",
  "quora.com",
  "4chan.org",
  "4channel.org",
  "8kun.top",
  "kiwifarms.net",
  "gutefrage.net",
  "forocoches.com",
  "wykop.pl",
  "jeuxvideo.com/forums",
] as const;
