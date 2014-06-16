package Awkward;

use Awkward::Client;
use AnyEvent::Redis;
use AnyEvent::Fork;
use AnyEvent::Fork::RPC;
use Encode;
use JSON::XS;
use Digest::SHA1 qw{sha1_hex};

my $EXPIRE = 60 * 60 * 24 * 7;
my %ACTIONS = (
  "join"   => "join_channel",
  "part"   => "part_channel",
  "msg"    => "msg_channel",
  "ping"   => "pong",
);

sub new {
  my $class = shift;
  bless {
    clients => {},
    redis => AnyEvent::Redis->new,
  }, $class;
}

sub channel_key { "chan-" . sha1_hex $_[0] }

sub new_client {
  my ($self, $conn, $id) = @_;
  my $client = Awkward::Client->new($conn, $id);
  $self->{clients}{$id} = $client;

  # stop expiration
  $self->{redis}->persist($id);

  # rejoin channels
  $self->{redis}->hvals($id, sub {
    my $channels = shift;
    if (@$channels) {
      $self->join_channel($client, {channel => $_}) for @$channels;
    }
    else {
      $self->join_channel($client, {channel => "toot"});
    }
  });

  return $client;
}

sub remove_client {
  my ($self, $client) = @_;
  my $id = $client->id;
  delete $self->{clients}{$id};

  # remove from channels
  $self->{redis}->hkeys($id, sub {
    my $channels = shift;
    for my $chan (@$channels) {
      $self->part_channel($client, {channel => $chan}, 1);
    }
  });

  $self->{redis}->expire($id, 60 * 3, sub {});
}

sub handle_req {
  my ($self, $client, $req) = @_;
  my $method = $ACTIONS{$req->{action}};

  if ($self->can($method)) {
    return $self->$method($client, $req);
  }

  $client->send(error => "unknown action: " . $req->{action});
}

sub join_channel {
  my ($self, $client, $req) = @_;

  unless (defined $req->{channel}) {
    return $client->send(error => "must specify channel");
  }

  my $chan_id = channel_key $req->{channel};

  $self->{redis}->sadd($chan_id, $client->id, sub {
    return unless $_[0]; # already was in channel
    $self->broadcast($chan_id, 
      exclude => $client->id,
      [join => {channel => $chan_id}]
    );
  });

  $self->{redis}->hset($client->id, $chan_id, $req->{channel}, sub {
    $client->send(joined => {
      channel_id => $chan_id,
      channel_name => $req->{channel},
    });
    $self->send_backlog($client, $chan_id);
  });
}

sub send_backlog {
  my ($self, $client, $channel) = @_;
  $self->{redis}->lrange("$channel-messages", 0, -1, sub {
    return unless @{$_[0]};
    my @ids = map {"message-$_"} @{$_[0]};
    $self->{redis}->mget(@ids, sub {
      $messages = shift;

      $client->send(backlog => decode(utf8 => $_))
        for grep {$_} @$messages;

      # trim channel up to first expired message
      for my $index (0..@$messages - 1) {
        if (!$messages->[$index]) {
          $self->{redis}->ltrim("$channel-messages", 0, $index - 1);
          return;
        }
      }
    });
  });
}

sub part_channel {
  my ($self, $client, $req, $disconnect) = @_;

  unless (defined $req->{channel}) {
    return $client->send(error => "must specify channel");
  }

  if (!$disconnect) {
    $self->{redis}->hdel($client->id, $req->{channel}, sub {
      my $name = shift;
      $client->send(parted => {
        channel_id => $req->{channel},
        channel_name => $name,
      });
    });
  }

  $self->{redis}->srem($req->{channel}, $client->id, sub {
    $self->broadcast($req->{channel},
      [part => {channel => $req->{channel}}]
    );
  });
}

sub broadcast {
  my $message = pop @_;
  my ($self, $channel, %opt) = @_;
  my ($type, $body) = @$message;
  my $cv = AE::cv;

  # store it and set expire
  $self->{redis}->incr("msgid", sub {
    my $id = shift;
    $body->{id} = $id;
    if (defined $opt{frames}) {
      $self->{redis}->setex("frames-$id", $EXPIRE, $opt{frames});
    }
    $self->{redis}->lpush("$channel-messages", $id);
    $self->{redis}->setex("message-$id", $EXPIRE, encode_json $message);
    $cv->send($id);
  });

  # broadcast it
  $cv->cb(sub {
    $self->{redis}->smembers($channel, sub {
      my $members = shift;
      my @clients = grep {$_ && (!$opt{exclude} || $_->id != $opt{exclude})}
                    map {$self->{clients}{$_}}
                    @$members;
      $_->send($type, $body) for @clients;
    });
  });
}


sub msg_channel {
  my ($self, $req) = @_;

  my $p = $req->parameters;
  for (qw{channel from msg}) {
    die "missing $_" unless defined $p->{$_};
    $p->{$_} = decode "utf8", $p->{$_};
  }

  my @frames = $p->get_all("frames[]");
  my $payload = [
    msg => {
      time => time,
      map {$_ => $p->{$_}} qw{from channel msg dimensions}
    }
  ];

  if (@frames) {
    $self->gifify(encode_json(\@frames), sub {
      $self->broadcast($p->{channel}, frames => $_[0], $payload);
    });
  }
  else {
    $self->broadcast($p->{channel}, $payload);
  }
}

sub get_image {
  my ($self, $id, $cb) = @_;
  $self->{redis}->get("frames-$id", $cb);
}

sub gifify {
  my ($self, $json, $cb) = @_;
  $self->{fork} ||= AnyEvent::Fork
    ->new
    ->require("Awkward::Gif")
    ->AnyEvent::Fork::RPC::run(
      "Awkward::Gif::make"
    );

  $self->{fork}->($json, $cb);
}

sub pong {
  my ($self, $client, $req) = @_;
  $client->send(pong => {});
}

1;
