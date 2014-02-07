$(document).ready(function() {
  var clients = {}
    , channels = {}
    , join_queue = []
    , own_id = null
    , own_stream = null
    , stop_prev = null
    , ws = null
    , overlay = $('#overlay')
    , recorder = $('#recorder')
    , channels_elem = $('#channels')
    , nav = $('#nav')
    , input = $('#input-wrap input');

  navigator.getUserMedia(
    {
      video: {
        mandatory: {
          maxWidth: 640
        },
      },
      audio: false
    },
    function(s) {
      own_stream = s;
    },
    function(e) {
      console.log("error getting video stream: " + e);
    }
  );

  $(window).on("focus", function() {
    input.focus();
  });


  nav.on('click', 'li button.close', function(e) {
    e.preventDefault();
    var li = $(this).parents("li");
    sendWSData({
      action: "part",
      channel: li.find('data-chan')
    });
  });

  nav.on('click', 'li a', function(e) {
    e.preventDefault();
    var li = $(this).parents("li");
    focusChannel(li.attr('data-chan'));
  });

  input.on("keypress", function(e) {
    if (e.keyCode == 13) {
      if (!own_stream) {
        alert("Must allow video capture");
        return;
      }

      var chan = channels_elem.find('.active').attr('data-chan')
        , msg = input.val()
        , last_row = channels_elem.find('.channel[data-chan="'+chan+'"] .messages tr:last-child');

      var send = last_row.attr('data-user') == own_id ? function(cb){cb()} : beginRecord;

      send(function(frames) {
        $.ajax({
          url: "/say",
          type: "POST", 
          data: {
            channel: chan,
            msg: msg,
            from: own_id,
            frames: frames
          },
          dataType: "json"
        });
      });

      input.val('');
    }
  });

  $("#channel").on("keypress", function(e) {
    if (e.keyCode == 13) {
      var input = $(this);
      sendWSData({
        action: "join",
        channel: input.val()
      });
      input.val('');
    }
  });

  setInterval(cycleImages, 100);
  console.log("starting");
  start(); // get ID and open WS

  function beginRecord(cb) {
    var video = recorder.find('video')
      , progress = recorder.find('progress')
      , flash = recorder.find('span.flash')
      , clock = recorder.find('span.countdown');

    progress.attr('value', 0);
    progress.addClass('down');
    recorder.removeClass("recording");

    var countdown = function(count) {
      if (count) {
        progress.attr('value', 100 - count * 10);
        setTimeout(countdown, 100, count - 1);
      }
      else {
        progress.attr('value', 200);
        setTimeout(recordVideo, 150, cb);
      }
    };

    video.on("loadeddata", function() {
      video.off("loadeddata");
      overlay.show();
      recorder.show();
      countdown(10);
    });

    video.attr('src', URL.createObjectURL(own_stream));
  }

  function recordVideo(cb) {
    var recorder = $('#recorder')
      , video = recorder.find('video')
      , progress = recorder.find('progress')
      , v = video.get(0)
      , w = video.width()
      , h = video.height()
      , aspect = w / h
      , c = document.createElement('canvas')
      , ctx = c.getContext('2d');

    c.width = 150
    c.height = parseInt(150 / aspect);
    progress.removeClass('down');

    var frames = [];
    var frame = function(count) {
      progress.attr('value', 100 - ((10 - count)*10));
      ctx.drawImage(v, 0, 0, c.width, c.height);
      frames.push(c.toDataURL("image/jpeg"));
      if (count > 0) {
        setTimeout(frame, 100, count - 1);
      }
      else {
        v.pause();
        cb(frames);
        setTimeout(function() {
          overlay.fadeOut(100);
          recorder.fadeOut(100, function() {
            video.removeAttr('src');
          });
        }, 200);
      }
    };

    frame(10);
  }

  function appendEvent(chan, message) {
    var messages = channels_elem.find('.channel[data-chan="'+chan+'"] .messages')
      , tr = $('<tr/>', {'class':'event'})
      , td = $('<td/>', {'colspan':'2'}).text(message);

    maybeScroll(function() {
      messages.append(tr.append(td));
    });
  }

  function start() {
    $.ajax({
      url: "/identify",
      type: "GET",
      dataType: "json",
      success: function(res) {
        if (res.success) {
          own_id = res.id;
          ws = openWebsocket();
        }
      }
    });
  }

  function cycleImages() {
    $('.frames.on').each(function() {
      var ol = $(this);
      var li = ol.find(".visible");
      var dir = ol.hasClass("reverse") ? ['prev', 'next'] : ['next', 'prev'];
      for (var i=0; i < dir.length; i++) {
        var next = li[dir[i]]("li");
        if (next.length) {
          next.addClass("visible");
          li.removeClass("visible");
          return;
        }
        else {
          ol.toggleClass("reverse");
        }
      }
    });
  }

  function insertFrames(frames, el, cb) {
    var ol = $('<ol/>', {'class':'frames on reverse'});
    $(frames).each(function() {
      var img = $('<img/>', {src: this});
      var li = $('<li/>').append(img);
      ol.append(li);
    });

    var last = ol.find("li:last-child");
    var img = last.find("img");
    last.addClass("visible");
    el.append(ol);
    img.on("load", function() {
      maybeScroll(function() {
        cb();
        ol.height(img.height());
        ol.width(img.width());
      });
    });
  }

  function maybeScroll(cb) {
    var outer_height = $(document).height()
      , inner_height = window.innerHeight
      , scroll = inner_height + $(document).scrollTop() >= outer_height;

    var do_scroll = function() {
      $(document).scrollTop($(document).height());
    };

    cb(scroll ? do_scroll : false);

    do_scroll();
  }

  function appendMessage(user, chan, message) {
    var messages = channels_elem.find('.channel[data-chan="'+chan+'"] .messages')
      , last_row = messages.find("tr:last-child")
      , last_user = last_row.attr('data-user')
      , consecutive = last_user == user
      , stream = null;

    if (consecutive) {
      maybeScroll(function() {
        last_row.find(".body").append("<br>").append($('<span/>').text(message));
      });
      return;
    }

    var new_row = $('<tr/>', {
      'class': (consecutive ? "consecutive" : ""),
      'data-user': user
    }).hide();

    var nick = $('<td/>', {'class': 'nick'});

    $.ajax({
      url: "/image/" + user,
      type: "GET",
      dataType: "json",
      success: function(frames) {
        insertFrames(frames, nick, function() {
          new_row.show()
        });
      }
    });

    new_row.prepend(nick);
    new_row.append($('<td/>',{'class':"body"}).text(message));

    maybeScroll(function() {
      messages.append(new_row);
    });
  }

  function openWebsocket() {
    var ws_url = [
      (window.location.protocol == "http:" ? "ws:" : "wss"), "//",
      window.location.hostname, ":",
      window.location.port, "/websocket/" + own_id
    ].join("");

    var ws = new WebSocket(ws_url);

    ws.onerror = function(e) {
      console.log(e);
    };

    ws.onopen = function(e) {
      $('#channel').removeAttr('disabled');
      if (window.location.hash) {
        var channel = decodeURIComponent(window.location.hash).replace(/^#/, "");
        sendWSData({
          action: "join",
          channel: channel
        });
      }
      else if (!$('.channel').length) {
        $('#channel').focus();
      }
    };

    ws.onmessage = function(e) {
      var data = JSON.parse(e.data);
      handleWSMessage(data);
    };

    return ws;
  }

  function queueJoin (peer, chan) {
    if (!join_queue[peer])
      join_queue[peer] = [];
    join_queue[peer].push(chan);
  }

  function handleWSMessage (data) {
    if (data.type == "joined") {
      if ($('#'+data.body.channel_id).length) return;
      renderChannel(data.body.channel_name, data.body.channel_id);
      appendEvent(data.body.channel_id, "you joined " + data.body.channel_name);
    }
    else if (data.type == "join") {
      appendEvent(data.body.channel, "someone joined");
    }
    else if (data.type == "part") {
      $('.messages').find('tr[data-user="'+data.body.client+'"]').addClass("disconnected");
      appendEvent(data.body.channel, "someone left");
    }
    else if (data.type == "msg") {
      appendMessage(data.body.from, data.body.channel, data.body.msg);
    }
  }

  function sendWSData (data) {
    ws.send(JSON.stringify(data));
  }

  function focusChannel(id) {
    channels_elem.find('.channel.active').removeClass('active');
    nav.find('li.active').removeClass('active');
    nav.find('li[data-chan="'+id+'"]').addClass('active');
    var channel = channels_elem.find('.channel[data-chan="'+id+'"]');
    channel.addClass('active');
    window.history.replaceState({}, "", "#" +encodeURIComponent(channel.attr('data-name')));
    input.focus();
  }

  function renderChannel(name, id) {
    input.removeAttr('disabled');
    var elem = $('<div/>', {
      'id': id,
      'data-chan': id,
      'data-name': name,
      'class': 'channel'
    });
    elem.append($('<table/>', {
      'class': 'messages',
      cellspacing: 0,
      cellpadding: 0,
      border: 0
    }));
    channels_elem.append(elem);

    var a = $('<a/>', {href: '#'}).text(name);
    var close = $('<button/>', {
      type: "button",
      'class': "close",
      'aria-hidden':"true"
    }).html("×");
    var li = $('<li/>', {'data-chan': id}).html(a);
    nav.append(li.append(close).append(a));

    focusChannel(id);
  }
});
