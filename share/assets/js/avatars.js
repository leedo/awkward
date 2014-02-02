$(document).ready(function() {
  var latest_peer = 0
    , clients = {}
    , id = null
    , channels = $('#channels')
    , own_stream = null
    , ws = openWebsocket();

  navigator.webkitGetUserMedia({audio: false, video: true}, function(s) {
    own_stream = s;
  });

  function appendMessage(user, chan, message) {
    var messages = $('#chan-'+chan).find('.messages')
      , last_row = messages.find("tr:last-child")
      , last_user = last_row.attr('data-user')
      , consecutive = last_user == user
      , stream = null;

    var outer_height = $(document).height()
      , inner_height = window.innerHeight
      , scroll = inner_height + $(document).scrollTop() >= outer_height;

    console.log(scroll);

    if (consecutive) {
      last_row.find(".body").append("<br>" + message);
      if (scroll)
        $(document).scrollTop(outer_height);
      return;
    }

    var new_row = $('<tr/>', {
      'class': (consecutive ? "consecutive" : ""),
      'data-user': user
    });

    var nick = $('<td/>', {'class': 'nick'});

    if (user == id) {
      stream = own_stream;
    }
    else if (clients[user] && clients[user]['stream']) {
      stream = clients[user]['stream'];
    }

    if (stream) {
      var video = $('<video/>', {
        autoplay: "autoplay",
        muted: "muted",
        'class': "chatvatar"
      });
      video.attr('src', URL.createObjectURL(stream));
      nick.append(video);
      if (scroll) {
        video.onload = function() {
          $(document).scrollTop(outer_height);
        }
      }
    }

    new_row.prepend(nick);
    new_row.append($('<td/>',{'class':"body"}).html(message));

    messages.append(new_row);
    if (scroll)
      $(document).scrollTop(outer_height);
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
    if (clients[peer]) {
      return clients[peer]['client'];
    }

    var client = new webkitRTCPeerConnection(
      {"iceServers": [{"url": "stun:stun.l.google.com:19302"}]},
      {"optional": []}
    );

    client.onicecandidate = function(event) {
      if (event.candidate) {
        var desc = {
          type: "candidate",
          candidate: event.candidate
        };
        ws.send(JSON.stringify({
          action: "signal",
          id: peer,
          sig: desc
        }));
      }
    };

    client.onaddstream = function(event) {
      clients[peer]['stream'] = event.stream;
    };

    client.oniceconnectionstatechange = function(event) {
      //console.log("state change", event);
    };

    client.onsignalingstatechange = function(event) {
      //console.log("signal change", event);
    };

    client.onremovestream = function(event) {
      //console.log("remove remote stream", event);
    };

    if (own_stream) {
      client.addStream(own_stream);
    }

    clients[peer] = {
      stream: null,
      peer: peer,
      client: client
    };

    return client;
  }

  function openWebsocket() {
    var ws_url = [
      (window.location.protocol == "http:" ? "ws:" : "wss"), "//",
      window.location.hostname, ":",
      window.location.port, "/websocket"
    ].join("");

    var ws = new WebSocket(ws_url);

    ws.onmessage = function(e) {
      var data = JSON.parse(e.data);
      if (data.type == "setup") {
        id = data.body.id;
      }
      else if (data.type == "signal") {
        handleSignal(ws, data.body.from, data.body.data);
      }
      else if (data.type == "join") {
        renderChannel(data.body.name, data.body.id);
        if (data.body.members.length) {
          $(data.body.members).each(function(i, member) {
            console.log(member);
            createOffer(member, function(desc) {
              console.log(desc);
              ws.send(JSON.stringify({
                id: member,
                action: "signal",
                sig: desc
              }));
            });
          });
        }
      }
      else if (data.type == "showmsg") {
        appendMessage(data.body.from, data.body.channel, data.body.msg);
      }
      else if (data.type == "disconnect") {
        console.log(data);
        $('.messages').find('tr[data-user="'+data.body.client+'"]').addClass("disconnected");
        delete clients[data.body.client];
      }
    };

    ws.onopen = function(e) {
      //console.log(e);
    };

    return ws;
  }

  $("#join").on("click", function(e) {
    var chan = $('#channel').val();
    $('#channel').prop('disabled', 'disabled');
    $('#start').hide();

    ws.send(JSON.stringify({
      action: "join",
      channel: chan
    }));

  });

  function handleSignal(ws, from, signal) {
    if (signal.type == "offer") {
      setRemote(from, signal);
      createAnswer(from, function(desc) {
        ws.send(JSON.stringify({
          id: from,
          action: "signal",
          sig: desc
        }));
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
    });
  }

  function renderChannel(name, id) {
    var elem = $('<div/>', {id: "chan-"+id, 'class': 'channel active'});
    var input_wrap = $('<div/>', {'class': 'input-wrap'});
    var input = $('<input/>', {type: "text", 'class': 'form-control'});
    elem.append($('<h2/>').html(name));
    elem.append($('<table/>', {
      'class': 'messages',
      cellspacing: 0,
      cellpadding: 0,
      border: 0
    }));
    elem.append(input_wrap.append(input));
    channels.find('.channel.active').removeClass('active');
    channels.append(elem);

    input.on("keypress", function(event) {
      if (event.charCode == 13) {
        ws.send(JSON.stringify({
          action: "saymsg",
          channel: id,
          msg: input.val()
        }));
        input.val('');
      }
    });
  }
});
