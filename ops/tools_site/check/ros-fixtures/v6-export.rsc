# jan/02/2024 10:15:22 by RouterOS 6.49.10
# software id = ABCD-1234
#
# model = RB3011UiAS
/interface bridge
add name=bridge-lan
add name=loopback
/ip address
add address=192.168.10.1/24 interface=bridge-lan
add address=10.255.0.1/30 interface=ether1
add address=10.255.0.5/30 interface=ether2
add address=172.16.255.1 interface=loopback
/routing ospf instance
set [ find default=yes ] distribute-default=if-installed-as-type-2 redistribute-connected=as-type-1 router-id=172.16.255.1
/routing ospf interface
add authentication=md5 authentication-key=ospfsecret interface=ether1 network-type=point-to-point
/routing ospf network
add area=backbone network=10.255.0.0/30
add area=backbone network=10.255.0.4/30
add area=backbone network=192.168.10.0/24
/routing filter
add action=accept chain=ospf-in prefix=10.0.0.0/8 prefix-length=8-24
add action=discard chain=ospf-in prefix=0.0.0.0/0
add action=accept chain=bgp-out prefix=203.0.113.0/24 set-bgp-prepend=2
/routing bgp instance
set default as=64512 router-id=172.16.255.1
/routing bgp network
add network=203.0.113.0/24 synchronize=no
/routing bgp peer
add name=upstream out-filter=bgp-out remote-address=198.51.100.1 remote-as=64500 tcp-md5-key=bgpsecret ttl=default
/ip firewall mangle
add action=mark-routing chain=prerouting new-routing-mark=via-isp2 src-address=192.168.10.128/25 passthrough=no
/ip route
add distance=1 gateway=10.255.0.2
add distance=1 gateway=10.255.0.6 routing-mark=via-isp2
add dst-address=192.0.2.0/24 type=blackhole
/ip route rule
add src-address=192.168.10.200/32 action=lookup-only-in-table table=via-isp2
/queue type
add kind=pcq name=pcq-down pcq-classifier=dst-address pcq-rate=10M pcq-limit=100
/system ntp client
set enabled=yes primary-ntp=162.159.200.1 server-dns-names=pool.ntp.org
/routing filter
add action=accept bgp-communities=64512:100 chain=bgp-in
add action=accept chain=bgp-in prefix=0.0.0.0/0 prefix-length=0-32 set-bgp-local-pref=200
/ip route
add distance=1 dst-address=198.18.0.0/15 gateway=10.255.0.2,10.255.0.6
/routing rip
set distribute-default=never
/system script
add name=failover source="/ip route set [find routing-mark=via-isp2] disabled=yes"
/ip firewall filter
add action=accept chain=input comment="long comment that the export wrapped onto a second line because it is very lo\
    ng indeed" connection-state=established,related
