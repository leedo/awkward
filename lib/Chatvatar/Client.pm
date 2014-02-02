package Chatvatar::Client;

use Data::GUID;
use JSON::XS;

sub new {
  my ($class, $conn) = @_;
  my $self = bless {
    conn => $conn,
    guid => Data::GUID->new->as_string,
  }, $class;

  $self->send_message(
    setup => {
      id => $self->id
    }
  );

  return $self;
}

sub id {
  my $self = shift;
  return $self->{guid};
}

sub send_signal {
  my ($self, %args) = @_;
  $self->send_message(
    signal => \%args,
  );
}

sub send_error {
  my ($self, $error) = @_;
  $self->send_message(
    error => {message => $error},
  );
}

sub send_message {
  my ($self, $type, $args) = @_;
  $self->send(encode_json {
    type => $type,
    body => $args,
  });
}

sub send {
  my ($self, $message) = @_;
  $self->{conn}->send($message);
}

1;
