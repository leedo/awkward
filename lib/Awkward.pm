package Awkward;

use Awkward::Client;
use AnyEvent::Redis;
use JSON::XS;
use Digest::SHA1 qw{sha1_hex};

my %ACTIONS = (
  "join"   => "join_channel",
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
  $self->{redis}->smembers($id, sub {
    $self->join_channel($client, {channel => $_}) for @{$_[0]};
  });

  return $client;
}

sub remove_client {
  my ($self, $client) = @_;
  my $id = $client->id;
  delete $self->{clients}{$id};

  # remove from channels
  $self->{redis}->smembers($id, sub {
    my $channels = shift;
    for my $chan (@$channels) {
      my $key = channel_key $chan;
      $self->{redis}->srem($key, $id, sub {});
      $self->broadcast($key, {
        part => {
          client => $id, channel => $key
        }
      });
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

  $self->{redis}->sadd($client->id, $req->{channel}, sub {});
  $self->{redis}->sadd($chan_id, $client->id, sub {});
  $self->{redis}->set("$chan_id-name", $req->{channel}, sub {});

  $client->send(joined => {
    channel_id => $chan_id,
    channel_name => $req->{channel},
  });
  $self->broadcast($chan_id, 
    exclude => $client->id,
    {join => {channel => $chan_id}}
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
  if (@frames) {
    $self->{redis}->set($p->{from} . "-image", encode_json \@frames);
  }

  $self->broadcast($p->{channel}, {
    msg => {
      map {$_ => $p->{$_}} qw{from channel msg}
    }
  });
}

sub get_image {
  my ($self, $id, $cb) = @_;
  $self->{redis}->get("$id-image", $cb);
}

1;
