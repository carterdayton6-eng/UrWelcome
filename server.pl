#!/usr/bin/env perl
# Ultra-lightweight zero-dependency HTTP server for LineCheck
# Usage: perl server.pl [port] (default: 8080)

use strict;
use warnings;
use IO::Socket::INET;
use File::Spec;
use Cwd qw(abs_path);

my $port = $ARGV[0] || 8080;
my $dir = abs_path(".");

my %mime_types = (
    'html' => 'text/html; charset=UTF-8',
    'css'  => 'text/css; charset=UTF-8',
    'js'   => 'application/javascript; charset=UTF-8',
    'json' => 'application/json; charset=UTF-8',
    'png'  => 'image/png',
    'jpg'  => 'image/jpeg',
    'svg'  => 'image/svg+xml',
    'ico'  => 'image/x-icon',
    'txt'  => 'text/plain; charset=UTF-8'
);

my $server = IO::Socket::INET->new(
    LocalAddr => '0.0.0.0',
    LocalPort => $port,
    Proto     => 'tcp',
    Listen    => 10,
    Reuse     => 1
) or die "Cannot create socket on port $port: $!\n";

my $wifi_ip = `ipconfig getifaddr en0 2>/dev/null`;
chomp($wifi_ip) if $wifi_ip;

print "\n⚡ LineCheck Server running!\n";
print " • Local access:   http://localhost:$port/\n";
print " • Same Wi-Fi link: http://$wifi_ip:$port/\n" if $wifi_ip;
print "📁 Serving files from: $dir\n";
print "Press Ctrl+C to stop.\n\n";

while (my $client = $server->accept()) {
    my $request = <$client>;
    next unless defined $request;

    my ($method, $url) = split(' ', $request);
    next unless ($method && $url);

    # Read remaining headers
    while (my $line = <$client>) {
        last if ($line eq "\r\n" || $line eq "\n");
    }

    $url =~ s/\?.*$//; # Strip query string
    $url = '/index.html' if ($url eq '/' || $url eq '');

    my $safe_path = File::Spec->catfile($dir, substr($url, 1));
    my $real_path = eval { abs_path($safe_path) };

    if ($real_path && -f $real_path && index($real_path, $dir) == 0) {
        my ($ext) = $real_path =~ /\.([^.]+)$/;
        my $content_type = $mime_types{$ext || ''} || 'application/octet-stream';

        if (open my $fh, '<', $real_path) {
            binmode $fh;
            my $content = do { local $/; <$fh> };
            close $fh;

            my $len = length($content);
            print $client "HTTP/1.1 200 OK\r\n";
            print $client "Content-Type: $content_type\r\n";
            print $client "Content-Length: $len\r\n";
            print $client "Access-Control-Allow-Origin: *\r\n";
            print $client "Connection: close\r\n\r\n";
            print $client $content;
        } else {
            send_404($client);
        }
    } else {
        send_404($client);
    }

    close $client;
}

sub send_404 {
    my ($client) = @_;
    my $msg = "404 Not Found";
    print $client "HTTP/1.1 404 Not Found\r\n";
    print $client "Content-Type: text/plain\r\n";
    print $client "Content-Length: " . length($msg) . "\r\n";
    print $client "Connection: close\r\n\r\n";
    print $client $msg;
}
