$(document).ready(function() {
  var own_id = null
    , own_stream = null
    , played_audio = false
    , channels = $('#channels')
    , video = $('<video/>', {autoplay:"autoplay"})
    , nav = $('#nav')
    , share = $('#share');

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
        video.attr('src', URL.createObjectURL(own_stream));
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

  $('#channels').on("click", 'li.input button.record', function(e) {
      if (!own_stream) {
        alert("Must allow video capture");
        return;
      }

      var button = $(this)
        , chan = channels.find('.active').attr('data-chan');

      button.hide();

      record(edit(function(frames,w,h) {
        if (!frames) {
          button.show();
          return;
        }
        var data = {
          channel: chan,
          msg: "",
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
          dataType: "json",
          complete: function() {
            button.show();
          }
        });
      }));
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

  channels.on("click", "#imgur", function() {
    var li = $(this).parents("li")
      , anchor = li.find("> a.anchor")
      , img = li.find("> img");

    if (li.attr('data-imgur-url')) {
      return showImgurPopover(anchor, li.attr('data-imgur-url'));
    }

    anchor.popover("destroy");
    anchor.popover({
      placement: "bottom",
      trigger: "manual",
      content: "uploading…",
    });
    anchor.popover("show");

    var b64 = img.attr('src').replace(/^data:image\/gif;base64,/, "")
      , arr = base64DecToArr(b64)
      , blob = new Blob([arr], {type: "image/gif"})
      , fd = new FormData()
      , xhr = new XMLHttpRequest();

    fd.append("image", blob);
    fd.append("key", "f1f60f1650a07bfe5f402f35205dffd4");
    xhr.open("POST", "http://api.imgur.com/2/upload.json");

    xhr.onload = function() {
      var res = JSON.parse(xhr.responseText);
      var url = res.upload.links.original;
      li.attr("data-imgur-url", url);
      showImgurPopover(anchor, url);
    };

    xhr.send(fd);
  });

  function showImgurPopover(elem, url) {
    var span = $('<span/>');
    var link = $('<a/>', {href: url}).text(url);
    var close = $('<button/>', {
      type: "button",
      'class': "close",
      'aria-hidden':"true",
      style: "display:inline-block;float:none;padding-left:5px"
    }).html("×");
    close.on("click", function() {elem.popover("destroy")});
    span.append(link).append(close);

    elem.popover("destroy");
    elem.popover({
      placement: "bottom",
      trigger: "manual",
      html: true,
      content: span
    });
    elem.popover("show");
  }

  channels.on("mouseenter", ".messages > li.msg", function() {
    share = share.remove();
    $(this).append(share);
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
    recalcSpacing();
    if (resizing) return;
    if (!resizing_scroll) {
      maybeScroll(function(scroll) {
        if (!scroll) return;
        resizing_scroll = scroll;
      });
    }
    resizing = setTimeout(resizingScroll, 200);
  });

  $(window).on("focus", function() {
    var channel = channels.find('.channel');
    if (channel.length) {
      channel.find("li.input input").focus();
      return;
    }
    $('#channel').focus();
  });

  recalcSpacing();
  start(); // get ID and open WS

  function recalcSpacing() {
    var width = channels.width() - 10
      , frame = 200
      , count = parseInt(width / (frame + 10))
      , space = 10;

    if (count > 1) {
      var excess = width - (frame * count);
      space = (excess + (excess / (count - 1))) / count;
    }

    $("#margin").text(
      ".messages>li {margin-left:"+space+"px}" +
      ".messages {margin-left:-"+space+"px}"
    );
    return excess;
  }

  function edit(cb) {
    return function(frames,w,h) {
      var channel = channels.find('.channel.active')
        , input = channel.find('li.input')
        , placeholder = input.find('.placeholder')
        , range = $('<div/>', {'class':'range'})
        , pos = $('<div/>', {'class':'range-pos'})
        , fill = $('<div/>', {'class':'range-fill'})
        , start = $('<div/>', {'class':'range-start'})
        , end = $('<div/>', {'class':'range-end'})
        , caption = ""
        , c = document.createElement('canvas')
        , ctx = c.getContext('2d')
        , frames_start = 0
        , frames_end = frames.length - 1
        , imgs = images(frames)

      var submit = $('<button/>', {
        'type': 'button',
        'class': 'btn btn-success'
      }).html("Submit");

      var cancel = $('<button/>', {
        'type': 'button',
        'class': 'btn btn-default'
      }).html("Cancel");

      var controls = $('<ul/>', {
        'id': 'controls'
      }).append(
        $('<li/>', {"class":"flip"}).html("⇄")
      ).append(
        $('<li/>', {"class":"caption"}).html("T").css("font-family","serif")
      );

      function done() {
        placeholder.html(video);
        video.get(0).play();
        cancel.remove();
        submit.remove();
        controls.remove();
      }

      function reframe(quality, flatten) {
        stop();
        ctx.fillStyle = "#fff";
        ctx.font = "20px sans-serif";
        ctx.textAlign = "center";
        for (var i=0; i< frames.length; i++) {
          ctx.drawImage(imgs[i], 0, 0, c.width, c.height);
          if (flatten)
            ctx.fillText(caption, c.width / 2, c.height - 10);
          frames[i] = c.toDataURL("image/jpeg", quality);
        }
        imgs = images(frames);
        play(0);
      }

      controls.on("click", "li.caption", function() {
        caption = prompt("Caption");
        reframe(1.0, false);
      });

      controls.on("click", "li.flip", function() {
        ctx.translate(c.width, 0);
        ctx.scale(-1, 1);
        reframe(1.0, false);
        ctx.translate(c.width, 0);
        ctx.scale(-1, 1);
      });

      cancel.on("click", function() { 
        done();
        cb();
      });

      submit.on("click", function() {
        done();
        reframe(0.7, true); // compress
        cb(frames.slice(frames_start, frames_end), w, h);
      });

      input.append(submit, cancel, controls);

      c.width = w;
      c.height = h;
      video.replaceWith(c);

      range.append(fill, pos, start, end);
      placeholder.append(range);
      end.css({left: (range.width() - end.width()) + "px"});

      var offset = range.offset().left;
      var segment_size = parseInt(range.width() / frames.length);
      pos.width(segment_size);

      $('.range-start,.range-end').on('mousedown', function(e) {
        var el = $(this);
        $(document).on('mousemove', function(e) {
          var left = e.pageX - offset - 5;
          if (left < 0 || left > w - 10)
            return;

          el.css({left: left + "px"});
          fill.css({
            'left': start.position().left,
            'width': end.position().left - start.position().left
          });
          frames_start = Math.max(0, parseInt(start.position().left / segment_size));
          frames_end = Math.min(frames.length - 1, parseInt(end.position().left / segment_size));
        });
        $(document).on('mouseup', function(e) {
          $(document).off('mousemove').off('mouseup');
        });
      });

      function images (frames) {
        return $.map(frames, function(frame) {
          var img = new Image();
          img.src = frame;
          return img;
        });
      }

      var timer = null
        , fwd = true;
      function play(index) {
        if (fwd && index > frames_end) {
          fwd = false;
          index--;
        }
        else if (!fwd && index < frames_start) {
          fwd = true;
          index++;
        }
        if (!imgs[index]) {
          console.log(imgs, index, fwd);
          timer = setTimeout(play, 100, fwd ? index + 1 : index - 1);
          return;
        }
        ctx.drawImage(imgs[index], 0, 0);
        ctx.fillStyle = "#fff";
        ctx.font = "20px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(caption, c.width / 2, c.height - 10);
        pos.css({left: (index * segment_size) + "px"});
        timer = setTimeout(play, 100, fwd ? index + 1 : index - 1);
      }

      function stop() {
        clearTimeout(timer);
      }

      play(0);
    };
  }

  function record(cb) {
    var channel = channels.find('.channel.active')
      , input = channel.find('li.input')
      , placeholder = input.find('.placeholder')
      , video = input.find('video')
      , progress = $('<progress/>', {value: 0, max: 100});

    placeholder.append(progress);

    var countdown = function(count) {
      if (count) {
        progress.attr('value', 100 - count * 10);
        setTimeout(countdown, 100, count - 1);
      }
      else {
        progress.attr('value', 200);
        progress.addClass('on');
        setTimeout(getframes, 150, video, progress, cb);
      }
    };

    countdown(10);
  }

  function getframes(video, progress, cb) {
    var v = video.get(0)
      , w = video.width()
      , h = video.height()
      , aspect = w / h
      , c = document.createElement('canvas')
      , ctx = c.getContext('2d');

    c.width = 200
    c.height = parseInt(200 / aspect);

    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);

    var frames = [];
    var limit = 25;
    var frame = function(count) {
      progress.attr('value', 100 - (((limit - count) / limit) * 100));
      ctx.drawImage(v, 0, 0, c.width, c.height);
      frames.push(c.toDataURL("image/jpeg", 1.0));
      if (count > 0) {
        setTimeout(frame, 100, count - 1);
      }
      else {
        progress.remove();
        cb(frames, c.width, c.height);
      }
    };

    frame(limit);
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
      'class': 'msg',
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
      url: "/image/"+message.id+".txt",
      dataType: "text",
      success: function(frames) {
        var img = $('<img/>',{
          src: "data:image/gif;base64," + frames,
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
    new_msg.prepend($('<a/>', {'class':'anchor', name: message.id}));

    maybeScroll(function(scroll) {
      if (message['backlog']) {
        messages.prepend(new_msg);
      }
      else {
        var slider = $('<li/>',{'class':'slider'});
        var last = messages.find('li.input');
        last.before(slider);
        slider.on("transitionend", function() {
          if (scroll) scroll();
          slider.replaceWith(new_msg);
        });
        slider.width(last.outerWidth());
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
    var placeholder = channel.find(".placeholder");
    video = video.remove();
    video.width(placeholder.width());
    video.height(placeholder.height());
    placeholder.append(video);
    video.get(0).play();
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
    var input = $('<button/>', {
      "type": "button",
      "class": "record btn btn-danger"
    }).html("Record");
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
