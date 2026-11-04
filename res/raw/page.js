// Injected into music.apple.com once per document load.
// Clean, loop-free script:
//  1. Locks 1600px desktop viewport width & keeps Lyrics button visible across phones, 1080p TVs, and 4K TVs.
//  2. Makes Full-Screen Player cover 100% of the screen (no left grey sidebar space) with lyrics & controls aligned.
//  3. Preserves natural scrolling in all directions and native touch-to-keyboard input (no focus/blur loops).
(function () {
  'use strict';

  var TARGET_WIDTH = 1600;
  var VIEWPORT_CONTENT = 'width=' + TARGET_WIDTH + ', user-scalable=no, viewport-fit=cover';

  // Minimal CSS: no overflow:hidden on html/body (so scrolling works in all directions),
  // no wildcard [data-testid*="lyrics"] overrides, and full-bleed 100vw x 100vh in fullscreen mode.
  var DESKTOP_CSS = [
    'button[data-testid="lyrics-button"],',
    'amp-chrome-player button[data-testid="lyrics-button"] {',
    '  visibility: visible !important;',
    '  opacity: 1 !important;',
    '  pointer-events: auto !important;',
    '}',
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

  function applyGuaranteed1600pxViewport() {
    try {
      var head = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
      if (head) {
        var primary = head.querySelector('meta[name="viewport"]');
        if (!primary) {
          primary = document.createElement('meta');
          primary.setAttribute('name', 'viewport');
          head.insertBefore(primary, head.firstChild);
        }
        if (primary.getAttribute('content') !== VIEWPORT_CONTENT) {
          primary.setAttribute('content', VIEWPORT_CONTENT);
        }

        var style = document.getElementById('amtv-guaranteed-1600-css');
        if (!style) {
          style = document.createElement('style');
          style.id = 'amtv-guaranteed-1600-css';
          style.textContent = DESKTOP_CSS;
          head.appendChild(style);
        }
      }

      var lyricsBtn = document.querySelector('button[data-testid="lyrics-button"]');
      if (lyricsBtn && lyricsBtn.hasAttribute('hidden')) {
        lyricsBtn.removeAttribute('hidden');
      }
    } catch (e) {}
  }

  window.applyGuaranteed1600pxViewport = applyGuaranteed1600pxViewport;
  applyGuaranteed1600pxViewport();

  if (window.__amtv) return;

  // Fullscreen Player support: eliminates the left grey sidebar area when entering full-screen song/lyrics view
  var fsEl = null;
  function setFsActive(el) {
    if (fsEl && fsEl !== el) fsEl.removeAttribute('data-amtv-fullscreen');
    fsEl = el || null;
    if (fsEl && fsEl !== document.documentElement && fsEl !== document.body) {
      fsEl.setAttribute('data-amtv-fullscreen', 'true');
    }
    if (fsEl) {
      document.documentElement.setAttribute('data-amtv-fullscreen-active', 'true');
      if (window.__amtv && window.__amtv.wake) window.__amtv.wake(3500);
    } else {
      document.documentElement.removeAttribute('data-amtv-fullscreen-active');
    }
  }

  var origReqFs = Element.prototype.requestFullscreen || Element.prototype.webkitRequestFullscreen;
  if (origReqFs) {
    var wrappedReqFs = function () {
      var target = this;
      setFsActive(target);
      try {
        var res = origReqFs.apply(target, arguments);
        if (res && typeof res.catch === 'function') {
          res.catch(function () { setFsActive(target); });
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
    setFsActive(document.fullscreenElement || document.webkitFullscreenElement || null);
  });
  document.addEventListener('webkitfullscreenchange', function () {
    setFsActive(document.fullscreenElement || document.webkitFullscreenElement || null);
  });

  document.addEventListener('click', function (ev) {
    if (!fsEl) return;
    var btn = ev.target && ev.target.closest && ev.target.closest('button');
    if (!btn) return;
    var label = (btn.getAttribute('aria-label') || btn.getAttribute('data-testid') || '').toLowerCase();
    if (label.indexOf('close') >= 0 || label.indexOf('exit') >= 0 || label.indexOf('fullscreen') >= 0) {
      setTimeout(function () {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) setFsActive(null);
      }, 150);
    }
  }, true);

  window.addEventListener('DOMContentLoaded', applyGuaranteed1600pxViewport, { passive: true });
  window.addEventListener('load', applyGuaranteed1600pxViewport, { passive: true });
  window.addEventListener('orientationchange', applyGuaranteed1600pxViewport, { passive: true });

  // Block Apple's animated artwork HLS streams (mvod.itunes.apple.com) so audio never queues behind video
  var MOTION = /^https:\/\/mvod\.itunes\.apple\.com\/itunes-assets\//;
  var xopen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments);
    if (MOTION.test(String(url))) args[1] = 'data:,';
    return xopen.apply(this, args);
  };

  var xfetch = window.fetch;
  window.fetch = function (input) {
    var url = String(typeof input === 'string' ? input : (input && input.url) || input);
    if (MOTION.test(url)) return Promise.resolve(new Response('', { status: 404 }));
    return xfetch.apply(this, arguments);
  };

  // Throttle the full-screen WebGL backdrop shader after it settles so TV CPU stays cool and smooth
  var raf = window.requestAnimationFrame.bind(window), held = [], awakeUntil = performance.now() + 4000;

  window.__amtv = {
    wake: function (ms) {
      awakeUntil = Math.max(awakeUntil, performance.now() + (ms || 2500));
      var h = held;
      held = [];
      h.forEach(function (cb) { raf(cb); });
    }
  };

  window.requestAnimationFrame = function (cb) {
    if (performance.now() > awakeUntil && /\/scene[~.-]/.test(new Error().stack || '')) {
      if (held.length < 30) held.push(cb);
      return 0;
    }
    return raf(cb);
  };

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