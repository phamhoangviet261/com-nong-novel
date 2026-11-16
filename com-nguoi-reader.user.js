// ==UserScript==
// @name         Cơm Nguội Reader (No Ads + Prev/Next)
// @namespace    https://comnguoinovel.com/
// @version      1.0.0
// @description  Chặn overlay quảng cáo đè lên <main>, chặn redirect app quảng cáo và thêm thanh Prev/Next + Tủ truyện cho comnguoinovel.com
// @author       Cơm Nguội Reader
// @match        https://comnguoinovel.com/*
// @match        https://www.comnguoinovel.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEYS = {
    HISTORY: 'cn_reader_history_v1',
  };
  const CHAPTER_REGEX = /^(https?:\/\/(?:www\.)?comnguoinovel\.com\/truyen\/([^\/?#]+)\/chuong\/)(\d+)(?:[\/?#].*)?$/i;
  const HOST_ID = 'cn-reader-host';

  function isCloudflareChallenge() {
    return Boolean(
      document.getElementById('challenge-running') ||
      document.getElementById('challenge-form') ||
      document.querySelector('.cf-turnstile, iframe[src*="challenges.cloudflare.com"]')
    );
  }

  // Chặn window.open mở tab/app quảng cáo
  const origOpen = window.open;
  window.open = function (url) {
    if (typeof url === 'string' && url.includes('comnguoinovel.com')) {
      return origOpen.apply(window, arguments);
    }
    return null;
  };

  // Xóa các lớp overlay quảng cáo đè lên <main> hoặc phủ toàn màn hình
  function removeAdOverlays() {
    if (isCloudflareChallenge()) return;

    const mainEl = document.querySelector('main');
    const mainRect = mainEl ? mainEl.getBoundingClientRect() : null;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;

    // 1. Chặn thẻ <a> trỏ ra ngoài hoặc app store phủ rộng trên màn hình
    document.querySelectorAll('a[href]').forEach((a) => {
      if (a.closest('#' + HOST_ID)) return;
      const href = a.getAttribute('href') || '';
      const isAppScheme = /^(intent:|market:|itms-apps:|itms-appss:)/i.test(href);
      let isExternal = false;
      try {
        const u = new URL(href, location.origin);
        isExternal = u.hostname && !u.hostname.endsWith('comnguoinovel.com');
      } catch (_) {}

      if (!isAppScheme && !isExternal) return;

      const rect = a.getBoundingClientRect();
      const style = window.getComputedStyle(a);
      const isOverlayPos = style.position === 'fixed' || style.position === 'absolute';
      const isLarge = rect.width > vw * 0.45 && rect.height > vh * 0.25;

      if (isAppScheme || (isOverlayPos && isLarge) || (mainEl && mainEl.contains(a) && isLarge)) {
        a.style.setProperty('display', 'none', 'important');
        a.style.setProperty('pointer-events', 'none', 'important');
        a.remove();
      }
    });

    // 2. Quét các div/section fixed/absolute có z-index cao đè lên <main>
    document.querySelectorAll('div, section, aside, ins').forEach((el) => {
      if (el.id === HOST_ID || el.closest('#' + HOST_ID)) return;
      if (el.tagName === 'MAIN' || el.contains(mainEl)) return;

      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;

      const pos = style.position;
      if (pos !== 'fixed' && pos !== 'absolute') return;

      const z = parseInt(style.zIndex, 10);
      const rect = el.getBoundingClientRect();
      const coversBigArea = rect.width >= vw * 0.6 && rect.height >= vh * 0.35;
      const overlapsMain =
        mainRect &&
        rect.width > 40 &&
        rect.height > 40 &&
        rect.left < mainRect.right &&
        rect.right > mainRect.left &&
        rect.top < mainRect.bottom &&
        rect.bottom > mainRect.top;

      // Bỏ qua header/nav thật của web nếu chiều cao nhỏ
      const isSmallHeader = rect.height < 90 && rect.top <= 10;
      if (isSmallHeader) return;

      const hasMinimalText = (el.innerText || '').trim().length < 40;
      const looksLikeAd =
        el.matches('[class*="ad" i], [id*="ad" i], [class*="overlay" i], [id*="overlay" i], [class*="popup" i]') ||
        el.querySelector('iframe[src*="ads"], ins.adsbygoogle') ||
        (overlapsMain && hasMinimalText && (isNaN(z) || z >= 5)) ||
        (coversBigArea && hasMinimalText && z >= 10);

      if (looksLikeAd) {
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
      }
    });
  }

  // Chặn click/tap vào overlay ngoài ý muốn trỏ sang domain lạ
  document.addEventListener(
    'click',
    (e) => {
      if (isCloudflareChallenge()) return;
      const target = e.target;
      if (!target || target.closest('#' + HOST_ID)) return;
      const link = target.closest('a[href]');
      if (link) {
        const href = link.getAttribute('href') || '';
        if (/^(intent:|market:|itms-apps:|itms-appss:)/i.test(href)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        try {
          const u = new URL(href, location.origin);
          if (u.hostname && !u.hostname.endsWith('comnguoinovel.com') && link.closest('main')) {
            e.preventDefault();
            e.stopImmediatePropagation();
          }
        } catch (_) {}
      }
    },
    true
  );

  function formatSlug(slug) {
    if (!slug) return '';
    return slug
      .split('-')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  function parseCurrentUrl(rawUrl) {
    const match = (rawUrl || location.href).match(CHAPTER_REGEX);
    if (match) {
      return {
        url: `${match[1]}${parseInt(match[3], 10)}`,
        isChapterUrl: true,
        basePrefix: match[1],
        slug: match[2],
        chapter: parseInt(match[3], 10),
      };
    }
    return {
      url: location.href,
      isChapterUrl: false,
      basePrefix: '',
      slug: '',
      chapter: null,
    };
  }

  function getHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.HISTORY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  function saveToHistory(parsed) {
    if (!parsed || !parsed.isChapterUrl) return;
    const list = getHistory();
    const idx = list.findIndex((item) => item.slug === parsed.slug);
    const entry = {
      slug: parsed.slug,
      name: idx >= 0 ? list[idx].name : formatSlug(parsed.slug),
      basePrefix: parsed.basePrefix,
      chapter: parsed.chapter,
      url: parsed.url,
      updatedAt: Date.now(),
    };
    if (idx >= 0) list.splice(idx, 1);
    list.unshift(entry);
    try {
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(list.slice(0, 50)));
    } catch (_) {}
  }

  function deleteFromHistory(slug) {
    const list = getHistory().filter((item) => item.slug !== slug);
    try {
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(list));
    } catch (_) {}
  }

  function formatRelativeTime(timestamp) {
    if (!timestamp) return '';
    const diffSec = Math.floor((Date.now() - timestamp) / 1000);
    if (diffSec < 60) return 'Vừa xong';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} phút trước`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour} giờ trước`;
    return `${Math.floor(diffHour / 24)} ngày trước`;
  }

  function mountReaderUI() {
    if (isCloudflareChallenge() || document.getElementById(HOST_ID)) return;

    const current = parseCurrentUrl(location.href);
    if (current.isChapterUrl) {
      saveToHistory(current);
    }

    // Chừa khoảng trống ở đáy để thanh bar không che chữ cuối chương
    const padStyle = document.createElement('style');
    padStyle.textContent = `
      body { padding-bottom: calc(68px + env(safe-area-inset-bottom, 0px)) !important; }
    `;
    (document.head || document.documentElement).appendChild(padStyle);

    const host = document.createElement('div');
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });

    shadow.innerHTML = `
      <style>
        :host {
          --bg-dark: #0f172a;
          --bg-card: #1e293b;
          --bg-input: #0b1120;
          --border: #334155;
          --text-main: #f8fafc;
          --text-muted: #94a3b8;
          --accent: #38bdf8;
          --danger: #ef4444;
          --bar-height: 54px;
          --safe-bottom: env(safe-area-inset-bottom, 0px);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
        .bottom-bar {
          position: fixed;
          bottom: 0; left: 0; right: 0;
          height: calc(var(--bar-height) + var(--safe-bottom));
          padding: 0 8px var(--safe-bottom);
          background: var(--bg-dark);
          border-top: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          z-index: 2147483640;
          user-select: none;
        }
        .nav-btn {
          width: 52px; height: 40px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--bg-card);
          color: var(--text-main);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; flex-shrink: 0;
        }
        .nav-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .nav-btn svg {
          width: 22px; height: 22px;
          stroke: currentColor; stroke-width: 2.2;
          fill: none; stroke-linecap: round; stroke-linejoin: round;
        }
        .center-trigger {
          flex: 1; min-width: 0; height: 40px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--bg-card);
          color: var(--text-main);
          padding: 0 12px;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          cursor: pointer; overflow: hidden;
        }
        .chapter-badge {
          font-size: 13px; font-weight: 700; color: var(--accent);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
        }
        .story-slug {
          font-size: 11px; color: var(--text-muted);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
        }
        .modal-backdrop {
          position: fixed; inset: 0;
          background: rgba(0, 0, 0, 0.65);
          backdrop-filter: blur(2px);
          z-index: 2147483647;
          display: flex; align-items: flex-end; justify-content: center;
          opacity: 0; pointer-events: none;
          transition: opacity 0.2s ease;
        }
        .modal-backdrop.open { opacity: 1; pointer-events: auto; }
        .modal-sheet {
          width: 100%; max-width: 540px; max-height: 82dvh;
          background: var(--bg-card);
          color: var(--text-main);
          border-top-left-radius: 18px; border-top-right-radius: 18px;
          border-top: 1px solid var(--border);
          padding: 16px;
          padding-bottom: calc(18px + var(--safe-bottom));
          display: flex; flex-direction: column; gap: 16px;
          transform: translateY(100%);
          transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
          overflow-y: auto;
        }
        .modal-backdrop.open .modal-sheet { transform: translateY(0); }
        .modal-header { display: flex; align-items: center; justify-content: space-between; }
        .modal-title { font-size: 16px; font-weight: 700; }
        .close-btn {
          background: transparent; border: none; color: var(--text-muted);
          font-size: 20px; width: 32px; height: 32px; border-radius: 8px; cursor: pointer;
        }
        .section-label {
          font-size: 12px; font-weight: 600; text-transform: uppercase;
          letter-spacing: 0.04em; color: var(--text-muted); margin-bottom: 6px; display: block;
        }
        .jump-box {
          display: flex; align-items: center; justify-content: space-between;
          background: var(--bg-input); border: 1px solid var(--border);
          border-radius: 10px; padding: 8px 12px; gap: 10px;
        }
        .jump-box.hidden { display: none; }
        .jump-input {
          width: 90px; background: var(--bg-card); border: 1px solid var(--border);
          color: var(--text-main); border-radius: 8px; padding: 6px 10px;
          font-size: 14px; font-weight: 600; text-align: center; outline: none;
        }
        .btn-primary {
          background: var(--accent); color: #0f172a; border: none;
          border-radius: 10px; padding: 8px 14px; font-size: 14px; font-weight: 600; cursor: pointer;
        }
        .history-list { display: flex; flex-direction: column; gap: 8px; max-height: 260px; overflow-y: auto; }
        .history-empty { font-size: 13px; color: var(--text-muted); text-align: center; padding: 16px 0; }
        .history-item {
          display: flex; align-items: center; justify-content: space-between;
          background: var(--bg-input); border: 1px solid var(--border);
          border-radius: 10px; padding: 10px 12px; gap: 10px; cursor: pointer;
        }
        .history-item.active { border-color: var(--accent); }
        .history-info { flex: 1; min-width: 0; }
        .history-name {
          font-size: 14px; font-weight: 600; color: var(--text-main);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;
        }
        .history-meta { font-size: 12px; color: var(--accent); display: flex; gap: 8px; }
        .history-time { color: var(--text-muted); }
        .delete-btn {
          background: transparent; border: none; color: var(--text-muted);
          width: 30px; height: 30px; border-radius: 8px; cursor: pointer; flex-shrink: 0;
        }
      </style>

      <nav class="bottom-bar">
        <button id="prev-btn" class="nav-btn" aria-label="Chương trước">
          <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <button id="center-btn" class="center-trigger">
          <span id="chapter-label" class="chapter-badge">Cơm Nguội Reader</span>
          <span id="story-label" class="story-slug">Chạm để mở tủ truyện</span>
        </button>
        <button id="next-btn" class="nav-btn" aria-label="Chương tiếp theo">
          <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
      </nav>

      <div id="modal-backdrop" class="modal-backdrop">
        <div class="modal-sheet" role="dialog" aria-modal="true">
          <div class="modal-header">
            <span class="modal-title">Điều khiển & Tủ truyện</span>
            <button id="close-modal-btn" class="close-btn" aria-label="Đóng">✕</button>
          </div>
          <div id="jump-box" class="jump-box ${current.isChapterUrl ? '' : 'hidden'}">
            <span style="font-size: 13px; font-weight: 600;">Nhảy tới chương:</span>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input id="jump-input" type="number" min="1" class="jump-input" value="${current.chapter || ''}" />
              <button type="button" id="jump-btn" class="btn-primary">Đi</button>
            </div>
          </div>
          <div>
            <span class="section-label">Tủ truyện đang đọc (Lưu trên máy)</span>
            <div id="history-list" class="history-list"></div>
          </div>
        </div>
      </div>
    `;

    (document.body || document.documentElement).appendChild(host);

    const prevBtn = shadow.getElementById('prev-btn');
    const nextBtn = shadow.getElementById('next-btn');
    const centerBtn = shadow.getElementById('center-btn');
    const chapterLabel = shadow.getElementById('chapter-label');
    const storyLabel = shadow.getElementById('story-label');
    const modalBackdrop = shadow.getElementById('modal-backdrop');
    const closeModalBtn = shadow.getElementById('close-modal-btn');
    const jumpInput = shadow.getElementById('jump-input');
    const jumpBtn = shadow.getElementById('jump-btn');
    const historyListEl = shadow.getElementById('history-list');

    if (current.isChapterUrl) {
      chapterLabel.textContent = `Chương ${current.chapter}`;
      storyLabel.textContent = formatSlug(current.slug);
      prevBtn.disabled = current.chapter <= 1;
      nextBtn.disabled = false;
    } else {
      chapterLabel.textContent = 'Tủ truyện & Điều khiển';
      storyLabel.textContent = 'Mở chương để bật Prev / Next';
      prevBtn.disabled = true;
      nextBtn.disabled = true;
    }

    function renderHistory() {
      const list = getHistory();
      historyListEl.innerHTML = '';
      if (list.length === 0) {
        historyListEl.innerHTML = '<div class="history-empty">Chưa có bộ truyện nào được lưu.</div>';
        return;
      }
      list.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'history-item' + (current.slug === item.slug ? ' active' : '');
        const info = document.createElement('div');
        info.className = 'history-info';
        info.innerHTML = `
          <div class="history-name">${item.name}</div>
          <div class="history-meta">
            <span>Chương ${item.chapter}</span>
            <span class="history-time">• ${formatRelativeTime(item.updatedAt)}</span>
          </div>
        `;
        info.addEventListener('click', () => {
          location.href = item.url;
        });

        const delBtn = document.createElement('button');
        delBtn.className = 'delete-btn';
        delBtn.textContent = '✕';
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteFromHistory(item.slug);
          renderHistory();
        });

        row.appendChild(info);
        row.appendChild(delBtn);
        historyListEl.appendChild(row);
      });
    }

    prevBtn.addEventListener('click', () => {
      if (current.isChapterUrl && current.chapter > 1) {
        location.href = `${current.basePrefix}${current.chapter - 1}`;
      }
    });

    nextBtn.addEventListener('click', () => {
      if (current.isChapterUrl) {
        location.href = `${current.basePrefix}${current.chapter + 1}`;
      }
    });

    centerBtn.addEventListener('click', () => {
      renderHistory();
      modalBackdrop.classList.add('open');
    });

    closeModalBtn.addEventListener('click', () => modalBackdrop.classList.remove('open'));
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) modalBackdrop.classList.remove('open');
    });

    jumpBtn.addEventListener('click', () => {
      if (!current.isChapterUrl) return;
      const ch = parseInt(jumpInput.value, 10);
      if (!isNaN(ch) && ch >= 1) {
        location.href = `${current.basePrefix}${ch}`;
      }
    });
  }

  function init() {
    removeAdOverlays();
    mountReaderUI();

    const observer = new MutationObserver(() => {
      removeAdOverlays();
    });
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
    // Quét thêm vài nhịp đầu phòng trường hợp script quảng cáo chèn trễ
    let ticks = 0;
    const timer = setInterval(() => {
      removeAdOverlays();
      ticks += 1;
      if (ticks > 15) clearInterval(timer);
    }, 700);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
