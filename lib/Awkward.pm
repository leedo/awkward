package Awkward;

use Awkward::Client;
use AnyEvent::Redis;
use Digest::SHA1 qw{sha1_hex};

my %ACTIONS = (
  "join"   => "join_channel",
  "signal" => "signal_client",
);

sub new {
  my $class = shift;
  bless {
    clients => {},
    redis => AnyEvent::Redis->new,
  }, $class;
}

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
      $self->{redis}->srem(channel_key($chan), $id, sub {});
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

sub channel_key { "chan-" . sha1_hex $_[0] }

sub join_channel {
  my ($self, $client, $req) = @_;

  unless (defined $req->{channel}) {
    return $client->send(error => "must specify channel");
  }

  my $chan_id = channel_key $req->{channel};
  my @members;

  $self->{redis}->multi;
  $self->{redis}->sadd($client->id, $req->{channel}, sub {});
  $self->{redis}->sadd($chan_id, $client->id, sub {});
  $self->{redis}->set("$chan_id-name", $req->{channel}, sub {});
  $self->{redis}->smembers($chan_id, sub {
    @members = grep {$client->id ne $_} @{$_[0]};
  });

  $self->{redis}->exec(sub {
    $client->send(join => {
      channel_id => $chan_id,
      channel_name => $req->{channel},
      members => \@members,
    });
  });
}

sub signal_client {
  my ($self, $client, $req) = @_;

  unless (defined $req->{id}) {
    return $client->send(error => "must specify a client id");
  }

  my $id = $req->{id};

  if (my $dest = $self->{clients}{$id}) {
    return $dest->send(
      signal => {
        from => $client->id,
        data => $req->{sig},
      }
    );
  }

  $client->send(error => "unknown client");
}

1;
