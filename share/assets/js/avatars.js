$(document).ready(function() {
  var own_id = null
    , own_stream = null
    , played_audio = false
    , channels = $('#channels')
    , nav = $('#nav');

  if ("getUserMedia" in navigator) {
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
  }
  else {
    alert("This browser does not support getUserMedia, so you are unable to chat.");
  }

  nav.on('click', 'li button', function(e) {
    e.preventDefault();
    var li = $(this).parents("li");
    sendWSData({
      action: "part",
      channel: li.attr('data-chan')
    });
  });

  nav.on('click', 'li a', function(e) {
    e.preventDefault();
    var li = $(this).parents("li");
    focusChannel(li.attr('data-chan'));
  });

  $('#channels').on("keypress", 'li.input input', function(e) {
    if (e.keyCode == 13) {
      if (!own_stream) {
        alert("Must allow video capture");
        return;
      }

      var chan = channels.find('.active').attr('data-chan')
        , msg = $(this).val();

      beginRecord(function(frames,w,h) {
        var data = {
          channel: chan,
          msg: msg,
          from: own_id
        };
        if (frames) {
          data["frames"] = frames;
          data["dimensions"] = w + ":" + h;
        }
        $.ajax({
          url: "/say",
          type: "POST", 
          data: data,
          dataType: "json"
        });
      });

      $(this).val('');
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

  channels.on("click", "img", function() {
    var b64 = $(this).attr('src').replace(/^data:image\/gif;base64,/, "")
      , arr = base64DecToArr(b64)
      , blob = new Blob([arr], {type: "image/gif"})
      , fd = new FormData()
      , xhr = new XMLHttpRequest();

    fd.append("image", blob);
    fd.append("key", "f1f60f1650a07bfe5f402f35205dffd4");
    xhr.open("POST", "http://api.imgur.com/2/upload.json");

    xhr.onload = function() {
      var res = JSON.parse(xhr.responseText);
      alert(res.upload.links.original);
    };

    xhr.send(fd);
  });

  $('#mobile-menu').on('click', function() {
    var gutter = $('#right-gutter');
    if (gutter.hasClass("visible")) {
      gutter.removeClass("visible");
    }
    else {
      gutter.addClass("visible");
      var doc = $(document);
      doc.scrollLeft(150);
      doc.on("scroll", function(e) {
        if (doc.scrollLeft() < 75) {
          gutter.removeClass("visible");
          doc.off("scroll");
        }
      });
    }
  });

  var resizing = null
    , resizing_scroll = null;
    
  function resizingScroll() {
    resizing = null;
    if (resizing_scroll) {
      resizing_scroll();
      resizing_scroll = null;
    }
  }

  $(window).on("resize", function() {
    if (resizing) return;
    if (!resizing_scroll) {
      maybeScroll(function(scroll) {
        if (!scroll) return;
        resizing_scroll = scroll;
      });
    }
    resizing = setTimeout(resizingScroll, 200);
  });

  console.log("starting");
  start(); // get ID and open WS

  function beginRecord(cb) {
    var channel = channels.find('.channel.active')
      , input = channel.find('li.input')
      , placeholder = input.find('.placeholder')
      , video = $('<video/>', {autoplay:"autoplay"})
      , progress = $('<progress/>', {value: 0, max: 100});

    video.width(placeholder.width());
    video.height(placeholder.height());
    placeholder.append(video).append(progress);

    var countdown = function(count) {
      if (count) {
        progress.attr('value', 100 - count * 10);
        setTimeout(countdown, 100, count - 1);
      }
      else {
        progress.attr('value', 200);
        progress.addClass('on');
        setTimeout(recordVideo, 150, video, progress, cb);
      }
    };

    video.on("loadeddata", function() {
      video.off("loadeddata");
      countdown(10);
    });

    video.attr('src', URL.createObjectURL(own_stream));
  }

  function recordVideo(video, progress, cb) {
    var v = video.get(0)
      , w = video.width()
      , h = video.height()
      , aspect = w / h
      , c = document.createElement('canvas')
      , ctx = c.getContext('2d');

    c.width = 200
    c.height = parseInt(200 / aspect);
    progress.removeClass('down');

    var frames = [];
    var frame = function(count) {
      progress.attr('value', 100 - ((10 - count)*10));
      ctx.drawImage(v, 0, 0, c.width, c.height);
      frames.push(c.toDataURL("image/jpeg", 0.7));
      if (count > 0) {
        setTimeout(frame, 100, count - 1);
      }
      else {
        v.pause();
        video.remove();
        progress.remove();
        cb(frames, c.width, c.height);
      }
    };

    frame(10);
  }

  function appendEvent(event) {
    if ($('#event-'+event.id).length)
      return;
    var messages = channels.find('.channel[data-chan="'+event.channel+'"] .messages')
      , span = $('<span />').text(event.msg)
      , li = $('<li/>', {'class':'event'}).append(span);

    if (event.id)
      li.attr('id', "event-" + event.id);

    maybeScroll(function(scroll) {
      if (event['backlog']) {
        messages.prepend(li);
      }
      else {
        messages.find('li.input').before(li);
      }
    });
  }

  function start() {
    $.ajax({
      url: "/identify",
      type: "GET",
      dataType: "text",
      success: function(res) {
        own_id = res;
        ws = openWebsocket();
      }
    });
  }

  function maybeScroll(cb) {
    var chan = $('.channel.active');
    if (!chan.length) return;

    var outer_height = chan.height()
      , inner_height = channels.height()
      , scroll = inner_height + channels.scrollTop() >= outer_height;

    var do_scroll = function() {
      channels.scrollTop(chan.height());
    };

    cb(scroll ? do_scroll : false);

    if (scroll) do_scroll();
  }

  function appendMessage(message) {
    if ($('#msg-'+message.id).length)
      return;

    var messages = channels.find('.channel[data-chan="'+message.channel+'"] .messages')
      , last_msg = messages.find("li:last-child")
      , last_user = last_msg.attr('data-user')
      , stream = null;

    var new_msg = $('<li/>', {
      'id': 'msg-'+message.id,
      'data-user': message.from
    });

    if (message.from == own_id)
      new_msg.addClass("self");

    var placeholder = $('<div/>', {'class': 'placeholder'});

    var d = message.dimensions.split(":")
      , aspect = d[0] / d[1]
      , width = 200
      , height = parseInt(200 / aspect);

    placeholder = placeholder.css({
      width: width,
      height: height
    });

    $.ajax({
      url: "/image/"+message.id+".gif",
      dataType: "text",
      success: function(frames) {
        var img = $('<img/>',{
          src: "data:image/gif;base64," + frames,
          title: "click for sharable URL",
          width: width,
          height: height
        });
        maybeScroll(function(scroll) {
          img.on("load", function() {
            if (scroll) scroll();
          });
          placeholder.replaceWith(img);
        });
      }
    });

    new_msg.prepend(placeholder);
    new_msg.append($('<span/>', {'class':'body'}).text(message.msg));

    maybeScroll(function(scroll) {
      if (message['backlog']) {
        messages.prepend(new_msg);
      }
      else {
        messages.find('li.input').before(new_msg);
      }
    });
  }

  var defaultSendWSData = function() {
    alert("not connected");
  };
  var sendWSData = defaultSendWSData;

  function openWebsocket() {
    var ws_url = [
      (window.location.protocol == "http:" ? "ws:" : "wss"), "//",
      window.location.hostname, ":",
      window.location.port, "/websocket/" + own_id
    ].join("");

    var ws = new WebSocket(ws_url);
    var timer;

    ws.onclose = function(e) {
      clearInterval(timer);
      sendWSData = defaultSendWSData;
      channels.find(".channel").remove();
      $('#channel').attr('disabled', 'disabled');
      nav.find("li").remove();
      setTimeout(openWebsocket, 3000);
    };

    ws.onopen = function(e) {
      sendWSData = function(data) {
        ws.send(JSON.stringify(data));
      };
      timer = setInterval(sendWSData, 15 * 1000, {action: "ping"});
      $('#channel').removeAttr('disabled');
      if (window.location.hash) {
        var channel = decodeURIComponent(window.location.hash).replace(/^#\/?/, "");
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

  function handleWSMessage (data) {
    if (data.type == "joined") {
      if ($('#'+data.body.channel_id).length) return;
      renderChannel(data.body.channel_name, data.body.channel_id);
      appendEvent({
        channel: data.body.channel_id,
        msg: "you joined " + data.body.channel_name
      });
    }
    else if (data.type == "parted") {
      removeChannel(data.body.channel_id);
    }
    /*
    else if (data.type == "join") {
      appendEvent({
        id: data.body.id,
        channel: data.body.channel,
        backlog: data.body.backlog ? true : false,
        msg: "someone joined",
      });
    }
    else if (data.type == "part") {
      $('.messages').find('tr[data-user="'+data.body.client+'"]').addClass("disconnected");
      appendEvent({
        id: data.body.id,
        channel: data.body.channel,
        backlog: data.body.backlog ? true : false,
        msg: "someone left"
      });
    }
    */
    else if (data.type == "msg") {
      appendMessage(data.body);
    }
    else if (data.type == "backlog") {
      var message = JSON.parse(data.body);
      message[1]["backlog"] = true;
      handleWSMessage({type: message[0], body: message[1]});
    }
  }

  function focusChannel(id) {
    channels.find('.channel.active').removeClass('active');
    nav.find('li.active').removeClass('active');
    nav.find('li[data-chan="'+id+'"]').addClass('active');
    var channel = channels.find('.channel[data-chan="'+id+'"]');
    channel.addClass('active');
    window.history.replaceState({}, "", "#/" +encodeURIComponent(channel.attr('data-name')));
    $('#channel-title').text(channel.attr('data-name'));
    channel.find("li.input input").focus();
  }

  function renderChannel(name, id) {
    var elem = $('<div/>', {
      'id': id,
      'data-chan': id,
      'data-name': name,
      'class': 'channel'
    });
    var ol = $('<ol/>', {
      'class': 'messages',
      cellspacing: 0,
      cellpadding: 0,
      border: 0
    });
    var li = $('<li/>',{'class':'input'});
    var placeholder = $('<div/>', {'class':'placeholder'});
    var input = $('<input/>', {
      "type": "text",
      "placeholder":"your message",
      "class": "form-control"
    });
    li.append(placeholder);
    li.append(input);
    ol.append(li);
    elem.append(ol);
    channels.append(elem);

    var a = $('<a/>', {href: '#'}).text(name);
    var close = $('<button/>', {
      type: "button",
      'class': "close",
      'aria-hidden':"true"
    }).html("×");
    var li = $('<li/>', {'data-chan': id}).html(a);
    nav.append(li.append(a.prepend(close)));

    focusChannel(id);
  }

  function removeChannel(id) {
    var n = nav.find('li[data-chan="'+id+'"]');

    if (n.hasClass('active')) {
      var next = n.siblings();
      if (next.length)
        focusChannel(next.first().attr('data-chan'));
    }

    $('#'+id).remove();
    n.remove();

    if (!nav.find("li").length) {
      input.attr('disabled', 'disabled');
      $('#channel').focus();
      window.history.replaceState({}, "", "/chat/");
    }
  }
});
