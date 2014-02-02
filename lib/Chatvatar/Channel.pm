package Chatvatar::Channel;

use Data::GUID;

sub new {
  my ($class, $name) = @_;
  bless {
    name => $name,
    members => {},
    guid => Data::GUID->new->as_string,
  };
}

sub members {
  my ($self) = @_;
  return keys %{$self->{members}};
}

sub add_client {
  my ($self, $client) = @_;
  $self->{members}{$client->id} = {
    time => time,
  };
}

sub remove_client {
  my ($self, $client) = @_;
  delete $self->{members}{$client->id};
}

sub id {
  my ($self) = @_;
  return $self->{guid};
}

sub name {
  my ($self) = @_;
  return $self->{name};
}

1;
