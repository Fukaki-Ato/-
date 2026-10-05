/**
 * 雷霆酷跑 开放数据域入口（docs/05 §4.3）
 *
 * 运行环境：微信小游戏「开放数据域」（子域），不能访问主域 DOM/引擎，只能使用
 * 有限 wx API + 共享画布（sharedCanvas）。主域通过
 *   wx.getOpenDataContext().postMessage({ type: 'render', top, title })
 * 触发绘制，通过 { type: 'hide' } 隐藏。
 *
 * 数据来源：wx.getFriendCloudStorage({ keyList: ['bestScore'] })，
 * bestScore 由主域在提交成绩时经 wx.setUserCloudStorage 写入托管数据。
 *
 * 注意：主域误加载本文件时（typeof wx.getSharedCanvas !== 'function'）直接退出，不产生副作用。
 */
(function () {
  'use strict';
  if (typeof wx === 'undefined' || typeof wx.getSharedCanvas !== 'function' || typeof wx.onMessage !== 'function') {
    return;
  }

  var sharedCanvas = wx.getSharedCanvas();
  var ctx = sharedCanvas.getContext('2d');
  var title = '好友排行榜';
  var top = 50;
  var lastData = null;
  var avatarCache = {};

  function canvasWidth() {
    return sharedCanvas.width || 480;
  }

  function canvasHeight() {
    return sharedCanvas.height || 640;
  }

  function clear() {
    ctx.clearRect(0, 0, canvasWidth(), canvasHeight());
  }

  function drawBackground() {
    ctx.fillStyle = 'rgba(8, 14, 28, 0.92)';
    ctx.fillRect(0, 0, canvasWidth(), canvasHeight());
    ctx.fillStyle = '#ffd76a';
    ctx.font = 'bold ' + Math.floor(canvasWidth() / 18) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, canvasWidth() / 2, Math.floor(canvasWidth() / 12));
    ctx.textAlign = 'left';
  }

  function scoreOf(user) {
    var list = (user && user.KVDataList) || [];
    for (var i = 0; i < list.length; i += 1) {
      if (list[i] && list[i].key === 'bestScore') {
        var value = parseInt(list[i].value, 10);
        return isFinite(value) && value > 0 ? value : 0;
      }
    }
    return 0;
  }

  function shorten(text, maxLen) {
    var value = String(text || '');
    return value.length > maxLen ? value.slice(0, maxLen - 3) + '...' : value;
  }

  function drawAvatar(url, x, y, size) {
    if (!url) return;
    var cached = avatarCache[url];
    if (cached === 'loading') return;
    if (cached && cached.loaded) {
      ctx.drawImage(cached.image, x, y, size, size);
      return;
    }
    if (cached) return;
    avatarCache[url] = 'loading';
    var image = wx.createImage();
    image.onload = function () {
      avatarCache[url] = { image: image, loaded: true };
      if (lastData) drawList(lastData);
    };
    image.onerror = function () {
      avatarCache[url] = { image: image, loaded: false };
    };
    image.src = url;
  }

  function drawList(users) {
    clear();
    drawBackground();
    var width = canvasWidth();
    var height = canvasHeight();
    if (!users || users.length === 0) {
      ctx.fillStyle = '#9fb0cc';
      ctx.font = Math.floor(width / 24) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('暂无好友数据', width / 2, height / 2);
      ctx.textAlign = 'left';
      return;
    }
    var sorted = users.slice(0).sort(function (a, b) {
      return scoreOf(b) - scoreOf(a);
    });
    var rowHeight = Math.floor(width / 7);
    var textBaseline = Math.floor(width / 60);
    ctx.font = Math.floor(width / 26) + 'px sans-serif';
    var limit = Math.min(sorted.length, top);
    for (var i = 0; i < limit; i += 1) {
      var user = sorted[i];
      var y = Math.floor(width / 7) + i * rowHeight;
      if (y + rowHeight > height) break;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)';
      ctx.fillRect(12, y, width - 24, rowHeight - 6);
      ctx.fillStyle = i < 3 ? '#ffd76a' : '#e8eefc';
      ctx.fillText(String(i + 1), 28, y + rowHeight / 2 + textBaseline);
      var avatarSize = rowHeight - 18;
      drawAvatar(user.avatarUrl, 66, y + 9, avatarSize);
      ctx.fillStyle = '#e8eefc';
      ctx.fillText(shorten(user.nickname || '微信玩家', 8), 66 + avatarSize + 14, y + rowHeight / 2 + textBaseline);
      ctx.fillStyle = '#ffd76a';
      ctx.textAlign = 'right';
      ctx.fillText(String(scoreOf(user)) + ' 分', width - 28, y + rowHeight / 2 + textBaseline);
      ctx.textAlign = 'left';
    }
  }

  function render() {
    clear();
    drawBackground();
    ctx.fillStyle = '#9fb0cc';
    ctx.font = Math.floor(canvasWidth() / 24) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('正在加载好友数据...', canvasWidth() / 2, canvasHeight() / 2);
    ctx.textAlign = 'left';
    wx.getFriendCloudStorage({
      keyList: ['bestScore'],
      success: function (res) {
        lastData = (res && res.data) || [];
        drawList(lastData);
      },
      fail: function () {
        lastData = null;
        drawList([]);
      },
    });
  }

  wx.onMessage(function (message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'render') {
      if (typeof message.title === 'string' && message.title) title = message.title;
      if (typeof message.top === 'number' && message.top > 0) {
        top = Math.min(100, Math.floor(message.top));
      }
      render();
      return;
    }
    if (message.type === 'hide') {
      clear();
    }
  });
})();
