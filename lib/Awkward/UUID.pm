package Awkward::UUID;

use parent 'Data::GUID';

use Plack::Request;

sub from_env {
  my ($class, $env) = @_;
  my $req = Plack::Request->new($env);

  if (my $id = $req->cookies->{awkward_id}) {
    return $class->from_string($id);
  }

  return $class->new;
}

1;
