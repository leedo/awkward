use Awkward;
use Awkward::UUID;

use Plack::App::File;
use Plack::Request;
use Plack::Middleware::Static;
use Plack::App::WebSocket;
use Plack::Builder;
use JSON::XS;

use strict;
use warnings;

my $app = Awkward->new;

builder {
  enable "Plack::Middleware::Static",
    path => sub {s!^/assets/!!}, root => "share/assets";

  mount "/" => Plack::App::File->new(file => "share/index.html")->to_app;

  mount "/image" => sub {
    my $env = shift;
    my ($id) = $env->{PATH_INFO} =~ m{/([^/]+?)\.gif$};
    return sub {
      my $respond = shift;
      $app->get_image($id, sub {
        if ($_[0]) {
          $respond->([200, ["Content-Type", "image/gif"], [$_[0]]]);
        }
        else {
          $respond->([404, ["Content-Type", "text/plain"], ["not found"]]);
        }
      });
    };
  };

  mount "/say" => sub {
    $app->msg_channel(Plack::Request->new(shift));
    return [200, ["Content-Type", "text/plain"], ["ok"]];
  };

  mount "/identify" => sub {
    my $id = Awkward::UUID->from_env(shift);
    return [
      200,
      ["Content-Type", "text/plain",
       "Set-Cookie", "awkward_id=$id"],
      [$id->as_string]
    ];
  };

  mount "/websocket" => Plack::App::WebSocket->new(
    on_error => sub {
      my $env = shift;
      return [
        500,
        ["Content-Type" => "text/plain"],
        ["Error: " . $env->{"plack.app.websocket.error"}]
      ];
    },
    on_establish => sub {
      my ($conn, $env) = @_;
      my ($id) = $env->{PATH_INFO} =~ m{/([^/]+)$};
      my $client = $app->new_client($conn, $id);
      $conn->on(
        message => sub {
          my ($conn, $msg) = @_;
          my $data = decode_json $msg;
          $app->handle_req($client, $data);
        },
        finish => sub {
          $app->remove_client($client);
          undef $conn;
        }
      );
    }
  )->to_app;
};
