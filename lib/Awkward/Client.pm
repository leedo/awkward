package Awkward::Client;

use JSON::XS;

sub new {
  my ($class, $conn, $id) = @_;
  my $self = bless {
    conn => $conn,
    id => $id,
  }, $class;
  return $self;
}

sub id {
  my $self = shift;
  return $self->{id};
}

sub send {
  my ($self, $type, $args) = @_;
  $self->{conn}->send(encode_json {
    type => $type,
    body => $args,
  });
}

1;
