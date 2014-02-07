package Awkward;

use Awkward::Client;
use AnyEvent::Redis;
use AnyEvent::Fork;
use AnyEvent::Fork::RPC;
use JSON::XS;
use Digest::SHA1 qw{sha1_hex};

my %ACTIONS = (
  "join"   => "join_channel",
  "part"   => "part_channel",
  "msg"    => "msg_channel",
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
    $self->join_channel($client, {channel => $_}) for @{$_[0]};
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
      $self->part_channel($client, {channel => $chan});
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

  $self->{redis}->hset($client->id, $chan_id, $req->{channel}, sub {});
  $self->{redis}->sadd($chan_id, $client->id, sub {});

  $client->send(joined => {
    channel_id => $chan_id,
    channel_name => $req->{channel},
  });

  $self->broadcast($chan_id, 
    exclude => $client->id,
    {join => {channel => $chan_id}}
  );
}

sub part_channel {
  my ($self, $client, $req) = @_;

  unless (defined $req->{channel}) {
    return $client->send(error => "must specify channel");
  }

  $self->{redis}->srem($req->{channel}, $client->id);
  $self->{redis}->hdel($client->id, $req->{channel}, sub {
    my $name = shift;
    $client->send(parted => {
      channel_id => $req->{channel},
      channel_name => $name,
    });
  });

  $self->broadcast($req->{channel},
    {part => {channel => $req->{channel}}}
  );
}

sub broadcast {
  my $message = pop @_;
  my ($self, $channel, %opt) = @_;

  $self->{redis}->smembers($channel, sub {
    my $members = shift;
    my @clients = grep {$_ && (!$opt{exclude} || $_->id != $opt{exclude})}
                  map {$self->{clients}{$_}}
                  @$members;
    $_->send(%$message) for @clients;
  });
}


sub msg_channel {
  my ($self, $req) = @_;

  my $p = $req->parameters;
  for (qw{channel from msg}) {
    die "missing $_" unless defined $p->{$_};
  }

  my @frames = $p->get_all("frames[]");
  my $payload = {
    msg => { map {$_ => $p->{$_}}
            qw{from channel msg} }
  };

  if (@frames) {
    $self->gifify(encode_json(\@frames), sub {
      $self->{redis}->setex($p->{from} . "-gif", 60 * 5, $_[0]);
      $self->broadcast($p->{channel}, $payload);
    });
  }
  else {
    $self->broadcast($p->{channel}, $payload);
  }
}

sub get_image {
  my ($self, $id, $cb) = @_;
  $self->{redis}->get("$id-gif", $cb);
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

1;
