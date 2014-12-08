package Awkward::Gif;

use MIME::Base64;
use JSON::XS;
use Imager;

sub make {
  my $in = decode_json $_[0];
  my @frames;

  for (@$in) {
    s{^data:image/jpeg;base64,}{};
    my $data = decode_base64 $_;
    my $image = Imager->new(data => $data, type => "jpeg");
    push @frames, $image;
  }

  my $out;

  Imager->write_multi({
    data => \$out,
    type => "gif",
    gif_delay => 0.1,
    gif_loop => 0,
  }, @frames, reverse @frames[1 .. $#frames -1]);

  return $out;
}

1;
