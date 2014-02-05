$(document).ready(function() {
  var clients = {}
    , channels = {}
    , join_queue = []
    , own_id = null
    , own_stream = null
    , ws = null
    , channels_elem = $('#channels')
    , nav = $('#nav')
    , input = $('#input-wrap input');

  navigator.getUserMedia(
    {
      video: {
        mandatory: {
          maxWidth: 320,
          maxHeight: 180
        },
      },
      audio: false
    },
    function(s) {
      own_stream = s;
      $('#channel').removeAttr('disabled');
      $('#channel').focus();
      $('#self-stream').attr('src', URL.createObjectURL(s));
      start();
    },
    function(e) {
      console.log("error getting video stream: " + e);
    }
  );

  $(window).on("focus", function() {
    input.focus();
  });


  nav.on('click', 'li', function(e) {
    e.preventDefault();
    focusChannel($(this).attr('data-chan'));
  });

  input.on("keypress", function(event) {
    if (event.charCode == 13) {
      var chan_id = channels_elem.find('.active').attr('data-chan');
      if (!channels[chan_id]) return;
      var msg = input.val();
      appendMessage(own_id, chan_id, msg);
      $.each(channels[chan_id], function(member, time) {
        sendRTCData(member, "msg", {
          channel: chan_id,
          msg: msg
        });
      });
      input.val('');
    }
  });

  $("#channel").on("keypress", function(e) {
    if (e.charCode == 13) {
      var input = $(this);
      sendWSData({
        action: "join",
        channel: input.val()
      });
      input.val('');
    }
  });

  function appendEvent(chan, message) {
    var messages = channels_elem.find('.channel[data-chan="'+chan+'"] .messages')
      , tr = $('<tr/>', {'class':'event'})
      , td = $('<td/>', {'colspan':'2'}).text(message);

    messages.append(tr.append(td));
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
    });

    var nick = $('<td/>', {'class': 'nick'});

    if (user == own_id) {
      stream = own_stream;
    }
    else if (clients[user] && clients[user]['stream']) {
      stream = clients[user]['stream'];
    }

    if (stream) {
      maybeScroll(function(scroll) {
        var video = $('<video/>', {
          autoplay: "autoplay",
          muted: "muted",
          'class': "chatvatar"
        });

        if (scroll) {
          video.on("loadeddata", function() {
            setTimeout(scroll, 10);
          });
        }

        video.attr('src', URL.createObjectURL(stream));
        nick.append(video);
        setTimeout(replaceVideoWithStill, 3000, video);
      });

    }

    new_row.prepend(nick);
    new_row.append($('<td/>',{'class':"body"}).text(message));

    maybeScroll(function() {
      messages.append(new_row);
    });
  }

  function replaceVideoWithStill(video) {
    var w = video.width()
      , h = video.height()
      , v = video.get(0);

    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    var ctx = c.getContext('2d');
    ctx.drawImage(v, 0, 0, w, h);

    var img = $('<img/>', {
      width: w,
      height: h,
      src: c.toDataURL("image/jpeg"),
      'class': 'chatvatar'
    });

    img.on("load", function() {
      video.replaceWith(this);
    });
  }

  function addIceCandidate(from, candidate) {
    if (clients[from]) {
      clients[from]['client'].addIceCandidate(new RTCIceCandidate({
        sdpMLineIndex: candidate.sdpMLineIndex,
        candidate: candidate.candidate
      }));
    }
  }

  function getClient(peer) {
    if (clients[peer] && clients[peer] != null) {
      return clients[peer]['client'];
    }

    var client = new RTCPeerConnection(
      {"iceServers": [{"url": "stun:stun.l.google.com:19302"}]},
      {"optional": [{RtpDataChannels: true}]}
    );
    var data = client.createDataChannel('data', {reliable: false});

    client.onicecandidate = function(event) {
      if (event.candidate) {
        sendWSData({
          action: "signal",
          id: peer,
          sig: {
            type: "candidate",
            candidate: event.candidate
          }
        });
      }
    };

    data.onopen = function() {
      if (join_queue[peer]) {
        $(join_queue[peer]).each(function(i, chan){
          sendRTCData(peer, "join", {channel: chan});
        })
      }
    };

    data.onclose = function() {
      removePeer(peer);
    };

    data.onmessage = function(e) {
      var data = JSON.parse(e.data);
      handleRTCMessage(data, peer);
    };

    client.onaddstream = function(event) {
      if (event && event.stream && clients[peer])
        clients[peer]['stream'] = event.stream;
    };

    client.oniceconnectionstatechange = function(event) {
      if (client.iceGatheringState == "complete" && client.iceConnectionState == "disconnected")
        removePeer(peer);
    };

    if (own_stream)
      client.addStream(own_stream);

    clients[peer] = {
      stream: null,
      data: data,
      client: client
    };

    return client;
  }

  function removePeer(id) {
    $('.messages').find('tr[data-user="'+id+'"]').addClass("disconnected");
    clients[id]['client'].oniceconnectionstatechange = null;
    clients[id]['client'].onaddstream = null;
    clients[id]['data'].onclose = null;
    clients[id]['data'].onmessage = null;
    clients[id]['data'].close();
    clients[id]['client'].close();
    clients[id] = null;
    delete clients[id];

    $.each(channels, function(chan, users) {
      if (users[id]) {
        delete channels[chan][id];
        appendEvent(chan, "someone disconnected");
      }
    });
  }

  function openWebsocket() {
    var ws_url = [
      (window.location.protocol == "http:" ? "ws:" : "wss"), "//",
      window.location.hostname, ":",
      window.location.port, "/websocket/" + own_id
    ].join("");

    var ws = new WebSocket(ws_url);

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
    if (data.type == "signal") {
      handleSignal(ws, data.body.from, data.body.data);
    }
    else if (data.type == "join") {
      renderChannel(data.body.channel_name, data.body.channel_id);

      // setup new channel
      channels[data.body.channel_id] = {};

      $(data.body.members).each(function(i, member) {
        // setup connection and queue join for new users
        if (!clients[member]) {
          queueJoin(member, data.body.channel_id);
          createOffer(member, function(desc) {
            sendWSData({
              id: member,
              action: "signal",
              sig: desc
            });
          });
        }
        // immediately send join to existing peer
        else {
          sendRTCData(member, "join", {
            channel: data.body.channel_id,
            msg: msg
          });
        }
      });
    }
  }

  function sendWSData (data) {
    ws.send(JSON.stringify(data));
  }

  function sendRTCData (to, type, body) {
    var data = clients[to]['data'];
    if (data) {
      body.from = own_id;
      data.send(JSON.stringify({
        type: type,
        body: body
      }));
    }
  }

  function handleRTCMessage (data, peer) {
    if (data.type == "msg") {
      appendMessage(data.body.from, data.body.channel, data.body.msg);
    }
    else if (data.type == "join") {
      if (channels[data.body.channel]) {
        channels[data.body.channel][data.body.from] = new Date();
        appendEvent(data.body.channel, "someone joined");
        sendRTCData(peer, "joined", {channel: data.body.channel});
      }
    }
    else if (data.type == "joined") {
      // was trying to join this channel, and we are still in it
      if (join_queue[data.body.from]
       && join_queue[data.body.from].indexOf(data.body.channel) !== -1
       && channels[data.body.channel])
      {
        delete join_queue[peer];
        channels[data.body.channel][data.body.from] = new Date();
      }
    }
    else if (data.type == "part") {
      $('.messages').find('tr[data-user="'+data.body.client+'"]').addClass("disconnected");
      appendEvent(data.body.channel, "someone left");
      delete channels[data.body.channel][data.body.from];
    }
  }

  function handleSignal(ws, from, signal) {
    if (signal.type == "offer") {
      if (clients[from])
        removePeer(from);
      setRemote(from, signal);
      createAnswer(from, function(desc) {
        sendWSData({
          id: from,
          action: "signal",
          sig: desc
        });
      });
    }
    else if (signal.type == "answer") {
      setRemote(from, signal);
    }
    else if (signal.type == "candidate") {
      addIceCandidate(from, signal.candidate);
    }
  }

  function createOffer(id, success) {
    var client = getClient(id);
    client.createOffer(function(desc) {
      client.setLocalDescription(desc);
      success(desc);
    }, function(e) {
      console.log("failed to create offer: " + e);
    });
  }

  function setRemote(from, message) {
    var client = getClient(from);
    client.setRemoteDescription(new RTCSessionDescription(message));
  }

  function createAnswer(from, success) {
    var client = getClient(from);
    client.createAnswer(function(desc) {
      client.setLocalDescription(desc);
      success(desc);
    }, function(e) {
      console.log("failed to create answer: " + e);
    });
  }

  function focusChannel(id) {
    channels_elem.find('.channel.active').removeClass('active');
    nav.find('li.active').removeClass('active');
    channels_elem.find('.channel[data-chan="'+id+'"]').addClass('active');
    nav.find('li[data-chan="'+id+'"]').addClass('active');
  }

  function renderChannel(name, id) {
    $('#start').hide();
    var elem = $('<div/>', {
      'data-chan': id,
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
    var li = $('<li/>', {'data-chan': id}).html(a);
    nav.append(li);

    focusChannel(id);
  }
});
