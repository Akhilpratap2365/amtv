// Injected into music.apple.com to run the official Apple Music website in full screen
// with Guaranteed 1600px Desktop Width & Lyrics Button locked across phones, 1080p TVs, and 4K TVs,
// while fixing Full-Screen Player layout/alignment, keeping the Search keyboard open,
// and preserving AMTV's low-CPU WebGL throttling.
(function () {
  'use strict';

  var TARGET_WIDTH = 1600;
  var VIEWPORT_CONTENT = 'width=' + TARGET_WIDTH + ', minimum-scale=0.1, maximum-scale=5.0, user-scalable=no, viewport-fit=cover';

  var DESKTOP_CSS = [
    'html, body {',
    '  min-width: ' + TARGET_WIDTH + 'px !important;',
    '  width: 100% !important;',
    '  height: 100% !important;',
    '  overflow-x: hidden !important;',
    '  background-color: #000 !important;',
    '}',
    '/* Keep the top-bar Lyrics button visible without touching fullscreen lyrics containers */',
    'button[data-testid="lyrics-button"],',
    'amp-chrome-player button[data-testid="lyrics-button"] {',
    '  visibility: visible !important;',
    '  opacity: 1 !important;',
    '  pointer-events: auto !important;',
    '}',
    '/* Ensure Full-Screen Player covers the entire screen (no left blank sidebar strip) */',
    ':fullscreen,',
    ':-webkit-full-screen,',
    '[data-amtv-fullscreen="true"] {',
    '  position: fixed !important;',
    '  inset: 0 !important;',
    '  top: 0 !important;',
    '  left: 0 !important;',
    '  right: 0 !important;',
    '  bottom: 0 !important;',
    '  width: 100vw !important;',
    '  height: 100vh !important;',
    '  max-width: 100vw !important;',
    '  max-height: 100vh !important;',
    '  margin: 0 !important;',
    '  z-index: 2147483647 !important;',
    '}',
    'html[data-amtv-fullscreen-active="true"] .web-navigation,',
    'html[data-amtv-fullscreen-active="true"] [class*="web-navigation"] {',
    '  display: none !important;',
    '  width: 0 !important;',
    '  min-width: 0 !important;',
    '}',
    'html[data-amtv-fullscreen-active="true"] .app-container,',
    'html[data-amtv-fullscreen-active="true"] .body-container,',
    'html[data-amtv-fullscreen-active="true"] .web-chrome {',
    '  --web-navigation-width: 0px !important;',
    '  left: 0 !important;',
    '  inset-inline-start: 0 !important;',
    '  width: 100vw !important;',
    '}'
  ].join('\n');

  function isTextInput(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA' || el.isContentEditable) return true;
    if (tag === 'INPUT') {
      var type = (el.type || 'text').toLowerCase();
      return type !== 'button' && type !== 'checkbox' && type !== 'radio' && type !== 'range' && type !== 'submit' && type !== 'hidden';
    }
    return false;
  }

  var applyingViewport = false;
  function applyGuaranteed1600pxViewport() {
    if (applyingViewport) return;
    // Never mutate <head> viewport meta while a text input is actively focused (prevents Android IME dismissal)
    if (isTextInput(document.activeElement)) return;
    applyingViewport = true;
    try {
      var head = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
      if (head) {
        var metas = head.querySelectorAll('meta[name="viewport"]');
        var primary = metas[0];
        if (!primary) {
          primary = document.createElement('meta');
          primary.setAttribute('name', 'viewport');
          head.insertBefore(primary, head.firstChild);
        }
        if (primary.getAttribute('content') !== VIEWPORT_CONTENT) {
          primary.setAttribute('content', VIEWPORT_CONTENT);
        }
        for (var i = 1; i < metas.length; i++) {
          if (metas[i] && metas[i].parentNode) metas[i].parentNode.removeChild(metas[i]);
        }

        var style = document.getElementById('amtv-guaranteed-1600-css');
        if (!style) {
          style = document.createElement('style');
          style.id = 'amtv-guaranteed-1600-css';
          style.textContent = DESKTOP_CSS;
          head.appendChild(style);
        } else if (style.textContent !== DESKTOP_CSS) {
          style.textContent = DESKTOP_CSS;
        }
      }

      var lyricsBtn = document.querySelector('button[data-testid="lyrics-button"]');
      if (lyricsBtn && lyricsBtn.hasAttribute('hidden')) {
        lyricsBtn.removeAttribute('hidden');
      }
    } catch (e) {
      // ignore early DOM errors
    } finally {
      applyingViewport = false;
    }
  }

  window.applyGuaranteed1600pxViewport = applyGuaranteed1600pxViewport;
  applyGuaranteed1600pxViewport();

  if (window.__amtv) return;

  // Hook HTML5 Fullscreen API so Apple Music's Full-Screen Player always gets true 100vw x 100vh coverage
  var fsEl = null;
  function setFsActive(el) {
    if (fsEl && fsEl !== el) fsEl.removeAttribute('data-amtv-fullscreen');
    fsEl = el || null;
    if (fsEl && fsEl !== document.documentElement && fsEl !== document.body) {
      fsEl.setAttribute('data-amtv-fullscreen', 'true');
    }
    if (fsEl) {
      document.documentElement.setAttribute('data-amtv-fullscreen-active', 'true');
      if (window.__amtv && window.__amtv.wake) window.__amtv.wake(4000);
    } else {
      document.documentElement.removeAttribute('data-amtv-fullscreen-active');
    }
    applyGuaranteed1600pxViewport();
  }

  var origReqFs = Element.prototype.requestFullscreen || Element.prototype.webkitRequestFullscreen;
  if (origReqFs) {
    var wrappedReqFs = function () {
      var target = this;
      setFsActive(target);
      try {
        var res = origReqFs.apply(target, arguments);
        if (res && typeof res.catch === 'function') {
          res.catch(function () {
            setFsActive(target);
          });
        }
        return res;
      } catch (e) {
        setFsActive(target);
        return Promise.resolve();
      }
    };
    Element.prototype.requestFullscreen = wrappedReqFs;
    Element.prototype.webkitRequestFullscreen = wrappedReqFs;
  }

  var origExitFs = document.exitFullscreen || document.webkitExitFullscreen;
  if (origExitFs) {
    var wrappedExitFs = function () {
      setFsActive(null);
      try { return origExitFs.apply(document, arguments); } catch (e) { return Promise.resolve(); }
    };
    document.exitFullscreen = wrappedExitFs;
    document.webkitExitFullscreen = wrappedExitFs;
  }

  document.addEventListener('fullscreenchange', function () {
    var active = document.fullscreenElement || document.webkitFullscreenElement;
    setFsActive(active || null);
  });
  document.addEventListener('webkitfullscreenchange', function () {
    var active = document.fullscreenElement || document.webkitFullscreenElement;
    setFsActive(active || null);
  });

  document.addEventListener('click', function (ev) {
    if (!fsEl) return;
    var btn = ev.target && ev.target.closest && ev.target.closest('button');
    if (!btn) return;
    var label = (btn.getAttribute('aria-label') || btn.getAttribute('data-testid') || '').toLowerCase();
    if (label.indexOf('close') >= 0 || label.indexOf('exit') >= 0 || label.indexOf('fullscreen') >= 0) {
      setTimeout(function () {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
          setFsActive(null);
        }
      }, 150);
    }
  }, true);

  // Keep 1600px viewport locked on layout changes and page load (but do not run on vertical IME keyboard resize)
  var lastWindowWidth = window.innerWidth;
  window.addEventListener('DOMContentLoaded', applyGuaranteed1600pxViewport, { passive: true });
  window.addEventListener('load', applyGuaranteed1600pxViewport, { passive: true });
  window.addEventListener('resize', function () {
    if (window.innerWidth !== lastWindowWidth) {
      lastWindowWidth = window.innerWidth;
      applyGuaranteed1600pxViewport();
    }
  }, { passive: true });
  window.addEventListener('orientationchange', applyGuaranteed1600pxViewport, { passive: true });
  window.addEventListener('pageshow', applyGuaranteed1600pxViewport, { passive: true });
  window.addEventListener('popstate', applyGuaranteed1600pxViewport, { passive: true });

  function observeHead() {
    var head = document.head || document.getElementsByTagName('head')[0];
    if (!head || window.__amtvHeadObserved) return;
    window.__amtvHeadObserved = true;
    var mo = new MutationObserver(function () {
      applyGuaranteed1600pxViewport();
    });
    mo.observe(head, { childList: true, subtree: true, attributes: true, attributeFilter: ['content'] });
  }
  if (document.head) observeHead();
  else window.addEventListener('DOMContentLoaded', observeHead, { once: true });

  // Protect Search input focus so Apple Music's /search route transition never blurs and closes the TV keyboard
  var lastInputTapAt = 0;
  function findSearchInput(target) {
    if (!target) return null;
    if (isTextInput(target)) return target;
    if (target.closest) {
      var wrapper = target.closest('[data-testid*="search" i], [class*="search" i], form, label');
      if (wrapper) {
        var inner = wrapper.querySelector('input[type="search"], input[type="text"], input:not([type="hidden"])');
        if (inner) return inner;
      }
    }
    return null;
  }

  document.addEventListener('pointerdown', function (ev) {
    var inp = findSearchInput(ev.target);
    if (inp) lastInputTapAt = Date.now();
  }, true);

  document.addEventListener('click', function (ev) {
    var inp = findSearchInput(ev.target);
    if (!inp) return;
    lastInputTapAt = Date.now();
    // After Apple Music's click/router handler finishes (e.g. navigating to /search), ensure the input stays focused
    setTimeout(function () {
      var activeInp = ( inp.isConnected ? inp : document.querySelector('input[type="search"], .search-input input, [data-testid*="search" i] input') );
      if (activeInp) {
        if (document.activeElement !== activeInp) activeInp.focus();
        try { window.AmtvNative && window.AmtvNative.keyboard && window.AmtvNative.keyboard(); } catch (e) {}
      }
    }, 120);
  }, true);

  // If Apple Music's /search route transition blurs the search input right after tapping it, restore focus immediately
  document.addEventListener('focusout', function (ev) {
    if (Date.now() - lastInputTapAt < 650 && isTextInput(ev.target)) {
      var prev = ev.target;
      setTimeout(function () {
        if (!isTextInput(document.activeElement)) {
          var targetInp = (prev && prev.isConnected)
            ? prev
            : document.querySelector('input[type="search"], .search-input input, [data-testid*="search" i] input');
          if (targetInp) {
            targetInp.focus();
            try { window.AmtvNative && window.AmtvNative.keyboard && window.AmtvNative.keyboard(); } catch (e) {}
          }
        }
      }, 50);
    }
  }, true);

  // Block Apple's animated artwork HLS streams (mvod.itunes.apple.com) so music audio requests never queue behind video
  var MOTION = /^https:\/\/mvod\.itunes\.apple\.com\/itunes-assets\//;
  var xopen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments);
    if (MOTION.test(String(url))) args[1] = 'data:,';
    return xopen.apply(this, args);
  };

  var DIAG = 'amtv.diag', diagLog = [];
  try { diagLog = JSON.parse(localStorage.getItem(DIAG)) || []; } catch (e) {}
  function diag(entry) {
    entry.at = new Date().toISOString().slice(5, 19).replace('T', ' ');
    diagLog.push(entry);
    if (diagLog.length > 40) diagLog.splice(0, diagLog.length - 40);
    try { localStorage.setItem(DIAG, JSON.stringify(diagLog)); } catch (e) {}
  }

  var AUTH = /^https:\/\/auth\.[a-z.]*apple\.com\/auth\//;
  var xfetch = window.fetch;
  window.fetch = function (input) {
    var url = String(typeof input === 'string' ? input : (input && input.url) || input);
    if (MOTION.test(url)) return Promise.resolve(new Response('', { status: 404 }));
    var p = xfetch.apply(this, arguments);
    if (AUTH.test(url)) {
      var e = { ev: 'auth-service', url: url.replace(/\?.*/, '') };
      p.then(function (r) {
        e.status = r.status;
        if (r.ok) return diag(e);
        return r.clone().text().then(function (t) { e.body = t.slice(0, 200); diag(e); }, function () { diag(e); });
      }, function (err) { e.error = String(err); diag(e); });
    }
    return p;
  };

  // Throttle the full-screen WebGL backdrop shader after it settles so TV CPU stays cool and smooth
  var raf = window.requestAnimationFrame.bind(window), held = [], awakeUntil = performance.now() + 4000;

  window.__amtv = {
    diag: diag,
    diagLog: function () { return diagLog.slice(); },
    wake: function (ms) {
      awakeUntil = Math.max(awakeUntil, performance.now() + (ms || 2500));
      var h = held;
      held = [];
      h.forEach(function (cb) { raf(cb); });
    }
  };

  window.requestAnimationFrame = function (cb) {
    if (performance.now() > awakeUntil && /\/scene[~.-]/.test(new Error().stack || '')) {
      held.push(cb);
      return 0;
    }
    return raf(cb);
  };

  // Pre-warm playback connections and Widevine DRM
  function warmUp() {
    try {
      var hosts = [
        'https://amp-api.music.apple.com',
        'https://play.music.apple.com',
        'https://play.itunes.apple.com',
        'https://aod-ssl.itunes.apple.com',
        'https://universal-activity-service.itunes.apple.com'
      ];
      hosts.forEach(function (host) {
        var l = document.createElement('link');
        l.rel = 'preconnect';
        l.href = host;
        l.crossOrigin = 'anonymous';
        if (document.head) document.head.appendChild(l);
      });
      fetch('/includes/js-cdn/hls.js/current/hls.js/hls.js', { credentials: 'same-origin' }).catch(function () {});
      if (navigator.requestMediaKeySystemAccess) {
        navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{
          initDataTypes: ['cenc'],
          audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"', robustness: 'SW_SECURE_CRYPTO' }]
        }]).then(function (a) { return a.createMediaKeys(); }).catch(function () {});
      }
    } catch (e) {}
  }

  // Sync signed-in account storefront so non-US accounts play without CONTENT_EQUIVALENT errors
  function checkStorefront(mk) {
    if (!mk || !mk.isAuthorized || !mk.developerToken || !mk.musicUserToken) return;
    fetch('https://amp-api.music.apple.com/v1/me/storefront', {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Authorization: 'Bearer ' + mk.developerToken,
        'Music-User-Token': mk.musicUserToken
      }
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var sf = String((j && j.data && j.data[0] && j.data[0].id) || '').toLowerCase();
      if (!/^[a-z]{2}$/.test(sf)) return;
      var was = String(mk.storefrontId || '').toLowerCase();
      if (sf !== was) {
        try { mk.storefrontId = sf; } catch (e) {}
      }
      try {
        window.AmtvNative && window.AmtvNative.storefront && window.AmtvNative.storefront(sf, String(mk.storefrontId || '').toLowerCase());
      } catch (e) {}
    }).catch(function () {});
  }

  var splashLifted = false;
  function liftSplash() {
    if (splashLifted) return;
    splashLifted = true;
    applyGuaranteed1600pxViewport();
    raf(function () {
      raf(function () {
        setTimeout(function () {
          try { window.AmtvNative && window.AmtvNative.ready && window.AmtvNative.ready(); } catch (e) {}
        }, 50);
      });
    });
  }

  // Support external adb/voice commands (--es cmd / --es play)
  var QUEUE_KEY = {
    albums: 'album', 'library-albums': 'album',
    playlists: 'playlist', 'library-playlists': 'playlist',
    songs: 'song', 'library-songs': 'song',
    stations: 'station'
  };
  window.__tv = {
    command: function (c) {
      var mk = window.MusicKit && MusicKit.getInstance && MusicKit.getInstance();
      if (!mk) return;
      if (c === 'next') mk.skipToNextItem();
      else if (c === 'prev') { if (mk.currentPlaybackTime > 8) mk.seekToTime(0); else mk.skipToPreviousItem(); }
      else if (c === 'pause') mk.pause();
      else if (c === 'play') mk.play();
      else if (c === 'toggle') { if (mk.playbackState === 2) mk.pause(); else mk.play(); }
    },
    flushPlay: function () {
      var id = window.__amtvPlay;
      var mk = window.MusicKit && MusicKit.getInstance && MusicKit.getInstance();
      if (!id || !mk || !mk.isAuthorized) return;
      delete window.__amtvPlay;
      try { window.AmtvNative && window.AmtvNative.played && window.AmtvNative.played(); } catch (e) {}
      var type = /^ra\./.test(id) ? 'stations' : /^pl\./.test(id) ? 'playlists' : /^p\./.test(id) ? 'library-playlists'
        : /^l\./.test(id) ? 'library-albums' : /^i\./.test(id) ? 'library-songs' : 'albums';
      var key = QUEUE_KEY[type] || 'album';
      var q = { startPlaying: true };
      q[key] = id;
      mk.setQueue(q).then(function () {
        if (mk.playbackState !== 2) return mk.play();
      }).catch(function () {});
    }
  };

  // Hook MusicKit once available
  var awakeState = null;
  (function hookMusicKit(tries) {
    var mk = window.MusicKit && MusicKit.getInstance && MusicKit.getInstance();
    if (mk) {
      mk.addEventListener('nowPlayingItemDidChange', function () {
        window.__amtv.wake(3000);
        applyGuaranteed1600pxViewport();
      });
      var onPlaybackState = function () {
        var on = [1, 2, 6, 8].indexOf(mk.playbackState) >= 0;
        if (on !== awakeState) {
          awakeState = on;
          try { window.AmtvNative && window.AmtvNative.playing && window.AmtvNative.playing(on); } catch (e) {}
        }
      };
      mk.addEventListener('playbackStateDidChange', onPlaybackState);
      onPlaybackState();
      mk.addEventListener('authorizationStatusDidChange', function () {
        if (mk.isAuthorized) {
          checkStorefront(mk);
          window.__tv.flushPlay();
        }
      });
      Promise.resolve(mk._whenConfigured).then(function () {
        checkStorefront(mk);
        window.__tv.flushPlay();
        liftSplash();
      }).catch(function () {
        liftSplash();
      });
      setTimeout(warmUp, 2000);
    } else if (tries > 0) {
      setTimeout(function () { hookMusicKit(tries - 1); }, 400);
    } else {
      liftSplash();
    }
  })(30);

  setTimeout(liftSplash, 1800);
})();