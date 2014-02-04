package Chatvatars;

use Chatvatar::Client;
use Chatvatar::Channel;

my %ACTIONS = (
  "join"   => "join_channel",
  "signal" => "signal_client",
);

sub new {
  my $class = shift;
  bless {
    clients => {},
    channels => {},
  }, $class;
}

sub find_client {
  my ($self, $id) = @_;
  return $self->{clients}{$id};
}

sub find_channel {
  my ($self, $id) = @_;
  return $self->{channels}{$id};
}

sub find_or_create_channel {
  my ($self, $name) = @_;

  for my $channel (values %{$self->{channels}}) {
    if ($channel->name eq $name) {
      return $channel;
    }
  }

  my $channel = Chatvatar::Channel->new($name);
  $self->{channels}{$channel->id} = $channel;
  return $channel;
}


sub add_client {
  my ($self, $conn) = @_;
  my $client = Chatvatar::Client->new($conn);
  $self->{clients}{$client->id} = $client;
  return $client;
}

sub remove_client {
  my ($self, $client) = @_;
  delete $self->{clients}{$client->id};
  for my $channel ($self->channels) {
    $channel->remove_client($client);
  }
  for my $dest ($self->clients) {
    $dest->send_message(
      disconnect => {
        client => $client->id,
      }
    );
  }
}

sub clients {
  my $self = shift;
  return values %{$self->{clients}};
}

sub channels {
  my $self = shift;
  return values %{$self->{channels}};
}

sub handle_req {
  my ($self, $client, $req) = @_;
  my $method = $ACTIONS{$req->{action}};

  if ($self->can($method)) {
    return $self->$method($client, $req);
  }

  $client->send_error("unknown action: " . $req->{action});
}

sub join_channel {
  my ($self, $client, $req) = @_;

  if (!defined $req->{channel}) {
    return $client->send_error("must specify channel");
  }

  my $channel = $self->find_or_create_channel($req->{channel});
  $channel->add_client($client);
  $client->send_message(
    "join" => {
      type => "join",
      id => $channel->id,
      name => $channel->name,
      members => [grep {$_ ne $client->id} $channel->members],
    }
  );
}

sub channel_members {
  my ($self, $channel) = @_;
  return grep {$_}
         map {$self->find_client($_)}
         $channel->members;
}


sub signal_client {
  my ($self, $client, $req) = @_;

  unless (defined $req->{id}) {
    return $client->send_error("must specify a client id");
  }

  if (my $dest = $self->find_client($req->{id})) {
    return $dest->send_signal(
      from => $client->id,
      data => $req->{sig},
    );
  }

  $client->send_error("unknown channel");
}

1;
