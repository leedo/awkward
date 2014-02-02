use Chatvatars;
use Plack::App::File;
use Plack::Middleware::Static;
use Plack::App::WebSocket;
use Plack::Builder;
use JSON::XS;

use strict;
use warnings;

my $app = Chatvatars->new;

builder {
  enable "Plack::Middleware::Static",
    path => sub {s!^/assets/!!}, root => "share/assets";

  mount "/" => Plack::App::File->new(file => "share/index.html")->to_app;
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
      my ($conn) = @_;
      my $client = $app->add_client($conn);
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
